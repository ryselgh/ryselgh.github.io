// Pure "Squer Clash" match engine (turn-based, no 3D scene deps, unit-testable).
// GDD §2-§4: 3 zones per side, hand 4, deck 8, Anima 60, 20 turns; one action
// per turn (draw-replace / place / attack); damage = ATK × (2/0.5/1) per type
// (12 types, TYPE_BEATS table); triggered abilities (on_play/on_destroy/
// on_attack/on_hit/on_turn_start/passive); discard pile reshuffles into the
// deck; turn limit -> higher Anima wins; heuristic bot (15% suboptimal move);
// the engine emits an event log for the UI.

var SQUER = (typeof window !== 'undefined' ? window.SQUER : globalThis.SQUER) || {};

// resolve makeRNG in both browser and Node
let _makeRNG = null;
let _makeRNGFromState = null;
if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) {
  _makeRNG = require('./rng.js').makeRNG;
  _makeRNGFromState = require('./rng.js').makeRNGFromState;
} else if (typeof makeRNG === 'function') {
  _makeRNG = makeRNG;
}
function rngFor(seed) {
  if (_makeRNG) return _makeRNG(seed);
  return { next: Math.random, int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)), pick: (arr) => arr[Math.floor(Math.random() * arr.length)], shuffle: (arr) => { const x = arr.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; } };
}
function rngFromState(state) {
  if (_makeRNGFromState) return _makeRNGFromState(state);
  return rngFor('state:' + state);
}
const CFG = () => SQUER.CONFIG || {};
const ZONES = ['left', 'center', 'right'];
const BEATS = () => CFG().TYPE_BEATS || { fuoco: ['erba', 'metallo'] };

function other(p) { return p === 'p' ? 'b' : 'p'; }

/** Max Anima per player (from config) */
function cfgAnimaMax() {
  const a = CFG().ANIMA;
  return a != null ? a : 80;
}

/** Type advantage of a over b: 1 a wins, -1 b wins, 0 neutral. */
function typeAdvantage(a, b) {
  if (a === b) return 0;
  const beats = BEATS()[a];
  if (beats && beats.indexOf(b) >= 0) return 1;
  if (BEATS()[b] && BEATS()[b].indexOf(a) >= 0) return -1;
  return 0;
}

// per-card match instances
let _seq = 0;
function spawnInstance(card) {
  // normalize ability: object {kind,...} (engine/tests) or string id plus
  // separate fields (real cards from cards.js)
  let ability = null;
  const ab = card.ability;
  if (ab && typeof ab === 'object' && (ab.kind || ab.id)) {
    ability = {
      kind: ab.kind || ab.id, value: ab.value, trigger: ab.trigger,
      name: ab.name, symbol: ab.symbol, text: ab.text,
    };
  } else if (ab && typeof ab === 'string') {
    ability = {
      kind: ab, value: card.abilityValue, trigger: card.abilityTrigger,
      name: card.abilityName, symbol: card.abilitySymbol, text: card.abilityText,
    };
  }
  return {
    id: 'i' + (++_seq) + '_' + Math.floor(Math.random() * 1e6).toString(36),
    uid: card.uid, name: card.name,
    type: card.type || 'normale',
    typeSymbol: card.typeSymbol || '✨',
    atk: card.atk, hp: card.hp,
    curAtk: card.atk, curHp: card.hp,
    ability,
  };
}

/** Readable snapshot of a card for UI events */
function cardRef(inst) {
  return {
    id: inst.id, uid: inst.uid, name: inst.name,
    type: inst.type, typeSymbol: inst.typeSymbol,
    atk: inst.atk, hp: inst.hp, curAtk: inst.curAtk, curHp: inst.curHp,
    ability: inst.ability ? { kind: inst.ability.kind, name: inst.ability.name, symbol: inst.ability.symbol, text: inst.ability.text } : null,
  };
}

function ev(state, e) { state.events.push(e); }

/** Draw 1 card to hand; reshuffles the discard pile into the deck if empty.
    Returns the card, or null when nothing can be drawn. */
function drawCardToHand(state, player, silent) {
  if (!state.deck[player].length) {
    if (!state.discard[player].length) return null;
    state.deck[player] = state.rng.shuffle(state.discard[player]);
    state.discard[player] = [];
    if (!silent) ev(state, { type: 'reshuffle', player });
  }
  const card = state.deck[player].shift();
  state.hand[player].push(card);
  if (!silent) ev(state, { type: 'draw', player, card: cardRef(card) });
  return card;
}

function canDraw(state, player) {
  return state.deck[player].length > 0 || state.discard[player].length > 0;
}

/** New match: deck = DECK_SIZE per player, hand = HAND_SIZE, Anima = ANIMA. */
function newMatch(playerDeck, botDeck, opts) {
  opts = opts || {};
  const rng = rngFor(opts.seed || ('match-' + Date.now()));
  const cfg = CFG();
  const anima = cfg.ANIMA != null ? cfg.ANIMA : 80;
  const handSize = cfg.HAND_SIZE != null ? cfg.HAND_SIZE : 4;
  const state = {
    turn: 1,
    turnPlayer: opts.first || 'p',
    maxTurns: (cfg.LIMIT_TURNS_ENABLED !== false) ? (cfg.MAX_TURNS != null ? cfg.MAX_TURNS : 20) : Infinity,
    anima: { p: anima, b: anima },
    zones: { p: {}, b: {} },
    hand: { p: [], b: [] },
    deck: { p: rng.shuffle(playerDeck.map(spawnInstance)), b: rng.shuffle(botDeck.map(spawnInstance)) },
    discard: { p: [], b: [] },
    events: [],
    over: false,
    outcome: null,
    winner: null,
    rng,
  };
  for (let i = 0; i < handSize; i++) { drawCardToHand(state, 'p', true); drawCardToHand(state, 'b', true); }
  // ★ FIRST_HAND_BONUS: the player who does NOT go first draws one extra card
  // (4 vs 5) to offset the first-move advantage (12-type simulation: first
  // player won 70% with the bonus to first, ~62% to second; combined with
  // higher HP/Anima and stronger abilities → ~55/20/25, acceptable for PvE).
  if ((cfg.FIRST_HAND_BONUS !== false) && state.deck[other(state.turnPlayer)].length) {
    drawCardToHand(state, other(state.turnPlayer), true);
  }
  return state;
}

function checkWin(state) {
  if (state.over) return;
  if (state.anima.p <= 0 || state.anima.b <= 0) finish(state);
}

function finish(state) {
  if (state.over) return;
  state.over = true;
  if (state.anima.p <= 0) { state.outcome = 'lose'; state.winner = 'b'; }
  else if (state.anima.b <= 0) { state.outcome = 'win'; state.winner = 'p'; }
  else if (state.anima.p > state.anima.b) { state.outcome = 'win'; state.winner = 'p'; }
  else if (state.anima.b > state.anima.p) { state.outcome = 'lose'; state.winner = 'b'; }
  else { state.outcome = 'draw'; state.winner = null; }
  ev(state, { type: 'end', outcome: state.outcome });
}

/* ---------- damage & death ---------- */

function dealDamage(state, targetPlayer, zone, amount, sourcePlayer, opts) {
  const slot = state.zones[targetPlayer][zone];
  if (!slot) return 0;
  const card = slot.card;
  let dmg = amount;
  if (card.ability && card.ability.kind === 'damage_reduce') {
    dmg = Math.max(0, dmg - card.ability.value);
    ev(state, { type: 'ability', player: targetPlayer, zone, text: card.ability.name + ': -' + card.ability.value + ' danno' });
  }
  card.curHp -= dmg;
  ev(state, { type: 'damage', player: targetPlayer, zone, card: cardRef(card), dmg, from: sourcePlayer, ability: (opts && opts.ability) || null });
  if (card.curHp <= 0) killCard(state, targetPlayer, zone, sourcePlayer);
  return dmg;
}

function killCard(state, player, zone, killer) {
  const slot = state.zones[player][zone];
  if (!slot) return;
  const card = slot.card;
  state.zones[player][zone] = null;
  ev(state, { type: 'kill', player, zone, card: cardRef(card) });
  // revive: comes back to the field with half HP
  if (card.ability && card.ability.kind === 'revive') {
    card.curHp = Math.ceil(card.hp / 2);
    state.zones[player][zone] = { card };
    ev(state, { type: 'ability', player, zone, text: card.ability.name + ': torna in campo con ' + card.curHp + ' PV' });
    return;
  }
  state.discard[player].push(card);
  // aoe_destroy: damages every enemy card on the field
  if (card.ability && card.ability.kind === 'aoe_destroy') {
    const opp = other(player);
    ev(state, { type: 'ability', player, zone, text: card.ability.name + ': ' + card.ability.value + ' danni a tutte le carte avversarie' });
    for (const z of ZONES) {
      if (state.zones[opp][z]) dealDamage(state, opp, z, card.ability.value, player, { ability: card.ability.name });
    }
  }
}

/** Allied card with the lowest current HP (heal_card target) */
function weakestAlly(state, player) {
  let best = null, bestRatio = Infinity;
  for (const z of ZONES) {
    const slot = state.zones[player][z];
    if (!slot) continue;
    const r = slot.card.curHp / slot.card.hp;
    if (r < bestRatio) { bestRatio = r; best = slot; }
  }
  return best;
}

/* ---------- ability triggers ---------- */

function triggerOnPlay(state, player, zone, card) {
  const ab = card.ability;
  if (!ab) return;
  const opp = other(player);
  switch (ab.kind) {
    case 'heal_anima':
      state.anima[player] = Math.min(cfgAnimaMax(state), state.anima[player] + ab.value);
      ev(state, { type: 'ability', player, zone, text: ab.name + ': +' + ab.value + ' Anima' });
      break;
    case 'strike_anima':
      state.anima[opp] -= ab.value;
      ev(state, { type: 'ability', player, zone, text: ab.name + ': -' + ab.value + ' Anima avversaria' });
      checkWin(state);
      break;
    case 'deal_front':
      if (state.zones[opp][zone]) {
        ev(state, { type: 'ability', player, zone, text: ab.name + ': ' + ab.value + ' danni alla carta di fronte' });
        dealDamage(state, opp, zone, ab.value, player, { ability: ab.name });
      }
      break;
    case 'aoe_play':
      ev(state, { type: 'ability', player, zone, text: ab.name + ': ' + ab.value + ' danni a tutte le carte avversarie' });
      for (const z of ZONES) { if (state.zones[opp][z]) dealDamage(state, opp, z, ab.value, player, { ability: ab.name }); }
      break;
    case 'heal_card': {
      const t = weakestAlly(state, player);
      if (t) {
        const healed = Math.min(ab.value, t.card.hp - t.card.curHp);
        if (healed > 0) {
          t.card.curHp += healed;
          ev(state, { type: 'ability', player, zone, text: ab.name + ': cura ' + healed + ' PV a ' + t.card.name });
        }
      }
      break;
    }
    case 'draw':
      drawCardToHand(state, player, false);
      break;
    default:
      break;
  }
}

/* ---------- actions (1 per turn) ---------- */

/** Draw action, split in two steps for the UI:
    1) peekDraw: draw 1 and put it at the end of hand.
    2) resolveDrawChoice: choice = { keep:true, handIndex } or { keep:false }. */
function peekDraw(state, player) {
  if (state.over) return { ok: false, reason: 'over' };
  const card = drawCardToHand(state, player, false);
  if (!card) return { ok: false, reason: 'no_draw' };
  return { ok: true, card };
}

function resolveDrawChoice(state, player, choice) {
  const hand = state.hand[player];
  const card = hand[hand.length - 1]; // the drawn card is the last one
  if (!card) return { ok: false, reason: 'no_draw' };
  const keep = choice && choice.keep;
  if (keep && choice.handIndex != null) {
    const idx = choice.handIndex;
    if (idx >= 0 && idx < hand.length - 1 && hand[idx].id !== card.id) {
      const replaced = hand.splice(idx, 1)[0];
      state.discard[player].push(replaced);
      ev(state, { type: 'discard', player, card: cardRef(replaced) });
    }
  } else if (!keep) {
    hand.pop();
    state.deck[player].push(card);
    ev(state, { type: 'draw_reject', player, card: cardRef(card) });
  }
  return { ok: true };
}

function actionDraw(state, player, choice) {
  const r = peekDraw(state, player);
  if (!r.ok) return r;
  return resolveDrawChoice(state, player, choice || { keep: false });
}

/** Place action: move a hand card into a zone (replacing one -> discard). */
function actionPlace(state, player, handIndex, zone) {
  if (state.over) return { ok: false, reason: 'over' };
  if (ZONES.indexOf(zone) < 0) return { ok: false, reason: 'bad_zone' };
  const hand = state.hand[player];
  if (handIndex < 0 || handIndex >= hand.length) return { ok: false, reason: 'bad_hand' };
  const card = hand.splice(handIndex, 1)[0];
  const old = state.zones[player][zone];
  if (old) {
    state.discard[player].push(old.card);
    ev(state, { type: 'discard', player, zone, card: cardRef(old.card) });
  }
  state.zones[player][zone] = { card };
  ev(state, { type: 'play', player, zone, card: cardRef(card) });
  triggerOnPlay(state, player, zone, card);
  return { ok: true };
}

/** Attack action: card in zone X attacks the opposing zone X. */
function actionAttack(state, player, zone) {
  if (state.over) return { ok: false, reason: 'over' };
  const atkSlot = state.zones[player][zone];
  if (!atkSlot) return { ok: false, reason: 'no_card' };
  const attacker = atkSlot.card;
  const opp = other(player);

  // on_attack: drain_anima steals Anima before dealing damage
  if (attacker.ability && attacker.ability.kind === 'drain_anima') {
    const v = Math.min(attacker.ability.value, state.anima[opp]);
    state.anima[opp] -= v;
    state.anima[player] = Math.min(cfgAnimaMax(state), state.anima[player] + v);
    ev(state, { type: 'ability', player, zone, text: attacker.ability.name + ': ruba ' + v + ' Anima' });
    checkWin(state);
    if (state.over) return { ok: true };
  }

  const target = state.zones[opp][zone];
  if (!target) {
    // open zone: direct Anima hit (deals the full ATK, always connects)
    const dmg = attacker.curAtk;
    state.anima[opp] -= dmg;
    ev(state, { type: 'attack_anima', player, zone, dmg, attacker: cardRef(attacker) });
    ev(state, { type: 'anima', player: opp, dmg });
    checkWin(state);
    return { ok: true };
  }

  const def = target.card;
  let dmg = attacker.curAtk;
  const adv = typeAdvantage(attacker.type, def.type);
  if (adv === 1) dmg *= 2;
  else if (adv === -1) dmg = Math.floor(dmg * 0.5);
  ev(state, { type: 'attack', player, zone, dmg, adv, attacker: cardRef(attacker), defender: cardRef(def) });

  // SURPLUS_PASSES (config): excess damage to a card "spills over" onto the
  // Anima (walls reduce damage, they don't block it).
  // Values: true = full surplus, 'half' = halved surplus.
  const cfgS = CFG();
  if (cfgS.SURPLUS_PASSES) {
    let eff = dmg;
    if (def.ability && def.ability.kind === 'damage_reduce') eff = Math.max(0, eff - def.ability.value);
    let spill = Math.max(0, eff - def.curHp);
    if (cfgS.SURPLUS_PASSES === 'half') spill = Math.floor(spill / 2);
    if (spill > 0) {
      state.anima[opp] -= spill;
      ev(state, { type: 'anima', player: opp, dmg: spill, surplus: true });
    }
  }

  dealDamage(state, opp, zone, dmg, player);
  checkWin(state);
  if (state.over) return { ok: true };

  // counter: defender strikes back only if it survived
  const def2 = state.zones[opp][zone];
  if (def2 && def2.card.ability && def2.card.ability.kind === 'counter') {
    ev(state, { type: 'ability', player: opp, zone, text: def2.card.ability.name + ': ' + def2.card.ability.value + " danni all'attaccante" });
    dealDamage(state, player, zone, def2.card.ability.value, opp);
  }
  return { ok: true };
}

/** End turn: swap the active player, fire on_turn_start triggers (ramp), check turn limit. */
function endTurn(state) {
  if (state.over) return;
  checkWin(state);
  if (state.over) return;
  const next = state.turnPlayer === 'p' ? 'b' : 'p';
  state.turnPlayer = next;
  state.turn++;
  if (state.turn > (state.maxTurns || 20)) { finish(state); return; }
  for (const z of ZONES) {
    const slot = state.zones[next][z];
    if (slot && slot.card.ability && slot.card.ability.kind === 'ramp_attack') {
      slot.card.curAtk += slot.card.ability.value;
      ev(state, { type: 'ramp', player: next, zone: z, card: cardRef(slot.card), atk: slot.card.curAtk });
    }
  }
}

/* ---------- bot ---------- */

/** Random SquerBot deck: DECK_SIZE cards, no duplicates, max 2 per type,
    never a legendary the player doesn't own (no spoilers). */
function makeBotDeck(allCards, ownedUids, rng) {
  const r = rng || rngFor('bot-deck');
  const pool = allCards.filter(c =>
    c.rarity.id !== 'legendary' || (ownedUids && ownedUids.indexOf(c.uid) >= 0)
  );
  const shuffled = r.shuffle(pool);
  const deck = [];
  const byType = {};
  for (const c of shuffled) {
    if (deck.length >= (CFG().DECK_SIZE || 8)) break;
    if ((byType[c.type] || 0) >= 2) continue;
    byType[c.type] = (byType[c.type] || 0) + 1;
    deck.push(c);
  }
  for (const c of shuffled) { // edge case: top up to the full deck size
    if (deck.length >= (CFG().DECK_SIZE || 8)) break;
    if (deck.indexOf(c) < 0) deck.push(c);
  }
  return deck;
}

/** Bot move: apply a legal action (heuristic + 15% suboptimal). */
function botAct(state) {
  if (state.over || state.turnPlayer !== 'b') return { ok: false };
  const cfg = CFG();
  const threshold = cfg.BOT_ATTACK_ANIMA_THRESHOLD != null ? cfg.BOT_ATTACK_ANIMA_THRESHOLD : 25;
  const actions = [];

  // 1. direct Anima attack on an open zone with damage >= threshold
  for (const z of ZONES) {
    const atkSlot = state.zones.b[z];
    if (atkSlot && !state.zones.p[z]) {
      const dmg = atkSlot.card.curAtk;
      if (dmg >= threshold) actions.push({ type: 'attack', zone: z, score: 100 + dmg });
    }
  }
  // 2. take out an enemy card with a type disadvantage
  for (const z of ZONES) {
    const atkSlot = state.zones.b[z];
    const def = state.zones.p[z];
    if (atkSlot && def && typeAdvantage(atkSlot.card.type, def.card.type) === 1) {
      actions.push({ type: 'attack', zone: z, score: 90 - def.card.curHp });
    }
  }
  // 3. place the best card into an empty zone
  if (state.hand.b.length && ZONES.some(z => !state.zones.b[z])) {
    let best = null, bestScore = -1;
    state.hand.b.forEach((c, i) => {
      for (const z of ZONES) {
        if (state.zones.b[z]) continue;
        let score = c.curAtk + Math.floor(c.curHp / 2);
        const def = state.zones.p[z];
        if (def && typeAdvantage(c.type, def.card.type) === 1) score += 40;
        if (!def) score += 20;
        if (score > bestScore) { bestScore = score; best = { handIndex: i, zone: z }; }
      }
    });
    if (best) actions.push({ type: 'place', handIndex: best.handIndex, zone: best.zone, score: 60 + bestScore });
  }
  // 4. draw
  if (canDraw(state, 'b')) actions.push({ type: 'draw', score: 10 });
  // 5. fallback: any legal attack/placement
  if (!actions.length) {
    for (const z of ZONES) { if (state.zones.b[z]) actions.push({ type: 'attack', zone: z, score: 5 }); }
    if (state.hand.b.length) {
      for (let i = 0; i < state.hand.b.length; i++) {
        for (const z of ZONES) { if (!state.zones.b[z]) actions.push({ type: 'place', handIndex: i, zone: z, score: 1 }); }
      }
    }
  }
  actions.sort((a, b) => b.score - a.score);
  let chosen = actions[0];
  if (!chosen) return { ok: false };
  if (state.rng.next() < (cfg.BOT_MISTAKE_CHANCE != null ? cfg.BOT_MISTAKE_CHANCE : 0.15) && actions.length > 1) {
    chosen = actions[1];
  }
  if (chosen.type === 'attack') return actionAttack(state, 'b', chosen.zone);
  if (chosen.type === 'place') return actionPlace(state, 'b', chosen.handIndex, chosen.zone);
  // draw: keep the drawn card, discarding the worst one if the hand is full
  const hand = state.hand.b;
  let worstIdx = null, worstSum = Infinity;
  hand.forEach((c, i) => { const s = c.curAtk + c.curHp; if (s < worstSum) { worstSum = s; worstIdx = i; } });
  const full = hand.length >= (cfg.HAND_SIZE != null ? cfg.HAND_SIZE : 4);
  return actionDraw(state, 'b', { keep: true, handIndex: full && worstIdx != null ? worstIdx : null });
}

/* ---------- rewards ---------- */

function matchReward(outcome) {
  const r = (CFG().AI_REWARDS) || { win: 12, draw: 6, lose: 3 };
  return r[outcome] || 0;
}

/* ---------- state serialization (PvP: persist mid-match) ---------- */

/** JSON-safe copy of a match state: strips the live rng object (functions
    can't be JSON'd) and records its internal state via getState(). */
function serializeMatch(state) {
  const copy = JSON.parse(JSON.stringify(state));
  copy.rngState = state.rng && typeof state.rng.getState === 'function' ? state.rng.getState() : 0;
  delete copy.rng;
  return copy;
}

/** Rebuild a live state from serializeMatch() output (e.g. D1 state_json). */
function restoreMatch(json) {
  const state = JSON.parse(JSON.stringify(json));
  const rs = state.rngState != null ? state.rngState : 0;
  delete state.rngState;
  state.rng = rngFromState(rs);
  if (!Array.isArray(state.events)) state.events = [];
  return state;
}

/* ---------- API ---------- */

SQUER.GAME = {
  typeAdvantage,
  newMatch,
  actionDraw, actionPlace, actionAttack,
  peekDraw, resolveDrawChoice,
  endTurn, botAct, canDraw,
  drawCardToHand,
  spawnInstance,
  makeBotDeck,
  matchReward,
  other,
  ZONE_KEYS: ZONES.slice(),
  serializeMatch,
  restoreMatch,
};

if (typeof module !== 'undefined' && module.exports) module.exports = SQUER.GAME;

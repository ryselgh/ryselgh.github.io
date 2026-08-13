/* =========================================================
   Squer TCG - Logica di gioco v2 "Squer Clash" (logica pura)
   Nessuna dipendenza dalla scena 3D: testabile in isolamento.
   GDD §2-§4:
   - 3 zone per lato, mano 4, mazzo 8, Anima 80, 20 turni
   - 1 azione per turno: pesca-sostituzione / posiziona / attacca
   - danno = ATK × (2 / 0.5 / 1) per tipo (12 tipi, tabella TYPE_BEATS)
   - abilità con trigger (on_play/on_destroy/on_attack/on_hit/
     on_turn_start/passive)
   - pila scarti -> nuovo mazzo; limite turni -> vince chi ha più Anima
   - bot euristico (15% mossa subottimale)
   - EVENTI: il motore emette un log di eventi per la UI
   ========================================================= */

var SQUER = (typeof window !== 'undefined' ? window.SQUER : globalThis.SQUER) || {};

// ---- makeRNG disponibile in browser e Node ----
let _makeRNG = null;
if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) {
  _makeRNG = require('./rng.js').makeRNG;
} else if (typeof makeRNG === 'function') {
  _makeRNG = makeRNG;
}
function rngFor(seed) {
  if (_makeRNG) return _makeRNG(seed);
  return { next: Math.random, int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)), pick: (arr) => arr[Math.floor(Math.random() * arr.length)], shuffle: (arr) => { const x = arr.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; } };
}
const CFG = () => SQUER.CONFIG || {};
const ZONES = ['left', 'center', 'right'];
const BEATS = () => CFG().TYPE_BEATS || { fuoco: ['erba', 'metallo'] };

function other(p) { return p === 'p' ? 'b' : 'p'; }

/** Massimo Anima per giocatore (dalla config) */
function cfgAnimaMax() {
  const a = CFG().ANIMA;
  return a != null ? a : 80;
}

/** Vantaggio di tipo di a su b: 1 a vince, -1 b vince, 0 neutro. */
function typeAdvantage(a, b) {
  if (a === b) return 0;
  const beats = BEATS()[a];
  if (beats && beats.indexOf(b) >= 0) return 1;
  if (BEATS()[b] && BEATS()[b].indexOf(a) >= 0) return -1;
  return 0;
}

// ---- istanze carta in partita ----
let _seq = 0;
function spawnInstance(card) {
  // normalizza l'abilità: oggetto {kind,...} (test/motore) oppure
  // stringa id + campi separati (carte reali da cards.js)
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

/** Snapshot leggibile dalla UI per gli eventi */
function cardRef(inst) {
  return {
    id: inst.id, uid: inst.uid, name: inst.name,
    type: inst.type, typeSymbol: inst.typeSymbol,
    atk: inst.atk, hp: inst.hp, curAtk: inst.curAtk, curHp: inst.curHp,
    ability: inst.ability ? { kind: inst.ability.kind, name: inst.ability.name, symbol: inst.ability.symbol, text: inst.ability.text } : null,
  };
}

function ev(state, e) { state.events.push(e); }

/** Pesca 1 carta in mano; se il mazzo è vuoto rimischia gli scarti.
    Ritorna la carta o null se non c'è nulla da pescare. */
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

/** Nuova partita: deck = 8 carte a testa, mano = HAND_SIZE, Anima = ANIMA. */
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
  // ★ FIRST_HAND_BONUS: il giocatore che NON inizia parte con 1 carta in più
  // (4 vs 5): compensa il vantaggio dell'iniziativa (simulazione 12 tipi:
  // col bonus al primo il 1° vinceva il 70%, al secondo ~62%; combinato con
  // PV/Anima più alti e abilità più forti → ~55/20/25, accettabile PvE).
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

/* ---------- danno e morte ---------- */

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
  // revive: torna in campo con metà PV
  if (card.ability && card.ability.kind === 'revive') {
    card.curHp = Math.ceil(card.hp / 2);
    state.zones[player][zone] = { card };
    ev(state, { type: 'ability', player, zone, text: card.ability.name + ': torna in campo con ' + card.curHp + ' PV' });
    return;
  }
  state.discard[player].push(card);
  // aoe_destroy: danno a tutte le carte avversarie in campo
  if (card.ability && card.ability.kind === 'aoe_destroy') {
    const opp = other(player);
    ev(state, { type: 'ability', player, zone, text: card.ability.name + ': ' + card.ability.value + ' danni a tutte le carte avversarie' });
    for (const z of ZONES) {
      if (state.zones[opp][z]) dealDamage(state, opp, z, card.ability.value, player, { ability: card.ability.name });
    }
  }
}

/** Carta alleata con meno PV correnti (target di heal_card) */
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

/* ---------- trigger abilità ---------- */

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

/* ---------- azioni (1 per turno) ---------- */

/** Azione Pesca (in due tempi, per la UI):
    1) peekDraw: pesco 1 e la metto in mano (ultima).
    2) resolveDrawChoice: choice = { keep:true, handIndex } o { keep:false }. */
function peekDraw(state, player) {
  if (state.over) return { ok: false, reason: 'over' };
  const card = drawCardToHand(state, player, false);
  if (!card) return { ok: false, reason: 'no_draw' };
  return { ok: true, card };
}

function resolveDrawChoice(state, player, choice) {
  const hand = state.hand[player];
  const card = hand[hand.length - 1]; // la pescata è l'ultima
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

/** Azione Posiziona: carta dalla mano in una zona (sostituzione -> scarti). */
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

/** Azione Attacca: carta in zona X attacca la zona X avversaria. */
function actionAttack(state, player, zone) {
  if (state.over) return { ok: false, reason: 'over' };
  const atkSlot = state.zones[player][zone];
  if (!atkSlot) return { ok: false, reason: 'no_card' };
  const attacker = atkSlot.card;
  const opp = other(player);

  // on_attack: drain_anima (ruba Anima prima del danno)
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
    // zona scoperta: colpo diretto all'Anima (il surplus non passa: colpisce sempre l'Anima)
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

  // SURPLUS_PASSES (config): il danno in eccesso sui PV della carta
  // "trabocca" sull'Anima (i muri riducono il danno, non lo bloccano).
  // Valori: true = surplus intero, 'half' = surplus dimezzato.
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

  // counter: il difensore risponde SOLO se sopravvive
  const def2 = state.zones[opp][zone];
  if (def2 && def2.card.ability && def2.card.ability.kind === 'counter') {
    ev(state, { type: 'ability', player: opp, zone, text: def2.card.ability.name + ': ' + def2.card.ability.value + " danni all'attaccante" });
    dealDamage(state, player, zone, def2.card.ability.value, opp);
  }
  return { ok: true };
}

/** Fine turno: alterna il giocatore, trigger on_turn_start (ramp), limite turni. */
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

/** Mazzo casuale per SquerBot: 8 carte, niente duplicati, max 2 per tipo,
    mai una leggendaria che il giocatore non possiede (niente spoiler). */
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
  for (const c of shuffled) { // caso limite: riempi fino a 8
    if (deck.length >= (CFG().DECK_SIZE || 8)) break;
    if (deck.indexOf(c) < 0) deck.push(c);
  }
  return deck;
}

/** Mossa del bot: applica un'azione legale (euristica + 15% subottimale). */
function botAct(state) {
  if (state.over || state.turnPlayer !== 'b') return { ok: false };
  const cfg = CFG();
  const threshold = cfg.BOT_ATTACK_ANIMA_THRESHOLD != null ? cfg.BOT_ATTACK_ANIMA_THRESHOLD : 25;
  const actions = [];

  // 1. attacco diretto all'Anima scoperta con danno >= soglia
  for (const z of ZONES) {
    const atkSlot = state.zones.b[z];
    if (atkSlot && !state.zones.p[z]) {
      const dmg = atkSlot.card.curAtk;
      if (dmg >= threshold) actions.push({ type: 'attack', zone: z, score: 100 + dmg });
    }
  }
  // 2. eliminare una carta avversaria in vantaggio di tipo
  for (const z of ZONES) {
    const atkSlot = state.zones.b[z];
    const def = state.zones.p[z];
    if (atkSlot && def && typeAdvantage(atkSlot.card.type, def.card.type) === 1) {
      actions.push({ type: 'attack', zone: z, score: 90 - def.card.curHp });
    }
  }
  // 3. posiziona la carta migliore in una zona vuota
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
  // 4. pesca
  if (canDraw(state, 'b')) actions.push({ type: 'draw', score: 10 });
  // 5. fallback: qualsiasi attacco/posizionamento legale
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
  // pesca: tiene la pescata scartando la carta peggiore (se mano piena)
  const hand = state.hand.b;
  let worstIdx = null, worstSum = Infinity;
  hand.forEach((c, i) => { const s = c.curAtk + c.curHp; if (s < worstSum) { worstSum = s; worstIdx = i; } });
  const full = hand.length >= (cfg.HAND_SIZE != null ? cfg.HAND_SIZE : 4);
  return actionDraw(state, 'b', { keep: true, handIndex: full && worstIdx != null ? worstIdx : null });
}

/* ---------- premi ---------- */

function matchReward(outcome) {
  const r = (CFG().AI_REWARDS) || { win: 12, draw: 6, lose: 3 };
  return r[outcome] || 0;
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
};

// testabilità in Node
if (typeof module !== 'undefined' && module.exports) module.exports = SQUER.GAME;

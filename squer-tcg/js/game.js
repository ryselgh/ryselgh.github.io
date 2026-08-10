/* =========================================================
   Squer TCG - Logica di gioco "Squer Clash" (logica pura)
   Nessuna dipendenza dalla scena 3D: testabile in isolamento.
   - tabella tipi (ogni tipo vince su 2, perde contro 2)
   - scontro di zona (regola unica, effetti in sequenza)
   - scelta squadra (max 2 per tipo)
   - SquerBot (mazzo casuale, niente leggendarie non scoperte)
   - risoluzione partita (3 zone, punteggi, esito)
   ========================================================= */

var SQUER = (typeof window !== 'undefined' ? window.SQUER : globalThis.SQUER) || {};

// ---- tabella dei tipi (carte.md §1): tipo -> vince su ----
const TYPE_BEATS = {
  fuoco:     ['erba', 'metallo'],
  erba:      ['acqua', 'spettrale'],
  acqua:     ['fuoco', 'metallo'],
  folgore:   ['acqua', 'erba'],
  psico:     ['lottatore', 'fata'],
  lottatore: ['buio', 'normale'],
  buio:      ['psico', 'spettrale'],
  fata:      ['lottatore', 'buio'],
  drago:     ['fuoco', 'spettrale'],
  metallo:   ['fata', 'folgore'],
  spettrale: ['psico', 'normale'],
  normale:   ['folgore', 'fata'],
};

/** Vantaggio di tipo di a su b: 1 a vince, -1 b vince, 0 neutro/uguali. */
function typeAdvantage(a, b) {
  if (a === b) return 0;
  if (TYPE_BEATS[a] && TYPE_BEATS[a].indexOf(b) >= 0) return 1;
  if (TYPE_BEATS[b] && TYPE_BEATS[b].indexOf(a) >= 0) return -1;
  return 0;
}

/** Risolve uno scontro di zona (GDD §5 + carte.md §3).
    Ritorna { winner:'a'|'b'|'draw', capture, aScore, bScore, decidedByType, notes } */
function resolveDuel(a, b) {
  const adv = typeAdvantage(a.type, b.type);
  const aMirror = a.ability === 'specchio';
  const bMirror = b.ability === 'specchio';
  let winner = null;          // 'a' | 'b' | null (pari)
  let decidedByType = false;

  if (adv === 1) { winner = 'a'; decidedByType = true; }
  else if (adv === -1) { winner = 'b'; decidedByType = true; }
  else {
    // Decidono i PV (tipo uguale o neutro) — salvo Specchio singolo.
    // Specchio contro Specchio si annulla -> regola PV.
    if (aMirror && !bMirror) winner = 'a';
    else if (bMirror && !aMirror) winner = 'b';
    else if (a.hp > b.hp) winner = 'a';
    else if (b.hp > a.hp) winner = 'b';
  }

  const draw = { winner: 'draw', capture: 0, aScore: 0, bScore: 0, decidedByType, notes: [] };
  if (!winner) return draw;

  const w = winner === 'a' ? a : b;   // carta vincitrice
  const l = winner === 'a' ? b : a;   // carta battuta
  const notes = [];

  // 1. cattura base = PV della carta battuta
  let capture = l.hp;

  // 2. bonus del vincitore
  if (w.ability === 'fortuna') { capture += 30; notes.push('fortuna +30'); }
  if (w.ability === 'sbruffone' && w.hp > l.hp) { capture = Math.floor(capture * 1.5); notes.push('sbruffone +50%'); }
  if (w.ability === 'imprevisto' && decidedByType) { capture = Math.floor(capture * 1.5); notes.push('imprevisto +50%'); }

  // 3. scudo del perdente: la cattura si dimezza
  if (l.ability === 'scudo') { capture = Math.floor(capture / 2); notes.push('scudo /2'); }

  // 4. rivincita del perdente: segna comunque metà dei propri PV
  let loserScore = 0;
  if (l.ability === 'rivincita') { loserScore = Math.floor(l.hp / 2); notes.push('rivincita +' + loserScore); }

  return {
    winner,
    capture,
    aScore: winner === 'a' ? capture : loserScore,
    bScore: winner === 'b' ? capture : loserScore,
    decidedByType,
    notes,
  };
}

/** Sceglie una squadra di 3 carte dalla mano pescata,
    rispettando "max 2 carte dello stesso tipo" (se possibile).
    Altrimenti la regola salta (es. 5 carte tutte dello stesso tipo). */
function pickTeam(hand, rng) {
  if (!rng) rng = makeRNG('pick-team');
  const shuffled = rng.shuffle(hand);
  const team = [];
  for (const c of shuffled) {
    if (team.length >= 3) break;
    if (team.filter(t => t.type === c.type).length >= 2) continue;
    team.push(c);
  }
  // se la regola ha reso impossibile arrivare a 3, si riempie liberamente
  for (const c of shuffled) {
    if (team.length >= 3) break;
    if (team.indexOf(c) < 0) team.push(c);
  }
  return team;
}

/** Mazzo casuale di 8 carte per SquerBot (GDD §8.1):
    - niente duplicati (una copia per carta nel set)
    - max 2 carte dello stesso tipo
    - mai una leggendaria che il giocatore non possiede ancora (niente spoiler) */
function makeBotDeck(allCards, ownedUids, rng) {
  const pool = allCards.filter(c =>
    c.rarity.id !== 'legendary' || ownedUids.indexOf(c.uid) >= 0
  );
  const shuffled = rng.shuffle(pool);
  const deck = [];
  for (const c of shuffled) {
    if (deck.length >= 8) break;
    if (deck.filter(t => t.type === c.type).length >= 2) continue;
    deck.push(c);
  }
  for (const c of shuffled) { // caso limite: riempi fino a 8
    if (deck.length >= 8) break;
    if (deck.indexOf(c) < 0) deck.push(c);
  }
  return deck;
}

/** Schieramento casuale della squadra sulle 3 zone (una carta per zona). */
function botDeploy(team, rng) {
  const z = rng.shuffle(team.slice());
  return { left: z[0], center: z[1], right: z[2] };
}

/** Risolve la partita: 3 zone indipendenti, totale, esito. */
function resolveMatch(playerZones, botZones) {
  const zoneKeys = SQUER.CONFIG && SQUER.CONFIG.ZONE_KEYS ? SQUER.CONFIG.ZONE_KEYS : ['left', 'center', 'right'];
  const results = {};
  let pTotal = 0, bTotal = 0;
  for (const z of zoneKeys) {
    const r = resolveDuel(playerZones[z], botZones[z]);
    results[z] = r;
    pTotal += r.aScore;
    bTotal += r.bScore;
  }
  const outcome = pTotal > bTotal ? 'win' : (pTotal < bTotal ? 'lose' : 'draw');
  return { zoneKeys, results, pTotal, bTotal, outcome };
}

/** Squerini guadagnati in base all'esito (già configurati in game-config.js). */
function matchReward(outcome) {
  const r = (SQUER.CONFIG && SQUER.CONFIG.AI_REWARDS) || { win: 8, draw: 4, lose: 2 };
  return r[outcome] || 0;
}

SQUER.GAME = {
  TYPE_BEATS,
  typeAdvantage,
  resolveDuel,
  pickTeam,
  makeBotDeck,
  botDeploy,
  resolveMatch,
  matchReward,
  ZONE_KEYS: ['left', 'center', 'right'],
};

// testabilità in Node
if (typeof module !== 'undefined' && module.exports) module.exports = SQUER.GAME;

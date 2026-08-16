// Ability system v2 (turn-based core loop). Per-card assignment is HARDCODED
// in cards/abilities.json (title -> { kind, value, text }), chosen by hand
// from each title's vibe (see GDD §2.4). This file: per-kind metadata
// (trigger/symbol/name) + seed fallback.
// Triggers: on_play / on_destroy / on_attack / on_hit / on_turn_start / passive

var SQUER = window.SQUER || (window.SQUER = {});

const ABILITIES_PATH = 'cards/abilities.json';

// per-kind metadata: trigger, UI symbol, short name
const KIND_META = {
  heal_anima:     { trigger: 'on_play',    symbol: '💚', name: 'Rigenerazione' },
  strike_anima:   { trigger: 'on_play',    symbol: '💢', name: 'Colpo diretto' },
  deal_front:     { trigger: 'on_play',    symbol: '🔥', name: 'Assalto' },
  aoe_play:       { trigger: 'on_play',    symbol: '💥', name: 'Esplosione' },
  aoe_destroy:    { trigger: 'on_destroy', symbol: '💣', name: 'Vendetta' },
  drain_anima:    { trigger: 'on_attack',  symbol: '🩸', name: 'Drenaggio' },
  counter:        { trigger: 'on_hit',     symbol: '🗯️', name: 'Contrattacco' },
  damage_reduce:  { trigger: 'passive',    symbol: '🛡️', name: 'Scudo' },
  ramp_attack:    { trigger: 'on_turn_start', symbol: '📈', name: 'Crescita' },
  heal_card:      { trigger: 'on_play',    symbol: '💗', name: 'Cura' },
  boost_adjacent: { trigger: 'passive',    symbol: '🤝', name: 'Aura' },
  draw:           { trigger: 'on_play',    symbol: '🎴', name: 'Intuito' },
  revive:         { trigger: 'on_destroy', symbol: '🌀', name: 'Rinascita' },
};

// title -> { kind, value, text } map (populated by loadAbilities)
let ABILITY_MAP = {};

/** Load cards/abilities.json (cache 'no-store': it's a hand-edited file).
    Call before createCardSet. */
async function loadAbilities() {
  try {
    const res = await fetch(ABILITIES_PATH, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') ABILITY_MAP = data;
    }
  } catch (e) { /* fall back below */ }
}

// ---- fallbacks for future cards not yet in the file (v2-scale values, x2) ----
const FALLBACKS = [
  { kind: 'ramp_attack', value: 2, text: 'Ogni tuo turno in campo, +2 ATK.' },
  { kind: 'damage_reduce', value: 10, text: 'Subisce 10 danni in meno dagli attacchi.' },
  { kind: 'heal_anima', value: 6, text: 'Giocandola, recuperi 6 Anima.' },
  { kind: 'deal_front', value: 12, text: 'Giocandola, fa 12 danni alla carta di fronte.' },
  { kind: 'heal_card', value: 16, text: 'Giocandola, cura 16 PV a una carta alleata in campo.' },
];

/** A card's ability: from cards/abilities.json (by title), else seeded from
    the file so it stays stable across loads. */
function abilityForCard(card) {
  const a = ABILITY_MAP[card.name];
  if (a && KIND_META[a.kind]) {
    const meta = KIND_META[a.kind];
    return { id: a.kind, trigger: meta.trigger, symbol: meta.symbol, name: meta.name, text: a.text, value: a.value };
  }
  const rng = makeRNG((card.file || card.uid || card.name) + '::ability-v2');
  const f = FALLBACKS[Math.floor(rng.next() * FALLBACKS.length)];
  const meta = KIND_META[f.kind];
  return { id: f.kind, trigger: meta.trigger, symbol: meta.symbol, name: meta.name, text: f.text, value: f.value };
}

SQUER.ABILITIES = { loadAbilities, abilityForCard, KIND_META, get map() { return ABILITY_MAP; } };

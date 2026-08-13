/* =========================================================
   Squer TCG - Abilità v2 (core loop a turni)
   Associazione HARDCODED per carta in cards/abilities.json
   (titolo -> { kind, value, text }), scelta a mano per ogni
   carta in base al vibe del titolo (vedi GDD §2.4).
   Qui: metadati per kind (trigger/symbol/nome) + fallback.
   Trigger: on_play / on_destroy / on_attack / on_hit / passive
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});

const ABILITIES_PATH = 'cards/abilities.json';

// metadati per kind: trigger, simbolo UI, nome breve
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

// mappa titolo -> { kind, value, text } (popolata da loadAbilities)
let ABILITY_MAP = {};

/** Carica cards/abilities.json (cache 'no-store': è un file manuale).
    Chiamare prima di createCardSet. */
async function loadAbilities() {
  try {
    const res = await fetch(ABILITIES_PATH, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') ABILITY_MAP = data;
    }
  } catch (e) { /* fallback sotto */ }
}

// ---- fallback per carte future non ancora nel file (valori scala v2, x2) ----
const FALLBACKS = [
  { kind: 'ramp_attack', value: 2, text: 'Ogni tuo turno in campo, +2 ATK.' },
  { kind: 'damage_reduce', value: 10, text: 'Subisce 10 danni in meno dagli attacchi.' },
  { kind: 'heal_anima', value: 6, text: 'Giocandola, recuperi 6 Anima.' },
  { kind: 'deal_front', value: 12, text: 'Giocandola, fa 12 danni alla carta di fronte.' },
  { kind: 'heal_card', value: 16, text: 'Giocandola, cura 16 PV a una carta alleata in campo.' },
];

/** Abilità di una carta: da cards/abilities.json (per titolo), altrimenti
    stabile dal seed (file) così non cambia tra i load. */
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

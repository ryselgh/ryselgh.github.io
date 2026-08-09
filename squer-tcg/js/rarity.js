/* =========================================================
   Squer TCG - Rarity system
   Each rarity: drop weight, frame palette, effects, label
   ========================================================= */

// ★ CONFIG PULL — percentuali di uscita delle rarità.
// I valori NON sono percentuali ma PESI: la probabilità di una carta è
//   peso / somma dei pesi.
// Nota: la pity in js/packs.js garantisce almeno una Rara+ per pacchetto,
// quindi le percentuali reali per pacchetto sono leggermente più alte per
// rare/super-rare/leggendarie.
const RARITY_WEIGHTS = {
  common: 55,
  uncommon: 38,
  rare: 5,
  superRare: 1.5,
  legendary: 0.5,
};

const RARITIES = {
  common: {
    id: 'common',
    name: 'Comune',
    weight: RARITY_WEIGHTS.common,
    order: 0,
    color: '#9aa7b8',
    glow: 'rgba(154,167,184,0.35)',
    frame: ['#5b6b7d', '#3a4654'],
    accent: '#c9d4e0',
    effects: [],
    packColor: '#8fa3b8',
  },
  uncommon: {
    id: 'uncommon',
    name: 'Non Comune',
    weight: RARITY_WEIGHTS.uncommon,
    order: 1,
    color: '#4aa3ff',
    glow: 'rgba(74,163,255,0.45)',
    frame: ['#1f6fd0', '#123f7a'],
    accent: '#9fd0ff',
    effects: ['foil'],
    packColor: '#3f8fe0',
  },
  rare: {
    id: 'rare',
    name: 'Rara',
    weight: RARITY_WEIGHTS.rare,
    order: 2,
    color: '#b06bff',
    glow: 'rgba(176,107,255,0.5)',
    frame: ['#7a2fd0', '#3d1470'],
    accent: '#d9b6ff',
    effects: ['contrast', 'sparkle'],
    packColor: '#8a4fe0',
  },
  superRare: {
    id: 'superRare',
    name: 'Super Rara',
    weight: RARITY_WEIGHTS.superRare,
    order: 3,
    color: '#ff5fd0',
    glow: 'rgba(255,95,208,0.55)',
    frame: ['#c22f9a', '#5c0f4a'],
    accent: '#ffc2ec',
    effects: ['rainbow'],
    packColor: '#e04fb0',
  },
  legendary: {
    id: 'legendary',
    name: 'Leggendaria',
    weight: RARITY_WEIGHTS.legendary,
    order: 4,
    color: '#ffc93d',
    glow: 'rgba(255,201,61,0.65)',
    frame: ['#d99a12', '#6b4a06'],
    accent: '#ffe9a8',
    effects: ['gold', 'sparkle'],
    packColor: '#f0b020',
  },
};

const RARITY_LIST = Object.values(RARITIES).sort((a, b) => a.order - b.order);

/** Roll a rarity from weights using a [0,1) value */
function rollRarity(r) {
  const total = RARITY_LIST.reduce((s, x) => s + x.weight, 0);
  let v = r * total;
  for (const rar of RARITY_LIST) {
    v -= rar.weight;
    if (v <= 0) return rar;
  }
  return RARITY_LIST[RARITY_LIST.length - 1];
}

/** Deterministic rarity for a card seed (stable per file) */
function rarityForSeed(rng) {
  return rollRarity(rng.next());
}
/* =========================================================
   Squer TCG - Collection, packs & daily-limit persistence
   localStorage-backed. Free packs per day + pity system.
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});

const STORE_KEY = 'squer_tcg_state_v1';
const PACK_SIZE = 10;           // ★ CONFIG: carte per pacchetto
const DAILY_FREE_LIMIT = 5;     // ★ CONFIG: pacchetti gratuiti al giorno

// ★ CONFIG PITY — se un pacchetto non contiene nessuna rare+ (order >= 2),
// una carta casuale viene sostituita con una rare+ (pool di rare/super
// rare/leggendarie, pescata con i loro pesi relativi).
// Per disattivare la pity: PITY_RARE_ORDER = 99.
const PITY_RARE_ORDER = 2;

// ★ CONFIG BIAS COLLEZIONE — favorisce le carte non ancora possedute
// quando si pesca una rarità alta.
//   UNOWNED_BIAS_RARE_ORDER: rarità minima a cui si applica (2 = rare+)
//   UNOWNED_BIAS_CHANCE:     probabilità di pescare dalle non possedute (0-1)
//                            (0 = nessun bias, 1 = sempre da non possedute)
// Il bias pesca solo tra le carte non possedute DELLA STESSA rarità del posto.
const UNOWNED_BIAS_RARE_ORDER = 1;
const UNOWNED_BIAS_CHANCE = 0.05;

// ★ CONFIG CAP RARITÀ — tetto massimo di carte rare+ (order >= 2) nel
// pacchetto, in percentuale del totale. Le eccedenze (scelte a caso, fair)
// vengono rigenerate come common/uncommon coi loro pesi.
//   RARE_PLUS_MAX_PCT: 30 = max 3 carte rare+ su 10 (minimo garantito 1)
const RARE_PLUS_MAX_PCT = 30;

function defaultState() {
  return {
    version: 1,
    collection: {},        // uid -> { pulled, lastPullAt }
    packsOpened: 0,
    packsToday: 0,
    lastPackDate: todayStr(),
    totalPulls: 0,
    pity: 0,               // packs without a rare+
  };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    // roll over daily counter if date changed
    if (s.lastPackDate !== todayStr()) {
      s.packsToday = 0;
      s.lastPackDate = todayStr();
    }
    return Object.assign(defaultState(), s);
  } catch (e) {
    return defaultState();
  }
}

function saveState(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

function getState() {
  const s = loadState();
  return s;
}

function packsRemaining() {
  const s = loadState();
  return Math.max(0, DAILY_FREE_LIMIT - s.packsToday);
}

function canOpenPack() {
  return packsRemaining() > 0;
}

/** Soglie [lo, hi) in [0,1) per rollRarity limitato alle rarità con
    order in [minOrder, maxOrder] — calcolate dai pesi, quindi robuste
    a qualsiasi modifica di RARITY_WEIGHTS */
function rarityBounds(minOrder, maxOrder) {
  const total = RARITY_LIST.reduce((s, r) => s + r.weight, 0);
  let lo = 0, hi = 0;
  for (const r of RARITY_LIST) {
    if (r.order < minOrder) lo += r.weight;
    if (r.order <= maxOrder) hi += r.weight;
  }
  return [lo / total, hi / total];
}

/** Roll delle rarità di un pacchetto:
   1) genera ogni carta con i pesi normali;
   2) PITY: se non c'è nessuna rare+ (order >= PITY_RARE_ORDER), sostituisci
      una carta CASUALE con una rare+ (pool rare/super rare/leggendarie);
   3) CAP: se le rare+ superano RARE_PLUS_MAX_PCT% del pacchetto, le
      eccedenze (scelte a caso, fair) vengono rigenerate come
      common/uncommon coi loro pesi. */
function rollPackRarities(rng) {
  const rarities = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    rarities.push(rollRarity(rng.next()));
  }

  // 2) pity: sostituzione casuale (non l'ultima carta)
  if (!rarities.some(r => r.order >= PITY_RARE_ORDER)) {
    const [lo, hi] = rarityBounds(PITY_RARE_ORDER, 4);
    rarities[Math.floor(rng.next() * PACK_SIZE)] = rollRarity(rng.range(lo, hi));
  }

  // 3) cap: eccedenze rigenerate come common/uncommon (fair: shuffle)
  const maxRarePlus = Math.max(1, Math.floor(PACK_SIZE * RARE_PLUS_MAX_PCT / 100));
  const rareIdx = [];
  rarities.forEach((r, i) => { if (r.order >= 2) rareIdx.push(i); });
  if (rareIdx.length > maxRarePlus) {
    rng.shuffle(rareIdx);
    const [lo, hi] = rarityBounds(0, 1);
    for (let k = maxRarePlus; k < rareIdx.length; k++) {
      rarities[rareIdx[k]] = rollRarity(rng.range(lo, hi));
    }
  }
  return rarities;
}

/** Open a pack: returns { cards:[card...], packId, isNew:[bool] } */
function openPack(cards) {
  const s = loadState();
  if (s.packsToday >= DAILY_FREE_LIMIT) {
    throw new Error('Nessun pacchetto gratuito rimasto oggi');
  }
  const rng = makeRNG('pack_' + Date.now() + '_' + Math.random());
  const rarities = rollPackRarities(rng);
  const packId = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const chosen = rarities.map((rar, i) => {
    // pick a card of the SAME rarity as the slot: il cap sulle rare+ vale
    // sulle carte effettive, non solo sui "posti" (prima il pool era tutte
    // le carte e un posto common poteva pescare una legendary)
    let pool = cards.filter(c => c.rarity.order === rar.order);
    if (pool.length === 0) pool = cards; // fallback: rarità senza carte
    // bias toward unowned (della stessa rarità) for rare+ slots
    if (rar.order >= UNOWNED_BIAS_RARE_ORDER) {
      const unowned = pool.filter(c => !s.collection[c.uid]);
      if (unowned.length > 0 && rng.next() < UNOWNED_BIAS_CHANCE) pool = unowned;
    }
    return pool[Math.floor(rng.next() * pool.length)];
  });

  // ordine di rivelazione: rarita' crescente, cosi' le carte piu' rare
  // restano in fondo al pacchetto e vengono rivelate per ultime
  // (sort stabile: a parita' di rarita' resta l'ordine casuale del roll)
  chosen.sort((a, b) => a.rarity.order - b.rarity.order);
  rarities.sort((a, b) => a.order - b.order);

  const result = chosen.map(card => {
    const rec = s.collection[card.uid] || { pulled: 0, firstPullAt: null, lastPullAt: null };
    const isNew = !rec.firstPullAt;
    rec.pulled += 1;
    if (!rec.firstPullAt) rec.firstPullAt = Date.now();
    rec.lastPullAt = Date.now();
    s.collection[card.uid] = rec;
    card.pulled = rec.pulled;
    card.isNew = isNew;
    return { card, isNew };
  });

  s.packsOpened += 1;
  s.packsToday += 1;
  s.totalPulls += PACK_SIZE;
  s.lastPackDate = todayStr();
  s.pity = rarities.some(r => r.order >= 2) ? 0 : s.pity + 1;
  saveState(s);

  return { cards: result, rarities, packId: packId };
}

function collectionStats(cards) {
  const s = loadState();
  let owned = 0, total = cards.length;
  const byRarity = {};
  for (const c of cards) {
    const rec = s.collection[c.uid];
    if (rec && rec.pulled > 0) {
      owned++;
      byRarity[c.rarity.id] = (byRarity[c.rarity.id] || 0) + 1;
    }
  }
  return { owned, total, byRarity, packsOpened: s.packsOpened, totalPulls: s.totalPulls };
}

function isOwned(uid) {
  const s = loadState();
  const rec = s.collection[uid];
  return !!(rec && rec.pulled > 0);
}

function resetProgress() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
}
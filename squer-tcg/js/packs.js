// Collection, packs & daily-limit persistence (localStorage).
// Free packs per day + pity system.

var SQUER = window.SQUER || (window.SQUER = {});

const STORE_KEY = 'squer_tcg_state_v1';
const PACK_SIZE = 10;           // ★ CONFIG: cards per pack
const DAILY_FREE_LIMIT = 3;     // ★ CONFIG: free packs per day

// ★ CONFIG PITY — if a pack has no rare+ (order >= 2), a random card is
// replaced with a rare+ (rare/super rare/legendary pool, rolled with their
// relative weights). Disable with PITY_RARE_ORDER = 99.
const PITY_RARE_ORDER = 2;

// ★ CONFIG COLLECTION BIAS — favors cards you don't own yet when rolling a
// high rarity.
//   UNOWNED_BIAS_RARE_ORDER: minimum rarity it applies to (2 = rare+)
//   UNOWNED_BIAS_CHANCE:     chance of rolling from unowned cards (0-1)
//                            (0 = no bias, 1 = always from unowned)
// The bias only rolls among unowned cards OF THE SAME rarity as the slot.
const UNOWNED_BIAS_RARE_ORDER = 1;
const UNOWNED_BIAS_CHANCE = 0.05;

// ★ CONFIG RARITY CAP — max share of rare+ (order >= 2) cards per pack, as
// a percentage of the total. Surplus (picked randomly, fair) is re-rolled
// as common/uncommon with their weights.
//   RARE_PLUS_MAX_PCT: 30 = max 3 rare+ out of 10 (minimum guaranteed 1)
const RARE_PLUS_MAX_PCT = 30;

function defaultState() {
  return {
    version: 3,
    collection: {},        // uid -> { count, level }  (copies + level 1-5)
    packsOpened: 0,
    packsToday: 0,
    lastPackDate: todayStr(),
    totalPulls: 0,
    pity: 0,               // packs without a rare+
    // ---- game profile (Squer Clash) ----
    nickname: '',          // required on first run (3-16 chars)
    squerini: 0,           // currency: buys extra packs
    packs: 0,              // packs BOUGHT with squerini (not yet opened)
    deck: [],              // deck card uids (DECK_SIZE, never duplicated)
    matches: [],           // match history
    welcomePacks: WELCOME_PACKS, // welcome packs remaining (one-time)
    welcomeDoneDate: null, // date the LAST welcome pack was opened: daily
                           // packs unlock from the following day
    tutorialDone: false,   // tutorial completed / skipped
  };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Migrates old state (v2: collection { pulled }) -> v3 { count, level }.
    Past pulls become count (min 1), level 1. */
function migrateState(s) {
  if (s.version >= 3) return s;
  const coll = {};
  for (const [uid, rec] of Object.entries(s.collection || {})) {
    if (rec && typeof rec === 'object' && typeof rec.count === 'number') {
      coll[uid] = { count: rec.count, level: rec.level || 1 };
    } else if (rec) {
      coll[uid] = { count: Math.max(1, rec.pulled || 1), level: 1 };
    }
  }
  s.collection = coll;
  s.version = 3;
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const wasOld = s.version < 3;
    migrateState(s);
    if (wasOld) saveState(s); // persist the v2 -> v3 migration
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

/** Free packs available TODAY.
    - Never cumulative: each day restarts at 0 toward DAILY_FREE_LIMIT.
    - Unlock ONLY from the day after the last welcome pack was opened:
      on first run only the welcome pack counts. */
function dailyRemaining() {
  const s = loadState();
  const unlocked = s.welcomePacks === 0 &&
    (!s.welcomeDoneDate || s.welcomeDoneDate < todayStr());
  return unlocked ? Math.max(0, DAILY_FREE_LIMIT - s.packsToday) : 0;
}

function packsRemaining() {
  const s = loadState();
  return s.welcomePacks + dailyRemaining() + (s.packs || 0);
}

/** Available packs detail: welcome (one-time) + daily + bought (a reserve
    that never expires). */
function packsBreakdown() {
  const s = loadState();
  return { welcome: s.welcomePacks, daily: dailyRemaining(), bought: s.packs || 0 };
}

function canOpenPack() {
  return packsRemaining() > 0;
}

/** Buys N packs with squerini (PACK_PRICE each).
    Quantity clamped to [1, floor(squerini/PACK_PRICE)].
    Returns the quantity actually bought (0 if impossible). */
function buyPacks(n) {
  const s = loadState();
  const max = Math.floor(s.squerini / PACK_PRICE);
  n = Math.floor(n);
  if (!(n >= 1)) n = 1;
  if (n > max) n = max;
  if (n < 1 || max < 1) return 0;
  s.squerini -= n * PACK_PRICE;
  s.packs = (s.packs || 0) + n;
  saveState(s);
  return n;
}

/** Thresholds [lo, hi) in [0,1) for rollRarity limited to rarities with
    order in [minOrder, maxOrder] — computed from weights, so robust to any
    RARITY_WEIGHTS change */
function rarityBounds(minOrder, maxOrder) {
  const total = RARITY_LIST.reduce((s, r) => s + r.weight, 0);
  let lo = 0, hi = 0;
  for (const r of RARITY_LIST) {
    if (r.order < minOrder) lo += r.weight;
    if (r.order <= maxOrder) hi += r.weight;
  }
  return [lo / total, hi / total];
}

/** Rolls a pack's rarities:
   1) each card with normal weights;
   2) PITY: if there's no rare+ (order >= PITY_RARE_ORDER), replace a RANDOM
      card with a rare+ (rare/super rare/legendary pool);
   3) CAP: if rare+ exceed RARE_PLUS_MAX_PCT% of the pack, the surplus
      (picked randomly, fair) is re-rolled as common/uncommon with their
      weights. */
function rollPackRarities(rng) {
  const rarities = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    rarities.push(rollRarity(rng.next()));
  }

  // 2) pity: random replacement (not the last card)
  if (!rarities.some(r => r.order >= PITY_RARE_ORDER)) {
    const [lo, hi] = rarityBounds(PITY_RARE_ORDER, 4);
    rarities[Math.floor(rng.next() * PACK_SIZE)] = rollRarity(rng.range(lo, hi));
  }

  // 3) cap: surplus re-rolled as common/uncommon (fair: shuffled)
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

/** Opens a pack: returns { cards:[card...], packId, isNew:[bool] }
    Consumption order: welcome packs first (one-time), then daily free
    (expire at the end of the day), then packs bought with squerini
    (a reserve that never expires). */
function openPack(cards) {
  const s = loadState();
  const useWelcome = s.welcomePacks > 0;
  const useDaily = !useWelcome && s.packsToday < DAILY_FREE_LIMIT;
  const useBought = !useWelcome && !useDaily && (s.packs || 0) > 0;
  if (!useWelcome && !useDaily && !useBought) {
    throw new Error('Nessun pacchetto da aprire');
  }
  const rng = makeRNG('pack_' + Date.now() + '_' + Math.random());
  const rarities = rollPackRarities(rng);
  const packId = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const chosen = rarities.map((rar, i) => {
    // Pick a card of the SAME rarity as the slot: the rare+ cap applies to
    // the actual cards, not just the "slots" (the old pool was all cards,
    // so a common slot could pull a legendary)
    let pool = cards.filter(c => c.rarity.order === rar.order);
    if (pool.length === 0) pool = cards; // fallback: no cards of that rarity
    // bias toward unowned (same rarity) for rare+ slots
    if (rar.order >= UNOWNED_BIAS_RARE_ORDER) {
      const unowned = pool.filter(c => !s.collection[c.uid]);
      if (unowned.length > 0 && rng.next() < UNOWNED_BIAS_CHANCE) pool = unowned;
    }
    return pool[Math.floor(rng.next() * pool.length)];
  });

  // Reveal order: ascending rarity, so the rarest cards sit at the back and
  // are revealed last (stable sort: same-rarity cards keep the roll order)
  chosen.sort((a, b) => a.rarity.order - b.rarity.order);
  rarities.sort((a, b) => a.order - b.order);

  const result = chosen.map(card => {
    const rec = s.collection[card.uid] || { count: 0, level: 1 };
    const isNew = rec.count === 0;
    rec.count += 1;
    s.collection[card.uid] = rec;
    card.count = rec.count;
    card.level = rec.level;
    card.isNew = isNew;
    return { card, isNew };
  });

  s.packsOpened += 1;
  if (useWelcome) {
    s.welcomePacks -= 1;
    // Last welcome opened today: dailies start tomorrow
    if (s.welcomePacks === 0) s.welcomeDoneDate = todayStr();
  } else if (useDaily) {
    s.packsToday += 1;
  } else {
    s.packs = (s.packs || 0) - 1;   // bought pack
  }
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
    if (rec && rec.count > 0) {
      owned++;
      byRarity[c.rarity.id] = (byRarity[c.rarity.id] || 0) + 1;
    }
  }
  return { owned, total, byRarity, packsOpened: s.packsOpened, totalPulls: s.totalPulls };
}

function isOwned(uid) {
  const s = loadState();
  const rec = s.collection[uid];
  return !!(rec && rec.count > 0);
}

// ---------- card economy (GDD §5) ----------

/** Collection record of a card (default 1 copy, level 1). */
function getCardRec(uid) {
  const s = loadState();
  return s.collection[uid] || { count: 0, level: 1 };
}

/** Fuse: 2 copies -> +1 level (one copy consumed). Free. */
function fuseCards(uid) {
  const s = loadState();
  const rec = getCardRec(uid);
  const max = (SQUER.CONFIG && SQUER.CONFIG.MAX_LEVEL) || 5;
  if (rec.count < 2) return { ok: false, reason: 'no_copies' };
  if (rec.level >= max) return { ok: false, reason: 'max_level' };
  rec.count -= 1;
  rec.level += 1;
  s.collection[uid] = rec;
  saveState(s);
  return { ok: true, level: rec.level, count: rec.count };
}

/** Upgrade with currency: costs UPGRADE_COSTS[level]. */
function upgradeCard(uid) {
  const s = loadState();
  const rec = getCardRec(uid);
  const costs = (SQUER.CONFIG && SQUER.CONFIG.UPGRADE_COSTS) || { 1: 150, 2: 300, 3: 500, 4: 800 };
  const max = (SQUER.CONFIG && SQUER.CONFIG.MAX_LEVEL) || 5;
  if (rec.count < 1) return { ok: false, reason: 'no_card' };
  if (rec.level >= max) return { ok: false, reason: 'max_level' };
  const cost = costs[rec.level];
  if (cost == null) return { ok: false, reason: 'max_level' };
  if (s.squerini < cost) return { ok: false, reason: 'no_money', cost };
  s.squerini -= cost;
  rec.level += 1;
  s.collection[uid] = rec;
  saveState(s);
  return { ok: true, level: rec.level, cost };
}

/** Convert: 1 surplus copy -> squerini (per rarity). */
function convertDupe(uid, rarityId) {
  const s = loadState();
  const rec = getCardRec(uid);
  const rates = (SQUER.CONFIG && SQUER.CONFIG.DUPE_CONVERSION) || { common: 20, uncommon: 35, rare: 60, superRare: 100, legendary: 150 };
  if (rec.count < 2) return { ok: false, reason: 'no_copies' };
  const gain = rates[rarityId] || 20;
  rec.count -= 1;
  s.collection[uid] = rec;
  s.squerini += gain;
  saveState(s);
  return { ok: true, count: rec.count, gain };
}

/** Resets PROGRESS (collection, packs, matches) but PRESERVES the profile:
    nickname, squerini, deck, remaining welcome packs, bought packs and
    tutorial. Currency and deck are never lost on a reset. */
function resetProgress() {
  const s = loadState();
  const fresh = defaultState();
  fresh.nickname = s.nickname;
  fresh.squerini = s.squerini;
  fresh.packs = s.packs || 0;
  fresh.deck = s.deck;
  fresh.welcomePacks = s.welcomePacks;
  fresh.welcomeDoneDate = s.welcomeDoneDate;
  fresh.tutorialDone = s.tutorialDone;
  saveState(fresh);
}

/** Deletes ALL data: as if the app were freshly installed.
    Re-asks for nickname and welcome packs. */
function wipeAllData() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
}

// Exposed API (used by online.js for sync and by the app)
SQUER.PACKS = { loadState, saveState, wipeAllData, dailyRemaining, packsRemaining, openPack, defaultState };
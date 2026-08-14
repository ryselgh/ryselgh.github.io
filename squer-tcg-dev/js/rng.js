// Deterministic per-card randomness (same image => same card).

/** mulberry32 - fast, decent quality seeded PRNG */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string hash -> 32-bit uint (FNV-1a) */
function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Create a random accessor bundle for one card seed.
    getState()/makeRNGFromState() allow the PvP server to persist the RNG
    mid-match (state_json) and resume it EXACTLY where it left off. */
function makeRNG(seedStr) {
  let a = hashString(seedStr) >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** float [0,1) */
    next: rand,
    /** int in [min, max] inclusive */
    int: (min, max) => Math.floor(rand() * (max - min + 1)) + min,
    /** float in [min, max) */
    range: (min, max) => rand() * (max - min) + min,
    /** pick from array */
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
    /** shuffle copy */
    shuffle: (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
    /** current internal 32-bit state (for serialization) */
    getState: () => a >>> 0,
    /** restore an internal state returned by getState() */
    setState: (s) => { a = s >>> 0; },
  };
}

/** Rebuild an RNG from a saved state (see makeRNG().getState()) */
function makeRNGFromState(state) {
  const rng = makeRNG('');
  rng.setState(state);
  return rng;
}

/** id generator for card uid (unique per file) */
function cardUID(fileName) {
  return 'sqr_' + hashString(fileName.toLowerCase()).toString(16);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mulberry32, hashString, makeRNG, makeRNGFromState, cardUID };
}


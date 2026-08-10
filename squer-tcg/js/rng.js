/* =========================================================
   Squer TCG - Seeded RNG utilities
   Deterministic per-card randomness (same image => same card)
   ========================================================= */

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

/** Stable string hash -> 32-bit uint */
function hashString(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Create a random accessor bundle for one card seed */
function makeRNG(seedStr) {
  const rand = mulberry32(hashString(seedStr));
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
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

/** id generator for card uid (unique per file) */
function cardUID(fileName) {
  return 'sqr_' + hashString(fileName.toLowerCase()).toString(16);
}

// testabilità in Node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mulberry32, hashString, makeRNG, cardUID };
}


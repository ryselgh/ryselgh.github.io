// All game, economy and reward values live here. ★ marks values meant to be
// re-tuned by hand (same convention as packs.js / rarity.js).

var SQUER = window.SQUER || (window.SQUER = {});

// Welcome gift & economy
const WELCOME_PACKS = 5;        // ★ welcome packs on first launch (one-time extra)
const PACK_PRICE = 100;         // ★ extra pack price in squerini

// Match rewards (squerini)
const AI_REWARDS = { win: 12, draw: 6, lose: 3 };        // ★ vs SquerBot
const ONLINE_REWARDS = { win: 30, draw: 15, lose: 10 };  // ★ online (phase 2)

// Deck & match
const DECK_SIZE = 8;             // ★ cards per deck (distinct, no duplicates)
const MIN_OWNED_TO_UNLOCK = 10;  // ★ owned cards needed to unlock the game
const MIN_DECK_TO_PLAY = 3;      // ★ min deck size to start a match
const HAND_SIZE = 4;             // ★ cards in hand (drawing never exceeds this)
const ANIMA = 60;                // ★ Anima per player (60: longer games, second player can respond)
const MAX_TURNS = 20;            // ★ total turns (10 per player); then the higher Anima wins
// ★ LIMIT_TURNS_ENABLED: true ends the match at MAX_TURNS (higher Anima wins);
// false = no turn limit (play until Anima hits 0). Default OFF.
const LIMIT_TURNS_ENABLED = false;
const ZONE_KEYS = ['left', 'center', 'right']; // ★ field zones (symmetric front)

// Type chart: every type beats 2 and loses to 2 (symmetric table)
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

// Card economy (phase 3)
const UPGRADE_COSTS = { 1: 150, 2: 300, 3: 500, 4: 800 }; // ★ level -> squerini cost
const DUPE_CONVERSION = { common: 20, uncommon: 35, rare: 60, superRare: 100, legendary: 150 }; // ★ excess copy -> squerini
const MAX_LEVEL = 5;             // ★ max level for fusion/upgrade
const LEVEL_STAT_BONUS = 0.10;   // ★ +10% HP/ATK per level past the first

// Bot
const BOT_ACT_STAGGER = 550;     // ★ ms between bot moves (UI pacing)
const BOT_ATTACK_ANIMA_THRESHOLD = 15; // ★ min damage to attack an open Anima (aggressive: shorter games)
const BOT_MISTAKE_CHANCE = 0.15;       // ★ chance of a suboptimal move (not perfect play)

// Match pacing
// ★ TURN_TIME_SEC: per-turn countdown (seconds); if the player does nothing
// the turn passes automatically.
const TURN_TIME_SEC = 60;
// ★ NOTIFY_LAST_TURNS: notify when N turns are left before the end.
const NOTIFY_LAST_TURNS = 3;
// ★ SURPLUS_PASSES: true lets excess damage to a card "spill over" onto the
// enemy Anima (walls reduce damage instead of blocking it). Kept OFF on
// purpose: excess damage is lost, cards act as full shields, and since there
// is no turn limit by default, stalemates are not a problem.
const SURPLUS_PASSES = false;
// ★ FIRST_HAND_BONUS: the player who does NOT go first starts with one extra
// card in hand (4 vs 5, a "komi"): it compensates for the structural first-
// move advantage (12-type simulation: first player won ~70% with bonus to
// first, ~62% when the bonus went to second).
const FIRST_HAND_BONUS = true;

// Exposed for modules that read config at runtime
SQUER.CONFIG = {
  WELCOME_PACKS, PACK_PRICE,
  AI_REWARDS, ONLINE_REWARDS,
  DECK_SIZE, MIN_OWNED_TO_UNLOCK, MIN_DECK_TO_PLAY,
  HAND_SIZE, ANIMA, MAX_TURNS, LIMIT_TURNS_ENABLED, ZONE_KEYS,
  TYPE_BEATS,
  UPGRADE_COSTS, DUPE_CONVERSION, MAX_LEVEL, LEVEL_STAT_BONUS,
  BOT_ACT_STAGGER, BOT_ATTACK_ANIMA_THRESHOLD, BOT_MISTAKE_CHANCE,
  SURPLUS_PASSES, FIRST_HAND_BONUS,
  TURN_TIME_SEC, NOTIFY_LAST_TURNS,
};

/* =========================================================
   Squer TCG - Game config v2 (Squer Clash a turni)
   Tutti i valori di gioco, economia e premi in un solo posto.
   Stile: come packs.js / rarity.js (★ CONFIG = ritoccabile).
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});

// ---- benvenuto & economia ----
const WELCOME_PACKS = 5;        // ★ pacchetti di benvenuto al primo avvio (extra, una tantum)
const PACK_PRICE = 100;         // ★ costo pacchetto extra in squerini

// ---- premi partita (squerini) ----
const AI_REWARDS = { win: 12, draw: 6, lose: 3 };        // ★ vs SquerBot
const ONLINE_REWARDS = { win: 30, draw: 15, lose: 10 };  // ★ online (fase 2)

// ---- mazzo & partita ----
const DECK_SIZE = 8;             // ★ carte nel mazzo (distinte, mai duplicati)
const MIN_OWNED_TO_UNLOCK = 10;  // ★ carte possedute per sbloccare il gioco
const MIN_DECK_TO_PLAY = 3;      // ★ carte minime nel mazzo per poter giocare
const HAND_SIZE = 4;             // ★ carte in mano (la pesca non la supera mai)
const ANIMA = 60;                // ★ punti Anima per giocatore (60: partite più lunghe, il 2° ha tempo di rispondere)
const MAX_TURNS = 20;            // ★ turni totali (10 per giocatore): poi vince chi ha più Anima
// ★ LIMIT_TURNS_ENABLED: true = la partita finisce al MAX_TURNS (vince chi ha
// più Anima); false = nessun limite (si gioca fino all'Anima a 0). Default OFF.
const LIMIT_TURNS_ENABLED = false;
const ZONE_KEYS = ['left', 'center', 'right']; // ★ zone del campo (fronte simmetrico)

// ---- tipi: ogni tipo vince su 2, perde contro 2 (tabella simmetrica) ----
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

// ---- economia carte (fase 3) ----
const UPGRADE_COSTS = { 1: 150, 2: 300, 3: 500, 4: 800 }; // ★ livello -> costo squerini
const DUPE_CONVERSION = { common: 20, uncommon: 35, rare: 60, superRare: 100, legendary: 150 }; // ★ copia in eccesso -> squerini
const MAX_LEVEL = 5;             // ★ livello massimo per fusione/potenziamento
const LEVEL_STAT_BONUS = 0.10;   // ★ +10% PV/ATK per livello oltre il 1°

// ---- bot ----
const BOT_ACT_STAGGER = 550;     // ★ ms tra una mossa e l'altra del bot (UI)
const BOT_ATTACK_ANIMA_THRESHOLD = 15; // ★ danno minimo per attaccare l'Anima scoperta (aggressivo: piu' partite corte)
const BOT_MISTAKE_CHANCE = 0.15;       // ★ probabilità di mossa subottimale (non perfetto)

// ---- ritmo partita ----
// ★ TURN_TIME_SEC: durata di ogni turno (secondi) — countdown visibile;
// se il giocatore non agisce, il turno passa da solo.
const TURN_TIME_SEC = 60;
// ★ NOTIFY_LAST_TURNS: quando mancano N turni alla fine, mostra una notifica.
const NOTIFY_LAST_TURNS = 3;
// ★ SURPLUS_PASSES: true = il danno in eccesso sui PV di una carta
// "trabocca" sull'Anima avversaria (i muri riducono, non bloccano).
// DISATTIVATO per scelta: il danno in eccesso si perde (le carte sono
// scudi completi); le partite non hanno limite turni di default, quindi
// lo stallo non e' un problema.
const SURPLUS_PASSES = false;
// ★ FIRST_HAND_BONUS: il giocatore che NON inizia parte con 1 carta in mano
// in più (4 vs 5, "komi"): compensa il vantaggio strutturale dell'iniziativa
// (simulazione 12 tipi: col bonus al primo il 1° vinceva ~70%, al secondo ~62%).
const FIRST_HAND_BONUS = true;

// Esposizione per i moduli che leggono la config a runtime
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

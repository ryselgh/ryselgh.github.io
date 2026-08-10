/* =========================================================
   Squer TCG - Game config (Squer Clash)
   Tutti i valori di gioco, economia e premi in un solo posto.
   Stile: come packs.js / rarity.js (★ CONFIG = ritoccabile).
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});

// ---- benvenuto & economia ----
const WELCOME_PACKS = 5;        // ★ pacchetti di benvenuto al primo avvio (extra, una tantum)
const PACK_PRICE = 100;         // ★ costo pacchetto extra in squerini

// ---- premi partita (squerini) ----
const AI_REWARDS = { win: 8, draw: 4, lose: 2 };        // ★ vs SquerBot
const ONLINE_REWARDS = { win: 30, draw: 15, lose: 10 }; // ★ online (fase 2)

// ---- mazzo & partita ----
const DECK_SIZE = 8;             // ★ carte nel mazzo (distinte, mai duplicati)
const MIN_OWNED_TO_UNLOCK = 10;  // ★ carte possedute per sbloccare il gioco
const MIN_DECK_TO_PLAY = 3;      // ★ carte minime nel mazzo per poter giocare
const HAND_SIZE = 5;             // ★ carte pescate dal mazzo
const TEAM_SIZE = 3;             // ★ carte scelte per la squadra
const MAX_SAME_TYPE = 2;         // ★ max carte dello stesso tipo in squadra
const ZONE_KEYS = ['left', 'center', 'right']; // ★ zone del campo

// ---- partita: showdown & schieramento ----
const SHOWDOWN_COUNTDOWN = 10;   // ★ secondi per memorizzare le carte avversarie dopo lo showdown
const BOT_DEPLOY_STAGGER = 450;  // ★ ms tra una carta e l'altra dello schieramento bot ("un po' alla volta")

// ---- online (fase 2: solo costanti, per ora) ----
const ONLINE_TIMER_SQUAD = 60;   // ★ secondi per la scelta squadra
const ONLINE_TIMER_DEPLOY = 60;  // ★ secondi per lo schieramento

// Esposizione per i moduli che leggono la config a runtime (es. game.js)
SQUER.CONFIG = {
  WELCOME_PACKS, PACK_PRICE,
  AI_REWARDS, ONLINE_REWARDS,
  DECK_SIZE, MIN_OWNED_TO_UNLOCK, MIN_DECK_TO_PLAY,
  HAND_SIZE, TEAM_SIZE, MAX_SAME_TYPE, ZONE_KEYS,
  SHOWDOWN_COUNTDOWN, BOT_DEPLOY_STAGGER,
  ONLINE_TIMER_SQUAD, ONLINE_TIMER_DEPLOY,
};

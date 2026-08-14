// Squer TCG online client: API wrapper, sessione persistente, sync automatico.
// Il gioco base funziona OFFLINE; questo modulo è un livello opzionale sopra.
// API_BASE: '' = offline, altrimenti URL dev/prod del Worker Cloudflare.

var SQUER = window.SQUER || (window.SQUER = {});
const ONLINE_KEY = 'squer_online_session_v1';

const Online = {
  // ★ API_BASE: '' disabilita l'online (modalità offline pura).
  // DEV: https://squer-tcg-api.squer-online.workers.dev
  // PROD (futuro): https://squer-tcg-api.prod.workers.dev o dominio custom
  // Override per build: impostare window.SQUER_ONLINE_API prima del load.
  API_BASE: (typeof window !== 'undefined' && window.SQUER_ONLINE_API) || 'https://squer-tcg-api.squer-online.workers.dev',
  apiKey: 'squer-tcg', // scope del servizio (non un segreto: identifica l'app)

  token: null,
  user: null,       // profilo dal server (nickname, avatar, level, stats pvp)
  synced: false,    // true dopo un sync riuscito in questa sessione

  // ---- sessione persistente (localStorage separato dallo stato di gioco) ----
  loadSession() {
    try {
      const raw = localStorage.getItem(ONLINE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && s.token && s.user) { this.token = s.token; this.user = s.user; }
    } catch (e) { /* ignore */ }
  },
  saveSession() {
    localStorage.setItem(ONLINE_KEY, JSON.stringify({ token: this.token, user: this.user }));
  },
  clearSession() {
    this.token = null; this.user = null; this.synced = false;
    localStorage.removeItem(ONLINE_KEY);
  },

  isOnline() { return !!this.API_BASE && !!this.token; },

  // ---- API wrapper ----
  async api(path, opts = {}) {
    if (!this.API_BASE) throw new Error('online-disabled');
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    if (this.token) headers.authorization = 'Bearer ' + this.token;
    const res = await fetch(this.API_BASE + '/api' + path, { ...opts, headers });
    if (res.status === 401) { this.clearSession(); }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  },

  // ---- auth ----
  async register(nickname, password, avatarEmoji) {
    const d = await this.api('/auth/register', { method: 'POST', body: JSON.stringify({ nickname, password, avatar_emoji: avatarEmoji }) });
    this.token = d.token; this.user = d.user; this.saveSession();
    return d; // include backup_code (da mostrare UNA volta!)
  },
  async login(nickname, password) {
    const d = await this.api('/auth/login', { method: 'POST', body: JSON.stringify({ nickname, password }) });
    this.token = d.token; this.user = d.user; this.saveSession();
    return d;
  },
  async recover(nickname, backupCode, newPassword) {
    const d = await this.api('/auth/recover', { method: 'POST', body: JSON.stringify({ nickname, backup_code: backupCode, new_password: newPassword }) });
    this.token = d.token; this.user = d.user; this.saveSession();
    return d;
  },
  async logout() {
    try { await this.api('/auth/logout', { method: 'POST' }); } catch (e) { /* anche offline: logout locale */ }
    this.clearSession();
  },

  // ---- migrazione automatica (una tantum, senza prompt) ----
  async migrateLocalData() {
    const s = window.SQUER.PACKS && SQUER.PACKS.loadState ? SQUER.PACKS.loadState() : null;
    if (!s) return { ok: false, reason: 'no-state' };
    const payload = {
      collection: s.collection || {},
      squerini: s.squerini || 0,
      deck: s.deck || [],
      welcome_packs: s.welcomePacks || 0,
    };
    try {
      return await this.api('/me/migrate', { method: 'POST', body: JSON.stringify(payload) });
    } catch (e) {
      // 409 = già migrato in passato: normale, non è un errore
      return { ok: e.message === 'Dati già importati per questo account', skipped: true };
    }
  },

  // ---- sync collezione (pull + merge; push a ogni modifica) ----
  async pullCollection() {
    const d = await this.api('/me/collection');
    return d; // { collection: {uid:{count,level}}, squerini }
  },
  async pushCollection(localState) {
    const payload = { collection: localState.collection || {}, squerini: localState.squerini || 0 };
    return this.api('/me/collection', { method: 'PUT', body: JSON.stringify(payload) });
  },

  // ---- limite pacchetti server-side ----
  async packsStatus() { return this.api('/me/packs/status'); },
  async packsOpen() { return this.api('/me/packs/open', { method: 'POST' }); },

  // ---- amici ----
  async listFriends() { return this.api('/friends'); },
  async friendRequest(nickname) { return this.api('/friends/request', { method: 'POST', body: JSON.stringify({ nickname }) }); },
  async friendAccept(userId) { return this.api('/friends/accept', { method: 'POST', body: JSON.stringify({ user_id: userId }) }); },
  async friendDecline(userId) { return this.api('/friends/decline', { method: 'POST', body: JSON.stringify({ user_id: userId }) }); },
  async friendRemove(userId) { return this.api('/friends/remove', { method: 'POST', body: JSON.stringify({ user_id: userId }) }); },
  async friendProfile(userId) { return this.api('/friends/' + encodeURIComponent(userId) + '/profile'); },

  // ---- scambi ----
  async createTrade(to, cards) { return this.api('/trades', { method: 'POST', body: JSON.stringify({ to, cards }) }); },
  async listTrades() { return this.api('/trades'); },
  async tradeCounter(id, cards) { return this.api('/trades/' + id + '/counter', { method: 'POST', body: JSON.stringify({ cards }) }); },
  async tradeAccept(id) { return this.api('/trades/' + id + '/accept', { method: 'POST' }); },
  async tradeDecline(id) { return this.api('/trades/' + id + '/decline', { method: 'POST' }); },
  async tradeCancel(id) { return this.api('/trades/' + id + '/cancel', { method: 'POST' }); },

  // ---- notifiche (polling) ----
  async listNotifications() { return this.api('/me/notifications'); },
  async markNotificationsRead(ids) { return this.api('/me/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }); },

  // ---- PvP (partite su invito con PIN) ----
  async createMatch(deck) { return this.api('/matches', { method: 'POST', body: JSON.stringify({ deck }) }); },
  async joinMatch(pin, deck) { return this.api('/matches/join', { method: 'POST', body: JSON.stringify({ pin, deck }) }); },
  async getMatch(id) { return this.api('/matches/' + encodeURIComponent(id)); },
  async moveMatch(id, action, extra = {}) { return this.api('/matches/' + encodeURIComponent(id) + '/move', { method: 'POST', body: JSON.stringify({ action, ...extra }) }); },
  async matchSkip(id) { return this.moveMatch(id, 'skip'); },

  // ---- merge helper: la collezione locale diventa max(locale, server) ----
  mergeCollections(localColl, serverColl) {
    const out = { ...(serverColl || {}) };
    for (const [uid, rec] of Object.entries(localColl || {})) {
      const cur = out[uid];
      if (!cur) out[uid] = { count: rec.count, level: rec.level };
      else out[uid] = { count: Math.max(cur.count, rec.count), level: Math.max(cur.level, rec.level) };
    }
    return out;
  },
};

SQUER.Online = Online;

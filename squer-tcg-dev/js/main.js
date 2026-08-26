// Squer TCG main app: screens, pack opening, collection, battle UI.

var SQUER = window.SQUER || (window.SQUER = {});
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const RARITY_TAG_COLOR = {
  common: '#aeb9c6', uncommon: '#4aa3ff', rare: '#b06bff',
  superRare: '#ff5fd0', legendary: '#ffc93d',
};

const TYPE_NAMES_IT = {
  fuoco: 'Fuoco', erba: 'Erba', acqua: 'Acqua', folgore: 'Folgore',
  psico: 'Psico', lottatore: 'Lottatore', buio: 'Buio', fata: 'Fata',
  drago: 'Drago', metallo: 'Metallo', spettrale: 'Spettrale', normale: 'Normale',
};
function typeName(t) { return TYPE_NAMES_IT[t] || t; }
function cardName(c) { return c ? c.name : '?'; }

const App = {
  cards: [],
  scene: null,
  currentScreen: 'home',
  packResult: null,
  revealedCount: 0,
  newCardsQueue: [],
  filter: 'all',
  ownedFilter: 'all',
  search: '',
  detailIndex: 0,

  async init() {
    this.bindEvents();
    const entries = await loadManifest();
    this.cards = await createCardSet(entries, (done, total, phase) => {
      if (phase === 'draw') {
        // Phase 2: draw card canvases (after image load)
        this.updateLoader(70 + Math.round((done / total) * 20), `Disegno carte... ${done} / ${total}`);
      } else {
        // Phase 1: download images (0 -> 70% of the bar)
        this.updateLoader(Math.round((done / total) * 70), `Caricamento carte... ${done} / ${total}`);
      }
    });
    // Brief pause so "Drawing cards... N / N" is readable at 90%
    await new Promise(r => setTimeout(r, 250));
    this.updateLoader(100, 'Carte pronte!');
    setTimeout(() => {
      $('#loader').classList.add('hidden');
      this.buildTypesTable();
      // Currency badge and menu: app ready (badge must not float over the loader)
      document.body.classList.add('app-ready');
      // Sessione online già attiva? Vai dritto a home (il login NON va
      // richiesto a ogni apertura).
      SQUER.Online.loadSession();
      if (SQUER.Online.token) {
        this.showScreen('home');
        this.refreshHome();
      } else if (!loadState().nickname) {
        // Prima volta assoluta: registrazione online (il nickname si sceglie lì)
        this.showScreen('auth');
        this.showAuthPanel('register');
        $('#reg-nickname').focus();
      } else {
        // Nickname già scelto in una versione precedente: registrazione
        // precompilata col nickname (normalizzato ai caratteri concessi)
        this.showScreen('auth');
        this.showAuthPanel('register');
        $('#reg-nickname').value = this.normalizeNickname(loadState().nickname);
        $('#reg-password').focus();
      }
      if (!this.cards.length) $('#empty-banner').classList.remove('hidden');
      this.watchManifestChanges();
    }, 300);
  },

  /** Polls the manifest; if it changed (new images added), asks to reload */
  async watchManifestChanges() {    let last = null;
    try {
      const r = await fetch('cards/manifest.json', { cache: 'no-store' });
      last = r.ok ? await r.text() : null;
    } catch (e) { last = null; }
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch('cards/manifest.json', { cache: 'no-store' });
        const cur = r.ok ? await r.text() : null;
        if (cur && last && cur !== last) {
          this.toast('Nuove carte rilevate — ricarica per vederle 🔄');
        }
        last = cur;
      } catch (e) { /* ignore */ }
    }, 5000);
  },

  updateLoader(p, text) {
    if (this._loaderIv) clearInterval(this._loaderIv);    $('#loader-fill').style.width = p + '%';
    if (text) $('#loader-text').textContent = text;
  },

  /** Adatta un nickname vecchio (o libero) ai caratteri concessi dal server:
      a-z A-Z 0-9 _, max 16. Utile per precompilare la registrazione. */
  normalizeNickname(raw) {
    let n = String(raw || '').trim();
    n = n.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    n = n.slice(0, 16);
    return n;
  },

  /** Help table of the 12 types, generated from TYPE_BEATS + CARD_TYPES
      so it stays in sync with the config (never hand-duplicated).
      Narrow screens: "Vince su" / "Perde contro" show only the emoji
      symbols (no names), first column has the type name. */
  buildTypesTable() {
    const tbody = $('#types-table');
    if (!tbody || !SQUER.CONFIG || !SQUER.CONFIG.TYPE_BEATS) return;
    const beats = SQUER.CONFIG.TYPE_BEATS;
    const rows = Object.keys(beats).map((type) => {
      const meta = SQUER.CARD_TYPES && SQUER.CARD_TYPES[type];
      const sym = meta ? meta.symbol : typeName(type);
      // "Loses to" = types that list this type in their win list
      const loses = Object.keys(beats).filter(t => beats[t].indexOf(type) >= 0);
      const fmt = (list) => list.map(t => {
        const m = SQUER.CARD_TYPES && SQUER.CARD_TYPES[t];
        return '<span class="tt-cell">' + (m ? m.symbol : '') + '</span>';
      }).join('');
      return '<tr><td class="tt-name">' + typeName(type) + '</td>' +
        '<td class="tt-wins">' + fmt(beats[type]) + '</td>' +
        '<td class="tt-loses">' + fmt(loses) + '</td></tr>';
    }).join('');
    tbody.innerHTML = '<tr class="tt-head"><th>Tipo</th><th>Vince su</th><th>Perde contro</th></tr>' + rows;
  },

  /** Forced update (menu ☰): checks the service worker, downloads a new
      version right away (bump cache) and reloads. */
  forceUpdate() {
    if (!('serviceWorker' in navigator)) {
      this.toast('Questa versione non usa il service worker — aggiorna la pagina');
      location.reload();
      return;
    }
    const btn = $('#menu-update');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.textContent = '⏳ Controllo…'; btn.disabled = true; }
    const done = (msg) => {
      if (btn) { btn.textContent = orig; btn.disabled = false; }
      this.toast(msg);
    };
    navigator.serviceWorker.getRegistration()
      .then(reg => {
        if (!reg) { done('Nessun service worker attivo'); return; }
        const hadWaiting = !!reg.waiting;
        // Wait for a new version to finish installing
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (w) w.addEventListener('statechange', () => {
            if (w.state === 'installed' && reg.waiting) {
              done('✅ Aggiornamento scaricato, applico…');
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
        // A version was already waiting: activate it right away
        if (hadWaiting && reg.waiting) {
          done('✅ Aggiornamento scaricato, applico…');
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          return;
        }
        reg.update()
          .then(() => {
            // No new version: cache already up to date
            setTimeout(() => {
              if (!reg.waiting && !reg.installing) done('✅ Già all\'ultima versione');
            }, 1500);
          })
          .catch(() => done('⚠️ Errore nel controllo aggiornamenti'));
      })
      .catch(() => done('⚠️ Errore nel controllo aggiornamenti'));
  },

  // ---------- navigation ----------
  showScreen(name) {
    this.currentScreen = name;
    $$('.screen').forEach(s => s.classList.remove('active'));
    $('#screen-' + name).classList.add('active');
    // polling intelligente: friends/trade (refresh) + home (solo notifiche)
    if (name === 'friends' || name === 'trade' || name === 'home') this.startPoll();
    else this.stopPoll();
    if (name !== 'battle') this.pvpPollStop();
    // il banner notifiche è globale: si nasconde solo in battaglia
    if (name === 'battle') $('#home-notice').classList.add('hidden');
    const topMenu = $('#top-menu');
    if (topMenu) topMenu.classList.toggle('hidden', name !== 'home');
    if (name === 'home') this.refreshHome();
    if (name === 'collection') this.renderCollection();
    // Currency badge is global: refresh on every screen change
    this.updateSqueriniBadge();
    // Currency badge visible ONLY on home
    const badge = $('#squerini-badge');
    if (badge) badge.style.display = (name === 'home') ? '' : 'none';
    // On the pack screen the badge would cover the back button and title:
    // hide it there, restore it elsewhere
    const b2 = $('#squerini-badge');
    if (b2 && name === 'pack') b2.style.display = 'none';
  },

  updateSqueriniBadge() {
    const s = loadState();
    $('#squerini-count').textContent = s.squerini;
    // "Buy" button next to the currency: ONLY on home and if affordable
    const inHome = this.currentScreen === 'home';
    $('#btn-buy-pack').classList.toggle('hidden', !(inHome && s.squerini >= PACK_PRICE));
  },

  // ---------- home ----------
  refreshHome() {
    const stats = collectionStats(this.cards);
    const s = loadState();
    $('#stat-owned').textContent = stats.owned;
    $('#stat-packs').textContent = stats.packsOpened;
    // "Unopened packs" widget: ALL packs to open (welcome + daily + bought)
    $('#stat-packs-closed').textContent = packsRemaining();
    // The buy button (and count) are handled by updateSqueriniBadge, which
    // shows them ONLY on home: refreshHome also runs from other screens
    // (e.g. afterPack on the pack screen) and must not reveal it there.
    this.updateSqueriniBadge();
    $('#home-nickname').textContent = s.nickname || 'Squer Trainer';
    const pct = stats.total ? Math.round((stats.owned / stats.total) * 100) : 0;
    $('#progress-fill').style.width = pct + '%';
    $('#progress-text').textContent = `${stats.owned} / ${stats.total}`;

    // Yellow pill ONLY for welcome/daily packs: bought packs don't trigger
    // it (the "unopened packs" widget + the open button already show them).
    // The open button still counts bought packs.
    const { welcome, daily, bought } = packsBreakdown();
    const total = welcome + daily + bought;
    const free = welcome + daily;
    $('#pack-counter').style.display = free > 0 ? '' : 'none';
    if (free > 0) {
      $('#pack-counter').classList.remove('empty');
      const p = (n) => n + ' pacchett' + (n === 1 ? 'o' : 'i');
      const parts = [];
      if (welcome > 0) parts.push(p(welcome) + ' di benvenuto');
      if (daily > 0) parts.push(p(daily) + ' gratis oggi');
      $('#pack-counter-text').textContent = 'Hai ' + parts.join(' · ');
    }
    $('#btn-open-pack').disabled = total <= 0;
    $('#btn-open-pack').style.opacity = total <= 0 ? 0.5 : 1;

    this.renderLatestPulls();
  },

  // ---------- buy packs (squerini) ----------
  /** Opens the quantity menu: min 1, max affordable packs. */
  openBuyMenu() {
    const max = Math.floor(loadState().squerini / PACK_PRICE);
    if (max < 1) { this.toast('Non hai abbastanza squerini'); return; }
    this._buyMax = max;
    this._buyQty = 1;
    $('#buy-modal').classList.remove('hidden');
    this.renderBuyMenu();
  },

  setBuyQty(n) {
    this._buyQty = Math.max(1, Math.min(n, this._buyMax));
    this.renderBuyMenu();
  },

  renderBuyMenu() {
    $('#buy-qty').textContent = this._buyQty;
    $('#buy-total').textContent = `Totale: ${this._buyQty * PACK_PRICE} 🪙`;
    $('#buy-minus').disabled = this._buyQty <= 1;
    $('#buy-plus').disabled = this._buyQty >= this._buyMax;
  },

  closeBuyMenu() {
    $('#buy-modal').classList.add('hidden');
  },

  confirmBuy() {
    const n = buyPacks(this._buyQty);
    if (n > 0) {
      this.closeBuyMenu();
      this.updateSqueriniBadge();
      this.refreshHome();
      this.toast(`Acquistati ${n} pacchett${n === 1 ? 'o' : 'i'}! 🎁`);
    } else {
      this.toast('Non puoi acquistare ora');
    }
  },

  // ---------- rendering utils ----------
  /** Cached 160x225 thumbnail dataURL — for grids and small previews */
  thumbDataUrl(card) {
    if (card._thumb) return card._thumb;
    const t = document.createElement('canvas');
    t.width = 160; t.height = 225;
    const ctx = t.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(card.canvas, 0, 0, t.width, t.height);
    card._thumb = t.toDataURL();
    return card._thumb;
  },

  /** Cached full-size dataURL — where full detail is needed (modals) */
  cardDataUrl(card) {
    if (!card._dataUrl) card._dataUrl = card.canvas.toDataURL();
    return card._dataUrl;
  },

  renderLatestPulls() {
    const s = loadState();
    const recs = Object.entries(s.collection)
      .filter(([, r]) => r.lastPullAt)
      .sort((a, b) => b[1].lastPullAt - a[1].lastPullAt)
      .slice(0, 6);
    const box = $('#latest-pulls');
    if (!recs.length) { box.innerHTML = ''; return; }
    box.innerHTML = recs.map(([uid]) => {
      const c = this.cards.find(x => x.uid === uid);
      if (!c) return '';
      return `<div class="mini-card" style="border:2px solid ${RARITY_TAG_COLOR[c.rarity.id]}">
        <img src="${this.thumbDataUrl(c)}" alt="${c.name}"></div>`;
    }).join('');
  },

  // ---------- pack opening ----------
  startPack() {
    if (!canOpenPack()) { this.toast('Nessun pacchetto gratuito rimasto oggi'); return; }
    SQUER.sound.unlock();
    this.showScreen('pack');
    this.revealedCount = 0;
    // Remove leftover action buttons from the previous pack
    const hud = $('#pack-hud');
    hud.querySelectorAll('button').forEach(b => b.remove());
    $('#pack-dots').innerHTML = Array.from({ length: PACK_SIZE }, () => '<div class="dot"></div>').join('');
    $('#pack-hud-text').textContent = 'Trascina per aprire ⚡';
    $('#pack-top-title').textContent = loadState().welcomePacks > 0
      ? 'Pacchetto di benvenuto 🎁' : 'Apri il pacchetto';

    this.disposeScene();
    this.scene = new SQUER.SquerScene($('#pack-scene'));
    this.scene.showPack(() => this.tearPack());
  },

  tearPack() {
    SQUER.sound.packRip();
    setTimeout(() => SQUER.sound.whoosh(), 150);
    this.packResult = openPack(this.cards);
    $('#pack-hud-text').textContent = 'Tocca per mettere via la carta';
    this.scene.tearPack(
      this.packResult.cards,
      (card) => this.onReveal(card),
      () => this.packComplete() // fires only when the last card is discarded
    );
  },

  onReveal(card) {
    this.revealedCount++;
    const dots = $$('#pack-dots .dot');
    if (dots[this.revealedCount - 1]) dots[this.revealedCount - 1].classList.add('revealed');

    // sound by rarity
    if (card.rarity.id === 'legendary') SQUER.sound.legendary();
    else if (card.rarity.id === 'superRare') SQUER.sound.epic();
    else if (card.rarity.id === 'rare') SQUER.sound.rare();
    else if (card.isNew) SQUER.sound.newCard();
    else SQUER.sound.flip();

    // New card: show the 'NUOVA!' banner at top (no bottom toast)
    if (card.isNew) {
      this.newCardsQueue.push(card);
      this.showNewBanner();
    }

    // No fixed timer here: pack completion (and the new-card summary) fires
    // when the last card is discarded, so the player can hold the last card
    // and rotate it without an overlay menu in the way.
  },

  showNewBanner() {
    const b = $('#pack-new-banner');
    if (!b) return;
    b.classList.remove('hidden');
    requestAnimationFrame(() => b.classList.add('show'));
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => {
      b.classList.remove('show');
      setTimeout(() => b.classList.add('hidden'), 300);
    }, 1800);
  },

  packComplete() {
    const remaining = packsRemaining();
    const newCards = this.newCardsQueue;
    this.newCardsQueue = [];
    if (newCards.length) {
      this.showPackSummary(newCards, () => this.afterPack(remaining));
    } else {
      this.afterPack(remaining);
    }
  },

  afterPack(remaining) {
    $('#pack-hud-text').textContent = 'Pacchetto completato!';
    if (remaining <= 0) {
      // Last pack of the day: go straight back to home
      this.showScreen('home');
      this.refreshHome();
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-next-pack';
    btn.textContent = 'Apri un altro pacchetto';
    btn.onclick = () => {
      btn.remove();
      this.startPack();
    };
    $('#pack-hud').appendChild(btn);
    this.refreshHome();
  },

  showPackSummary(newCards, onClose) {
    const modal = $('#pack-summary-modal');
    const list = $('#summary-list');
    $('#summary-title').textContent = newCards.length === 1
      ? 'Nuova carta!' : `${newCards.length} nuove carte!`;
    list.innerHTML = newCards.map(c => `
      <div class="summary-item" style="border-color:${RARITY_TAG_COLOR[c.rarity.id]}">
        <img src="${this.thumbDataUrl(c)}" alt="${c.name}">
      </div>`).join('');
    $('#summary-continue').onclick = () => {
      modal.classList.add('hidden');
      onClose();
    };
    modal.classList.remove('hidden');

    // Fit the grid: find the width (and column count) that fits ALL cards
    // whole in the available space, shrinking as needed instead of cropping.
    // Measure AFTER the images decode, otherwise the container height is 0.
    const fit = () => {
      const items = list.querySelectorAll('.summary-item');
      if (!items.length) return;
      // Force content past the limit: the list stops at its real max height
      // (flex), so availH is the space actually granted, not the current
      // content's "auto" height
      items.forEach(t => { t.style.width = '300px'; });
      const availW = list.clientWidth;
      const availH = list.clientHeight;
      const gap = 10;
      const RATIO = 512 / 720; // card width/height ratio
      const MAX_W = 110;       // max width: few cards must not become giant
      const n = newCards.length;
      let w = availW;
      for (let c = 1; c <= n; c++) {
        const ww = Math.min((availW - (c - 1) * gap) / c, MAX_W);
        const h = ww / RATIO;
        const rows = Math.ceil(n / c);
        if (rows * h + (rows - 1) * gap <= availH) { w = ww; break; }
      }
      items.forEach(t => { t.style.width = w + 'px'; });
    };
    const imgs = list.querySelectorAll('img');
    if (imgs.length && typeof imgs[0].decode === 'function') {
      Promise.all(Array.from(imgs).map(i => i.decode().catch(() => {}))).then(fit);
    } else {
      requestAnimationFrame(fit);
    }
  },

  // ---------- collection ----------
  renderCollection() {
    const grid = $('#collection-grid');
    const s = loadState();
    const q = this.search;
    const filtered = this.cards.filter(c => {
      if (this.filter !== 'all' && c.rarity.id !== this.filter) return false;
      const rec = s.collection[c.uid];
      const owned = rec && rec.count > 0;
      if (this.ownedFilter === 'owned' && !owned) return false;
      if (this.ownedFilter === 'missing' && owned) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
    // Shown list: the detail arrows (‹ ›) navigate ONLY within these cards
    this.detailList = filtered;

    if (this._renderToken) this._renderToken.cancelled = true;
    const token = { cancelled: false };
    this._renderToken = token;
    grid.innerHTML = '';

    if (!filtered.length) {
      grid.innerHTML = '<div class="grid-empty">Nessuna carta trovata</div>';
      return;
    }

    // Build the HTML (and thumbnails) in chunks so the UI never blocks
    const builders = filtered.map(c => {
      const rec = s.collection[c.uid];
      const owned = rec && rec.count > 0;
      if (!owned) {
        return () => `<div class="card-tile empty" data-uid="${c.uid}">${c.number}</div>`;
      }
      const tag = RARITY_TAG_COLOR[c.rarity.id];
      const dup = rec.count > 1 ? `<span class="owned-count">×${rec.count}</span>` : '';
      const lv = rec.level > 1 ? `<span class="owned-level">lv${rec.level}</span>` : '';
      return () => `<div class="card-tile" data-uid="${c.uid}" style="border:2px solid ${tag}">
        <img src="${this.thumbDataUrl(c)}" alt="${c.name}">
        ${dup}${lv}
      </div>`;
    });

    const CHUNK = 24;
    let i = 0;
    const draw = () => {
      if (token.cancelled) return;
      const end = Math.min(i + CHUNK, builders.length);
      grid.insertAdjacentHTML('beforeend', builders.slice(i, end).map(f => f()).join(''));
      i = end;
      if (i < builders.length) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  },

  // ---------- detail ----------
  openDetail(card) {
    // Navigate the current FILTERED list (rarity/owned/search); fall back to
    // all cards if the album was never rendered
    const list = (this.detailList && this.detailList.length) ? this.detailList : this.cards;
    this.detailIndex = list.indexOf(card);
    if (this.detailIndex < 0) this.detailIndex = 0;
    this.showScreen('detail');
    this.renderDetail();
  },

  renderDetail() {
    const list = (this.detailList && this.detailList.length) ? this.detailList : this.cards;
    const card = list[this.detailIndex];
    if (!card) return;
    const s = loadState();
    const rec = getCardRec(card.uid);
    const owned = rec.count > 0;
    const max = (SQUER.CONFIG && SQUER.CONFIG.MAX_LEVEL) || 5;
    const costs = (SQUER.CONFIG && SQUER.CONFIG.UPGRADE_COSTS) || {};
    const rates = (SQUER.CONFIG && SQUER.CONFIG.DUPE_CONVERSION) || {};
    $('#btn-detail-prev').disabled = this.detailIndex <= 0;
    $('#btn-detail-next').disabled = this.detailIndex >= list.length - 1;

    // Unowned card: dashed silhouette + number, name "???", no stats /
    // ability / type (same philosophy as empty album tiles)
    if (!owned) {
      $('#detail-title').textContent = '???';
      $('#detail-info').innerHTML = '<div class="detail-copies dim">Non posseduta — apri pacchetti per trovarla</div>';
      this.disposeScene();
      $('#detail-scene').classList.add('hidden');
      const m = $('#detail-mystery');
      m.classList.remove('hidden');
      m.innerHTML = `<div class="dm-card">${card.number}</div>`;
      return;
    }
    $('#detail-mystery').classList.add('hidden');
    $('#detail-scene').classList.remove('hidden');

    const st = rec.level > 1 ? cardStatsAt(card, rec.level) : { hp: card.hp, atk: card.atk };
    const cost = rec.level < max ? (costs[rec.level] || 0) : null;
    const gain = rates[card.rarity.id] || 0;
    $('#detail-title').textContent = card.name;
    const eco = `
      <div class="detail-copies">×${rec.count} copie · Livello ${'⭐'.repeat(rec.level)}${rec.level >= max ? ' <span class="dim">MAX</span>' : ''}</div>
      <div class="economy-row">
        <button class="btn btn-ghost" id="btn-fuse" ${rec.count < 2 || rec.level >= max ? 'disabled' : ''} title="Consuma 1 copia: 2 copie -> +1 livello">🧬 Fondi (×2)</button>
        <button class="btn btn-ghost" id="btn-upgrade" ${rec.count < 1 || rec.level >= max || s.squerini < (cost || 0) ? 'disabled' : ''} title="Spendi squerini: +1 livello">⬆️ Potenzia${cost ? ` (${cost} 🪙)` : ''}</button>
        <button class="btn btn-ghost" id="btn-convert" ${rec.count < 2 ? 'disabled' : ''} title="Consuma 1 copia in eccesso">💱 Converti (+${gain} 🪙)</button>
      </div>`;
    $('#detail-info').innerHTML = `
      <div class="rarity-name" style="color:${RARITY_TAG_COLOR[card.rarity.id]}">${card.rarity.name}</div>
      <div class="detail-meta">
        ${card.typeSymbol} ${card.typeName} · ${card.number}/${card.setSize}
      </div>
      <div class="detail-stats">
        <div class="detail-stat"><b>${st.hp}</b><span>PV</span></div>
        <div class="detail-stat"><b>${st.atk}</b><span>ATK</span></div>
      </div>
      <div class="detail-ability">
        <span class="ability-symbol">${card.abilitySymbol}</span>
        <span class="ability-body"><b>${card.abilityName}</b> — ${card.abilityText}</span>
      </div>
      ${eco}`;
    this.disposeScene();
    this.scene = new SQUER.SquerScene($('#detail-scene'));
    this.scene.showCard(card, { flip: true });
  },

  // ---------- card economy (M3) ----------
  doFuse(card) {
    const r = fuseCards(card.uid);
    if (!r.ok) { this.toast(r.reason === 'max_level' ? 'Già al livello massimo' : 'Servono 2 copie'); return; }
    SQUER.sound.upgrade();
    this.toast(`🧬 Fusione: ${card.name} ora è livello ${r.level}!`);
    this.renderDetail();
    this.refreshHome();
  },

  doUpgrade(card) {
    const r = upgradeCard(card.uid);
    if (!r.ok) {
      if (r.reason === 'max_level') this.toast('Già al livello massimo');
      else if (r.reason === 'no_money') this.toast(`Servono ${r.cost} 🪙 per potenziare`);
      return;
    }
    SQUER.sound.upgrade();
    this.toast(`⬆️ ${card.name} ora è livello ${r.level}!`);
    this.updateSqueriniBadge();
    this.renderDetail();
    this.refreshHome();
  },

  doConvert(card) {
    const r = convertDupe(card.uid, card.rarity.id);
    if (!r.ok) { this.toast('Serve una copia in eccesso'); return; }
    SQUER.sound.coin();
    this.toast(`💱 Copia convertita: +${r.gain} 🪙`);
    this.updateSqueriniBadge();
    this.renderDetail();
    this.refreshHome();
  },

  navDetail(dir) {
    const list = (this.detailList && this.detailList.length) ? this.detailList : this.cards;
    const i = this.detailIndex + dir;
    if (i < 0 || i >= list.length) return;
    this.detailIndex = i;
    this.renderDetail();
  },

  // ---------- nickname (first run) ----------
  saveNickname() {
    const v = $('#nickname-input').value.trim();
    const err = $('#nickname-error');
    if (v.length < 3 || v.length > 16) {
      err.textContent = 'Il nickname deve avere 3-16 caratteri';
      err.classList.remove('hidden');
      return;
    }
    err.classList.add('hidden');
    const s = loadState();
    s.nickname = v;
    saveState(s);
    this.showScreen('home');
    this.refreshHome();
    this.toast(`Benvenuto, ${v}! 🎉`, true);
  },

  // ---------- deck ----------
  showDeck() {
    this.showScreen('deck');
    this.renderDeck();
  },

  renderDeck() {
    const s = loadState();
    const deckCards = s.deck.map(uid => this.cards.find(c => c.uid === uid)).filter(Boolean);
    $('#deck-count').textContent = `${deckCards.length}/8`;
    const grid = $('#deck-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const c = deckCards[i];
      const slot = document.createElement('div');
      slot.className = 'deck-slot';
      if (c) {
        const rec = s.collection[c.uid];
        const st = rec && rec.level > 1 ? cardStatsAt(c, rec.level) : null;
        const hp = st ? st.hp : c.hp;
        const atk = st ? st.atk : c.atk;
        slot.innerHTML = `<img src="${this.thumbDataUrl(c)}" alt="${c.name}">
          <span class="slot-el">${c.typeSymbol}${rec && rec.level > 1 ? ' <i>lv' + rec.level + '</i>' : ''}</span>
          <span class="slot-stats">❤${hp} ⚔${atk}</span>
          <span class="slot-x">✕</span>`;
        slot.querySelector('.slot-x').onclick = (e) => {
          e.stopPropagation();
          this.deckRemove(c.uid);
        };
      } else {
        slot.textContent = '+';
        slot.title = 'Aggiungi una carta';
        slot.onclick = () => {
          if (locked) { this.toast(`Apri pacchetti: servono ${MIN_OWNED_TO_UNLOCK} carte per sbloccare il mazzo`); return; }
          this.openDeckPicker();
        };
      }
      grid.appendChild(slot);
    }
    const owned = collectionStats(this.cards).owned;
    const locked = owned < MIN_OWNED_TO_UNLOCK;
    $('#deck-lock-msg').textContent = locked
      ? `🔒 Apri pacchetti: servono ${MIN_OWNED_TO_UNLOCK} carte per sbloccare Squer Clash (ne hai ${owned})`
      : '';
    $('#btn-deck-pick').disabled = locked;
    $('#btn-deck-pick').style.opacity = locked ? 0.5 : 1;
  },

  deckRemove(uid) {
    const s = loadState();
    s.deck = s.deck.filter(u => u !== uid);
    saveState(s);
    SQUER.sound.remove();
    this.renderDeck();
  },

  openDeckPicker() {
    const s = loadState();
    const owned = this.cards.filter(c => isOwned(c.uid));
    const grid = $('#deck-picker-grid');
    grid.innerHTML = '';
    const full = s.deck.length >= DECK_SIZE;
    owned.forEach(c => {
      const div = document.createElement('div');
      const inDeck = s.deck.indexOf(c.uid) >= 0;
      div.className = 'deck-pick' + (inDeck ? ' in-deck' : '') + (full && !inDeck ? ' full' : '');
      div.innerHTML = `<img src="${this.thumbDataUrl(c)}" alt="${c.name}">`;
      div.onclick = () => this.deckToggle(c, div);
      grid.appendChild(div);
    });
    $('#deck-picker-modal').classList.remove('hidden');
    this.updateDeckPickerCount();
  },

  deckToggle(c, el) {
    const s = loadState();
    if (s.deck.indexOf(c.uid) >= 0) {
      s.deck = s.deck.filter(u => u !== c.uid);
      el.classList.remove('in-deck');
      SQUER.sound.remove();
    } else {
      if (s.deck.length >= DECK_SIZE) { this.toast('Mazzo pieno (8 carte)'); return; }
      s.deck.push(c.uid);
      el.classList.add('in-deck');
      SQUER.sound.place();
    }
    saveState(s);
    this.updateDeckPickerCount();
    const full = s.deck.length >= DECK_SIZE;
    $$('#deck-picker-grid .deck-pick').forEach(d =>
      d.classList.toggle('full', full && !d.classList.contains('in-deck')));
  },

  updateDeckPickerCount() {
    $('#deck-picker-count').textContent = `${loadState().deck.length}/8`;
  },

  // ---------- match (Squer Clash v2, turn-based) ----------
  startMatch() {
    const s = loadState();
    const owned = collectionStats(this.cards).owned;
    if (owned < MIN_OWNED_TO_UNLOCK) {
      this.toast(`Apri pacchetti: servono ${MIN_OWNED_TO_UNLOCK} carte per giocare`);
      return;
    }
    const deckCards = s.deck.map(uid => {
      const c = this.cards.find(x => x.uid === uid);
      if (!c) return null;
      // Effective stats at the card's level (GDD §2.3)
      const rec = s.collection[uid];
      if (rec && rec.level > 1) {
        const st = cardStatsAt(c, rec.level);
        return Object.assign({}, c, { hp: st.hp, atk: st.atk, level: rec.level });
      }
      return c;
    }).filter(Boolean);
    if (deckCards.length < MIN_DECK_TO_PLAY) {
      this.toast('Costruisci il tuo mazzo (almeno 3 carte) per giocare');
      this.showDeck();
      return;
    }
    SQUER.sound.unlock();
    this.disposeScene();
    this.showScreen('battle');
    this._coinFlip();
  },

  /** 3D coin flip: decides who starts (the winner starts with 5 cards). */
  _coinFlip() {
    const first = Math.random() < 0.5 ? 'p' : 'b';
    const coin = $('#coin-3d');
    coin.classList.remove('spin', 'testa', 'croce');
    void coin.offsetWidth; // restart the animation
    coin.classList.add('spin', first === 'p' ? 'testa' : 'croce');
    $('#coin-result').textContent = 'Chi inizierà?';
    $('#coin-sub').textContent = 'Lancio di moneta…';
    $('#coin-modal').classList.remove('hidden');
    setTimeout(() => {
      $('#coin-result').innerHTML = first === 'p' ? 'O — <b>Inizi tu!</b>' : 'X — <b>Inizia SquerBot</b>';
      $('#coin-sub').textContent = 'Chi inizia parte con 5 carte';
      setTimeout(() => {
        $('#coin-modal').classList.add('hidden');
        this._setupMatch(first);
      }, 1300);
    }, 1800);
  },

  /** Starts the actual match with the decided first player. */
  _setupMatch(first) {
    const s = loadState();
    const deckCards = s.deck.map(uid => {
      const c = this.cards.find(x => x.uid === uid);
      if (!c) return null;
      const rec = s.collection[uid];
      if (rec && rec.level > 1) {
        const st = cardStatsAt(c, rec.level);
        return Object.assign({}, c, { hp: st.hp, atk: st.atk, level: rec.level });
      }
      return c;
    }).filter(Boolean);
    const ownedUids = this.cards.filter(c => isOwned(c.uid)).map(c => c.uid);
    const botDeck = SQUER.GAME.makeBotDeck(this.cards, ownedUids, makeRNG('bot_' + Date.now()));
    this.match = SQUER.GAME.newMatch(deckCards, botDeck, {
      seed: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1e9),
      first,
    });
    this._animaMax = (SQUER.CONFIG && SQUER.CONFIG.ANIMA) || 80;
    this._sel = null;
    this._botTimer = null;
    this._turnIv = null;
    this._turnLeft = null;
    this._lastTimerPlayer = 'b';
    this._notifiedEnd = false;
    // 3D battle scene (perspective field + fan hand)
    this.scene = new SQUER.BattleScene2($('#battle-scene'), {
      onZoneTap: (player, zone) => this.onZoneTap(player, zone),
      onHandTap: (index) => this.onHandTap(index),
      onHandDrop: (handIndex, zone) => this.onHandDrop(handIndex, zone),
      onHandDrag: (index) => this.onHandDrag(index),
      onPadMatchup: (zone, adv) => this.onPadMatchup(zone, adv),
    });
    $('#battle-nick').textContent = loadState().nickname || 'Tu';
    // emoji profilo locale accanto alla propria Anima (online)
    if (SQUER.Online.user && SQUER.Online.user.avatar_emoji) {
      $('#battle-me-avatar').textContent = SQUER.Online.user.avatar_emoji;
    }
    this.renderBattle();
    if (this.match.turnPlayer === 'b') this.botTurn();
    else this.showTurnNotice(`${SQUER.Online.user && SQUER.Online.user.avatar_emoji ? SQUER.Online.user.avatar_emoji + ' ' : ''}${loadState().nickname || 'Tu'}`);
  },

  cardOrig(uid) { return this.cards.find(c => c.uid === uid) || null; },

  renderBattle() {
    const m = this.match;
    const animaPct = (v) => Math.max(0, Math.min(100, Math.round(v / this._animaMax * 100)));
    $('#anima-p').textContent = Math.max(0, m.anima.p);
    $('#anima-b').textContent = Math.max(0, m.anima.b);
    $('#anima-p-fill').style.width = animaPct(m.anima.p) + '%';
    $('#anima-b-fill').style.width = animaPct(m.anima.b) + '%';
    $('#battle-turn').textContent = `Turno ${Math.ceil(m.turn / 2)} / ${Math.ceil(m.maxTurns / 2)}`;
    $('#deck-count-live').textContent = m.deck.p.length;
    $('#discard-count-live').textContent = m.discard.p.length;
    if (this.scene && this.scene.setState) this.scene.setState(this.visState(), this._sel);
    if (this.scene && this.scene.setHand) {
      const handVis = this.match.hand.p.map(c => ({ id: c.id, orig: this.cardOrig(c.uid) || c }));
      this.scene.setHand(handVis, this._sel && this._sel.type === 'hand' ? this._sel.index : null);
    }
    if (this.scene && this.scene.setBotHand) {
      this.scene.setBotHand(this.match.hand.b.length, this.cards[0]);
    }
    this.renderActions();
    this._turnTick();
  },

  /** Turn timer: visible countdown (TURN_TIME_SEC); the turn passes on its
      own if the player doesn't act. Notifies NOTIFY_LAST_TURNS from the end. */
  _turnTick() {
    const m = this.match;
    const total = (SQUER.CONFIG && SQUER.CONFIG.TURN_TIME_SEC) || 20;
    const notifyAt = (SQUER.CONFIG && SQUER.CONFIG.NOTIFY_LAST_TURNS) || 3;
    // Notify when few turns remain (only if the turn limit is active)
    if (isFinite(m.maxTurns) && !this._notifiedEnd && !m.over && m.turn >= m.maxTurns - notifyAt + 1) {
      this._notifiedEnd = true;
      this.toast(`⚡ Mancano ${notifyAt} turni alla fine!`);
    }
    if (m.turnPlayer === 'p' && !m.over) {
      if (this._lastTimerPlayer !== 'p') {
        this._lastTimerPlayer = 'p';
        this._turnLeft = total;
        if (this._turnIv) clearInterval(this._turnIv);
        this._turnIv = setInterval(() => {
          this._turnLeft--;
          this._updateTurnDisplay();
          if (this._turnLeft <= 0) {
            clearInterval(this._turnIv);
            this._turnIv = null;
            if (!this.match.over && this.match.turnPlayer === 'p') {
              this.toast('⏱ Tempo scaduto: turno passato');
              if (this._pvp) {
                // PvP: il turno passa lato server (skip); il poll aggiorna
                this.pvpMove('skip');
                this._lastTimerPlayer = 'b';
                return;
              }
              SQUER.GAME.endTurn(this.match);
              this.processEvents(this.match.events.splice(0));
              this._sel = null;
              this.renderBattle();
              if (this.match.over) { this.finishMatch(); return; }
              if (this.match.turnPlayer === 'b') this.botTurn();
            }
          }
        }, 1000);
      }
    } else {
      // turno avversario: in PvP il timer resta visibile col countdown (60s)
      if (this._pvp && (!this._turnIv || this._lastTimerPlayer !== 'b')) {
        this._lastTimerPlayer = 'b';
        if (this._pvpTurnLeft == null || this._pvpTurnLeft <= 0) {
          this._pvpTurnLeft = (SQUER.CONFIG && SQUER.CONFIG.TURN_TIME_SEC) || 60;
        }
        if (this._turnIv) clearInterval(this._turnIv);
        this._turnIv = setInterval(() => {
          this._pvpTurnLeft--;
          this._updateTurnDisplay();
          if (this._pvpTurnLeft <= 0) {
            clearInterval(this._turnIv);
            this._turnIv = null;
            // il server gestisce il timeout del turno avversario: il poll
            // aggiornerà quando tocca di nuovo a noi
            this._pvpTurnLeft = 0;
          }
        }, 1000);
      } else if (!this._pvp && this._lastTimerPlayer !== 'b') {
        this._lastTimerPlayer = 'b';
        if (this._turnIv) { clearInterval(this._turnIv); this._turnIv = null; }
      }
    }
    this._updateTurnDisplay();
  },

  _updateTurnDisplay() {
    const m = this.match;
    const finite = isFinite(m.maxTurns);
    const turno = finite ? `Turno ${m.turn}/${m.maxTurns}` : `Turno ${m.turn}`;
    if (m.over) { $('#battle-turn').textContent = turno; return; }
    if (m.turnPlayer === 'p') {
      const left = this._turnLeft != null ? this._turnLeft : ((SQUER.CONFIG && SQUER.CONFIG.TURN_TIME_SEC) || 20);
      $('#battle-turn').textContent = `${turno} · ⏱ ${left}s`;
      // Under 10s left: blink + beep
      const el = $('#battle-turn');
      if (left <= 10) {
        el.classList.add('urgent');
        if (this._lastBeep !== left) {
          this._lastBeep = left;
          if (SQUER.sound && SQUER.sound.tick) SQUER.sound.tick();
        }
      } else {
        el.classList.remove('urgent');
      }
    } else {
      // turno avversario: il TIMER resta visibile (PvP: countdown dal server;
      // bot: nessun timer, resta solo il turno)
      $('#battle-turn').classList.remove('urgent');
      if (this._pvp) {
        const left = this._pvpTurnLeft != null ? this._pvpTurnLeft : '…';
        $('#battle-turn').textContent = `${turno} · ⏱ ${left}s`;
      } else {
        $('#battle-turn').textContent = `${turno} · 🤖`;
      }
    }
  },

  /** Visual state for the 3D scene: original cards (with canvas) + live values */
  visState() {
    const m = this.match;
    const mk = (player) => {
      const out = {};
      for (const z of ZONE_KEYS) {
        const slot = m.zones[player][z];
        if (slot) {
          const orig = this.cardOrig(slot.card.uid);
          out[z] = {
            id: slot.card.id,
            orig: orig || slot.card,
            curHp: slot.card.curHp,
            curAtk: slot.card.curAtk,
            hp: slot.card.hp,
            type: slot.card.type || 'normale',
            ability: slot.card.ability
              ? {
                  symbol: slot.card.ability.symbol || '',
                  name: slot.card.ability.name || '',
                  text: slot.card.ability.text || '',
                }
              : null,
          };
        } else out[z] = null;
      }
      return out;
    };
    return { p: mk('p'), b: mk('b') };
  },

  renderActions() {
    const m = this.match;
    const isP = m.turnPlayer === 'p' && !m.over;
    const sel = this._sel;
    const canAtk = isP && sel && sel.type === 'zone' && !!m.zones.p[sel.zone];
    $('#btn-draw').classList.toggle('hidden', !isP);
    $('#btn-draw').disabled = !isP || !SQUER.GAME.canDraw(m, 'p');
    $('#btn-attack').classList.toggle('hidden', !canAtk);
    $('#btn-cancel').classList.toggle('hidden', !sel);
    let msg;
    if (m.over) msg = 'Partita finita';
    else if (!isP) msg = this._pvp
      ? `⚔️ ${this._pvpOpp ? this._pvpOpp.nickname : 'Avversario'} sta giocando…`
      : '🤖 SquerBot sta giocando…';
    else if (sel && sel.type === 'hand') {
      msg = 'Tocca una zona del tuo campo per posizionare la carta.';
      this.renderMatchupHint();
    }
    else if (sel && sel.type === 'zone') {
      msg = 'Premi ⚔️ Attacca per colpire il fronte (o tocca un\'altra carta).';
      // avviso superefficace/poco efficace anche quando si seleziona la
      // propria carta per attaccare (stesso badge del drag)
      this.renderAttackMatchup(sel.zone);
    }
    else msg = 'Pesca, oppure tocca una carta in mano per posizionarla, o una in campo per attaccare.';
    $('#battle-status').textContent = msg;
    if (!(sel && sel.type === 'hand')) this.clearMatchupHint();
    if (!(sel && sel.type === 'zone')) this.onPadMatchup(null, null);
  },

  /** Matchup della carta selezionata per ATTACCARE contro la carta di fronte
      (stessa zona avversaria). Usa il badge #pad-matchup (verde/rosso). */
  renderAttackMatchup(zone) {
    const atkSlot = this.match && this.match.zones && this.match.zones.p && this.match.zones.p[zone];
    const defSlot = this.match && this.match.zones && this.match.zones.b && this.match.zones.b[zone];
    if (!atkSlot || !defSlot) { this.onPadMatchup(null, null); return; }
    const adv = SQUER.GAME.typeAdvantage(atkSlot.card.type, defSlot.card.type);
    this.onPadMatchup(zone, adv);
  },

  /** Placement hint: for each enemy field card shows whether the selected
      (or dragged) card hits it ×2 (super effective), ×0.5 (weak) or ×1
      (neutral). Shown when a hand card is selected (tap) or lifted (drag). */
  renderMatchupHint(handIndex) {
    const el = $('#matchup-hint');
    if (!el || !this.match) return;
    const idx = handIndex != null ? handIndex : (this._sel && this._sel.type === 'hand' ? this._sel.index : -1);
    if (idx < 0) { this.clearMatchupHint(); return; }
    const hand = this.match.hand.p[idx];
    if (!hand) { this.clearMatchupHint(); return; }
    const zones = ['left', 'center', 'right'];
    const parts = zones.map(z => {
      const def = this.match.zones.b[z];
      if (!def) return '<span class="mh-zone">' + (z === 'left' ? '←' : z === 'right' ? '→' : '•') + ' libera</span>';
      const adv = SQUER.GAME.typeAdvantage(hand.type, def.card.type);
      const cls = adv === 1 ? 'mh-super' : (adv === -1 ? 'mh-weak' : 'mh-neut');
      const tag = adv === 1 ? '×2 SUPER' : (adv === -1 ? '×0.5' : '×1');
      const sym = def.card.typeSymbol || '';
      return '<span class="mh-zone ' + cls + '">' + (z === 'left' ? '←' : z === 'right' ? '→' : '•') + ' ' +
        sym + ' ' + typeName(def.card.type) + ' <b>' + tag + '</b></span>';
    });
    const selSym = hand.typeSymbol || '';
    el.innerHTML = '<span class="mh-sel">' + selSym + ' ' + typeName(hand.type) + '</span> ' + parts.join(' ');
    el.classList.remove('hidden');
  },

  /** Matchup hint while dragging: the scene calls this when a hand card is
      lifted (index >= 0) or released (null). Drag skips the selection (_sel),
      so the hint must be shown/hidden here. */
  onHandDrag(index) {
    if (!this.match || this.match.over) return;
    if (index != null && index >= 0) this.renderMatchupHint(index);
    else this.clearMatchupHint();
  },

  clearMatchupHint() {
    const el = $('#matchup-hint');
    if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
  },

  /** Badge del pad durante il drag: Superefficace (verde) / Poco efficace
      (rosso) in base al tipo della carta sul pad avversario di fronte.
      adv: 1 forte, -1 debole, 0 neutro, null nessun pad/nessuna carta. */
  onPadMatchup(zone, adv) {
    const el = $('#pad-matchup');
    if (!el) return;
    if (adv === 1) {
      el.textContent = 'Superefficace';
      el.className = 'pad-matchup super';
    } else if (adv === -1) {
      el.textContent = 'Poco efficace';
      el.className = 'pad-matchup weak';
    } else {
      el.textContent = '';
      el.className = 'pad-matchup hidden';
    }
  },

  processEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'play':
          if (this.scene && this.scene.shakeCard) break;
          break;
        case 'attack':
          if (this.scene && this.scene.animateAttack) {
            this.scene.animateAttack(e.attacker.id, SQUER.GAME.other(e.player), e.zone);
          }
          if (this.scene && this.scene.floatDamage) {
            this.scene.floatDamage(SQUER.GAME.other(e.player), e.zone, e.dmg, e.adv);
          }
          break;
        case 'attack_anima':
          // Direct Anima attack: the attacker flies to the open zone +
          // floating damage + flash on the hit Anima bar
          if (this.scene && this.scene.animateAttack && e.attacker) {
            this.scene.animateAttack(e.attacker.id, SQUER.GAME.other(e.player), e.zone);
          }
          if (this.scene && this.scene.floatDamage) {
            this.scene.floatDamage(SQUER.GAME.other(e.player), e.zone, e.dmg, 0);
          }
          this._flashAnimaBar(SQUER.GAME.other(e.player));
          break;
        case 'damage':
          if (this.scene && this.scene.shakeCard) this.scene.shakeCard(e.player, e.zone);
          break;
        case 'kill': this.toast('💀 ' + cardName(e.card) + ' distrutta!'); break;
        case 'anima': break;
        case 'ability': break;
        case 'ramp':
          if (this.scene && this.scene.flashRamp) this.scene.flashRamp(e.player, e.zone, e.atk);
          break;
        default: break;
      }
    }
  },

  /** Flash on the hit Anima bar (direct attack) */
  _flashAnimaBar(player) {
    const el = document.getElementById(player === 'p' ? 'anima-p-fill' : 'anima-b-fill');
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
    clearTimeout(this._animaFlashT);
    this._animaFlashT = setTimeout(() => el.classList.remove('flash'), 600);
  },

  onHandTap(i) {
    if (this.match.over || this.match.turnPlayer !== 'p') return;
    if (this._sel && this._sel.type === 'hand' && this._sel.index === i) this._sel = null;
    else this._sel = { type: 'hand', index: i };
    this.renderBattle();
  },

  /** Drag&drop: the card was released on a free zone */
  onHandDrop(handIndex, zone) {
    if (this.match.over || this.match.turnPlayer !== 'p') return;
    if (handIndex < 0 || handIndex >= this.match.hand.p.length) return;
    this._sel = null;
    if (this._pvp) { this.pvpMove('place', { handIndex, zone }); return; }
    this.commitPlayerAction(SQUER.GAME.actionPlace(this.match, 'p', handIndex, zone));
  },

  onZoneTap(player, zone) {
    if (player === 'b') {
      // Feedback when tapping an enemy card (3D cards are small)
      const slot = this.match.zones.b[zone];
      if (slot) {
        const c = slot.card;
        const ab = c.ability;
        this.toast(`${c.name} · ${c.typeSymbol} ⚔️${c.curAtk} ❤️${c.curHp}${ab ? ' · ' + ab.symbol + ' ' + ab.name : ''}`);
      }
      return;
    }
    if (this.match.over || this.match.turnPlayer !== 'p') return;
    const slot = this.match.zones.p[zone];
    if (this._sel && this._sel.type === 'hand') {
      const idx = this._sel.index;
      this._sel = null;
      if (this._pvp) { this.pvpMove('place', { handIndex: idx, zone }); return; }
      this.commitPlayerAction(SQUER.GAME.actionPlace(this.match, 'p', idx, zone));
      return;
    }
    if (this._sel && this._sel.type === 'zone') { this._sel = null; this.renderBattle(); return; }
    if (slot) { this._sel = { type: 'zone', zone }; this.renderBattle(); }
    else this.toast('Zona vuota: posiziona una carta dalla mano');
  },

  commitPlayerAction(r) {
    if (!r || !r.ok) {
      if (r && r.reason === 'no_draw') this.toast('Nessuna carta da pescare');
      return;
    }
    this.processEvents(this.match.events.splice(0));
    SQUER.GAME.endTurn(this.match);
    this.processEvents(this.match.events.splice(0));
    this._sel = null;
    this.renderBattle();
    if (this.match.over) { this.finishMatch(); return; }
    if (this.match.turnPlayer === 'b') this.botTurn();
  },

  onClickDraw() {
    if (this.match.over || this.match.turnPlayer !== 'p') return;
    // PvP: il server pesca (zero trust): draw_peek restituisce la carta, poi
    // il client decide (draw_choice) — o salta la scelta se c'è spazio.
    if (this._pvp) { this.pvpDrawPeek(); return; }
    const r = SQUER.GAME.peekDraw(this.match, 'p');
    if (!r.ok) { this.toast('Nessuna carta da pescare'); return; }
    const hand = this.match.hand.p;
    // Hand has ROOM (max 5): draw DIRECTLY, no confirmation
    if (hand.length <= 5) {
      this.finishDrawChoice({ keep: true, handIndex: null });
      return;
    }
    // Hand FULL (6 after the draw): show the choice modal
    const drawn = hand[hand.length - 1];
    const orig = this.cardOrig(drawn.uid);
    $('#draw-preview').innerHTML =
      `<div class="draw-card-big"><img src="${orig ? this.thumbDataUrl(orig) : ''}" alt="${drawn.name}">
       <span>${drawn.name} · ${drawn.typeSymbol} ⚔️${drawn.curAtk} ❤️${drawn.curHp}</span></div>`;
    const rest = hand.slice(0, -1);
    $('#draw-hand').innerHTML = rest.length
      ? rest.map((c, i) => `<button class="draw-card" data-idx="${i}">${c.typeSymbol} ${c.name}</button>`).join('')
      : '<div class="draw-empty">Nessuna carta in mano da scartare.</div>';
    // Full hand: you must discard or reject (no "keep without discarding")
    $('#draw-keep-none').classList.add('hidden');
    $('#draw-modal').classList.remove('hidden');
  },

  /** PvP: pesca lato server. La carta arriva in `peeked`; se la mano ha
      spazio confermiamo subito, altrimenti mostriamo la modale di scelta. */
  async pvpDrawPeek() {
    try {
      const v = await SQUER.Online.moveMatch(this._pvp.id, 'draw_peek');
      const hand = v.match && v.match.hand ? v.match.hand.p : [];
      if (hand.length <= 5) {
        // spazio: tieni la carta, conferma
        const v2 = await SQUER.Online.moveMatch(this._pvp.id, 'draw_choice', { choice: { keep: true, handIndex: null } });
        this.applyPvpView(v2);
        return;
      }
      // mano piena: mostra la scelta (la carta pescata è l'ultima)
      const drawn = hand[hand.length - 1];
      const orig = this.cardOrig(drawn.uid);
      $('#draw-preview').innerHTML =
        `<div class="draw-card-big"><img src="${orig ? this.thumbDataUrl(orig) : ''}" alt="${drawn.name}">
         <span>${drawn.name} · ${drawn.typeSymbol} ⚔️${drawn.curAtk} ❤️${drawn.curHp}</span></div>`;
      const rest = hand.slice(0, -1);
      $('#draw-hand').innerHTML = rest.length
        ? rest.map((c, i) => `<button class="draw-card" data-idx="${i}">${c.typeSymbol} ${c.name}</button>`).join('')
        : '<div class="draw-empty">Nessuna carta in mano da scartare.</div>';
      $('#draw-keep-none').classList.add('hidden');
      $('#draw-modal').classList.remove('hidden');
    } catch (e) {
      this.toast(e.message);
    }
  },

  finishDrawChoice(choice) {
    $('#draw-modal').classList.add('hidden');
    if (this._pvp) { this.pvpMove('draw_choice', { choice }); return; }
    SQUER.GAME.resolveDrawChoice(this.match, 'p', choice);
    this.commitPlayerAction({ ok: true });
  },

  onClickAttack() {
    if (!this._sel || this._sel.type !== 'zone') return;
    if (this._pvp) {
      const zone = this._sel.zone;
      this._sel = null;
      this.pvpMove('attack', { zone });
      return;
    }
    this.commitPlayerAction(SQUER.GAME.actionAttack(this.match, 'p', this._sel.zone));
  },

  botTurn() {
    if (this.match.over || this.match.turnPlayer !== 'b') return;
    if (this._pvp) { this.pvpPollStart(); return; } // avversario remoto: poll
    const delay = (SQUER.CONFIG && SQUER.CONFIG.BOT_ACT_STAGGER) || 550;
    this._botTimer = setTimeout(() => {
      SQUER.GAME.botAct(this.match);
      this.processEvents(this.match.events.splice(0));
      SQUER.GAME.endTurn(this.match);
      this.processEvents(this.match.events.splice(0));
      this.renderBattle();
      if (this.match.over) { this.finishMatch(); return; }
      if (this.match.turnPlayer === 'b') this.botTurn();
    }, delay);
  },

  finishMatch() {
    const m = this.match;
    if (m._rewarded) return;
    m._rewarded = true;
    const reward = SQUER.GAME.matchReward(m.outcome);
    const s = loadState();
    s.squerini += reward;
    s.matches.push({
      date: Date.now(), vs: 'bot', outcome: m.outcome, reward,
      animaP: Math.max(0, m.anima.p), animaB: Math.max(0, m.anima.b),
      deck: s.deck.slice(),
    });
    saveState(s);
    this.updateSqueriniBadge();
    if (m.outcome === 'win') SQUER.sound.matchWin();
    else if (m.outcome === 'draw') SQUER.sound.matchDraw();
    else SQUER.sound.matchLose();
    $('#result-icon').textContent = m.outcome === 'win' ? '🏆' : (m.outcome === 'draw' ? '🤝' : '💀');
    $('#result-title').textContent = m.outcome === 'win' ? 'Vittoria!' : (m.outcome === 'draw' ? 'Pareggio' : 'Sconfitta');
    // No score: it stood for the final HP, no longer needed
    $('#result-score').classList.add('hidden');
    $('#result-reward').textContent = reward > 0 ? `+${reward} 🪙 Squerini` : 'Nessun guadagno';
    $('#result-zones').innerHTML = '';
    $('#result-zones').classList.add('hidden');
    // Delay so the last move's animation plays before the modal
    clearTimeout(this._resultT);
    this._resultT = setTimeout(() => {
      $('#result-modal').classList.remove('hidden');
    }, 1400);
  },

  rematch() {
    $('#result-modal').classList.add('hidden');
    if (this._pvp) {
      // PvP: rivincita (se entrambi la chiedono si gioca subito)
      this.pvpRematch();
      return;
    }
    this.startMatch();
  },

  quitBattle() {
    if (this._botTimer) { clearTimeout(this._botTimer); this._botTimer = null; }
    if (this._turnIv) { clearInterval(this._turnIv); this._turnIv = null; }
    if (this._pvpRematchIv) { clearInterval(this._pvpRematchIv); this._pvpRematchIv = null; }
    this._sel = null;
    $('#draw-modal').classList.add('hidden');
    $('#help-modal').classList.add('hidden');
    $('#result-modal').classList.add('hidden');
    // PvP: avvisa il server che si esce (l'avversario torna a home)
    if (this._pvp) {
      const id = this._pvp.id;
      this.quitPvp();
      SQUER.Online.matchLeave(id).catch(() => {});
    } else {
      this.quitPvp();
    }
    this.showScreen('home');
    this.refreshHome();
  },

  /** Pulisce lo stato PvP (poll, timer, riferimenti). */
  quitPvp() {
    this.pvpPollStop();
    if (this._sfidaPollIv) { clearInterval(this._sfidaPollIv); this._sfidaPollIv = null; }
    if (this._pvpRematchIv) { clearInterval(this._pvpRematchIv); this._pvpRematchIv = null; }
    this._pvp = null;
    this._pvpOpp = null;
    this._pvpMatchId = null;
  },


  disposeScene() {
    if (this._cdTimer) { clearTimeout(this._cdTimer); this._cdTimer = null; }
    if (this._cdToken) { this._cdToken.stopped = true; this._cdToken = null; }
    if (this.scene) { this.scene.dispose(); this.scene = null; }
  },

  toast(msg, big = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.style.background = big ? 'linear-gradient(135deg,#ffc93d,#ff8a3d)' : '';
    t.style.color = big ? '#141b2b' : '';
    t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.add('hidden'), 2200);
  },

  /** Banner centrato "Tocca a <nome>" per 2s (cambio turno). */
  showTurnNotice(label) {
    const el = $('#turn-notice');
    if (!el) return;
    $('#turn-notice-name').textContent = label;
    el.classList.remove('hidden');
    // riavvia l'animazione
    void el.offsetWidth;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this._turnNoticeT);
    this._turnNoticeT = setTimeout(() => el.classList.add('hidden'), 2000);
  },

  bindEvents() {
    $('#btn-open-pack').addEventListener('click', () => this.startPack());
    // ---- buy packs (squerini) ----
    $('#btn-buy-pack').addEventListener('click', () => this.openBuyMenu());
    $('#buy-minus').addEventListener('click', () => this.setBuyQty(this._buyQty - 1));
    $('#buy-plus').addEventListener('click', () => this.setBuyQty(this._buyQty + 1));
    $('#buy-cancel').addEventListener('click', () => this.closeBuyMenu());
    $('#buy-confirm').addEventListener('click', () => this.confirmBuy());
    $('#buy-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) this.closeBuyMenu(); });
    $('#btn-collection').addEventListener('click', () => this.showScreen('collection'));
    $('#btn-pack-back').addEventListener('click', () => { this.disposeScene(); this.showScreen('home'); });
    $('#btn-collection-back').addEventListener('click', () => this.showScreen('home'));
    $('#btn-detail-back').addEventListener('click', () => { this.disposeScene(); this.showScreen('collection'); });

    // ---- Squer Clash ----
    $('#btn-play').addEventListener('click', () => this.openPlayModal());
    $('#btn-play-bot').addEventListener('click', () => {
      $('#play-modal').classList.add('hidden');
      this.startMatch();
    });
    $('#btn-play-online').addEventListener('click', () => {
      $('#play-modal').classList.add('hidden');
      this.playOnline();
    });
    $('#play-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('#play-modal').classList.add('hidden'); });
    $('#btn-deck').addEventListener('click', () => this.showDeck());
    $('#btn-deck-back').addEventListener('click', () => {
      // se venivamo dalla sfida, torna lì (altrimenti home)
      if (this._sfidaFrom) {
        this._sfidaFrom = false;
        this.openSfida();
      } else {
        this.showScreen('home');
      }
    });
    $('#btn-deck-pick').addEventListener('click', () => this.openDeckPicker());
    $('#deck-picker-done').addEventListener('click', () => {
      $('#deck-picker-modal').classList.add('hidden');
      this.renderDeck();
    });
    $('#btn-nickname-ok').addEventListener('click', () => this.saveNickname());
    $('#nickname-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.saveNickname(); });
    $('#btn-battle-quit').addEventListener('click', () => this.quitBattle());
    $('#battle-help').addEventListener('click', () => $('#help-modal').classList.remove('hidden'));
    $('#help-close').addEventListener('click', () => $('#help-modal').classList.add('hidden'));
    $('#help-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('#help-modal').classList.add('hidden'); });
    // ---- battle v2: actions ----
    $('#btn-draw').addEventListener('click', () => this.onClickDraw());
    $('#btn-attack').addEventListener('click', () => this.onClickAttack());
    $('#btn-cancel').addEventListener('click', () => { this._sel = null; this.renderBattle(); });
    $('#draw-reject').addEventListener('click', () => this.finishDrawChoice({ keep: false }));
    $('#draw-keep-none').addEventListener('click', () => this.finishDrawChoice({ keep: true, handIndex: null }));
    $('#draw-hand').addEventListener('click', (e) => {
      const b = e.target.closest('.draw-card');
      if (b) this.finishDrawChoice({ keep: true, handIndex: parseInt(b.dataset.idx, 10) });
    });
    $('#result-rematch').addEventListener('click', () => this.rematch());
    // ---- card-detail economy (event delegation: innerHTML is rebuilt) ----
    $('#detail-info').addEventListener('click', (e) => {
      const card = this.cards[this.detailIndex];
      if (!card) return;
      if (e.target.closest('#btn-fuse')) this.doFuse(card);
      else if (e.target.closest('#btn-upgrade')) this.doUpgrade(card);
      else if (e.target.closest('#btn-convert')) this.doConvert(card);
    });
    $('#result-home').addEventListener('click', () => this.quitBattle());
    $('#result-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) this.quitBattle(); });

    // top menu (hamburger)
    $('#menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#menu-dropdown').classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.top-menu')) {
        $('#menu-dropdown').classList.add('hidden');
        $('#online-dropdown').classList.add('hidden');
      }
    });
    $('#menu-reset').addEventListener('click', () => {
      $('#menu-dropdown').classList.add('hidden');
      if (confirm('Azzera i progressi? Collezione e partite verranno azzerate.\nNickname, squerini e mazzo restano.')) {
        resetProgress();
        this.refreshHome();
        this.toast('Progressi azzerati');
      }
    });
    $('#menu-wipe').addEventListener('click', () => {
      $('#menu-dropdown').classList.add('hidden');
      if (confirm('Cancellare TUTTI i dati? L\'app tornerà come appena installata.')) {
        wipeAllData();
        location.reload();
      }
    });
    $('#menu-update').addEventListener('click', () => {
      $('#menu-dropdown').classList.add('hidden');
      this.forceUpdate();
    });

    // rarity filters
    $$('.chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.chip[data-filter]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.filter = chip.dataset.filter;
        this.renderCollection();
      });
    });

    // owned / missing toggle
    $$('#own-toggle .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('#own-toggle .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.ownedFilter = chip.dataset.own;
        this.renderCollection();
      });
    });

    // name search (debounced)
    $('#search-input').addEventListener('input', (e) => {
      clearTimeout(this._searchT);
      this._searchT = setTimeout(() => {
        this.search = e.target.value.trim().toLowerCase();
        this.renderCollection();
      }, 120);
    });

    // detail navigation: arrows
    $('#btn-detail-prev').addEventListener('click', () => this.navDetail(-1));
    $('#btn-detail-next').addEventListener('click', () => this.navDetail(1));

    // detail navigation: horizontal swipe (not on the 3D canvas)
    let touchX = null;
    $('#screen-detail').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    $('#screen-detail').addEventListener('touchend', (e) => {
      if (touchX === null || e.target.closest('canvas')) { touchX = null; return; }
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 40) this.navDetail(dx < 0 ? 1 : -1);
    });

    // event delegation for album tiles (single listener, survives chunking)
    $('#collection-grid').addEventListener('click', (e) => {
      const tile = e.target.closest('.card-tile');
      if (!tile) return;
      const uid = tile.dataset.uid;
      const c = this.cards.find(x => x.uid === uid);
      if (!c) return;
      // Unowned tiles open too: the detail shows the silhouette
      this.openDetail(c);
    });

    // ---------- online (auth + sync) ----------
    // Mappamondo in alto: dropdown con Amici / Scambio (+ Logout se loggato)
    $('#btn-online-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!SQUER.Online.API_BASE) { this.toast('Online non configurato in questa build'); return; }
      // chiusura reciproca dei dropdown
      $('#menu-dropdown').classList.add('hidden');
      const dd = $('#online-dropdown');
      dd.classList.toggle('hidden');
      if (!SQUER.Online.token) {
        // non loggato: il dropdown offre solo Amici/Scambio che portano all'auth
        $('#online-friends').textContent = '👥 Amici';
        $('#online-trade').textContent = '🤝 Scambio';
        $('#online-logout').classList.add('hidden');
      } else {
        $('#online-logout').classList.remove('hidden');
      }
    });
    $('#online-friends').addEventListener('click', () => {
      $('#online-dropdown').classList.add('hidden');
      if (!SQUER.Online.token) { this.openAuthLogin(); return; }
      this.openFriends();
    });
    $('#online-trade').addEventListener('click', () => {
      $('#online-dropdown').classList.add('hidden');
      if (!SQUER.Online.token) { this.openAuthLogin(); return; }
      this.openTradeHub();
    });
    $('#online-logout').addEventListener('click', async () => {
      $('#online-dropdown').classList.add('hidden');
      await SQUER.Online.logout();
      this.toast('Disconnesso');
      // dopo il logout: schermata di Accedi (default)
      this.openAuthLogin();
    });
    // banner notifiche in home: cliccabile -> azione (es. apri lo scambio)
    $('#home-notice').addEventListener('click', () => {
      $('#home-notice').classList.add('hidden');
      const fn = this._homeNoticeAction;
      this._homeNoticeAction = null;
      if (fn) fn();
    });

    // auth tabs
    $('#tab-login').addEventListener('click', () => this.showAuthPanel('login'));
    $('#tab-register').addEventListener('click', () => this.showAuthPanel('register'));
    $('#btn-recover-toggle').addEventListener('click', () => this.showAuthPanel('recover'));
    $('#btn-auth-back').addEventListener('click', () => {
      this._pendingSfida = false;
      // senza nickname locale (primo avvio) chiediamo prima il nickname:
      // serve anche offline
      if (!loadState().nickname) {
        this.showScreen('nickname');
        $('#nickname-input').focus();
        return;
      }
      this.showScreen('home');
    });

    // login
    $('#btn-login').addEventListener('click', async () => {
      const nick = $('#login-nickname').value.trim();
      const pass = $('#login-password').value;
      const errEl = $('#login-error');
      errEl.classList.add('hidden');
      try {
        await SQUER.Online.login(nick, pass);
        this.showScreen('sync');
        await this.runSync();
      } catch (e) {
        errEl.textContent = e.message; errEl.classList.remove('hidden');
      }
    });

    // recover
    $('#btn-recover').addEventListener('click', async () => {
      const nick = $('#recover-nickname').value.trim();
      const code = $('#recover-code').value.trim();
      const pass = $('#recover-password').value;
      const errEl = $('#recover-error');
      errEl.classList.add('hidden');
      try {
        await SQUER.Online.recover(nick, code, pass);
        this.showScreen('sync');
        await this.runSync();
      } catch (e) {
        errEl.textContent = e.message; errEl.classList.remove('hidden');
      }
    });

    // register
    $('#btn-register').addEventListener('click', async () => {
      const nick = $('#reg-nickname').value.trim();
      const pass = $('#reg-password').value;
      const avatar = $('#reg-avatar').value.trim() || '🙂';
      const errEl = $('#reg-error');
      errEl.classList.add('hidden');
      // l'emoji profilo deve essere UNA sola emoji (niente lettere/testo)
      if (!/^\p{Extended_Pictographic}$/u.test(avatar)) {
        errEl.textContent = 'Profilo: inserisci 1 sola emoji (es. 🙂)';
        errEl.classList.remove('hidden');
        return;
      }
      try {
        const d = await SQUER.Online.register(nick, pass, avatar);
        // mostra il codice di backup UNA volta
        this.showAuthPanel('backup');
        $('#backup-code').textContent = d.backup_code;
        $('#btn-backup-done').onclick = async () => {
          this.showScreen('sync');
          await this.runSync();
        };      } catch (e) {
        errEl.textContent = e.message; errEl.classList.remove('hidden');
      }
    });

    // sync screen: retry / continue offline
    $('#btn-sync-retry').addEventListener('click', () => this.runSync());
    $('#btn-sync-offline').addEventListener('click', () => {
      this.showScreen('home');
      this.refreshHome();
      this.toast('Modalità offline: sincronizzazione rimandata');
    });

    // friends screen
    $('#btn-friends-back').addEventListener('click', () => this.showScreen('home'));
    $('#btn-sfida-open').addEventListener('click', () => this.openSfida());
    $('#btn-sfida-back').addEventListener('click', () => {
      this._pendingSfida = false;
      this.showScreen('home');
    });
    $('#btn-sfida-create').addEventListener('click', () => this.sfidaCreate());
    $('#btn-sfida-edit-deck').addEventListener('click', () => {
      this._sfidaFrom = true;
      this.showScreen('deck');
      this.renderDeck();
    });
    $('#btn-sfida-cancel').addEventListener('click', () => {
      if (this._sfidaPollIv) { clearInterval(this._sfidaPollIv); this._sfidaPollIv = null; }
      this.openSfida();
    });
    $('#btn-sfida-join').addEventListener('click', () => this.sfidaJoin());
    $('#sfida-pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sfidaJoin(); });
    $('#btn-friends-add').addEventListener('click', () => {
      $('#friends-add-error').classList.add('hidden');
      $('#friends-add-nick').value = '';
      $('#friends-add-modal').classList.remove('hidden');
      $('#friends-add-nick').focus();
    });
    $('#btn-friends-add-cancel').addEventListener('click', () => $('#friends-add-modal').classList.add('hidden'));
    $('#btn-friends-send').addEventListener('click', async () => {
      const nick = $('#friends-add-nick').value.trim();
      const errEl = $('#friends-add-error');
      errEl.classList.add('hidden');
      try {
        await SQUER.Online.friendRequest(nick);
        $('#friends-add-modal').classList.add('hidden');
        this.toast('Richiesta inviata a ' + nick);
        this.renderFriends();
      } catch (e) {
        errEl.textContent = e.message; errEl.classList.remove('hidden');
      }
    });
    $('#btn-fp-close').addEventListener('click', () => $('#friends-profile-modal').classList.add('hidden'));

    // delegation per le azioni nelle liste amici
    $('#screen-friends').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act][data-id]');
      if (!btn) return;
      const { act, id } = btn.dataset;
      try {
        if (act === 'accept') await SQUER.Online.friendAccept(id);
        else if (act === 'decline') await SQUER.Online.friendDecline(id);
        else if (act === 'remove') await SQUER.Online.friendRemove(id);
        else if (act === 'profile') {
          const p = await SQUER.Online.friendProfile(id);
          this.showFriendProfile(p);
          return;
        } else if (act === 'trade') {
          const name = btn.dataset.name || 'Amico';
          await this.openTrade(id, name);
          return;
        }
        this.renderFriends();
      } catch (e2) { this.toast(e2.message); }
    });

    // trade screen listeners
    $('#btn-trade-back').addEventListener('click', () => this.showScreen('friends'));
    $('#btn-trade-add').addEventListener('click', () => this.tradeOpenPick());
    $('#btn-trade-pick-cancel').addEventListener('click', () => $('#trade-pick-modal').classList.add('hidden'));
    $('#btn-trade-pick-done').addEventListener('click', async () => {
      if (!this.tradePick.length) { this.toast('Scegli almeno 1 carta'); return; }
      const cards = this.tradePick;
      try {
        if (!this.trade) {
          // nuovo scambio: crea la proposta
          const d = await SQUER.Online.createTrade(this.tradeOpp.id, cards);
          this.trade = { id: d.id, status: 'pending' };
          this.tradeMyRole = 'proposer';
        } else {
          // controproposta
          await SQUER.Online.tradeCounter(this.trade.id, cards);
        }
        $('#trade-pick-modal').classList.add('hidden');
        await this.tradeRefresh();
      } catch (e) { this.toast(e.message); }
    });
    // selezione carte nella modale
    $('#trade-pick-grid').addEventListener('click', (e) => {
      const t = e.target.closest('.trade-pick');
      if (!t) return;
      const uid = t.dataset.uid;
      const idx = this.tradePick.findIndex(x => x.uid === uid);
      if (idx >= 0) { this.tradePick.splice(idx, 1); t.classList.remove('sel'); return; }
      if (this.tradePick.length >= 3) { this.toast('Max 3 carte'); return; }
      this.tradePick.push({ uid, level: parseInt(t.dataset.lv, 10) });
      t.classList.add('sel');
    });
  },

  // ---------- friends UI ----------
  async openFriends() {
    if (!SQUER.Online.isOnline()) { this.toast('Devi essere connesso'); return; }
    this.showScreen('friends');
    await this.renderFriends();
  },

  async renderFriends() {
    try {
      const d = await SQUER.Online.listFriends();
      const me = SQUER.Online.user;
      $('#friends-me').textContent = `Connesso come ${me.avatar_emoji || ''} ${me.nickname} · ${me.level_text}`;

      const incoming = $('#friends-incoming');
      incoming.innerHTML = d.incoming.length
        ? d.incoming.map(f => this.friendCard(f, 'incoming')).join('')
        : '<div class="friends-empty">Nessuna richiesta in arrivo</div>';

      const list = $('#friends-list');
      list.innerHTML = d.friends.length
        ? d.friends.map(f => this.friendCard(f, 'friend')).join('')
        : '<div class="friends-empty">Nessun amico — aggiungine uno con ＋</div>';

      const outgoing = $('#friends-outgoing');
      outgoing.innerHTML = d.outgoing.length
        ? d.outgoing.map(f => this.friendCard(f, 'outgoing')).join('')
        : '<div class="friends-empty">—</div>';
    } catch (e) {
      $('#friends-list').innerHTML = '<div class="friends-empty">Errore: ' + e.message + '</div>';
    }
  },

  friendCard(f, kind) {
    const pvp = f.pvp ? `⚔️ ${f.pvp.wins}-${f.pvp.losses}-${f.pvp.draws}` : '';
    const coll = f.collection ? `🃏 ${f.collection.cards} carte` : '';
    if (kind === 'incoming') {
      return `<div class="friend-card">
        <span class="friend-avatar">${f.avatar_emoji || '🙂'}</span>
        <div class="friend-info"><b>${f.nickname}</b><span class="friend-sub">${f.level_text}</span></div>
        <button class="btn btn-ghost btn-sm" data-act="accept" data-id="${f.id}">✓</button>
        <button class="btn btn-ghost btn-sm" data-act="decline" data-id="${f.id}">✕</button>
      </div>`;
    }
    if (kind === 'outgoing') {
      return `<div class="friend-card">
        <span class="friend-avatar">${f.avatar_emoji || '🙂'}</span>
        <div class="friend-info"><b>${f.nickname}</b><span class="friend-sub">in attesa…</span></div>
      </div>`;
    }
    return `<div class="friend-card">
      <span class="friend-avatar">${f.avatar_emoji || '🙂'}</span>
      <div class="friend-info"><b>${f.nickname}</b>
        <span class="friend-sub">${f.level_text} · ${coll}</span>
        ${pvp ? `<span class="friend-sub friend-pvp">${pvp}</span>` : ''}</div>
      <button class="btn btn-ghost btn-sm" data-act="trade" data-id="${f.id}" data-name="${f.nickname}" title="Scambia">🤝</button>
      <button class="btn btn-ghost btn-sm" data-act="profile" data-id="${f.id}">👁</button>
      <button class="btn btn-ghost btn-sm" data-act="remove" data-id="${f.id}">🗑</button>
    </div>`;
  },

  showFriendProfile(p) {
    $('#fp-title').textContent = `${p.avatar_emoji || '🙂'} ${p.nickname}`;
    $('#fp-body').innerHTML = `
      <div class="fp-row"><span>Livello collezionista</span><b>${p.level_text}</b></div>
      <div class="fp-row"><span>Scambi fatti</span><b>${p.trades_done}</b></div>
      <div class="fp-row"><span>Carte possedute</span><b>${p.collection.cards} / 180</b></div>
      <div class="fp-row"><span>Pacchetti aperti</span><b>${p.packs_opened != null ? p.packs_opened : '—'}</b></div>
      <div class="fp-row"><span>PvP (W-L-D)</span><b>${p.pvp.wins}-${p.pvp.losses}-${p.pvp.draws}</b></div>`;
    $('#friends-profile-modal').classList.remove('hidden');
  },

  // ---------- polling intelligente (solo dove serve) ----------
  // Si attiva su screen-friends, screen-trade e screen-home (3s); si mette in
  // pausa quando il tab è nascosto. In home polla SOLO le notifiche (banner).
  startPoll() {
    if (this._pollIv || !SQUER.Online.isOnline()) return;
    const tick = async () => {
      if (document.hidden) return; // tab nascosto: pausa, zero richieste
      const screen = this.currentScreen;
      try {
        // notifiche (richieste amicizia, scambi ricevuti) -> toast/banner
        const n = await SQUER.Online.listNotifications();
        if (n.notifications && n.notifications.length) {
          this.handlePollNotifications(n.notifications);
        }
      } catch (e) { /* rete assente: ignora */ }
      if (screen === 'trade') {
        // su screen-trade il poll continua SEMPRE (anche con this.trade null:
        // serve a rilevare proposte in arrivo nella stanza "nuovo scambio")
        this.tradeRefresh();
      }
      else if (screen === 'friends') this.renderFriends();
      else if (screen === 'home') { /* solo notifiche: il banner lo gestisce handlePollNotifications */ }
      else this.stopPoll(); // usciti dalle schermate online: spegni
    };
    this._pollIv = setInterval(tick, 3000);
  },

  /** Mostra toast per le notifiche nuove e le marca come lette.
      In home mostra anche un BANNER cliccabile per scambi/amicizie. */
  async handlePollNotifications(list) {
    const seen = new Set(this._seenNotifs || []);
    const fresh = list.filter(n => !seen.has(n.id));
    for (const n of fresh) {
      const p = n.payload || {};
      if (n.type === 'friend_request') this.toast(`📥 Nuova richiesta amicizia — controlla la tab Amici`);
      else if (n.type === 'friend_accepted') this.toast(`🤝 Richiesta amicizia accettata`);
      else if (n.type === 'trade_offer') {
        this.toast(`🤝 Hai ricevuto una proposta di scambio!`);
        this.showNotice('🤝', 'Nuova proposta di scambio', () => this.openTradeHub());
      }
      else if (n.type === 'trade_counter') {
        this.toast(`🔄 Controproposta di scambio ricevuta`);
        this.showNotice('🔄', 'Controproposta di scambio', () => this.openTradeHub());
      }
      else if (n.type === 'trade_accepted') this.toast(`✅ Scambio accettato!`);
      else if (n.type === 'trade_declined') this.toast(`❌ Scambio rifiutato`);
      else if (n.type === 'match_started') this.toast(`⚔️ Un avversario si è unito alla tua sfida!`);
      else if (n.type === 'match_move') this.toast(`⚔️ Il tuo avversario ha mosso`);
      seen.add(n.id);
    }
    this._seenNotifs = Array.from(seen).slice(-100);
    // marca come lette quelle mostrate
    if (fresh.length) SQUER.Online.markNotificationsRead(fresh.map(n => n.id)).catch(() => {});
  },

  /** Banner cliccabile (visibile su home, friends e altre schermate —
      non in battaglia). */
  showNotice(icon, text, onClick) {
    if (this.currentScreen === 'battle') return;
    $('#home-notice-icon').textContent = icon;
    $('#home-notice-text').textContent = text;
    $('#home-notice').classList.remove('hidden');
    this._homeNoticeAction = onClick;
  },

  stopPoll() {
    if (this._pollIv) { clearInterval(this._pollIv); this._pollIv = null; }
  },

  // ---------- PvP: sfida con PIN ----------
  /** Bottone Gioca: chiede la modalità (bot vs online). */
  openPlayModal() {
    if (!SQUER.Online.API_BASE) {
      // build senza online: gioca solo contro il bot
      this.startMatch();
      return;
    }
    $('#play-modal').classList.remove('hidden');
  },

  /** Apre la schermata auth con il tab ACCEDI attivo (default). */
  openAuthLogin() {
    this._pendingSfida = false;
    this.showScreen('auth');
    this.showAuthPanel('login');
    $('#login-nickname').value = this.normalizeNickname(loadState().nickname);
    $('#login-password').value = '';
    $('#login-error').classList.add('hidden');
    $('#login-nickname').focus();
  },

  /** Scelta "Online" dal modale: richiede l'account, poi apre la sfida. */
  async playOnline() {
    if (!SQUER.Online.isOnline()) {
      // non loggato: mostra Accedi (default); si può passare a Registrati
      this._pendingSfida = true;
      this.openAuthLogin();
      return;
    }
    // loggato ma mai sincronizzato in questa sessione
    if (!SQUER.Online.synced) {
      this._pendingSfida = true;
      this.showScreen('sync');
      await this.runSync();
      return;
    }
    this.openSfida();
  },

  /** Apre la schermata sfida (da screen-friends). */
  openSfida() {
    $('#sfida-wait').classList.add('hidden');
    $('#btn-sfida-create').classList.remove('hidden');
    $('#sfida-pin-input').value = '';
    $('#sfida-join-error').classList.add('hidden');
    this.renderSfidaDeck();
    this.showScreen('sfida');
  },

  /** Miniature del mazzo nella schermata sfida (cosa userai nella partita). */
  renderSfidaDeck() {
    const s = loadState();
    const deckCards = s.deck.map(uid => this.cards.find(c => c.uid === uid)).filter(Boolean);
    $('#sfida-deck-count').textContent = `${deckCards.length}/8`;
    const grid = $('#sfida-deck-grid');
    if (!deckCards.length) {
      grid.innerHTML = '<div class="friends-empty">Nessuna carta nel mazzo — creane uno prima di sfidare</div>';
      $('#btn-sfida-create').disabled = true;
      $('#btn-sfida-create').style.opacity = 0.5;
      return;
    }
    $('#btn-sfida-create').disabled = false;
    $('#btn-sfida-create').style.opacity = 1;
    grid.innerHTML = deckCards.map(c => {
      const rec = s.collection[c.uid];
      const lv = rec && rec.level > 1 ? ' lv' + rec.level : '';
      return `<div class="sfida-deck-mini" title="${c.name}">
        <img src="${this.thumbDataUrl(c)}" alt="${c.name}">
        <span class="slot-el">${c.typeSymbol}${lv}</span>
      </div>`;
    }).join('');
  },

  /** Crea una partita: usa il mazzo locale (uid+level) e mostra il PIN. */
  async sfidaCreate() {
    const deck = this.pvpDeck();
    if (!deck) return;
    try {
      // sincronizza la collezione locale col server (il server valida il deck
      // contro la collezione cloud: senza push, carte mai sincronizzate
      // verrebbero rifiutate con "Non possiedi la carta")
      await this.pvpSyncCollection();
      const d = await SQUER.Online.createMatch(deck);
      this._pvpMatchId = d.id;
      $('#sfida-pin').textContent = d.pin;
      $('#sfida-wait').classList.remove('hidden');
      $('#btn-sfida-create').classList.add('hidden');
      $('#sfida-wait-text').textContent = 'In attesa di un avversario… (PIN scade in ~2 min)';
      this._sfidaPollIv = setInterval(() => this.sfidaPollCreated(), 2000);
    } catch (e) { this.toast(e.message); }
  },

  /** Poll sul match appena creato: quando l'avversario si unisce -> partita. */
  async sfidaPollCreated() {
    if (!this._pvpMatchId) return;
    try {
      const v = await SQUER.Online.getMatch(this._pvpMatchId);
      if (v.status === 'active') {
        clearInterval(this._sfidaPollIv); this._sfidaPollIv = null;
        const opp = (v.opp_nick && v.opp_nick.nickname) ? `${v.opp_nick.avatar || '⚔️'} ${v.opp_nick.nickname}` : 'un avversario';
        $('#sfida-wait-text').textContent = `${opp} si è unito!`;
        setTimeout(() => this.startPvp(v), 600);
      } else if (v.status === 'expired') {
        clearInterval(this._sfidaPollIv); this._sfidaPollIv = null;
        this.toast('PIN scaduto: creane uno nuovo');
        this.openSfida();
      }
    } catch (e) { /* rete: riprova al prossimo tick */ }
  },

  /** Unisciti a una partita col PIN. */
  async sfidaJoin() {
    const pin = $('#sfida-pin-input').value.trim();
    const errEl = $('#sfida-join-error');
    errEl.classList.add('hidden');
    if (!/^\d{4}$/.test(pin)) { errEl.textContent = 'Inserisci un PIN di 4 cifre'; errEl.classList.remove('hidden'); return; }
    const deck = this.pvpDeck();
    if (!deck) return;
    try {
      await this.pvpSyncCollection();
      const v = await SQUER.Online.joinMatch(pin, deck);
      this.startPvp(v);
    } catch (e) {
      errEl.textContent = e.message; errEl.classList.remove('hidden');
    }
  },

  /** Push della collezione locale al server prima della sfida: il server
      valida il deck contro la collezione cloud, quindi le carte locali
      devono esserci (merge max, mai distruttivo). */
  async pvpSyncCollection() {
    const s = loadState();
    await SQUER.Online.pushCollection({ collection: s.collection || {}, squerini: s.squerini || 0, packsOpened: s.packsOpened || 0 });
  },

  /** Sync della collezione locale col server prima dello scambio (stessa
      logica del PvP): il server valida le carte offerte contro la collezione
      cloud, quindi le carte locali devono esserci. */
  tradeSyncCollection() {
    this.pvpSyncCollection().catch(() => {});
  },

  /** Deck per il PvP: dal mazzo locale, uid + livello. Min 3 carte. */
  pvpDeck() {
    const s = loadState();
    // solo carte POSsedute (count > 0): il server valida contro la collezione
    // cloud e rifiuta le carte non possedute (es. trasferite via scambio)
    const deck = s.deck
      .filter(uid => { const rec = s.collection[uid]; return rec && rec.count > 0; })
      .map(uid => {
        const rec = s.collection[uid];
        return { uid, level: rec && rec.level > 1 ? rec.level : 1 };
      });
    if (deck.length < (SQUER.CONFIG.MIN_DECK_TO_PLAY || 3)) {
      this.toast('Il tuo mazzo ha meno di 3 carte possedute: aggiornalo per sfidare');
      this.showDeck();
      return null;
    }
    return deck;
  },

  /** Avvia la battaglia PvP: lo stato arriva dal server (zero trust), la UI
      riusa scene-battle2 esattamente come contro il bot. */
  startPvp(view) {
    if (!view || !view.match) { this.toast('Errore: partita non valida'); return; }
    clearInterval(this._sfidaPollIv); this._sfidaPollIv = null;
    SQUER.sound.unlock();
    this.disposeScene();
    this.showScreen('battle');
    this._pvp = { id: view.id, mySide: view.my_side, seq: view.events_seq || 0, outcome: view.outcome, reward: view.reward != null ? view.reward : 0 };
    this._pvpOpp = (view.opp_nick && view.opp_nick.nickname) ? view.opp_nick : null;
    const oppLabel = this._pvpOpp ? `${this._pvpOpp.avatar || '⚔️'} ${this._pvpOpp.nickname}` : '⚔️ Avversario';
    // lo stato dal server ha già p = io
    this.match = view.match;
    if (this.match.maxTurns == null) this.match.maxTurns = Infinity;
    this._animaMax = (SQUER.CONFIG && SQUER.CONFIG.ANIMA) || 80;
    this._sel = null;
    this._botTimer = null;
    this._turnIv = null;
    this._turnLeft = null;
    this._lastTimerPlayer = view.my_turn ? 'p' : 'b';
    this._pvpTurnLeft = view.my_turn ? null : ((SQUER.CONFIG && SQUER.CONFIG.TURN_TIME_SEC) || 60);
    this._notifiedEnd = false;
    this.scene = new SQUER.BattleScene2($('#battle-scene'), {
      onZoneTap: (player, zone) => this.onZoneTap(player, zone),
      onHandTap: (index) => this.onHandTap(index),
      onHandDrop: (handIndex, zone) => this.onHandDrop(handIndex, zone),
      onHandDrag: (index) => this.onHandDrag(index),
      onPadMatchup: (zone, adv) => this.onPadMatchup(zone, adv),
    });
    $('#battle-nick').textContent = SQUER.Online.user ? (SQUER.Online.user.nickname || 'Tu') : 'Tu';
    if (SQUER.Online.user && SQUER.Online.user.avatar_emoji) {
      $('#battle-me-avatar').textContent = SQUER.Online.user.avatar_emoji;
    }
    $('#anima-b-name').textContent = oppLabel;
    this.renderBattle();
    // notifica "Tocca a" per chi inizia
    if (!this.match.over) {
      if (view.my_turn) {
        const me = SQUER.Online.user;
        this.showTurnNotice(`${me && me.avatar_emoji ? me.avatar_emoji + ' ' : ''}${me ? me.nickname : 'Tu'}`);
      } else {
        this.showTurnNotice(oppLabel);
      }
    }
    // flusso: se tocca a me, attendo la mossa; altrimenti poll sull'avversario
    if (!this.match.over && !view.my_turn) this.pvpPollStart();
  },

  /** Aggiorna la UI con un nuovo stato dal server (dopo una mossa o poll). */
  applyPvpView(view) {
    if (!view || !view.match) return;
    const seq = view.events_seq || 0;
    const freshEvents = seq > this._pvp.seq ? (view.match.events || []) : [];
    const prevMyTurn = this._pvp.myTurn;
    this._pvp.seq = seq;
    this._pvp.myTurn = view.my_turn;
    this._pvp.outcome = view.outcome;
    this._pvp.reward = view.reward != null ? view.reward : 0;
    if (view.opp_nick && view.opp_nick.nickname) {
      this._pvpOpp = view.opp_nick;
      $('#anima-b-name').textContent = `${view.opp_nick.avatar || '⚔️'} ${view.opp_nick.nickname}`;
    }
    view.match.events = []; // gli eventi li rigioca processEvents
    this.match = view.match;
    if (this.match.maxTurns == null) this.match.maxTurns = Infinity;
    this.renderBattle();
    if (freshEvents.length) this.processEvents(freshEvents);
    if (this.match.over) { this.pvpFinish(); return; }
    // notifica "Tocca a" quando il turno cambia
    if (view.my_turn && !prevMyTurn) {
      const me = SQUER.Online.user;
      this.showTurnNotice(`${me && me.avatar_emoji ? me.avatar_emoji + ' ' : ''}${me ? me.nickname : 'Tu'}`);
    } else if (!view.my_turn && prevMyTurn && this._pvpOpp) {
      this.showTurnNotice(`${this._pvpOpp.avatar || '⚔️'} ${this._pvpOpp.nickname}`);
    }
    if (view.my_turn) {
      this.pvpPollStop();
      this._lastTimerPlayer = 'p';
      this._pvpTurnLeft = null; // il countdown mio lo gestisce _turnTick
    } else {
      this._lastTimerPlayer = 'b';
      this._pvpTurnLeft = this._pvpTurnLeft == null ? ((SQUER.CONFIG && SQUER.CONFIG.TURN_TIME_SEC) || 60) : this._pvpTurnLeft;
      this.pvpPollStart();
    }
  },

  /** Poll sul match: scopre la mossa dell'avversario. */
  pvpPollStart() {
    if (this._pvpPollIv) return;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const v = await SQUER.Online.getMatch(this._pvp.id);
        if (this.currentScreen !== 'battle') { this.pvpPollStop(); return; }
        if (v.events_seq !== this._pvp.seq || v.my_turn || v.over) this.applyPvpView(v);
      } catch (e) { /* rete */ }
    };
    this._pvpPollIv = setInterval(tick, 2000);
  },

  pvpPollStop() {
    if (this._pvpPollIv) { clearInterval(this._pvpPollIv); this._pvpPollIv = null; }
  },

  /** Invia una mossa al server e applica la risposta.
      Ottimismo per place/attack: la carta si muove SUBITO in campo (il flusso
      di animazione del drag non si rompe), poi il server conferma e sostituisce
      lo stato vero. Se il server rifiuta, si ricarica lo stato reale. */
  async pvpMove(action, extra = {}) {
    // optimistic: applica localmente per l'animazione (solo per il turno mio)
    if ((action === 'place' || action === 'attack') && this.match && !this.match.over) {
      this.pvpOptimistic(action, extra);
    }
    try {
      const v = await SQUER.Online.moveMatch(this._pvp.id, action, extra);
      this.applyPvpView(v);
    } catch (e) {
      if (/Non è il tuo turno/.test(e.message)) { this.toast('Non è il tuo turno'); return; }
      this.toast(e.message);
      // rollback: ricarica lo stato vero dal server
      try {
        const v = await SQUER.Online.getMatch(this._pvp.id);
        this.applyPvpView(v);
      } catch (e2) { /* resta come siamo */ }
    }
  },

  /** Applica la mossa su una COPIA locale dello stato (solo per la resa
      visiva immediata). Il server resta la fonte di verità. */
  pvpOptimistic(action, extra) {
    try {
      const st = SQUER.GAME.restoreMatch(JSON.parse(JSON.stringify(this.match)));
      let r = null;
      if (action === 'place') r = SQUER.GAME.actionPlace(st, 'p', extra.handIndex, extra.zone);
      else if (action === 'attack') r = SQUER.GAME.actionAttack(st, 'p', extra.zone);
      if (!r || !r.ok) return;
      // aggiorna solo la resa (anima/zona/mano) senza toccare turno ed eventi:
      // il server decide la verità e applyPvpView la sostituisce
      this.match = st;
      this._sel = null;
      this.renderBattle();
    } catch (e) { /* ignora: il server è la verità */ }
  },

  /** Fine partita PvP: risultato dal server (outcome dal MIO lato). */
  pvpFinish() {
    const m = this.match;
    if (m._rewarded) return;
    m._rewarded = true;
    this.pvpPollStop();
    const outcome = this._pvp && this._pvp.outcome != null ? this._pvp.outcome : m.outcome;
    // outcome è dal lato p (= io): win | lose | draw | abandon
    const isWin = outcome === 'win';
    const isDraw = outcome === 'draw';
    const isAbandon = outcome === 'abandon';
    $('#result-icon').textContent = isWin ? '🏆' : (isDraw ? '🤝' : (isAbandon ? '🚪' : '💀'));
    $('#result-title').textContent = isWin ? 'Vittoria!' : (isDraw ? 'Pareggio' : (isAbandon ? 'Avversario assente' : 'Sconfitta'));
    $('#result-score').classList.add('hidden');
    // pillola ricompensa: come col bot (win 30 / draw 15 / lose 10, 0 se
    // hai abbandonato) — il reward arriva dal server (fonte di verità)
    const reward = this._pvp && this._pvp.reward != null ? this._pvp.reward : 0;
    $('#result-reward').textContent = reward > 0 ? `+${reward} 🪙 Squerini` : 'Nessun guadagno';
    $('#result-reward').classList.remove('hidden');
    // aggiorna gli squerini locali (il sync cloud li riconfermerà)
    const s = loadState();
    s.squerini = (s.squerini || 0) + reward;
    saveState(s);
    this.updateSqueriniBadge();
    $('#result-zones').innerHTML = '';
    $('#result-zones').classList.add('hidden');
    $('#result-rematch').textContent = '⚔️ Rigioca';
    clearTimeout(this._resultT);
    this._resultT = setTimeout(() => {
      $('#result-modal').classList.remove('hidden');
    }, 1400);
  },

  /** Rivincita PvP: chiede al server; se anche l'avversario la chiede si
      gioca subito, altrimenti si attende (finestra ~30s) con poll. */
  async pvpRematch() {
    if (!this._pvp) return;
    $('#result-modal').classList.add('hidden');
    try {
      const v = await SQUER.Online.matchRematch(this._pvp.id);
      if (v.status === 'active') {
        // entrambi l'hanno chiesta: nuova partita subito
        this.startPvp(v);
        return;
      }
      // attesa rivincita
      this.toast('⏳ In attesa della rivincita… (30s)', true);
      this._pvpRematchIv = setInterval(() => this.pvpRematchPoll(), 2000);
    } catch (e) {
      this.toast(e.message);
      this.showScreen('home');
      this.refreshHome();
    }
  },

  /** Poll sulla rivincita: se l'avversario la chiede -> nuova partita;
      se è andato via o la finestra scade -> home. */
  async pvpRematchPoll() {
    if (!this._pvp) { clearInterval(this._pvpRematchIv); this._pvpRematchIv = null; return; }
    try {
      const v = await SQUER.Online.getMatch(this._pvp.id);
      if (v.status === 'active') {
        clearInterval(this._pvpRematchIv); this._pvpRematchIv = null;
        this.startPvp(v);
        return;
      }
      const mySide = v.my_side;
      const other = mySide === 'a' ? (v.rematch && v.rematch.b) : (v.rematch && v.rematch.a);
      if (other === -1) {
        // l'avversario è andato via: torna a home
        clearInterval(this._pvpRematchIv); this._pvpRematchIv = null;
        this.toast('L\'avversario è andato via');
        this.quitPvp();
        this.showScreen('home');
        this.refreshHome();
        return;
      }
      if (v.rematch_deadline && Date.now() > v.rematch_deadline) {
        clearInterval(this._pvpRematchIv); this._pvpRematchIv = null;
        this.toast('Nessuna rivincita: avversario non ha risposto');
        this.quitPvp();
        this.showScreen('home');
        this.refreshHome();
      }
    } catch (e) { /* rete: riprova */ }
  },

  // ---------- trade (stanza scambio) ----------
  trade: null,          // oggetto scambio corrente
  tradeMyRole: null,    // 'proposer' | 'receiver'
  tradePick: [],        // carte selezionate nella modale di scelta

  /** Avvia la stanza di scambio con un amico. Se esiste già uno scambio
      attivo (proposta in arrivo o in corso) con quell'amico, lo apre —
      altrimenti parte un nuovo scambio. */
  async openTrade(friendId, friendName) {
    // sincronizza la collezione locale col server (il server valida le carte
    // offerte contro la collezione cloud: senza push, carte mai sincronizzate
    // verrebbero rifiutate con "Non possiedi la carta")
    this.tradeSyncCollection();
    // cerca uno scambio attivo con questo amico (proposta ricevuta o inviata)
    try {
      const d = await SQUER.Online.listTrades();
      const active = (d.trades || []).find(t =>
        (t.proposer === friendId || t.receiver === friendId) &&
        (t.status === 'pending' || t.status === 'countered'));
      if (active) { this.openTradeById(active); return; }
    } catch (e) { /* rete: continua con nuovo scambio */ }
    this.trade = null;
    this.tradeMyRole = null;
    this.tradeOpp = { id: friendId, name: friendName };
    this.showScreen('trade');
    // nuovo scambio: renderizza subito lo stato vuoto (pulsante ＋ visibile)
    this.renderTrade();
    this.tradeRefresh();
  },

  /** Voce "Scambio" del menu online: riprende uno scambio in corso, altrimenti
      guida alla lista amici (dove si avvia con 🤝). */
  async openTradeHub() {
    // sincronizza la collezione locale col server prima di mostrare gli scambi
    this.tradeSyncCollection();
    try {
      const d = await SQUER.Online.listTrades();
      const active = (d.trades || []).find(t => t.status === 'pending' || t.status === 'countered');
      if (active) { this.openTradeById(active); return; }
    } catch (e) { /* ignora: va dagli amici */ }
    this.toast('Scegli un amico e tocca 🤝 per scambiare');
    this.openFriends();
  },

  /** Apre lo scambio esistente (da lista). */
  async openTradeById(t) {
    this.trade = t;
    this.tradeMyRole = t.proposer === SQUER.Online.user.id ? 'proposer' : 'receiver';
    this.tradeOpp = {
      id: t.proposer === SQUER.Online.user.id ? t.receiver : t.proposer,
      name: 'Avversario',
    };
    this.showScreen('trade');
    this.tradeRefresh();
  },

  /** Ricarica lo scambio dal server (se è aperto per id) e ridisegna.
      Se siamo in una stanza "nuovo scambio" (this.trade null) ma è arrivata
      una proposta dall'amico, la rileva e la apre. Se lo scambio è chiuso
      (completed/declined/cancelled) lo recupera per id per mostrare l'esito. */
  async tradeRefresh() {
    // stanza "nuovo scambio": cerca se è arrivata una proposta dall'amico
    if (!this.trade || !this.trade.id) {
      if (this.tradeOpp && this.tradeOpp.id) {
        try {
          const d = await SQUER.Online.listTrades();
          const active = (d.trades || []).find(t =>
            (t.proposer === this.tradeOpp.id || t.receiver === this.tradeOpp.id) &&
            (t.status === 'pending' || t.status === 'countered'));
          if (active) { this.openTradeById(active); return; }
        } catch (e) { /* rete */ }
      }
      return;
    }
    try {
      const d = await SQUER.Online.listTrades();
      let found = d.trades.find(x => x.id === this.trade.id);
      if (!found) {
        // chiuso: recupera per id per mostrare l'esito
        try { found = await SQUER.Online.getTrade(this.trade.id); } catch (e) { found = null; }
      }
      if (!found) { this.toast('Scambio non più attivo'); this.showScreen('friends'); return; }
      this.trade = found;
      this.tradeMyRole = found.proposer === SQUER.Online.user.id ? 'proposer' : 'receiver';
      this.renderTrade();
    } catch (e) { this.toast(e.message); }
  },

  renderTrade() {
    const t = this.trade;
    // Stato "nuovo scambio": nessuna proposta ancora — mostra il pulsante
    // per aggiungere le prime carte (e un messaggio chiaro).
    if (!t) {
      $('#trade-status').textContent = 'Offri le tue carte per iniziare lo scambio';
      $('#trade-mine').innerHTML = '<div class="trade-empty">Nessuna carta offerta</div>';
      $('#trade-opp').innerHTML = '<div class="trade-empty">…</div>';
      $('#trade-opp-label').textContent = `🤖 ${this.tradeOpp ? this.tradeOpp.name : 'Avversario'}`;
      $('#trade-actions').innerHTML = '';
      $('#trade-log').textContent = '';
      return;
    }
    const myCards = t.cards[this.tradeMyRole] || [];
    const oppCards = t.cards[this.tradeMyRole === 'proposer' ? 'receiver' : 'proposer'] || [];
    const myRole = this.tradeMyRole;

    // riscrive l'innerHTML SOLO se cambiato: evita che l'animazione CSS
    // (tradeIn) riparta a ogni refresh del polling (effetto "popping")
    this.setTradeCards($('#trade-mine'), myCards.length
      ? myCards.map(c => this.tradeCardHtml(c.uid, c.level)).join('')
      : '<div class="trade-empty">Nessuna carta offerta</div>');
    this.setTradeCards($('#trade-opp'), oppCards.length
      ? oppCards.map(c => this.tradeCardHtml(c.uid, c.level, true)).join('')
      : '<div class="trade-empty">…</div>');
    $('#trade-opp-label').textContent = `🤖 ${this.tradeOpp.name}`;

    // azioni contestuali
    const acts = $('#trade-actions');
    const log = $('#trade-log');
    const myTurn = (t.status === 'pending' && myRole === 'receiver') || (t.status === 'countered' && myRole === 'proposer');
    const canAccept = myTurn && myCards.length && oppCards.length;

    if (t.status === 'completed') {
      $('#trade-status').textContent = '✅ Scambio completato!';
      acts.innerHTML = '<button class="btn btn-primary" id="btn-trade-close">Chiudi</button>';
      log.textContent = 'Carte trasferite. Livello collezionista aggiornato!';
      $('#btn-trade-close').onclick = () => this.showScreen('friends');
      this.renderTradeSigil();
      return;
    }
    if (t.status === 'declined' || t.status === 'cancelled') {
      // annullato per scadenza TTL: mostra chi non ha risposto
      if (t.status === 'cancelled' && t.reason === 'timeout') {
        const who = t.proposer === SQUER.Online.user.id ? t.receiver : t.proposer;
        const name = this.tradeOpp && this.tradeOpp.id === who ? this.tradeOpp.name : 'L\'avversario';
        $('#trade-status').textContent = `⏰ ${name} non ha risposto alla richiesta`;
      } else {
        $('#trade-status').textContent = t.status === 'declined' ? '❌ Scambio rifiutato' : '🚫 Scambio annullato';
      }
      acts.innerHTML = '<button class="btn btn-ghost" id="btn-trade-close">Chiudi</button>';
      $('#btn-trade-close').onclick = () => this.showScreen('friends');
      return;
    }

    $('#trade-status').textContent = myTurn
      ? '👈 Tocca a te: rispondi alla proposta'
      : '⏳ In attesa dell\'avversario…';
    acts.innerHTML = '';
    if (myTurn) {
      acts.innerHTML += `<button class="btn btn-primary" id="btn-trade-counter">Controproponi</button>`;
      if (canAccept) acts.innerHTML += `<button class="btn btn-primary" id="btn-trade-accept">✓ Accetta</button>`;
      acts.innerHTML += `<button class="btn btn-ghost" id="btn-trade-decline">✕ Rifiuta</button>`;
    } else if (myRole === 'proposer') {
      acts.innerHTML = `<button class="btn btn-ghost" id="btn-trade-cancel">Annulla scambio</button>`;
    }
    // guardie: i bottoni non sempre esistono (es. il proposer in attesa vede
    // solo "Annulla") — senza, null.onclick lancia un errore nel toast
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    bind('btn-trade-counter', () => this.tradeOpenPick());
    bind('btn-trade-accept', () => this.tradeDoAccept());
    bind('btn-trade-decline', () => this.tradeDoDecline());
    bind('btn-trade-cancel', () => this.tradeDoCancel());
    log.textContent = '';
  },

  /** Aggiorna un contenitore carte SOLO se il contenuto è cambiato
      (evita che l'animazione tradeIn riparta a ogni refresh). */
  setTradeCards(el, html) {
    if (!el) return;
    if (el.innerHTML !== html) el.innerHTML = html;
  },

  tradeCardHtml(uid, level, opp) {
    const c = this.cards.find(x => x.uid === uid);
    if (!c) return `<div class="trade-card"><span>❓</span></div>`;
    return `<div class="trade-card ${opp ? 'opp' : ''}" style="border-color:${RARITY_TAG_COLOR[c.rarity.id]}">
      <img src="${this.thumbDataUrl(c)}" alt="${c.name}">
      <span class="trade-card-name">${c.name}</span>
      <span class="trade-card-lv">Lv${level}</span>
    </div>`;
  },

  /** Sigillo dello scambio: animazione finale (anello di luce + carte). */
  renderTradeSigil() {
    const sigil = document.createElement('div');
    sigil.className = 'trade-sigil';
    sigil.innerHTML = '<div class="sigil-ring"></div><div class="sigil-emoji">🤝</div>';
    $('#screen-trade').appendChild(sigil);
    setTimeout(() => sigil.classList.add('show'), 50);
    setTimeout(() => { sigil.classList.add('out'); setTimeout(() => sigil.remove(), 600); }, 1600);
  },

  async tradeDoAccept() {
    try {
      await SQUER.Online.tradeAccept(this.trade.id);
      await this.tradeRefresh();
      // dopo lo scambio il SERVER è autorevole: la collezione locale va
      // SOSTITUITA con quella server (le carte date sono state rimosse, le
      // ricevute aggiunte) — un merge max terrebbe carte non più possedute
      const d = await SQUER.Online.pullCollection();
      const s = SQUER.PACKS.loadState();
      s.collection = d.collection || {};
      if (d.squerini > (s.squerini || 0)) s.squerini = d.squerini;
      if (d.packs_opened > (s.packsOpened || 0)) s.packsOpened = d.packs_opened;
      SQUER.PACKS.saveState(s);
    } catch (e) { this.toast(e.message); }
  },
  async tradeDoDecline() { try { await SQUER.Online.tradeDecline(this.trade.id); await this.tradeRefresh(); } catch (e) { this.toast(e.message); } },
  async tradeDoCancel() { try { await SQUER.Online.tradeCancel(this.trade.id); await this.tradeRefresh(); } catch (e) { this.toast(e.message); } },

  /** Modale di scelta carte dalla propria collezione (max 3). */
  tradeOpenPick() {
    const s = SQUER.PACKS.loadState();
    this.tradePick = [];
    const owned = this.cards.filter(c => { const rec = s.collection[c.uid]; return rec && rec.count > 0; });
    $('#trade-pick-grid').innerHTML = owned.length
      ? owned.map(c => {
          const rec = s.collection[c.uid];
          const copies = rec.count > 1 ? `<span class="trade-pick-copies">×${rec.count}</span>` : '';
          return `<div class="trade-pick" data-uid="${c.uid}" data-lv="${rec.level}">
            <img src="${this.thumbDataUrl(c)}" alt="${c.name}">
            <span class="trade-pick-lv">Lv${rec.level}</span>
            ${copies}
          </div>`;
        }).join('')
      : '<div class="trade-empty">Nessuna carta posseduta</div>';
    $('#trade-pick-modal').classList.remove('hidden');
  },

  /** HTML per il pulsante aggiungi/done: si attacca qui il click. */

  // ---------- online UI helpers ----------
  showAuthPanel(name) {
    $$('.auth-tab').forEach(t => t.classList.remove('active'));
    $$('.auth-panel').forEach(p => p.classList.add('hidden'));
    if (name === 'login') { $('#tab-login').classList.add('active'); $('#panel-login').classList.remove('hidden'); }
    else if (name === 'register') { $('#tab-register').classList.add('active'); $('#panel-register').classList.remove('hidden'); }
    else if (name === 'recover') { $('#panel-recover').classList.remove('hidden'); }
    else if (name === 'backup') { $('#panel-backup').classList.remove('hidden'); }
  },

  /** Schermata di caricamento a fasi: login/migrazione/sync con feedback. */
  async runSync() {
    const phases = [
      'Connessione al server…',
      'Verifica credenziali…',
      'Importazione della collezione locale…',
      'Sincronizzazione con il cloud…',
    ];
    const list = $('#sync-phases');
    list.innerHTML = '';
    phases.forEach((label, i) => {
      const div = document.createElement('div');
      div.className = 'sync-phase';
      div.dataset.i = i;
      div.innerHTML = '<span class="sync-dot"></span> ' + label;
      list.appendChild(div);
    });
    $('#sync-actions').textContent = '';
    $('#sync-buttons').classList.add('hidden');
    $('#sync-title').textContent = 'Sincronizzazione…';

    const setPhase = (i, state) => {
      const el = list.querySelector(`.sync-phase[data-i="${i}"]`);
      if (el) {
        el.classList.remove('doing', 'ok', 'err');
        el.classList.add(state);
        el.querySelector('.sync-dot').textContent = state === 'ok' ? '✓' : state === 'err' ? '✕' : '…';
      }
    };
    const fail = (msg) => {
      $('#sync-title').textContent = 'Connessione non disponibile';
      $('#sync-actions').textContent = msg;
      $('#sync-buttons').classList.remove('hidden');
      // showScreen resta su sync per le azioni Riprova/offline
    };

    setPhase(0, 'doing');
    try {
      // 1-2. connect + session check (una chiamata: /me)
      await SQUER.Online.api('/me');
      setPhase(0, 'ok'); setPhase(1, 'ok');
    } catch (e) {
      setPhase(0, 'err');
      fail('Non riesco a raggiungere il server. Controlla la connessione.');
      return;
    }

    // 3. migrazione automatica (una tantum; 409 = già fatto, ok)
    setPhase(2, 'doing');
    try {
      await SQUER.Online.migrateLocalData();
      setPhase(2, 'ok');
    } catch (e) {
      setPhase(2, 'err');
      fail('Errore durante l\'importazione dei dati locali: ' + e.message);
      return;
    }

    // 4. pull + merge collezione nel localStorage
    setPhase(3, 'doing');
    try {
      const d = await SQUER.Online.pullCollection();
      const s = SQUER.PACKS.loadState();
      s.collection = SQUER.Online.mergeCollections(s.collection, d.collection);
      if (d.squerini > (s.squerini || 0)) s.squerini = d.squerini;
      // pacchetti aperti: merge max (il server è autorevole se più alto);
      // se invece il LOCALE è più alto (es. account già migrato prima del
      // contatore), lo spingiamo su così il server si allinea
      if (d.packs_opened > (s.packsOpened || 0)) {
        s.packsOpened = d.packs_opened;
      } else if ((s.packsOpened || 0) > (d.packs_opened || 0)) {
        SQUER.Online.pushCollection({ collection: {}, squerini: 0, packsOpened: s.packsOpened }).catch(() => {});
      }
      SQUER.PACKS.saveState(s);
      setPhase(3, 'ok');
      SQUER.Online.synced = true;
      // il nickname dell'account diventa il nickname locale (così al prossimo
      // avvio l'app non richiede di nuovo login/registrazione)
      const s3 = SQUER.PACKS.loadState();
      if (SQUER.Online.user && SQUER.Online.user.nickname) s3.nickname = SQUER.Online.user.nickname;
      SQUER.PACKS.saveState(s3);
      $('#sync-title').textContent = 'Fatto!';
      $('#sync-actions').textContent = 'Collezione sincronizzata con il cloud.';
      setTimeout(() => {
        if (this._pendingSfida) {
          this._pendingSfida = false;
          this.openSfida();
          return;
        }
        this.showScreen('home');
        this.refreshHome();
      }, 800);
    } catch (e) {
      setPhase(3, 'err');
      fail('Sync non riuscito: ' + e.message);
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init(); // init() calls bindEvents()
});

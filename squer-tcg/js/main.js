/* =========================================================
   Squer TCG - main app orchestrator
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const RARITY_TAG_COLOR = {
  common: '#aeb9c6', uncommon: '#4aa3ff', rare: '#b06bff',
  superRare: '#ff5fd0', legendary: '#ffc93d',
};

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
    this.cards = await createCardSet(entries);
    this.updateLoader(0.9, 'Carte pronte!');
    setTimeout(() => {
      $('#loader').classList.add('hidden');
      this.showScreen('home');
      this.refreshHome();
      if (!this.cards.length) $('#empty-banner').classList.remove('hidden');
      this.watchManifestChanges();
    }, 300);
  },

  /** Polls the manifest; if it changes (new images added), invites to reload */
  async watchManifestChanges() {
    let last = null;
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

  bindProgress() {
    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(p + Math.random() * 18, 85);
      $('#loader-fill').style.width = p + '%';
    }, 120);
    this._loaderIv = iv;
  },
  updateLoader(p, text) {
    clearInterval(this._loaderIv);
    $('#loader-fill').style.width = p + '%';
    if (text) $('#loader-text').textContent = text;
  },

  // ---------- navigation ----------
  showScreen(name) {
    this.currentScreen = name;
    $$('.screen').forEach(s => s.classList.remove('active'));
    $('#screen-' + name).classList.add('active');
    const topMenu = $('#top-menu');
    if (topMenu) topMenu.classList.toggle('hidden', name !== 'home');
    if (name === 'home') this.refreshHome();
    if (name === 'collection') this.renderCollection();
  },

  // ---------- home ----------
  refreshHome() {
    const stats = collectionStats(this.cards);
    $('#stat-owned').textContent = stats.owned;
    $('#stat-packs').textContent = stats.packsOpened;
    const pct = stats.total ? Math.round((stats.owned / stats.total) * 100) : 0;
    $('#progress-fill').style.width = pct + '%';
    $('#progress-text').textContent = `${stats.owned} / ${stats.total}`;

    const remaining = packsRemaining();
    $('#pack-counter').style.display = remaining > 0 ? '' : 'none';
    $('#pack-counter-text').textContent = remaining > 0
      ? `${remaining} pacchett${remaining === 1 ? 'o' : 'i'} gratis oggi`
      : '';
    $('#btn-open-pack').disabled = remaining <= 0;
    $('#btn-open-pack').style.opacity = remaining <= 0 ? 0.5 : 1;
    $('#home-hint').textContent = remaining <= 0 ? 'Torna domani per altri pacchetti gratuiti' : '';

    this.renderLatestPulls();
  },

  // ---------- rendering utils ----------
  /** Thumbnail dataURL (160x225) con cache — per griglie e anteprime piccole */
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

  /** dataURL full-size con cache — per usi dove serve il dettaglio (modal) */
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
    // remove leftover action buttons from previous pack
    const hud = $('#pack-hud');
    hud.querySelectorAll('button').forEach(b => b.remove());
    $('#pack-dots').innerHTML = Array.from({ length: PACK_SIZE }, () => '<div class="dot"></div>').join('');
    $('#pack-hud-text').textContent = 'Trascina per aprire ⚡';
    $('#pack-top-title').textContent = 'Apri il pacchetto';

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
      () => this.packComplete() // solo quando l'ultima carta viene scartata
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

    // nuova carta: banner 'NUOVA!' in alto (niente toast in basso)
    if (card.isNew) {
      this.newCardsQueue.push(card);
      this.showNewBanner();
    }

    // Niente timer fisso qui: il completamento del pacchetto (e il riepilogo
    // delle nuove carte) scatta quando l'ultima carta viene scartata, cosi'
    // l'utente puo' tenere premuto l'ultima carta e ruotarla senza menu
    // in sovrimpressione.
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
      // ultimo pacchetto del giorno: torna direttamente alla home
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

    // adatta la griglia: trova la larghezza (e le colonne) che fa entrare
    // TUTTE le carte intere nello spazio disponibile, rimpicciolendole
    // quanto serve invece di tagliarle. Misura DOPO la decodifica delle
    // immagini, altrimenti l'altezza del contenitore risulta 0.
    const fit = () => {
      const items = list.querySelectorAll('.summary-item');
      if (!items.length) return;
      // forzo il contenuto oltre il limite: il list si ferma alla sua altezza
      // massima reale (flex), cosi' availH e' lo spazio effettivamente
      // concesso, non l'altezza "auto" del contenuto corrente
      items.forEach(t => { t.style.width = '300px'; });
      const availW = list.clientWidth;
      const availH = list.clientHeight;
      const gap = 10;
      const RATIO = 512 / 720; // larghezza/altezza carta
      const MAX_W = 110;       // larghezza massima: con poche carte non diventano giganti
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
      const owned = rec && rec.pulled > 0;
      if (this.ownedFilter === 'owned' && !owned) return false;
      if (this.ownedFilter === 'missing' && owned) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });

    if (this._renderToken) this._renderToken.cancelled = true;
    const token = { cancelled: false };
    this._renderToken = token;
    grid.innerHTML = '';

    if (!filtered.length) {
      grid.innerHTML = '<div class="grid-empty">Nessuna carta trovata</div>';
      return;
    }

    // builders: l'HTML (e la thumbnail) viene generato a chunk per non bloccare la UI
    const builders = filtered.map(c => {
      const rec = s.collection[c.uid];
      const owned = rec && rec.pulled > 0;
      if (!owned) {
        return () => `<div class="card-tile empty" data-uid="${c.uid}">${c.number}</div>`;
      }
      const tag = RARITY_TAG_COLOR[c.rarity.id];
      const dup = rec.pulled > 1 ? `<span class="owned-count">${rec.pulled}</span>` : '';
      return () => `<div class="card-tile" data-uid="${c.uid}" style="border:2px solid ${tag}">
        <img src="${this.thumbDataUrl(c)}" alt="${c.name}">
        ${dup}
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
    this.detailIndex = this.cards.indexOf(card);
    if (this.detailIndex < 0) this.detailIndex = 0;
    this.showScreen('detail');
    this.renderDetail();
  },

  renderDetail() {
    const card = this.cards[this.detailIndex];
    if (!card) return;
    $('#detail-title').textContent = card.name;
    $('#detail-info').innerHTML = `
      <div class="rarity-name" style="color:${RARITY_TAG_COLOR[card.rarity.id]}">${card.rarity.name}</div>
      <div class="detail-meta">
        ${card.typeSymbol} ${card.typeName} · Carta ${card.number}/${card.setSize}
      </div>
      <div class="detail-stats">
        <div class="detail-stat"><b>${card.hp}</b><span>PV</span></div>
        <div class="detail-stat"><b>${card.pulled}</b><span>Possedute</span></div>
        <div class="detail-stat"><b>${card.rarity.name}</b><span>Rarità</span></div>
      </div>`;
    $('#btn-detail-prev').disabled = this.detailIndex <= 0;
    $('#btn-detail-next').disabled = this.detailIndex >= this.cards.length - 1;
    this.disposeScene();
    this.scene = new SQUER.SquerScene($('#detail-scene'));
    this.scene.showCard(card, { flip: true });
  },

  navDetail(dir) {
    const i = this.detailIndex + dir;
    if (i < 0 || i >= this.cards.length) return;
    this.detailIndex = i;
    this.renderDetail();
  },

  disposeScene() {
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

  bindEvents() {
    $('#btn-open-pack').addEventListener('click', () => this.startPack());
    $('#btn-collection').addEventListener('click', () => this.showScreen('collection'));
    $('#btn-pack-back').addEventListener('click', () => { this.disposeScene(); this.showScreen('home'); });
    $('#btn-collection-back').addEventListener('click', () => this.showScreen('home'));
    $('#btn-detail-back').addEventListener('click', () => { this.disposeScene(); this.showScreen('collection'); });

    // top menu (hamburger)
    $('#menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#menu-dropdown').classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.top-menu')) $('#menu-dropdown').classList.add('hidden');
    });
    $('#menu-reset').addEventListener('click', () => {
      $('#menu-dropdown').classList.add('hidden');
      if (confirm('Azzera tutti i progressi? Le carte verranno rigenerate.')) {
        resetProgress();
        this.refreshHome();
        this.toast('Progressi azzerati');
      }
    });

    // filtri rarita'
    $$('.chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.chip[data-filter]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.filter = chip.dataset.filter;
        this.renderCollection();
      });
    });

    // toggle possedute/mancanti
    $$('#own-toggle .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('#own-toggle .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.ownedFilter = chip.dataset.own;
        this.renderCollection();
      });
    });

    // ricerca per nome (debounce)
    $('#search-input').addEventListener('input', (e) => {
      clearTimeout(this._searchT);
      this._searchT = setTimeout(() => {
        this.search = e.target.value.trim().toLowerCase();
        this.renderCollection();
      }, 120);
    });

    // navigazione dettaglio: frecce
    $('#btn-detail-prev').addEventListener('click', () => this.navDetail(-1));
    $('#btn-detail-next').addEventListener('click', () => this.navDetail(1));

    // navigazione dettaglio: swipe orizzontale (non sul canvas 3D)
    let touchX = null;
    $('#screen-detail').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    $('#screen-detail').addEventListener('touchend', (e) => {
      if (touchX === null || e.target.closest('canvas')) { touchX = null; return; }
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 40) this.navDetail(dx < 0 ? 1 : -1);
    });

    // event delegation per le tile dell'album (un solo listener, sopravvive al chunking)
    $('#collection-grid').addEventListener('click', (e) => {
      const tile = e.target.closest('.card-tile');
      if (!tile) return;
      const uid = tile.dataset.uid;
      const c = this.cards.find(x => x.uid === uid);
      if (!c) return;
      if (!isOwned(uid)) { this.toast('Non hai ancora questa carta'); return; }
      this.openDetail(c);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init(); // init() chiama bindEvents()
});
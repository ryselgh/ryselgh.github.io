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
        // fase 2: disegno dei canvas (dopo il caricamento immagini)
        this.updateLoader(70 + Math.round((done / total) * 20), `Disegno carte... ${done} / ${total}`);
      } else {
        // fase 1: scaricamento immagini (0 -> 70% della barra)
        this.updateLoader(Math.round((done / total) * 70), `Caricamento carte... ${done} / ${total}`);
      }
    });
    // breve pausa: lascia vedere "Disegno carte... 180 / 180" al 90%
    await new Promise(r => setTimeout(r, 250));
    this.updateLoader(100, 'Carte pronte!');
    setTimeout(() => {
      $('#loader').classList.add('hidden');
      this.buildTypesTable();
      // badge valuta e menu: app pronta (il badge NON deve galleggiare
      // sopra il loader durante il caricamento iniziale)
      document.body.classList.add('app-ready');
      // primo avvio: chiedi il nickname prima di tutto
      if (!loadState().nickname) {
        this.showScreen('nickname');
        $('#nickname-input').focus();
      } else {
        this.showScreen('home');
        this.refreshHome();
      }
      if (!this.cards.length) $('#empty-banner').classList.remove('hidden');
      this.watchManifestChanges();
    }, 300);
  },

  /** Polls the manifest; if it changes (new images added), invites to reload */
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

  /** Tabella dei 12 tipi nell'help: generata da TYPE_BEATS + CARD_TYPES
      (così resta sincronizzata con la config, mai duplicata a mano).
      Compatibile con schermi stretti: "Vince su" / "Perde contro" solo
      con le emoji (niente nomi), prima colonna col nome del tipo. */
  buildTypesTable() {
    const tbody = $('#types-table');
    if (!tbody || !SQUER.CONFIG || !SQUER.CONFIG.TYPE_BEATS) return;
    const beats = SQUER.CONFIG.TYPE_BEATS;
    const rows = Object.keys(beats).map((type) => {
      const meta = SQUER.CARD_TYPES && SQUER.CARD_TYPES[type];
      const sym = meta ? meta.symbol : typeName(type);
      // "perde contro" = i tipi che hanno questo nelle loro win
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

  /** Forza aggiornamento (menu ☰): controlla il service worker, scarica
      subito l'eventuale nuova versione (bump cache) e ricarica. */
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
        // aspetta l'installazione di una nuova versione
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (w) w.addEventListener('statechange', () => {
            if (w.state === 'installed' && reg.waiting) {
              done('✅ Aggiornamento scaricato, applico…');
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
        // se c'era già una versione in attesa, la attivo subito
        if (hadWaiting && reg.waiting) {
          done('✅ Aggiornamento scaricato, applico…');
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          return;
        }
        reg.update()
          .then(() => {
            // nessuna nuova versione: la cache è già aggiornata
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
    const topMenu = $('#top-menu');
    if (topMenu) topMenu.classList.toggle('hidden', name !== 'home');
    if (name === 'home') this.refreshHome();
    if (name === 'collection') this.renderCollection();
    // il badge valuta è globale: si aggiorna ad ogni cambio schermata
    this.updateSqueriniBadge();
    // badge valuta visibile SOLO nella home
    const badge = $('#squerini-badge');
    if (badge) badge.style.display = (name === 'home') ? '' : 'none';
    // nella schermata "apri pacchetto" il badge valuta coprirebbe il tasto
    // indietro e il titolo: lo nascondo lì e lo ripristino altrove
    const b2 = $('#squerini-badge');
    if (b2 && name === 'pack') b2.style.display = 'none';
  },

  updateSqueriniBadge() {
    const s = loadState();
    $('#squerini-count').textContent = s.squerini;
    // tasto "Acquista" accanto alla valuta: SOLO nella home e se puoi
    // permetterti almeno 1 pacchetto
    const inHome = this.currentScreen === 'home';
    $('#btn-buy-pack').classList.toggle('hidden', !(inHome && s.squerini >= PACK_PRICE));
  },

  // ---------- home ----------
  refreshHome() {
    const stats = collectionStats(this.cards);
    const s = loadState();
    $('#stat-owned').textContent = stats.owned;
    $('#stat-packs').textContent = stats.packsOpened;
    // widget "Pacchetti chiusi": TUTTI quelli da aprire (benvenuto +
    // giornalieri + acquistati)
    $('#stat-packs-closed').textContent = packsRemaining();
    // il tasto "Acquista" (e il count) li aggiorna updateSqueriniBadge, che
    // li mostra SOLO nella home: refreshHome viene chiamato anche da altre
    // schermate (es. afterPack in schermata pack) e non deve far comparire
    // il tasto fuori dalla home.
    this.updateSqueriniBadge();
    $('#home-nickname').textContent = s.nickname || 'Squer Trainer';
    const pct = stats.total ? Math.round((stats.owned / stats.total) * 100) : 0;
    $('#progress-fill').style.width = pct + '%';
    $('#progress-text').textContent = `${stats.owned} / ${stats.total}`;

    // pillola gialla SOLO per benvenuto/giornalieri: gli acquistati non la
    // fanno comparire (si vedono nel widget "Pacchetti chiusi" e bastano
    // il tasto "apri" + il widget). Il tasto "apri" però conta anche loro.
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

  // ---------- compra pacchetti (squerini) ----------
  /** Apre il menu quantità: min 1, max quanti pacchetti ci si può permettere. */
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
      const owned = rec && rec.count > 0;
      if (this.ownedFilter === 'owned' && !owned) return false;
      if (this.ownedFilter === 'missing' && owned) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
    // lista mostrata: il dettaglio (‹ ›) naviga SOLO tra queste carte
    this.detailList = filtered;

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
    // naviga nella lista FILTRATA corrente (rarità/possedute/ricerca),
    // fallback su tutte le carte se non è stato renderizzato l'album
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

    // carta NON posseduta: silhouette tratteggiata + numero, nome "???",
    // niente stats/abilità/tipo (stessa filosofia delle tile vuote album)
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

  // ---------- economia carte (M3) ----------
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

  // ---------- nickname (primo avvio) ----------
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

  // ---------- mazzo ----------
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

  // ---------- partita (Squer Clash v2, a turni) ----------
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
      // stats effettive col livello della carta (GDD §2.3)
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

  /** Lancio di moneta 3D: decide chi inizia (il vincitore parte con 5 carte). */
  _coinFlip() {
    const first = Math.random() < 0.5 ? 'p' : 'b';
    const coin = $('#coin-3d');
    coin.classList.remove('spin', 'testa', 'croce');
    void coin.offsetWidth; // restart animazione
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

  /** Avvia la partita vera e propria con il primo giocatore deciso. */
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
    // scena 3D della battaglia (campo in prospettiva + mano a ventaglio)
    this.scene = new SQUER.BattleScene2($('#battle-scene'), {
      onZoneTap: (player, zone) => this.onZoneTap(player, zone),
      onHandTap: (index) => this.onHandTap(index),
      onHandDrop: (handIndex, zone) => this.onHandDrop(handIndex, zone),
      onHandDrag: (index) => this.onHandDrag(index),
    });
    $('#battle-nick').textContent = loadState().nickname || 'Tu';
    this.renderBattle();
    if (this.match.turnPlayer === 'b') this.botTurn();
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

  /** Timer di turno: countdown visibile (TURN_TIME_SEC); se il giocatore
      non agisce, il turno passa da solo. Notifica a NOTIFY_LAST_TURNS dalla
      fine. */
  _turnTick() {
    const m = this.match;
    const total = (SQUER.CONFIG && SQUER.CONFIG.TURN_TIME_SEC) || 20;
    const notifyAt = (SQUER.CONFIG && SQUER.CONFIG.NOTIFY_LAST_TURNS) || 3;
    // notifica: mancano pochi turni alla fine (solo se il limite è attivo)
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
      this._lastTimerPlayer = 'b';
      if (this._turnIv) { clearInterval(this._turnIv); this._turnIv = null; }
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
      // sotto i 10s: lampeggia + bip
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
      $('#battle-turn').textContent = `${turno} · 🤖 SquerBot`;
      $('#battle-turn').classList.remove('urgent');
    }
  },

  /** Stato visivo per la scena 3D: carte originali (con canvas) + valori live */
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
    else if (!isP) msg = '🤖 SquerBot sta giocando…';
    else if (sel && sel.type === 'hand') {
      msg = 'Tocca una zona del tuo campo per posizionare la carta.';
      this.renderMatchupHint();
    }
    else if (sel && sel.type === 'zone') msg = 'Premi ⚔️ Attacca per colpire il fronte (o tocca un\'altra carta).';
    else msg = 'Pesca, oppure tocca una carta in mano per posizionarla, o una in campo per attaccare.';
    $('#battle-status').textContent = msg;
    if (!(sel && sel.type === 'hand')) this.clearMatchupHint();
  },

  /** Hint al piazzamento: per ogni carta avversaria in campo mostra se la
      carta selezionata (o trascinata) la colpisce ×2 (superefficace),
      ×0.5 (poco efficace) o ×1 (neutro). Compare quando una carta in mano
      è selezionata (tap) oppure sollevata (drag). */
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

  /** Hint matchup durante il trascinamento: la scena chiama questo callback
      quando una carta della mano viene sollevata (index >= 0) o rilasciata
      (null). Il drag non passa dalla selezione (_sel), quindi l'hint va
      mostrato/nascosto qui. */
  onHandDrag(index) {
    if (!this.match || this.match.over) return;
    if (index != null && index >= 0) this.renderMatchupHint(index);
    else this.clearMatchupHint();
  },

  clearMatchupHint() {
    const el = $('#matchup-hint');
    if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
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
          // attacco diretto all'Anima: la carta attaccante vola sulla zona
          // scoperta + danno flottante + flash sulla barra Anima colpita
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

  /** Flash sulla barra Anima colpita (attacco diretto) */
  _flashAnimaBar(player) {
    const el = document.getElementById(player === 'p' ? 'anima-p-fill' : 'anima-b-fill');
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth; // restart animazione
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

  /** Drag&drop: la carta è stata rilasciata su una zona libera */
  onHandDrop(handIndex, zone) {
    if (this.match.over || this.match.turnPlayer !== 'p') return;
    if (handIndex < 0 || handIndex >= this.match.hand.p.length) return;
    this._sel = null;
    this.commitPlayerAction(SQUER.GAME.actionPlace(this.match, 'p', handIndex, zone));
  },

  onZoneTap(player, zone) {
    if (player === 'b') {
      // feedback sul tap della carta avversaria: le carte 3D sono piccole
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
      this.commitPlayerAction(SQUER.GAME.actionPlace(this.match, 'p', this._sel.index, zone));
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
    const r = SQUER.GAME.peekDraw(this.match, 'p');
    if (!r.ok) { this.toast('Nessuna carta da pescare'); return; }
    const hand = this.match.hand.p;
    // mano con SPAZIO (max 5): pesca DIRETTA, nessuna conferma
    if (hand.length <= 5) {
      this.finishDrawChoice({ keep: true, handIndex: null });
      return;
    }
    // mano PIENA (6 dopo la pescata): modale di scelta
    const drawn = hand[hand.length - 1];
    const orig = this.cardOrig(drawn.uid);
    $('#draw-preview').innerHTML =
      `<div class="draw-card-big"><img src="${orig ? this.thumbDataUrl(orig) : ''}" alt="${drawn.name}">
       <span>${drawn.name} · ${drawn.typeSymbol} ⚔️${drawn.curAtk} ❤️${drawn.curHp}</span></div>`;
    const rest = hand.slice(0, -1);
    $('#draw-hand').innerHTML = rest.length
      ? rest.map((c, i) => `<button class="draw-card" data-idx="${i}">${c.typeSymbol} ${c.name}</button>`).join('')
      : '<div class="draw-empty">Nessuna carta in mano da scartare.</div>';
    // con la mano piena devi scartare o rifiutare (niente "tieni senza scartare")
    $('#draw-keep-none').classList.add('hidden');
    $('#draw-modal').classList.remove('hidden');
  },

  finishDrawChoice(choice) {
    $('#draw-modal').classList.add('hidden');
    SQUER.GAME.resolveDrawChoice(this.match, 'p', choice);
    this.commitPlayerAction({ ok: true });
  },

  onClickAttack() {
    if (!this._sel || this._sel.type !== 'zone') return;
    this.commitPlayerAction(SQUER.GAME.actionAttack(this.match, 'p', this._sel.zone));
  },

  botTurn() {
    if (this.match.over || this.match.turnPlayer !== 'b') return;
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
    // niente punteggio: rappresentava la vita finale, non serve
    $('#result-score').classList.add('hidden');
    $('#result-reward').textContent = reward > 0 ? `+${reward} 🪙 Squerini` : 'Nessun guadagno';
    $('#result-zones').innerHTML = '';
    $('#result-zones').classList.add('hidden');
    // ritardo: lascia vedere l'animazione dell'ultima mossa prima del modal
    clearTimeout(this._resultT);
    this._resultT = setTimeout(() => {
      $('#result-modal').classList.remove('hidden');
    }, 1400);
  },

  rematch() {
    $('#result-modal').classList.add('hidden');
    this.startMatch();
  },

  quitBattle() {
    if (this._botTimer) { clearTimeout(this._botTimer); this._botTimer = null; }
    if (this._turnIv) { clearInterval(this._turnIv); this._turnIv = null; }
    this._sel = null;
    $('#draw-modal').classList.add('hidden');
    $('#help-modal').classList.add('hidden');
    $('#result-modal').classList.add('hidden');
    this.showScreen('home');
    this.refreshHome();
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

  bindEvents() {
    $('#btn-open-pack').addEventListener('click', () => this.startPack());
    // ---- compra pacchetti (squerini) ----
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
    $('#btn-play').addEventListener('click', () => this.startMatch());
    $('#btn-deck').addEventListener('click', () => this.showDeck());
    $('#btn-deck-back').addEventListener('click', () => this.showScreen('home'));
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
    // ---- battaglia v2: azioni ----
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
    // ---- economia dettaglio carta (delegation: innerHTML rigenerato) ----
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
      if (!e.target.closest('.top-menu')) $('#menu-dropdown').classList.add('hidden');
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
      // le non possedute si aprono comunque: il dettaglio mostra la silhouette
      this.openDetail(c);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init(); // init() chiama bindEvents()
});

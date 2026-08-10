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

  updateLoader(p, text) {
    if (this._loaderIv) clearInterval(this._loaderIv);
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
    // il badge valuta è globale: si aggiorna ad ogni cambio schermata
    this.updateSqueriniBadge();
  },

  updateSqueriniBadge() {
    $('#squerini-count').textContent = loadState().squerini;
  },

  // ---------- home ----------
  refreshHome() {
    const stats = collectionStats(this.cards);
    const s = loadState();
    $('#stat-owned').textContent = stats.owned;
    $('#stat-packs').textContent = stats.packsOpened;
    $('#squerini-count').textContent = s.squerini;
    $('#home-nickname').textContent = s.nickname || 'Squer Trainer';
    const pct = stats.total ? Math.round((stats.owned / stats.total) * 100) : 0;
    $('#progress-fill').style.width = pct + '%';
    $('#progress-text').textContent = `${stats.owned} / ${stats.total}`;

    // badge pacchetti UNICO: o il benvenuto o i gratis di oggi, mai entrambi.
    // Il contatore è la pillola in alto: quando non ci sono pacchetti mostra
    // il messaggio "torna domani" al posto della riga tra i bottoni (ora rimossa).
    const { welcome, daily } = packsBreakdown();
    const remaining = welcome + daily;
    $('#pack-counter').style.display = '';
    $('#pack-counter').classList.toggle('empty', remaining <= 0);
    $('#pack-counter-text').textContent = remaining > 0
      ? (welcome > 0
        ? `Hai ${welcome} pacchett${welcome === 1 ? 'o' : 'i'} di benvenuto`
        : `${daily} pacchett${daily === 1 ? 'o' : 'i'} gratis oggi`)
      : 'Torna domani per altri pacchetti gratuiti';
    $('#btn-open-pack').disabled = remaining <= 0;
    $('#btn-open-pack').style.opacity = remaining <= 0 ? 0.5 : 1;

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
      </div>
      <div class="detail-ability">
        <span class="ability-symbol">${card.abilitySymbol}</span>
        <span class="ability-body"><b>${card.abilityName}</b> — ${card.abilityText}</span>
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
        slot.innerHTML = `<img src="${this.thumbDataUrl(c)}" alt="${c.name}">
          <span class="slot-type">${c.typeSymbol} ${c.hp} PV</span>
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

  // ---------- partita (Squer Clash) ----------
  startMatch() {
    const s = loadState();
    const owned = collectionStats(this.cards).owned;
    if (owned < MIN_OWNED_TO_UNLOCK) {
      this.toast(`Apri pacchetti: servono ${MIN_OWNED_TO_UNLOCK} carte per giocare`);
      return;
    }
    const deckCards = s.deck.map(uid => this.cards.find(c => c.uid === uid)).filter(Boolean);
    if (deckCards.length < MIN_DECK_TO_PLAY) {
      this.toast('Costruisci il tuo mazzo (almeno 3 carte) per giocare');
      this.showDeck();
      return;
    }

    SQUER.sound.unlock();
    this.disposeScene();
    this.showScreen('battle');
    const rng = makeRNG('match_' + Date.now() + '_' + Math.random());
    const hand = rng.shuffle(deckCards).slice(0, Math.min(HAND_SIZE, deckCards.length));
    const ownedUids = this.cards.filter(c => isOwned(c.uid)).map(c => c.uid);
    const botDeck = SQUER.GAME.makeBotDeck(this.cards, ownedUids, rng);
    const botHand = rng.shuffle(botDeck).slice(0, HAND_SIZE);
    const botTeam = SQUER.GAME.pickTeam(botHand, rng);

    this.match = { hand, team: [], zones: {}, botTeam, botZones: null, results: {}, rng };
    this.battleScore = { p: 0, b: 0 };
    this.phase = 'team';

    this.scene = new SQUER.BattleScene($('#battle-scene'), {
      botTeam,
      onHandTap: (i) => this.onBattleHandTap(i),
      onZoneTap: (z) => this.onBattleZoneTap(z),
      onUndeployTap: (z) => this.onBattleUndeployTap(z),
      onHandHover: (i) => this.onBattleHandHover(i),
      onBotHover: (c) => this.showBattleCardInfo(c),
    });
    // niente carte bot visibili durante la scelta: solo la mano COPERTA
    this.scene.showHand(hand);
    this.scene.showBotHand(botHand);
    // SquerBot "sceglie" le sue 3 carte con la mano coperta
    const pickIdx = botTeam.map(c => botHand.indexOf(c));
    this.scene.botPick(pickIdx);
    $('#battle-score').classList.add('hidden');
    $('#battle-msg').textContent = 'Scegli 3 carte per la tua squadra (max 2 per tipo)';
    $('#battle-action').textContent = 'Conferma squadra';
    $('#battle-action').disabled = true;
  },

  onBattleHandTap(i) {
    const card = this.match.hand[i];
    if (!card) return;
    SQUER.sound.click();
    if (this.phase === 'team') {
      const idx = this.match.team.indexOf(card);
      if (idx >= 0) {
        this.match.team.splice(idx, 1);
      } else {
        if (this.match.team.length >= TEAM_SIZE) { this.toast('Squadra piena: 3 carte'); return; }
        const same = this.match.team.filter(c => c.type === card.type).length;
        if (same >= MAX_SAME_TYPE) { this.toast('Max 2 carte dello stesso tipo'); return; }
        this.match.team.push(card);
      }
      const sel = this.match.team.map(c => this.match.hand.indexOf(c)).filter(i2 => i2 >= 0);
      this.scene.setTeamSelection(sel);
      $('#battle-msg').textContent = sel.length === 3
        ? 'Squadra pronta! SquerBot ha scelto in segreto: le sue carte restano nascoste.'
        : `Scegli 3 carte per la tua squadra (${sel.length}/3)`;
      $('#battle-action').disabled = sel.length < 3;
      // mostra i dati della carta toccata
      this.showBattleCardInfo(card);
    } else if (this.phase === 'deploy') {
      this.scene.setSelected(i);
      this.showBattleCardInfo(card);
    }
  },

  /** Pannello sotto la scena: dati di gioco della carta in mano
      (nome, tipo con vince/perde, PV, effetto). */
  showBattleCardInfo(card) {
    const box = $('#battle-card-info');
    if (!card) {
      box.classList.add('hidden');
      return;
    }
    const beats = (SQUER.GAME.TYPE_BEATS[card.type] || []).map(t => typeName(t)).join(', ');
    const losesTo = Object.keys(SQUER.GAME.TYPE_BEATS)
      .filter(t => SQUER.GAME.TYPE_BEATS[t].indexOf(card.type) >= 0)
      .map(t => typeName(t)).join(', ');
    const ability = card.abilityName
      ? `<div class="ability">${card.abilitySymbol} <b>${card.abilityName}</b> — ${card.abilityText}</div>`
      : '';
    box.innerHTML = `
      <div><b class="name">${card.typeSymbol} ${card.name}</b></div>
      <div class="stat-row">
        <span>❤️ <b>${card.hp}</b> PV</span>
        <span>${card.typeSymbol} ${typeName(card.type)}</span>
        <span>${card.rarity.name}</span>
      </div>
      ${ability}
      <div class="weakness">Vince su: ${beats || '—'} · Perde contro: ${losesTo || '—'}</div>`;
    box.classList.remove('hidden');
  },

  onBattleHandHover(i) {
    // hover/press su una carta in mano: mostra i suoi dati
    this.showBattleCardInfo(i >= 0 ? this.match.hand[i] : null);
  },

  confirmTeam() {
    if (this.phase !== 'team' || this.match.team.length < 3) return;
    SQUER.sound.whoosh();
    this.phase = 'showdown';
    // ferma la "scelta" simulata del bot: le sue carte restano coperte
    this.scene.botPickCancel();
    // il bot schiera le sue carte sulle zone IN SEGRETO (mappa zona->carta)
    this.match.botZones = SQUER.GAME.botDeploy(this.match.botTeam, this.match.rng);
    // la mano resta solo con le 3 carte scelte, ordinate come nell'album
    const chosen = this.cards.filter(c => this.match.team.indexOf(c) >= 0);
    this.match.hand = chosen;
    this.scene.showHand(chosen);
    this.scene.beginShowdown();
    $('#battle-msg').textContent = 'Le squadre si rivelano! Memorizza le carte di SquerBot...';
    $('#battle-action').textContent = 'In arrivo lo schieramento…';
    $('#battle-action').disabled = true;
    $('#battle-card-info').classList.add('hidden');
    this._startShowdownCountdown();
  },

  /** Countdown di memorizzazione (configurabile, default 10s):
      vive nel messaggio di stato sotto la scena (non copre mai le
      carte del bot) e NON è skippabile: scorre fino a zero e poi
      parte lo schieramento. */
  _startShowdownCountdown() {
    const total = (SQUER.CONFIG && SQUER.CONFIG.SHOWDOWN_COUNTDOWN) || 10;
    let left = total;
    this._cdToken = { stopped: false };
    const msg = () => {
      $('#battle-msg').innerHTML =
        `Memorizza le carte di SquerBot: <span class="battle-msg-countdown">${left}s</span>`;
      // i secondi vivono anche nel testo del bottone sotto la scena:
      // ben visibili e senza coprire nulla
      $('#battle-action').textContent = `Schieramento tra ${left}s…`;
      $('#battle-action').disabled = true;
    };
    msg();
    const tick = () => {
      if (this._cdToken.stopped || this.phase !== 'showdown') return;
      left--;
      if (left <= 0) { this._finishShowdown(); return; }
      msg();
      this._cdTimer = setTimeout(tick, 1000);
    };
    this._cdTimer = setTimeout(tick, 1000);
  },

  /** Fine countdown: carte del bot coperte e mischiate, si schiera. */
  _finishShowdown() {
    if (this.phase !== 'showdown') return;
    this.phase = 'deploy';
    clearTimeout(this._cdTimer);
    this._cdTimer = null;
    if (this._cdToken) this._cdToken.stopped = true;
    this.scene.coverAndShuffle(() => {
      if (this.phase !== 'deploy') return;
      this.scene.beginDeploy();
      this.scene.startDeploy(this.match.botZones);
      $('#battle-msg').textContent = 'Carte coperte e mischiate! Piazza le tue 3 carte: toccala e scegli la zona, oppure trascinala nello slot';
      $('#battle-action').textContent = '⚔️ Inizia lo scontro!';
      $('#battle-action').disabled = true;
    });
  },

  onBattleZoneTap(z) {
    if (this.phase !== 'deploy') return;
    const sel = this.scene.selectedIndex;
    if (sel < 0) { this.toast('Prima tocca una carta in mano'); return; }
    if (this.match.zones[z]) { this.toast('Zona già occupata'); return; }
    const card = this.match.hand[sel];
    this.scene.deployPlayer(z, card, sel);
    this.match.zones[z] = card;
    const left = TEAM_SIZE - Object.keys(this.match.zones).length;
    if (left === 0) {
      $('#battle-msg').textContent = 'Schieramento completo!';
      $('#battle-action').disabled = false;
    } else {
      $('#battle-msg').textContent = `Ancora ${left} carta${left === 1 ? '' : 'e'} da piazzare`;
    }
  },

  onBattleUndeployTap(z) {
    if (this.phase !== 'deploy') return;
    if (!this.match.zones[z]) return;
    delete this.match.zones[z];
    this.scene.undeployPlayer(z);
    $('#battle-msg').textContent = 'Carta rimossa: riposizionala oppure scegline un\'altra';
    $('#battle-action').disabled = true;
  },

  startBattle() {
    if (this.phase !== 'deploy' || Object.keys(this.match.zones).length < 3) return;
    this.phase = 'reveal';
    this.scene.beginReveal();
    $('#battle-action').disabled = true;
    $('#battle-score').classList.remove('hidden');
    this.revealedZones = 0;
    this.revealNextZone();
  },

  revealNextZone() {
    const z = ZONE_KEYS[this.revealedZones];
    if (!z) { this.finishMatch(); return; }
    const result = SQUER.GAME.resolveDuel(this.match.zones[z], this.match.botZones[z]);
    this.match.results[z] = result;
    const zname = z === 'left' ? 'Sinistra' : z === 'center' ? 'Centro' : 'Destra';
    $('#battle-msg').textContent = `Zona ${zname}: la carta di SquerBot si rivela...`;
    this.scene.revealZone(z, result, () => {
      this.battleScore.p += result.aScore;
      this.battleScore.b += result.bScore;
      $('#battle-score-p').textContent = this.battleScore.p;
      $('#battle-score-b').textContent = this.battleScore.b;
      this.revealedZones++;
      setTimeout(() => this.revealNextZone(), 750);
    });
  },

  finishMatch() {
    const m = SQUER.GAME.resolveMatch(this.match.zones, this.match.botZones);
    const reward = SQUER.GAME.matchReward(m.outcome);
    const s = loadState();
    s.squerini += reward;
    s.matches.push({
      date: Date.now(), vs: 'bot', outcome: m.outcome,
      pTotal: m.pTotal, bTotal: m.bTotal, reward,
      playerTeam: this.match.team.map(c => c.uid),
      botTeam: this.match.botTeam.map(c => c.uid),
      zones: this.match.zones,
    });
    saveState(s);
    this.phase = 'done';
    this.updateSqueriniBadge();
    $('#battle-msg').textContent = m.outcome === 'win' ? 'Vittoria! 🎉' : (m.outcome === 'draw' ? 'Pareggio!' : 'Sconfitta...');
    if (m.outcome === 'win') SQUER.sound.matchWin();
    else if (m.outcome === 'draw') SQUER.sound.matchDraw();
    else SQUER.sound.matchLose();
    this.showResultModal(m, reward);
  },

  showResultModal(m, reward) {
    const zoneName = { left: 'Sinistra', center: 'Centro', right: 'Destra' };
    $('#result-icon').textContent = m.outcome === 'win' ? '🏆' : (m.outcome === 'draw' ? '🤝' : '💀');
    $('#result-title').textContent = m.outcome === 'win' ? 'Vittoria!' : (m.outcome === 'draw' ? 'Pareggio' : 'Sconfitta');
    $('#result-score').textContent = `${m.pTotal} — ${m.bTotal}`;
    $('#result-reward').textContent = reward > 0 ? `+${reward} 🪙 Squerini` : 'Nessun guadagno';
    $('#result-zones').innerHTML = ZONE_KEYS.map(z => {
      const r = m.results[z];
      const res = r.winner === 'a' ? 'win' : (r.winner === 'b' ? 'lose' : 'draw');
      const label = res === 'win' ? `Tu +${r.aScore}` : (res === 'lose' ? `Bot +${r.bScore}` : 'Pari');
      return `<div class="result-zone ${res}">${zoneName[z]}<b>${label}</b></div>`;
    }).join('');
    $('#result-modal').classList.remove('hidden');
  },

  rematch() {
    $('#result-modal').classList.add('hidden');
    this.disposeScene();
    this.startMatch();
  },

  quitBattle() {
    this.disposeScene();
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
    // niente skip del countdown: scade e parte lo schieramento da solo
    $('#battle-action').addEventListener('click', () => {
      if (this.phase === 'team') this.confirmTeam();
      else if (this.phase === 'deploy') this.startBattle();
    });
    $('#result-rematch').addEventListener('click', () => this.rematch());
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
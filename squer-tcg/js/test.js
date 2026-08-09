/* =========================================================
   Squer TCG - Ambiente di test
   Genera carte placeholder (nessuna foto reale) per provare
   ogni feature: tutte le rarità, pacchetti, effetti olografici.
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});

const RARITY_IDS = ['common', 'uncommon', 'rare', 'superRare', 'legendary'];
const RARITY_COLORS = {
  common: '#9aa7b8',
  uncommon: '#4aa3ff',
  rare: '#b06bff',
  superRare: '#ff5fd0',
  legendary: '#ffc93d',
};

let cards = [];
let scene = null;
let activeRarity = null;

const $ = (s) => document.querySelector(s);

/* ---------- placeholder image (canvas, nessuna foto) ---------- */
function makePlaceholder(seed, typeKey) {
  const w = 512, h = 384;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const rng = makeRNG('ph_' + seed);

  const g1 = rng.pick(['#1a2233', '#2a1a33', '#0f2a24', '#2a241a', '#1a2a3a', '#331a1a']);
  const g2 = rng.pick(['#3a4a66', '#6a3a66', '#2a6a55', '#6a553a', '#3a5a7a', '#6a3a3a']);
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, g1); grad.addColorStop(1, g2);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);

  for (let i = 0; i < 10; i++) {
    g.fillStyle = `hsla(${rng.int(0, 360)},60%,60%,${rng.range(0.12, 0.35)})`;
    const x = rng.range(0, w), y = rng.range(0, h), s = rng.range(24, 100);
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
  }

  const type = CARD_TYPES[typeKey];
  g.font = '700 170px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.globalAlpha = 0.9;
  g.fillText(type.symbol, w / 2, h / 2 - 10);
  g.globalAlpha = 1;

  g.font = '700 30px sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText('PLACEHOLDER', w / 2, h - 26);
  return c;
}

/* ---------- generazione set di test ---------- */
function buildTestCards(count) {
  // garantisce almeno una carta per ogni rarità, poi riempie con pesi reali
  const rarities = [];
  for (let i = 0; i < RARITY_IDS.length; i++) rarities.push(RARITY_IDS[i]);
  const rng = makeRNG('test_dist_' + count);
  while (rarities.length < count) rarities.push(rollRarity(rng.next()).id);
  // mescola così le garantite non sono sempre in testa
  const rng2 = makeRNG('test_shuffle_' + count);
  const order = rng2.shuffle(rarities.map((_, i) => i));
  const ordered = order.map((i) => rarities[i]);

  const built = ordered.map((rarId, i) => {
    const rng3 = makeRNG('test_card_' + i + '_' + count);
    const typeKey = TYPE_KEYS[Math.floor(rng3.next() * TYPE_KEYS.length)];
    const card = {
      uid: 'test_' + i,
      file: 'test/' + (i + 1),
      name: 'Test ' + (i + 1),
      image: makePlaceholder(i, typeKey),
      canvas: null, foilCanvas: null, palette: null, effects: [],
      rarity: RARITIES[rarId],
      type: typeKey,
      typeSymbol: CARD_TYPES[typeKey].symbol,
      typeName: CARD_TYPES[typeKey].name,
      hp: rng3.int(60, 180),
      number: i + 1, setSize: count,
      rng: rng3, pulled: 0, pulledAt: null, pulledBy: [],
    };
    SQUER.art.draw(card); // genera canvas + effetti deterministici
    return card;
  });
  return built;
}

/* ---------- scena 3D ---------- */
function ensureScene() {
  if (!scene) scene = new SQUER.SquerScene($('#scene'));
  return scene;
}

function showCard(card) {
  ensureScene();
  scene.clearCard();
  scene.showCard(card, { flip: true });
  setHud(`${card.rarity.name} · ${card.name} — trascina per ruotare`);
}

function openPack(guaranteed) {
  if (!cards.length) { toast('Genera prima le carte'); return; }
  ensureScene();
  scene.clearCard();
  const chosen = pickPackCards(guaranteed);
  scene.showPack(() => scene.tearPack(chosen));
  setHud('Trascina il pacchetto per aprirlo');
}

function pickPackCards(guaranteed) {
  const rng = mulberry32((Date.now() & 0xffffffff) ^ 0x9e3779b9);
  if (guaranteed) {
    return RARITY_IDS.map((rarId) => {
      const pool = cards.filter((c) => c.rarity.id === rarId);
      const c = pool[Math.floor(rng() * pool.length)];
      return { card: c, isNew: true };
    });
  }
  const picks = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    const c = cards[Math.floor(rng() * cards.length)];
    picks.push({ card: c, isNew: true });
  }
  return picks;
}

/* ---------- caricamento carte reali dal manifest ---------- */
async function loadAllGameCards() {
  setHud('Caricamento carte del gioco...');
  try {
    const entries = await loadManifest();
    if (!entries.length) { toast('Nessuna carta nel manifest'); setHud('Nessuna carta nel manifest'); return; }
    cards = await createCardSet(entries);
    renderRarityRow();
    renderGrid();
    const leg = cards.find((c) => c.rarity.id === 'legendary');
    showCard(leg || cards[0]);
    toast(`Caricate ${cards.length} carte dal gioco`);
  } catch (e) {
    console.error(e);
    toast('Errore nel caricamento delle carte');
    setHud('Errore nel caricamento');
  }
}

/* ---------- UI ---------- */
function setHud(msg) { $('#hud').textContent = msg; }

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

function renderRarityRow() {
  const row = $('#rarity-row');
  row.innerHTML = '';
  RARITY_IDS.forEach((id) => {
    const b = document.createElement('button');
    b.className = 'rarity-chip';
    b.style.color = RARITY_COLORS[id];
    b.textContent = RARITIES[id].name;
    b.onclick = () => {
      activeRarity = id;
      document.querySelectorAll('.rarity-chip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const pool = cards.filter((c) => c.rarity.id === id);
      if (pool.length) showCard(pool[0]);
      else toast('Nessuna carta di questa rarità');
    };
    row.appendChild(b);
  });
}

function renderGrid() {
  const grid = $('#grid');
  grid.innerHTML = '';
  cards.forEach((card) => {
    const tile = document.createElement('div');
    tile.className = 'card-tile';
    const img = document.createElement('img');
    img.src = card.canvas.toDataURL();
    img.alt = card.name;
    const dot = document.createElement('div');
    dot.className = 'rarity-dot';
    dot.style.background = RARITY_COLORS[card.rarity.id];
    tile.appendChild(img);
    tile.appendChild(dot);
    tile.onclick = () => showCard(card);
    grid.appendChild(tile);
  });
}

function generate() {
  const count = Math.max(5, Math.min(60, parseInt($('#count').value, 10) || 20));
  cards = buildTestCards(count);
  renderRarityRow();
  renderGrid();
  // mostra subito una carta per rarità (la prima leggendaria se c'è)
  const leg = cards.find((c) => c.rarity.id === 'legendary');
  showCard(leg || cards[0]);
  const counts = {};
  cards.forEach((c) => { counts[c.rarity.id] = (counts[c.rarity.id] || 0) + 1; });
  const summary = RARITY_IDS.map((id) => `${RARITIES[id].name}: ${counts[id] || 0}`).join(' · ');
  toast(`Generate ${cards.length} carte — ${summary}`);
}

/* ---------- init ---------- */
function init() {
  $('#btn-generate').onclick = generate;
  $('#btn-all').onclick = loadAllGameCards;
  $('#btn-pack').onclick = () => openPack(false);
  $('#btn-pack-guaranteed').onclick = () => openPack(true);
  $('#btn-clear').onclick = () => {
    if (scene) { scene.clearCard(); setHud('Scena svuotata'); }
  };
  $('#count').addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });
  generate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
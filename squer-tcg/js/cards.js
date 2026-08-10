/* =========================================================
   Squer TCG - Card data model + manifest loader
   Each file in cards/custom/ becomes exactly one unique card.
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});

const CARD_TYPES = {
  fuoco:   { name: 'Fuoco',   symbol: '🔥', icon: 'flame' },
  acqua:   { name: 'Acqua',   symbol: '💧', icon: 'droplet' },
  folgore: { name: 'Folgore', symbol: '⚡', icon: 'bolt' },
  erba:    { name: 'Erba',    symbol: '🌿', icon: 'leaf' },
  psico:   { name: 'Psico',   symbol: '🔮', icon: 'crystal' },
  lottatore: { name: 'Lottatore', symbol: '🥊', icon: 'fist' },
  buio:    { name: 'Buio',    symbol: '🌑', icon: 'moon' },
  fata:    { name: 'Fata',    symbol: '✨', icon: 'star' },
  drago:   { name: 'Drago',   symbol: '🐉', icon: 'dragon' },
  metallo: { name: 'Metallo', symbol: '⚙️', icon: 'gear' },
  spettrale: { name: 'Spettrale', symbol: '👻', icon: 'ghost' },
  normale: { name: 'Normale', symbol: '⬛', icon: 'neutral' },
};
const TYPE_KEYS = Object.keys(CARD_TYPES);

const TYPE_NAMES = {
  flame: 'Fuoco', droplet: 'Acqua', bolt: 'Folgore', leaf: 'Erba',
  crystal: 'Psico', fist: 'Lottatore', moon: 'Buio', star: 'Fata',
  dragon: 'Drago', gear: 'Metallo', ghost: 'Spettrale', neutral: 'Normale',
};

/** Pretty-print a filename into a card name (handles UUID-style names) */
function nameFromFile(file) {
  const base = file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  // UUID-ish: starts with digits followed by hex chunks (es. esportazioni iPhone)
  if (/^\d+[\s-][0-9a-f]{8}[\s-]/i.test(base)) {
    const num = base.split(/\s+/)[0];
    if (/^\d+$/.test(num)) return 'Carta ' + num;
  }
  return base
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 24) || 'Carta Misteriosa';
}

// ★ CONFIG PV per rarità (carte.md §2): fascia del valore deterministco
const HP_RANGES = {
  common: [60, 90],
  uncommon: [85, 115],
  rare: [110, 140],
  superRare: [135, 165],
  legendary: [160, 190],
};

/** Build a full card object from a manifest entry */
function buildCard(entry, index, setSize) {
  const rng = makeRNG(entry.file);
  // rarità dal manifest (sottocartella di cards/custom/), altrimenti casuale
  const rarity = entry.rarity && RARITIES[entry.rarity]
    ? RARITIES[entry.rarity]
    : rarityForSeed(rng);
  const type = TYPE_KEYS[Math.floor(rng.next() * TYPE_KEYS.length)];
  const cardName = entry.name || nameFromFile(entry.file);
  const hpRange = HP_RANGES[rarity.id] || HP_RANGES.common;
  const ability = abilityForCard({ file: entry.file, name: cardName });
  return {
    uid: entry.uid || cardUID(entry.file),
    file: entry.file,
    name: cardName,
    order: entry.order,         // override ordine interno (cards/order.json)
    image: null,            // loaded HTMLImageElement
    canvas: null,           // generated card art
    foilCanvas: null,       // holographic foil overlay texture
    palette: null,
    effects: [],
    rarity,
    fullart: !!entry.fullart, // variante senza frame (PNG con trasparenza)
    type,
    typeSymbol: CARD_TYPES[type].symbol,
    typeName: CARD_TYPES[type].name,
    hp: rng.int(hpRange[0], hpRange[1]), // deterministisco, fascia per rarità
    ability: ability.id,          // id effetto di gioco (Squer Clash)
    abilitySymbol: ability.symbol,
    abilityName: ability.name,
    abilityText: ability.text,
    number: index + 1,
    setSize,
    rng,
    pulled: 0,              // times pulled
    pulledAt: null,
    pulledBy: [],           // pack ids
  };
}

const MANIFEST_PATH = 'cards/manifest.json';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.bmp']);

/** Load optional cards/names.json override: { "file.png": "Nome Carta" } */
async function loadNamesMap() {
  try {
    const res = await fetch('cards/names.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return (data && typeof data === 'object') ? data : {};
    }
  } catch (e) { /* optional */ }
  return {};
}

/** cartella -> id rarità (sottocartelle di cards/custom/) */
const RARITY_DIR_MAP = {
  common: 'common', uncommon: 'uncommon', rare: 'rare',
  'super-rare': 'superRare', legendary: 'legendary',
};

/** Rarity from the subfolder in the file path (null if none) */
function rarityFromPath(file) {
  const first = file.split('/')[0];
  return RARITY_DIR_MAP[first] || null;
}

/** Try to auto-discover images from the directory listing of cards/custom/
    (funziona con python http.server e con tools/server.js) */
async function tryDirectoryListing() {
  try {
    const res = await fetch('cards/custom/', { cache: 'no-store' });
    if (!res.ok) return null;
    const html = await res.text();
    const re = /href="([^"]+)"/g;
    const files = [];
    const dirs = [];
    let m;
    while ((m = re.exec(html))) {
      let href = m[1].replace(/^\.\//, '');
      href = href.split(/[?#]/)[0];
      if (href === '' || href.includes('/')) continue;
      if (href.endsWith('/')) { dirs.push(href.slice(0, -1)); continue; }
      if (/^[\w.\- ]+$/.test(href) && IMAGE_EXTS.has(href.slice(href.lastIndexOf('.')).toLowerCase())) {
        if (!files.includes(href)) files.push(href);
      }
    }
    // scansiona anche le sottocartelle (una per rarità, o legendary/fullart)
    for (const dir of dirs) {
      try {
        const sub = await fetch('cards/custom/' + dir + '/', { cache: 'no-store' });
        if (!sub.ok) continue;
        const re2 = /href="([^"]+)"/g;
        let m2;
        while ((m2 = re2.exec(await sub.text()))) {
          let href = m2[1].replace(/^\.\//, '');
          href = href.split(/[?#]/)[0];
          if (href === '' || href.endsWith('/') || href.includes('/')) continue;
          if (IMAGE_EXTS.has(href.slice(href.lastIndexOf('.')).toLowerCase())) {
            files.push(dir + '/' + href);
          }
        }
      } catch (e) { /* skip dir */ }
    }
    return files.length ? files : null;
  } catch (e) {
    return null;
  }
}

/** Load the card list: manifest first, then directory-listing fallback.
    Applies names.json overrides on top. Returns manifest-style entries. */
async function loadManifest() {
  let entries = null;
  try {
    const res = await fetch(MANIFEST_PATH, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) entries = data;
    }
  } catch (e) { /* fallback below */ }

  if (!entries) {
    console.warn('[SQUER] manifest.json mancante o vuoto: provo il rilevamento automatico...');
    const files = await tryDirectoryListing();
    if (files) entries = files.map(file => ({ file, rarity: rarityFromPath(file) }));
  }

  if (!entries) return [];

  const names = await loadNamesMap();
  return entries.map((e, i) => ({
    file: e.file,
    name: names[e.file] || e.name || nameFromFile(e.file),
    uid: e.uid || cardUID(e.file),
    rarity: e.rarity,
    fullart: !!e.fullart,
    order: e.order,
  }));
}

/** Load one image file into an HTMLImageElement */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('cannot load ' + src));
    im.src = src;
  });
}

/** Turn manifest entries into ready cards with generated art.
    onProgress(done, total, phase) is called while loading the images
    (phase 'images') and while drawing the card canvases (phase 'draw'),
    so the loading bar can show real progress for every step. */
async function createCardSet(entries, onProgress) {
  const setSize = entries.length;
  const cards = [];
  const jobs = entries.map(async (entry, i) => {
    const card = buildCard(entry, i, setSize);
    try {
      card.image = await loadImage('cards/custom/' + entry.file);
    } catch (e) {
      card.image = null; // art window stays empty, still playable
    }
    cards.push(card);
    if (onProgress) onProgress(cards.length, setSize, 'images');
  });
  await Promise.all(jobs);
  // ordine album: rarita' crescente (common 1-70, uncommon 71-120, rare,
  // super-rare, legendary in coda), fullart per ultima nella sua rarita',
  // poi order override manuale (cards/order.json, carte senza order in coda
  // per uid), uid come ultimo criterio di stabilità
  const orderOf = c => (typeof c.order === 'number' ? c.order : Infinity);
  cards.sort((a, b) =>
    a.rarity.order - b.rarity.order ||
    (a.fullart ? 1 : 0) - (b.fullart ? 1 : 0) ||
    orderOf(a) - orderOf(b) ||
    (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
  );
  // numeri finali PRIMA del draw: il canvas deve mostrare il numero
  // della posizione nell'album, non l'indice del manifest
  cards.forEach((c, i) => { c.number = i + 1; c.setSize = cards.length; });
  // disegno dei canvas A BLOCCHI (chunked): draw() è CPU-intensive e, se
  // fatto tutto in un colpo, blocca la UI per secondi senza mostrare nulla.
  // A blocchi con una pausa tra l'uno e l'altro, la barra avanza e l'utente
  // vede "Disegno carte... X / 180" fino a 180 / 180.
  const CHUNK = 18;
  for (let i = 0; i < cards.length; i += CHUNK) {
    const slice = cards.slice(i, i + CHUNK);
    for (const card of slice) SQUER.art.draw(card);
    if (onProgress) onProgress(Math.min(i + CHUNK, cards.length), cards.length, 'draw');
    if (i + CHUNK < cards.length) await new Promise(r => setTimeout(r, 0));
  }
  return cards;
}

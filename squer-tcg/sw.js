/* =========================================================
   Squer TCG - Service Worker
   - Precache della "shell" (html, css, js, icone) -> l'app
     si apre sempre, anche offline
   - Cache progressiva delle immagini carte e degli asset:
     la prima volta che una carta viene vista resta salvata
   - Navigazioni: network-first (aggiornamenti immediati,
     fallback offline sull'ultima copia)
   ========================================================= */
const CACHE = 'squer-tcg-v30';
const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'vendor/three.min.js',
  'js/rng.js',
  'js/rarity.js',
  'js/cardgen.js',
  'js/cards.js',
  'js/abilities.js',
  'js/game-config.js',
  'js/game.js',
  'js/packs.js',
  'js/sound.js',
  'js/scene.js',
  'js/scene-battle2.js',
  'js/online.js',
  'js/main.js',
  'js/install.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// "Forza aggiornamento" dalla UI: salta l'attesa e attiva subito la nuova
// versione precached (bump cache), poi la pagina ricarica.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // solo stesso origin

  // Navigazioni: network-first, fallback sull'ultima copia salvata
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./'))
    );
    return;
  }

  const path = url.pathname;

  // JSON dati (manifest carte, nomi, ordine): sempre freschi se possibile
  if (path.endsWith('.json')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Tutto il resto (css, js, immagini carte, icone): cache-first,
  // prima visita scarica e salva, poi sempre offline
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});

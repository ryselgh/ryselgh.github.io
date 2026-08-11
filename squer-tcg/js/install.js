/* =========================================================
   Squer TCG - Installazione PWA
   - Chrome/Edge (desktop + Android): beforeinstallprompt
     -> mostra il bottone e apre il popup ufficiale
   - iOS Safari: nessuna API ufficiale -> il bottone mostra
     le istruzioni "Condividi -> Aggiungi alla schermata Home"
   - Bottone nascosto se l'app è già installata
   - Su mobile, quando il gioco NON è installato: home
     semplificata (classe body "pwa-cta") con solo titolo,
     bottone "Installa" grande al centro e footer
   - Registrazione del service worker
   ========================================================= */
(() => {
  const btn = document.getElementById('install-btn');
  if (!btn) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;

  let deferredPrompt = null;
  let installable = false; // true = il bottone è mostrato (app installabile)

  // home semplificata "installa": solo su mobile e solo se non è già installata
  function updatePwaCta() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    document.body.classList.toggle('pwa-cta', !isStandalone && isMobile && installable);
  }

  // già installata come app: home normale, niente bottone
  if (isStandalone) return;

  /* ---------- hint per iOS ---------- */
  function showIosHint() {
    const overlay = document.createElement('div');
    overlay.className = 'ios-hint';
    overlay.innerHTML =
      '<div class="ios-hint-card">' +
      '<b>Installa Squer TCG</b>' +
      '<p>1. Tocca il pulsante <b>Condividi</b> <span class="ios-share-icon">&#10548;</span> nella barra di Safari</p>' +
      '<p>2. Scegli <b>&ldquo;Aggiungi alla schermata Home&rdquo;</b></p>' +
      '<p>3. Apri l\'icona: il gioco funziona anche offline</p>' +
      '<button class="btn btn-ghost" id="ios-hint-close">OK</button>' +
      '</div>';
    overlay.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#ios-hint-close').addEventListener('click', (ev) => {
      ev.stopPropagation();
      overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  /* ---------- iOS: solo istruzioni ---------- */
  if (isIOS) {
    installable = true;
    btn.classList.remove('hidden');
    btn.textContent = '\u{1F4F1} Aggiungi alla Home';
    btn.addEventListener('click', showIosHint);
  } else {
    /* ---------- Chrome / Edge / Android ---------- */
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      installable = true;
      btn.classList.remove('hidden');
      updatePwaCta();
    });

    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installable = false;
      btn.classList.add('hidden');
      updatePwaCta();
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      installable = false;
      btn.classList.add('hidden');
      updatePwaCta();
    });
  }

  window.addEventListener('resize', updatePwaCta);
  updatePwaCta();

  /* ---------- registrazione service worker ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then((reg) => {
          // Prima visita assoluta del dispositivo: lo si marca e non si mostra
          // alcun avviso (non c'è ancora nulla da aggiornare).
          const VKEY = 'squer_sw_seen_v1';
          const firstRun = !localStorage.getItem(VKEY);
          if (firstRun) localStorage.setItem(VKEY, '1');

          let updateNotified = false;
          const notify = () => {
            if (updateNotified) return;
            updateNotified = true;
            showUpdateBanner();
          };

          // Il service worker usa skipWaiting + clients.claim: quando esiste
          // una nuova versione, al successivo avvio/riapertura dell'app il
          // browser la installa subito e il "controller" cambia. Questo evento
          // scatta quindi SOLO in presenza di un vero aggiornamento (al primo
          // install lo escludiamo col flag sopra).
          if (!firstRun) {
            navigator.serviceWorker.addEventListener('controllerchange', notify);
            reg.addEventListener('updatefound', () => {
              const w = reg.installing;
              if (w) w.addEventListener('statechange', () => {
                if (w.state === 'activated') notify();
              });
            });
          }
        })
        .catch((err) => console.warn('Service Worker non registrato:', err));
    });
  }

  /** Banner breve: nuova versione pronta, tap su "Aggiorna" per applicarla */
  function showUpdateBanner() {
    if (document.getElementById('update-banner')) return;
    const b = document.createElement('div');
    b.id = 'update-banner';
    b.className = 'update-banner';
    b.innerHTML =
      '<span>\u2728 Nuova versione disponibile</span>' +
      '<button class="update-btn">Aggiorna</button>';
    b.querySelector('.update-btn').addEventListener('click', () => {
      b.remove();
      location.reload();
    });
    document.body.appendChild(b);
    requestAnimationFrame(() => b.classList.add('show'));
  }
})();

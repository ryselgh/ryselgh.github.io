// PWA installation: install button, iOS hint, service worker registration.
// Chrome/Edge/Android use beforeinstallprompt; iOS shows "Share -> Add to
// Home Screen" instructions; the button hides once the app is installed.
// On mobile, when NOT installed, home becomes a simplified "install" page
// (body class "pwa-cta"): title, big install button, footer.
(() => {
  const btn = document.getElementById('install-btn');
  if (!btn) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;

  let deferredPrompt = null;
  let installable = false; // true = button shown (app installable)

  // Simplified "install" home: only on mobile and only if not installed
  function updatePwaCta() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    document.body.classList.toggle('pwa-cta', !isStandalone && isMobile && installable);
  }

  // Already installed as an app: normal home, no button
  if (isStandalone) return;

  // ---------- iOS hint ----------
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

  // ---------- iOS: instructions only ----------
  if (isIOS) {
    installable = true;
    btn.classList.remove('hidden');
    btn.textContent = '\u{1F4F1} Aggiungi alla Home';
    btn.addEventListener('click', showIosHint);
  } else {
    // ---------- Chrome / Edge / Android ----------
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

  // ---------- service worker registration ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then((reg) => {
          // Absolute first visit on this device: mark it and show no banner
          // (there's nothing to update yet).
          const VKEY = 'squer_sw_seen_v1';
          const firstRun = !localStorage.getItem(VKEY);
          if (firstRun) localStorage.setItem(VKEY, '1');

          let updateNotified = false;
          const notify = () => {
            if (updateNotified) return;
            updateNotified = true;
            showUpdateBanner();
          };

          // The service worker uses skipWaiting + clients.claim: when a new
          // version exists, the browser installs it on the next launch/reopen
          // and the "controller" changes. So this event fires ONLY on a real
          // update (on first install it's excluded by the flag above).
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

  /** Short banner: new version ready, tap "Aggiorna" to apply it */
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

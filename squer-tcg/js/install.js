/* =========================================================
   Squer TCG - Installazione PWA
   - Chrome/Edge (desktop + Android): beforeinstallprompt
     -> mostra il bottone e apre il popup ufficiale
   - iOS Safari: nessuna API ufficiale -> il bottone mostra
     le istruzioni "Condividi -> Aggiungi alla schermata Home"
   - Bottone nascosto se l'app è già installata
   - Registrazione del service worker
   ========================================================= */
(() => {
  const btn = document.getElementById('install-btn');
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;

  // Già installata come app: niente bottone
  if (isStandalone || !btn) return;

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
    btn.classList.remove('hidden');
    btn.textContent = '\u{1F4F1} Aggiungi alla Home';
    btn.addEventListener('click', showIosHint);
  } else {
    /* ---------- Chrome / Edge / Android ---------- */
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      btn.classList.remove('hidden');
    });

    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.classList.add('hidden');
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      btn.classList.add('hidden');
    });
  }

  /* ---------- registrazione service worker ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('Service Worker non registrato:', err);
      });
    });
  }
})();

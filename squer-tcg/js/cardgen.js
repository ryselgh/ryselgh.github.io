/* =========================================================
   Squer TCG - Procedural card art generator
   Every custom image becomes a unique card: seeded procedural
   frame art + rarity styling + effects metadata for 3D scene.
   Output: { canvas, foilCanvas, effects:[...], palette }
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});
const W = 512, H = 720;

// ---- tiny canvas helpers ---------------------------------
function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function ctx2(c) { return c.getContext('2d'); }
function hsl(h, s, l, a = 1) { return `hsla(${h},${s}%,${l}%,${a})`; }

/** Colori per tipo elementale (hex) — usati per la palette affine
    (rarità + tipo) e per il badge del tipo */
const TYPE_COLORS = {
  fuoco: '#ff7043', acqua: '#4fc3f7', folgore: '#ffe082', erba: '#81c784',
  psico: '#ba68c8', lottatore: '#ff8a65', buio: '#7e8aa0', fata: '#f48fb1',
  drago: '#b39ddb', metallo: '#b0bec5', spettrale: '#9575cd', normale: '#cfd8dc',
};

/** hue (0-360) di un colore hex #rrggbb — per derivare la palette dalla rarità */
function hueOf(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ---- holographic foil texture (per rarity) ----
   A seamless diagonal-band gradient + a fine foil grid.
   The pattern is MATHEMATICALLY PERIODIC: the phase coordinate
   t = x/W + y/H advances by an integer number of bands when the
   texture wraps on either axis, so the offset can scroll forever
   with NO visible seam line. The 3D scene shifts this texture's
   offset with the card's rotation, so the foil reacts to light
   instead of animating on its own. */
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function makeFoilTexture(type) {
  const c = cv(W, H);
  const g = ctx2(c);
  const palettes = {
    foil:    [[210,55,80],[230,50,75],[260,55,78],[190,50,75]],                    // iridescente blu/viola
    contrast:[[0,40,12],[0,0,62],[0,0,95],[0,0,48],[0,0,18]],                      // cromato alto contrasto
    rainbow: [[0,95,60],[35,95,60],[70,95,60],[130,95,55],[200,90,55],[260,90,55],[300,90,55]], // arcobaleno
    gold:    [[0,75,45],[0,80,78],[50,70,60],[0,90,85],[50,65,35]],             // oro cromato
  };
  const pal = palettes[type] || palettes.foil;
  // precompute rgb for each palette entry (per-pixel loop below)
  const rgb = pal.map(([h, s, l]) => hslToRgb(h, s, l));

  const img = g.createImageData(W, H);
  const d = img.data;
  const peak = 0.55; // max band alpha (material opacity multiplies this)

  // Ogni banda = una voce della palette. La fase t = (x/W + y/H) * L
  // avanza di esattamente L (= pal.length) quando la texture si avvolge
  // su entrambi gli assi: un ciclo intero di palette, quindi niente salto
  // di colore né cucitura visibile, qualunque sia lo scorrimento.
  const L = pal.length;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const phase = (x / W + y / H) * L;
      const k = Math.floor(phase) % L;
      const t1 = phase - Math.floor(phase); // 0..1 within the band
      // raised-cosine window: 0 at band edges, 1 at center -> no hard seams
      const w = 0.5 - 0.5 * Math.cos(t1 * 2 * Math.PI);
      const a = w * w * peak;

      const i = (y * W + x) * 4;
      d[i] = rgb[k][0]; d[i + 1] = rgb[k][1]; d[i + 2] = rgb[k][2];
      d[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);

  // fine foil grid: la densità si adatta alla distensione (FOIL_REPEAT,
// definito in scene.js) così la griglia resta visivamente costante e non
// compaiono "quadretti" quando si distende l'effetto (REPEAT < 1). Linee
// centrate nelle celle, NESSUNA sul wrap: seamless (spaziatura uniforme).
  const rep = SQUER.FOIL_REPEAT || 0.5;
  const cols = Math.max(4, Math.round(30 / rep));
  const rows = Math.max(4, Math.round(42 / rep));
  g.strokeStyle = 'rgba(255,255,255,' + (0.05 * rep).toFixed(3) + ')';
  g.lineWidth = 1;
  for (let k = 0; k < cols; k++) {
    const x = (k + 0.5) * (W / cols);
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  for (let k = 0; k < rows; k++) {
    const y = (k + 0.5) * (H / rows);
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  return c;
}

SQUER.art = (() => {
  const CARD_W = 512, CARD_H = 720;

  // ---- pattern painters (seeded) -------------------------
  const patterns = {
    hex(g, rng, W, H, colors, size) {
      const s = size || rng.range(34, 58);
      const r = s / 2;
      const hh = s * 0.866;
      for (let y = -hh; y < H + hh; y += hh) {
        for (let x = -s; x < W + s; x += s * 1.5) {
          const cx = x + (Math.floor(y / hh) % 2) * s * 0.75;
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i;
            const px = cx + r * Math.cos(a), py = y + r * Math.sin(a);
            i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
          }
          g.closePath();
          g.fillStyle = colors[rng.int(0, colors.length - 1)];
          g.globalAlpha = rng.range(0.05, 0.16);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    },
    wave(g, rng, W, H, colors) {
      g.lineWidth = rng.range(3, 9);
      for (let i = 0; i < rng.int(6, 12); i++) {
        g.strokeStyle = colors[i % colors.length];
        g.globalAlpha = rng.range(0.1, 0.3);
        g.beginPath();
        const y0 = rng.range(0, H);
        const amp = rng.range(30, 90);
        const freq = rng.range(2, 5);
        const ph = rng.range(0, Math.PI * 2);
        for (let x = -10; x <= W + 10; x += 6) {
          const y = y0 + Math.sin((x / W) * freq * Math.PI * 2 + ph) * amp;
          x === -10 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    rings(g, rng, W, H, colors) {
      const cx = rng.range(0, W), cy = rng.range(0, H);
      for (let i = 0; i < rng.int(8, 16); i++) {
        g.strokeStyle = colors[i % colors.length];
        g.globalAlpha = rng.range(0.08, 0.25);
        g.lineWidth = rng.range(1.5, 6);
        g.beginPath();
        g.arc(cx, cy, rng.range(20, 500), 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    stripes(g, rng, W, H, colors) {
      const ang = rng.pick([0, Math.PI / 4, Math.PI / 6, -Math.PI / 6]);
      g.save();
      g.translate(W / 2, H / 2);
      g.rotate(ang);
      const len = Math.hypot(W, H);
      for (let i = -len; i < len; i += rng.range(26, 60)) {
        g.fillStyle = colors[rng.int(0, colors.length - 1)];
        g.globalAlpha = rng.range(0.06, 0.18);
        g.fillRect(i, -len, rng.range(8, 22), len * 2);
      }
      g.restore();
      g.globalAlpha = 1;
    },
    dots(g, rng, W, H, colors) {
      const n = rng.int(60, 130);
      for (let i = 0; i < n; i++) {
        g.fillStyle = colors[rng.int(0, colors.length - 1)];
        g.globalAlpha = rng.range(0.07, 0.22);
        g.beginPath();
        g.arc(rng.range(0, W), rng.range(0, H), rng.range(2, 14), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    },
    cells(g, rng, W, H, colors) {
      const n = rng.int(20, 40);
      for (let i = 0; i < n; i++) {
        g.fillStyle = colors[rng.int(0, colors.length - 1)];
        g.globalAlpha = rng.range(0.06, 0.2);
        g.save();
        g.translate(rng.range(0, W), rng.range(0, H));
        g.rotate(rng.range(0, Math.PI));
        const s = rng.range(20, 80);
        roundRect(g, -s / 2, -s / 2, s, s, rng.range(2, 14));
        g.fill();
        g.restore();
      }
      g.globalAlpha = 1;
    },
    burst(g, rng, W, H, colors) {
      const cx = W / 2, cy = H / 2;
      const rays = rng.int(14, 30);
      const R = Math.max(W, H);
      g.lineWidth = rng.range(2, 6);
      for (let i = 0; i < rays; i++) {
        g.strokeStyle = colors[i % colors.length];
        g.globalAlpha = rng.range(0.08, 0.25);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos((i / rays) * Math.PI * 2) * R,
                 cy + Math.sin((i / rays) * Math.PI * 2) * R);
        g.stroke();
      }
      g.globalAlpha = 1;
    },
  };

  /** Palette AFFINE: combina la rarità (hue h) con il tipo elementale
      (hueTipo). Bordo/frame e accenti principali restano della rarità;
      lo sfondo sfuma verso il colore del tipo, e pattern/forme/sparkle
      sono tinti dal tipo: ogni carta ha una combinazione unica ma la
      rarità resta riconoscibile.
      ECCEZIONE legendary: gradiente dorato puro (niente tinta del tipo),
      il contorno del simbolo del tipo resta comunque del colore del tipo. */
  function makePalette(rar, rng, hueTipo) {
    const h = hueOf(rar.frame[0]);
    const t = hueTipo;
    if (rar.id === 'legendary') {
      return {
        baseH: h,
        bg1: rar.frame[0],
        bg2: rar.frame[1],
        pat: [
          hsl(h, 50, rng.range(58, 72)),
          hsl(h, 42, rng.range(44, 58)),
          hsl(h, 55, rng.range(72, 85)),
          hsl(h, 38, rng.range(28, 44)),
        ],
        accent1: rar.accent,
        accent2: hsl(h, 48, rng.range(70, 84)),
      };
    }
    return {
      baseH: h,
      bg1: rar.frame[0],
      bg2: hsl(t, 55, rng.range(16, 30)),      // fondo: colore scuro del tipo
      pat: [
        hsl(t, 45, rng.range(58, 72)),         // pattern: variazioni del tipo
        hsl(t, 38, rng.range(42, 56)),
        hsl(t, 50, rng.range(72, 85)),
        hsl(h, 40, rng.range(30, 45)),         // + un colore della rarità
      ],
      accent1: rar.accent,
      accent2: hsl(t, 50, rng.range(68, 82)),  // forme/sparkle del tipo
    };
  }

  // ---- main draw -----------------------------------------
  function draw(card) {
    const rng = card.rng;
    const rar = card.rarity;
    const c = cv(W, H);
    const g = ctx2(c);
    const pal = makePalette(rar, rng, hueOf(TYPE_COLORS[card.type] || rar.frame[0]));
    const effects = [];
    // fullart: variante senza frame — solo l'immagine su tutta la carta
    const isFull = !!card.fullart;

    // --- background gradient ---
    // Palette AFFINE: parte dal colore della rarita' (riconoscibile:
    // legendary sempre con base oro) e sfuma verso il colore scuro del
    // tipo elementale (fuoco rosso, acqua blu, erba verde, ...).
    const grad = g.createLinearGradient(0, 0, W * rng.range(0.3, 1), H * rng.range(0.3, 1));
    grad.addColorStop(0, rar.frame[0]);
    grad.addColorStop(1, pal.bg2);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // --- seeded background pattern ---
    const patKey = rng.pick(['hex', 'wave', 'rings', 'stripes', 'dots', 'cells', 'burst']);
    patterns[patKey](g, rng, W, H, pal.pat, patKey === 'hex' ? rng.range(34, 58) : undefined);

    // --- corner glow (rarity tint) ---
    const cglow = g.createRadialGradient(W * 0.5, H * 0.35, 40, W * 0.5, H * 0.35, 520);
    cglow.addColorStop(0, rar.glow);
    cglow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cglow;
    g.fillRect(0, 0, W, H);

    // --- decorative floating shapes ---
    for (let i = 0; i < rng.int(6, 12); i++) {
      const x = rng.range(0, W), y = rng.range(0, H), s = rng.range(6, 26);
      g.fillStyle = i % 2 ? pal.accent1 : pal.accent2;
      g.globalAlpha = rng.range(0.12, 0.35);
      g.save();
      g.translate(x, y);
      g.rotate(rng.range(0, Math.PI * 2));
      if (rng.next() < 0.5) {
        g.fillRect(-s / 2, -s / 2, s, s);
      } else {
        g.beginPath();
        g.arc(0, 0, s / 2, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
    g.globalAlpha = 1;

    // --- ART WINDOW (where the custom image lives) ---
    const img = card.image;
    const winX = 34, winY = 96, winW = W - 68, winH = 300;

    if (isFull) {
      // --- FULLART: immagine intera, centrata su tutta la carta (contain-fit:
      // niente crop, si vede tutto; le barre mostrano il background) ---
      if (img) {
        const iw = img.width, ih = img.height;
        const scale = Math.min(W / iw, H / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = (W - dw) / 2, dy = (H - dh) / 2;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, dx, dy, dw, dh);
      }
    } else {
      // window frame outer
      g.fillStyle = 'rgba(8,12,20,0.55)';
      roundRect(g, winX - 8, winY - 8, winW + 16, winH + 16, 18);
      g.fill();

      // image, cover-fit inside window
      if (img) {
        const iw = img.width, ih = img.height;
        const scale = Math.max(winW / iw, winH / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = winX + (winW - dw) / 2, dy = winY + (winH - dh) / 2;
        g.save();
        roundRect(g, winX, winY, winW, winH, 12);
        g.clip();
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, dx, dy, dw, dh);
        // subtle vignette over image
        const vg = g.createLinearGradient(0, winY, 0, winY + winH);
        vg.addColorStop(0, 'rgba(0,0,0,0.25)');
        vg.addColorStop(0.5, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = vg;
        g.fillRect(winX, winY, winW, winH);
        g.restore();
      } else {
        g.fillStyle = 'rgba(20,28,40,0.8)';
        g.fillRect(winX, winY, winW, winH);
      }

      // inner frame line (rarity accent, non la palette dell'immagine)
      g.strokeStyle = rar.accent;
      g.globalAlpha = 0.85;
      g.lineWidth = 3;
      roundRect(g, winX, winY, winW, winH, 12);
      g.stroke();

      // outer ornate frame
      g.strokeStyle = rar.accent;
      g.globalAlpha = 0.9;
      g.lineWidth = 2.5;
      roundRect(g, winX - 12, winY - 12, winW + 24, winH + 24, 20);
      g.stroke();

      // frame corner gems
      const gemR = rng.range(7, 11);
      for (const [gx, gy] of [[winX - 12, winY - 12], [winX + winW + 12, winY - 12],
                             [winX - 12, winY + winH + 12], [winX + winW + 12, winY + winH + 12]]) {
        g.fillStyle = rar.accent;
        g.globalAlpha = 0.95;
        g.beginPath();
        g.arc(gx, gy, gemR, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.beginPath();
        g.arc(gx - gemR * 0.25, gy - gemR * 0.25, gemR * 0.35, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // --- TITLE AREA ---
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // title plate
    const plateY = 52;
    g.fillStyle = 'rgba(6,10,18,0.55)';
    roundRect(g, 20, plateY - 22, W - 40, 44, 12);
    g.fill();
    g.strokeStyle = pal.accent1;
    g.globalAlpha = 0.7;
    g.lineWidth = 2;
    roundRect(g, 20, plateY - 22, W - 40, 44, 12);
    g.stroke();
    g.globalAlpha = 1;

    // card name with decorative styling
    let name = card.name;
    const nameSize = name.length > 18 ? 30 : name.length > 12 ? 34 : 38;
    g.font = `700 ${nameSize}px 'Segoe UI', system-ui, sans-serif`;
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 8;
    g.fillStyle = '#ffffff';
    g.fillText(name, W / 2, plateY + 1, W - 60);
    g.shadowBlur = 0;
    // name shimmer underline
    g.fillStyle = pal.accent1;
    g.fillRect(W / 2 - nameSize * 1.6, plateY + 20, nameSize * 3.2, 2.5);

    // --- BOTTOM PANEL (rarity + stats + number) ---
    // disegnato sempre (anche sulle fullart, in sovrimpressione: gli sfondi
    // scuri semi-trasparenti tengono le scritte leggibili sopra l'immagine)
    const by0 = winY + winH + 30; // 426

    // HP / power badge (left)
    const hp = card.hp;
    g.fillStyle = 'rgba(6,10,18,0.6)';
    g.beginPath();
    g.arc(52, by0, 34, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = hp >= 40 ? '#ff5f5f' : hp >= 30 ? '#ffb02e' : pal.accent1;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '700 26px "Segoe UI", sans-serif';
    g.fillText(hp, 52, by0);
    g.font = '600 13px "Segoe UI", sans-serif';
    g.fillStyle = '#ffb0b0';
    g.fillText('PV', 52, by0 + 22);

    // ATK badge (accanto al PV): gemello, stesso livello
    const atk = card.atk;
    g.fillStyle = 'rgba(6,10,18,0.6)';
    g.beginPath();
    g.arc(128, by0, 34, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = atk >= 40 ? '#ff5f5f' : atk >= 30 ? '#ffb02e' : '#7ec8ff';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '700 26px "Segoe UI", sans-serif';
    g.fillText(atk, 128, by0);
    g.font = '600 13px "Segoe UI", sans-serif';
    g.fillStyle = '#a8d4ff';
    g.fillText('ATK', 128, by0 + 22);

    // energy type symbol (sotto i badge PV/ATK, centrato tra loro)
    const tCol = TYPE_COLORS[card.type] || pal.accent1;
    const tY = by0 + 44;
    g.fillStyle = 'rgba(6,10,18,0.6)';
    g.beginPath();
    g.arc(90, tY, 24, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = tCol;
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = tCol;
    g.font = '700 18px "Segoe UI", sans-serif';
    g.fillText(card.typeSymbol, 90, tY + 1);

    // ABILITY: nome effetto + descrizione sono raggruppati SOTTO la
    // rarità (vedi DESCRIPTION più sotto), a metà strada tra rarità e
    // numero di collezione. Qui in alto (right of HP) niente box nero.

    // RARITY GEM (center-bottom)
    const gemY = by0 + 44;
    const gemColors = {
      common: '#aeb9c6', uncommon: '#4aa3ff', rare: '#b06bff',
      superRare: '#ff5fd0', legendary: '#ffc93d',
    };
    const gc = gemColors[rar.id] || '#fff';
    const gemGrad = g.createLinearGradient(0, gemY - 26, 0, gemY + 26);
    gemGrad.addColorStop(0, '#ffffff');
    gemGrad.addColorStop(0.35, gc);
    gemGrad.addColorStop(1, 'rgba(0,0,0,0.65)');
    g.save();
    g.translate(W / 2, gemY);
    g.beginPath();
    // diamond shape
    g.moveTo(0, -24);
    g.lineTo(17, -8);
    g.lineTo(17, 14);
    g.lineTo(0, 28);
    g.lineTo(-17, 14);
    g.lineTo(-17, -8);
    g.closePath();
    g.fillStyle = gemGrad;
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.stroke();
    // facet
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -24); g.lineTo(0, 28);
    g.moveTo(-17, -8); g.lineTo(0, 10); g.lineTo(17, -8);
    g.stroke();
    g.restore();

    // rarity label (outer glow nero trasparente: leggibile su ogni sfondo)
    const rarLabel = rar.name.toUpperCase();
    g.font = '700 22px "Segoe UI", sans-serif';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 10;
    g.fillStyle = rar.color;
    g.fillText(rarLabel, W / 2, gemY + 60);
    g.shadowBlur = 0;

    // ABILITY TITLE + DESCRIPTION — raggruppati sotto la rarità, a metà
    // strada tra rarità e numero di collezione. Titolo (simbolo + nome)
    // sopra, descrizione (max 2 righe, con ellissi se troppo lunga) sotto:
    // nessun box nero, leggibilità garantita dal glow nero come per la
    // rarità. Il blocco non tocca mai il numero di collezione (H-40).
    if (card.abilityName) {
      const descCenterY = (gemY + 60 + (H - 40)) / 2;   // 605: metà tra i due
      const maxW = W - 90;                               // margine dai bordi
      const lh = 21;
      // titolo effetto (grassetto, accent della rarità)
      g.textBaseline = 'middle';
      g.font = '700 15px "Segoe UI", sans-serif';
      g.fillStyle = pal.accent1;
      g.shadowColor = 'rgba(0,0,0,0.9)';
      g.shadowBlur = 8;
      const title = card.abilitySymbol + ' ' + card.abilityName.toUpperCase();
      g.fillText(title, W / 2, descCenterY - 26);
      // descrizione sotto il titolo (max 2 righe, ellissi finale)
      if (card.abilityText) {
        g.font = '600 15px "Segoe UI", sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.92)';
        const words = String(card.abilityText).split(/\s+/).filter(Boolean);
        const lines = [];
        let line = '';
        for (const w of words) {
          const t = line ? line + ' ' + w : w;
          if (g.measureText(t).width > maxW && line) {
            lines.push(line);
            line = w;
            if (lines.length >= 2) { line += '…'; break; }  // max 2 righe
          } else line = t;
        }
        if (line && lines.length < 2) lines.push(line);
        const y0 = descCenterY + 8 - ((lines.length - 1) * lh) / 2;  // centro
        lines.forEach((ln, i) => g.fillText(ln, W / 2, y0 + i * lh));
      }
      g.shadowBlur = 0;
    }

    // card number + set tag (bottom, stesso outer glow)
    const numText = `${card.number} / ${card.setSize}`;
    const setText = '✦ SQUER TCG ✦';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 8;
    g.font = '600 15px "Segoe UI", sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(numText, W / 2, H - 40);
    g.font = '700 16px "Segoe UI", sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillText(setText, W / 2, H - 18);
    g.shadowBlur = 0;

    // --- holo / foil effects (for 3D scene) ---
    // Ogni rarità ha un effetto riconoscibile. Nessuna animazione a tempo:
    // il piano foil è statico e la scena 3D ne sposta la texture in base
    // alla rotazione della carta (simulazione della luce).
    const foilType = { uncommon: 'foil', rare: 'contrast', superRare: 'rainbow', legendary: 'gold' }[rar.id];
    if (foilType) {
      card.foilCanvas = makeFoilTexture(foilType, rng);
      const opacity = { foil: 0.35, contrast: 0.5, rainbow: 0.6, gold: 0.55 }[foilType];
      effects.push({ type: foilType, opacity });
    }
    if (rar.id === 'rare' || rar.id === 'legendary') {
      const n = rar.id === 'legendary' ? 12 : 8;
      for (let i = 0; i < n; i++) {
        effects.push({
          type: 'sparkle',
          x: rng.range(0.05, 0.95),
          y: rng.range(0.08, 0.85),
          r: rng.range(0.008, 0.02),
          color: rng.pick(['#ffffff', rar.accent, pal.accent1, pal.accent2]),
        });
      }
    }

    // --- card edge border (bordino) ---
    // sottile cornice chiara su tutto il bordo della carta:
    // quando le carte sono impilate con offset, il bordo pulito
    // nasconde il contenuto delle carte sotto.
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 6;
    roundRect(g, 3, 3, W - 6, H - 6, 14);
    g.stroke();
    g.strokeStyle = 'rgba(10,14,22,0.9)';
    g.lineWidth = 2;
    roundRect(g, 7.5, 7.5, W - 15, H - 15, 11);
    g.stroke();

    card.canvas = c;
    card.palette = pal;
    card.effects = effects;
    return card;
  }

  return { draw, W: CARD_W, H: CARD_H };
})();

/* ---- Card back texture (procedural) ---- */
SQUER.artBack = () => {
  const c = cv(W, H);
  const g = ctx2(c);
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#1b2333');
  grad.addColorStop(1, '#0c111c');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // border
  g.strokeStyle = '#3a4a66';
  g.lineWidth = 14;
  roundRect(g, 16, 16, W - 32, H - 32, 22);
  g.stroke();
  g.strokeStyle = '#5a6f94';
  g.lineWidth = 3;
  roundRect(g, 30, 30, W - 60, H - 60, 16);
  g.stroke();

  // center emblem
  g.fillStyle = '#3a4a66';
  g.beginPath();
  g.arc(W / 2, H / 2, 90, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#5a6f94';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#8fa3c4';
  g.font = '700 64px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('S', W / 2, H / 2 - 6);
  g.font = '600 20px "Segoe UI", sans-serif';
  g.fillText('SQUER TCG', W / 2, H / 2 + 46);

  // corner dots
  for (const [x, y] of [[40, 40], [W - 40, 40], [40, H - 40], [W - 40, H - 40]]) {
    g.fillStyle = '#5a6b94';
    g.beginPath();
    g.arc(x, y, 8, 0, Math.PI * 2);
    g.fill();
  }
  return c;
};

/* ---- pack wrapper texture (procedural) ---- */
SQUER.packArt = () => {
  const c = cv(300, 420);
  const g = ctx2(c);
  const grad = g.createLinearGradient(0, 0, 300, 420);
  grad.addColorStop(0, '#2b3a55');
  grad.addColorStop(1, '#141b2b');
  g.fillStyle = grad;
  g.fillRect(0, 0, 300, 420);

  // diagonal shine
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 18;
  for (let i = -2; i < 6; i++) {
    g.beginPath();
    g.moveTo(i * 120, 0);
    g.lineTo(i * 120 - 420, 420);
    g.stroke();
  }

  // emblem
  g.fillStyle = '#ffc93d';
  g.beginPath();
  g.arc(150, 150, 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#141b2b';
  g.font = '700 60px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('S', 150, 150);

  g.fillStyle = '#ffffff';
  g.font = '700 30px "Segoe UI", sans-serif';
  g.fillText('SQUER', 150, 250);
  g.fillStyle = '#9fb0cc';
  g.font = '600 18px "Segoe UI", sans-serif';
  g.fillText('PACCHETTO', 150, 285);

  // bottom bar
  g.fillStyle = '#ffc93d';
  g.fillRect(0, 380, 300, 40);
  g.fillStyle = '#141b2b';
  g.font = '700 20px "Segoe UI", sans-serif';
  g.fillText(PACK_SIZE + ' CARTE', 150, 400);
  return c;
};

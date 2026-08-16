// Squer TCG three.js 3D scene: card tilt, flip reveal, pack opening
// ceremony, sparkles, holographic shift and edge glow effects.

var SQUER = window.SQUER || (window.SQUER = {});

// FOIL BAND WIDTH — the only constant to tweak (here, in scene.js).
// Smaller = wider holo bands (more spread effect); 1 = original.
// The foil texture grid adapts to this same value (see makeFoilTexture
// in cardgen.js), so no checkerboard shows when the effect is stretched.
const FOIL_REPEAT = 0.15;
SQUER.FOIL_REPEAT = FOIL_REPEAT;

// CARD ZOOM — multiplies card scale in both pack opening and the album
// detail view. 1 = current, >1 = bigger, <1 = smaller.
// Try 1.1, 1.2, 1.3... (the camera allows up to ~1.5).
const CARD_ZOOM = 2;
SQUER.CARD_ZOOM = CARD_ZOOM;

// DETAIL ZOOM — camera distance when tapping a card in the detail view
// (smaller = closer = more zoomed). 9 = default (far).
const DETAIL_ZOOM_Z = 5.2;
SQUER.DETAIL_ZOOM_Z = DETAIL_ZOOM_Z;

/** Rounded rectangle shape, centered at origin, matching the card face */
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
SQUER.roundedRectShape = roundedRectShape;

class SquerScene {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth;
    this.height = container.clientHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, this.width / this.height, 0.1, 100);
    this.camera.position.set(0, 0, 9);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    // lights
    const amb = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(amb);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(-3, -1, -2);
    this.scene.add(rim);

    // ground glow — scales with CARD_ZOOM so the big detail card
    // never clips into it at any zoom value
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(8 * CARD_ZOOM, 8 * CARD_ZOOM),
      new THREE.MeshBasicMaterial({ color: 0x1a1f2e, transparent: true, opacity: 0.4 })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -1.6 * CARD_ZOOM;
    this.scene.add(glow);

    // sparkle pool
    this.sparkles = [];
    this.fxMats = [];
    this._sparkleTex = null;
    this.sparkleGroup = new THREE.Group();
    this.scene.add(this.sparkleGroup);

    // card group
    this.cardGroup = new THREE.Group();
    this.scene.add(this.cardGroup);

    // interaction
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.tiltEnabled = true;
    this._bindPointer();

    this.clock = new THREE.Clock();
    this.animations = [];
    this._loop();
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  _onResize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      this.pointer.tx = (cx / r.width) * 2 - 1;
      this.pointer.ty = (cy / r.height) * 2 - 1;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('touchmove', move, { passive: true });
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    // smooth pointer
    this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.08;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.08;

    // card tilt
    if (this.tiltEnabled && this.cardGroup.children.length) {
      this.cardGroup.rotation.y = this.pointer.x * 0.35;
      this.cardGroup.rotation.x = this.pointer.y * 0.25; // vertical inverted: mouse up = card up
    }

    // holo/foil: shift the overlay texture with the deck tilt, so the
    // effect reacts to light instead of animating on its own.
    const ry = this.cardGroup.rotation.y;
    const rx = this.cardGroup.rotation.x;
    for (let i = this.fxMats.length - 1; i >= 0; i--) {
      const f = this.fxMats[i];
      if (!f.mesh.parent) { this.fxMats.splice(i, 1); continue; }
      // scale offset by repeat so wider bands (repeat < 1) keep the
      // approved visual sweep speed instead of moving twice as fast
      const rep = f.repeat || 1;
      f.mat.map.offset.x = ry * 0.6 * rep;
      f.mat.map.offset.y = rx * 0.6 * rep;
    }

    // sparkles: a light wave sweeps across the card with the rotation,
    // lighting up the sparkles it passes (specular sweep)
    const sweep = ry * 0.5 + 0.5;
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      if (!s.mesh.parent) { this.sparkles.splice(i, 1); continue; }
      const catchF = Math.max(0, 1 - Math.abs(s.x - sweep) * 3);
      s.mesh.material.opacity = 0.15 + catchF * 0.85;
    }

    // run tweens
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const a = this.animations[i];
      a.t += dt;
      const k = Math.min(a.t / a.dur, 1);
      const e = a.ease ? a.ease(k) : k;
      a.update(e, t);
      if (k >= 1) {
        this.animations.splice(i, 1);
        if (a.onDone) a.onDone();
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  // card creation
  /** Build a card mesh (front/back/edges); reusable from other scenes
      (e.g. BattleScene) via SQUER.buildCardMesh. */
  makeCardMesh(card, scale = 1) {
    return buildCardMesh(card, scale);
  }

  /** Show a single card (detail view) with flip-in */
  showCard(card, { flip = true } = {}) {
    this.clearCard();
    this.tiltEnabled = true;
    const mesh = this.makeCardMesh(card, 1.15 * CARD_ZOOM);
    this.cardGroup.add(mesh);
    this._applyEffects(card, mesh);

    if (flip) {
      mesh.rotation.y = Math.PI; // show back
      this._tween(0.7, (k, t) => {
        mesh.rotation.y = Math.PI * (1 - easeOutBack(k));
        mesh.position.y = Math.sin(k * Math.PI) * 0.15;
      });
    }

    // tap on the card -> 3D camera zoom (see _toggleDetailZoom)
    this._bindDetailTap();
    return mesh;
  }

  /** Tap (not drag) on the detail card: 3D camera zoom in/out */
  _bindDetailTap() {
    const el = this.renderer.domElement;
    let sx = null, sy = null;
    const down = (e) => {
      const p = e.touches ? e.touches[0] : e;
      sx = p.clientX; sy = p.clientY;
    };
    const up = (e) => {
      if (sx === null) return;
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const d = Math.hypot(p.clientX - sx, p.clientY - sy);
      sx = null;
      if (d < 10) this._toggleDetailZoom();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('pointerup', up);
    el.addEventListener('touchend', up, { passive: true });
    this._detailTapCleanup = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('touchend', up);
    };
  }

  /** Toggle camera zoom: tap zooms in, next tap zooms out */
  _toggleDetailZoom() {
    this._detailZoomed = !this._detailZoomed;
    const targetZ = this._detailZoomed ? DETAIL_ZOOM_Z : 9;
    const fromZ = this.camera.position.z;
    this._tween(0.6, (k) => {
      const e = easeOutCubic(k);
      this.camera.position.z = fromZ + (targetZ - fromZ) * e;
    });
  }

  /** Flip a card from back to front (used in pack reveal) */
  flipCard(mesh, onDone) {
    this.tiltEnabled = false;
    this._tween(0.6, (k) => {
      mesh.rotation.y = Math.PI * (1 - easeOutCubic(k));
    }, () => { this.tiltEnabled = true; if (onDone) onDone(); });
  }

  _applyEffects(card, mesh) {
    const fx = card.effects || [];
    // actual card dims (vary: detail 1.15, pack 0.8)
    const { w: cw, h: ch, d: cd } = mesh.userData.dims;
    for (const e of fx) {
      if (e.type === 'sparkle') {
        this._addSparkle(e, mesh, cw, ch, cd);
      } else if (e.type === 'foil' || e.type === 'contrast' || e.type === 'rainbow' || e.type === 'gold') {
        if (card.foilCanvas) {
          const tex = new THREE.CanvasTexture(card.foilCanvas);
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          const mat = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, opacity: e.opacity, blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          // Foil plane with the SAME corner rounding as the card face
          // (inset 3px, radius 14px on a 512x720 canvas), reproduced in
          // world units so the foil matches the card edge exactly.
          const inset = 3 / 512 * cw;
          const radius = 14 / 512 * cw;
          const shape = roundedRectShape(cw - inset * 2, ch - inset * 2, radius);
          const plane = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);

          // Band width reads the shared FOIL_REPEAT constant (top of this
          // file); the texture grid uses the same value, so no checkering.
          const REPEAT = SQUER.FOIL_REPEAT || 0.5;
          // ShapeGeometry emits raw world-space vertex UVs, not 0..1:
          // normalize first, then apply REPEAT so band width stays
          // constant at any scale.
          const sw = cw - inset * 2, sh = ch - inset * 2;
          const uv = plane.geometry.attributes.uv;
          for (let i = 0; i < uv.count; i++) {
            const u = (uv.getX(i) + sw / 2) / sw;
            const v = (uv.getY(i) + sh / 2) / sh;
            uv.setXY(i, u * REPEAT, v * REPEAT);
          }

          plane.position.z = cd / 2 + 0.002;
          mesh.add(plane);
          this.fxMats.push({ mat, mesh, type: e.type, repeat: REPEAT });
        }
      }
    }
  }

  _addSparkle(e, mesh, cw, ch, cd) {
    // soft round sparkle, child of the card so it follows the rotation
    if (!this._sparkleTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      this._sparkleTex = new THREE.CanvasTexture(c);
    }
    const mat = new THREE.SpriteMaterial({
      map: this._sparkleTex, color: new THREE.Color(e.color),
      transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    // size and position relative to the card (same fix as the foil: they
    // were fixed for scale 1 and ended up outside the edges on packs)
    sprite.scale.set(e.r * cw * 3.75, e.r * cw * 3.75, 1);
    sprite.position.set((e.x - 0.5) * cw * 0.85, (0.5 - e.y) * ch * 0.85, cd / 2 + 0.02);
    mesh.add(sprite);
    this.sparkles.push({ mesh: sprite, x: e.x, card: mesh });
  }

  // pack opening
  showPack(onSwipe) {
    this.clearCard();
    this.tiltEnabled = false;
    this.packGroup = new THREE.Group();
    this.scene.add(this.packGroup);

    const packTex = new THREE.CanvasTexture(SQUER.packArt());
    // thickness proportional to card count (more cards = thicker pack)
    const packDepth = 0.04 * PACK_SIZE;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 2.1, packDepth),
      new THREE.MeshStandardMaterial({ map: packTex, roughness: 0.4, metalness: 0.1 })
    );
    this.packGroup.add(body);
    this.packBody = body;

    // top flap
    const flap = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.06, packDepth),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.6 })
    );
    flap.position.y = 1.05;
    this.packGroup.add(flap);
    this.packFlap = flap;

    this.packGroup.position.y = 0.2;
    this.packGroup.rotation.y = 0.4;
    // pack scales with CARD_ZOOM so cards exit a proportioned wrapper
    this.packGroup.scale.setScalar(CARD_ZOOM * 1.05);

    // gentle float
    this._tween(1.2, (k, t) => {
      this.packGroup.position.y = 0.2 + Math.sin(t * 2) * 0.08;
      this.packGroup.rotation.y = 0.4 + Math.sin(t * 0.8) * 0.15;
    }, null, true);

    // swipe interaction
    this._packSwipe = onSwipe;
    this._bindSwipe();
  }

  _bindSwipe() {
    const el = this.renderer.domElement;
    let startX = null, startY = null;
    const down = (e) => {
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX; startY = p.clientY;
    };
    const up = (e) => {
      if (startX === null) return;
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const dx = p.clientX - startX, dy = p.clientY - startY;
      if (Math.hypot(dx, dy) > 40) {
        startX = null;
        if (this._packSwipe) this._packSwipe();
      }
      startX = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('pointerup', up);
    el.addEventListener('touchend', up, { passive: true });
    this._swipeCleanup = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('touchend', up);
    };
  }

  /** Tear the pack open: flap flies off, body fades; the cards come out
      as a single face-up BLOCK (no stagger -> no spoiler), then spread
      into a stack. The top card is revealed immediately; tap it to
      swipe it to the right and reveal the next one. */
  tearPack(cards, onReveal, onStackDone) {
    this.tiltEnabled = false;
    this.cardGroup.rotation.set(0, 0, 0);
    if (this._swipeCleanup) this._swipeCleanup();
    // burst particles
    this._burst();

    // flap flies off
    this._tween(0.5, (k) => {
      this.packFlap.position.y = 1.05 + k * 2;
      this.packFlap.rotation.x = -k * 1.2;
      this.packFlap.position.z = k * 1.5;
    }, () => this.packFlap.visible = false);

    // body fades/scales
    this._tween(0.6, (k) => {
      this.packBody.scale.setScalar(1 + k * 0.3);
      this.packBody.material.opacity = 1 - k;
      this.packBody.material.transparent = true;
    }, () => this.packGroup.visible = false);

    // spawn cards, all face-up (no spoiler block: they fly out together)
    const n = cards.length;
    const stack = [];
    const zTop = 0.1;
    const zStep = 0.02;   // > card thickness (0.04) -> no z-fighting
    for (let i = 0; i < n; i++) {
      const mesh = this.makeCardMesh(cards[i].card, CARD_ZOOM);
      mesh.rotation.y = 0; // face-up
      // compact block: card 0 (first) stays in front (higher z), so the
      // first card is visible while exiting, not the last
      mesh.position.set(0, 0, (n - 1 - i) * 0.002);
      mesh.userData.revealed = false;
      this._applyEffects(cards[i].card, mesh);
      this.cardGroup.add(mesh);
      stack.push(mesh);
    }
    this._stack = stack;
    this._stackIndex = 0;
    this._dismissing = false;
    this._onReveal = onReveal;
    this._onStackDone = onStackDone;
    this._bindStackTap();
    // hide sparkles on all cards: only the top (revealed) card shows them,
    // otherwise ones behind would overlap the cards in front
    this.sparkles.forEach(s => s.mesh.visible = false);

    // resting position: top card centered, lower cards fanned down-right.
    // DIAGONAL OFFSET — tweak here to change the stagger:
    //   endX = i * 0.04  (horizontal step per card)
    //   endY = -i * 0.03 (vertical step per card)
    const endX = (i) => i * 0.01;
    const endY = (i) => -i * 0.01;
    const endZ = (i) => zTop - i * zStep;

    // 1) the whole block rises out of the pack as one unit
    this._tween(0.8, (k) => {
      const e = easeOutCubic(k);
      const rise = Math.sin(k * Math.PI) * 1.6;
      for (let i = 0; i < n; i++) {
        const m = stack[i];
        m.position.y = rise;
        m.position.z = (n - 1 - i) * 0.002;
      }
    }, () => {
      // 2) spread into a stack
      this._tween(0.4, (k) => {
        const e = easeOutCubic(k);
        for (let i = 0; i < n; i++) {
          const m = stack[i];
          m.position.x = endX(i) * e;
          m.position.y = endY(i) * e;
          m.position.z = endZ(i) * e;
        }
      }, () => {
        // 3) reveal the top card
        setTimeout(() => {
          if (this._stack && this._stack.length) this._revealTop();
        }, 300);
      });
    });
  }

  /** The current top card is already face-up: just notify it's shown */
  _revealTop() {
    if (!this._stack) return;
    const mesh = this._stack[this._stackIndex];
    if (!mesh || mesh.userData.revealed) return;
    mesh.userData.revealed = true;
    this._setSparklesVisible(mesh, true);
    if (this._onReveal) this._onReveal(mesh.userData.card);
  }

  /** Show/hide the sparkles of a specific card mesh */
  _setSparklesVisible(cardMesh, visible) {
    for (const s of this.sparkles) {
      if (s.card === cardMesh) s.mesh.visible = visible;
    }
  }

  /** Swipe the top card to the right, then reveal the next one */
  _dismissTop() {
    // debounce: ignore rapid taps while a card is already swiping, else a
    // second tween on the same mesh (the old callback hasn't fired, the
    // card isn't removed) would fight the first, leaving the card stuck
    // mid-air tilted in front of the others and skipping stackIndex.
    if (this._dismissing) return;
    const mesh = this._stack[this._stackIndex];
    if (!mesh) return;
    this._dismissing = true;
    this._setSparklesVisible(mesh, false); // hide its sparkles
    const sx = mesh.position.x, sy = mesh.position.y;
    this._tween(0.4, (k) => {
      const e = easeInCubic(k);
      mesh.position.x = sx + e * 2.4;   // swipe right
      mesh.position.y = sy + e * 0.35;
      mesh.rotation.z = e * 0.22;       // slight tilt while swiping
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => { m.transparent = true; m.opacity = 1 - e; });
      }
    }, () => {
      this.cardGroup.remove(mesh);
      this._stackIndex++;
      this._dismissing = false;
      if (this._stackIndex < this._stack.length) this._revealTop();
      else if (this._onStackDone) this._onStackDone();
    });
  }

  _bindStackTap() {
    const el = this.renderer.domElement;
    let startX = null, startY = null, moved = false;

    const down = (e) => {
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX; startY = p.clientY;
      moved = false;
    };
    const move = (e) => {
      if (startX === null) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - startX;
      const dy = p.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
      // drag: rotate the top card to see its holographic effects
      this._dragCard(dx, dy);
    };
    const up = (e) => {
      if (startX === null) return;
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const dx = p.clientX - startX;
      const dy = p.clientY - startY;
      const dist = Math.hypot(dx, dy);
      startX = null;
      // always snap the stack back to neutral on release
      this._snapCard();
      if (dist < 10) {
        // simple tap -> swipe right (reveal first if auto-reveal hasn't)
        const mesh = this._stack[this._stackIndex];
        if (mesh && !mesh.userData.revealed) this._revealTop();
        else this._dismissTop();
      }
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('pointermove', move);
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('pointerup', up);
    el.addEventListener('touchend', up, { passive: true });
    this._stackCleanup = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('touchend', up);
    };
  }

  /** Rotate the WHOLE visible stack following the finger drag (clamped),
      so the top card doesn't intersect the ones behind it */
  _dragCard(dx, dy) {
    const MAX = 0.55; // max rotation (radians)
    this.cardGroup.rotation.y = THREE.MathUtils.clamp(dx * 0.004, -MAX, MAX);
    this.cardGroup.rotation.x = THREE.MathUtils.clamp(-dy * 0.004, -MAX, MAX);
  }

  /** Snap the stack back to neutral after a drag */
  _snapCard() {
    const ry = this.cardGroup.rotation.y, rx = this.cardGroup.rotation.x;
    this._tween(0.35, (k) => {
      const e = easeOutCubic(k);
      this.cardGroup.rotation.y = ry * (1 - e);
      this.cardGroup.rotation.x = rx * (1 - e);
    });
  }

  /** Reveal the current top card programmatically (tap anywhere) */
  revealNext() {
    if (!this._stack) return null;
    const mesh = this._stack[this._stackIndex];
    if (!mesh) return null;
    if (mesh.userData.revealed) {
      this._dismissTop();
    } else {
      this._revealTop();
    }
    return mesh.userData.card;
  }

  _burst() {
    const geo = new THREE.BufferGeometry();
    const N = 60;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = 0; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
      const c = new THREE.Color().setHSL(Math.random(), 0.9, 0.7);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.08, vertexColors: true, transparent: true, opacity: 1 });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    const vel = [];
    for (let i = 0; i < N; i++) {
      vel.push(new THREE.Vector3(
        (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4
      ));
    }
    this._tween(1.0, (k, t) => {
      const arr = geo.attributes.position.array;
      for (let i = 0; i < N; i++) {
        arr[i * 3] = vel[i].x * k;
        arr[i * 3 + 1] = vel[i].y * k - 1.5 * k * k;
        arr[i * 3 + 2] = vel[i].z * k;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - k;
    }, () => this.scene.remove(pts));
  }

  // helpers
  _tween(dur, update, onDone, loop = false) {
    this.animations.push({ t: 0, dur, update, onDone, loop, ease: null });
  }

  clearCard() {
    while (this.cardGroup.children.length) {
      const c = this.cardGroup.children[0];
      this.cardGroup.remove(c);
      c.geometry.dispose();
      if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
      else c.material.dispose();
    }
    while (this.sparkleGroup.children.length) {
      this.sparkleGroup.remove(this.sparkleGroup.children[0]);
    }
    this.sparkles = [];
    this.fxMats = [];
    if (this.packGroup) { this.scene.remove(this.packGroup); this.packGroup = null; }
    if (this._revealCleanup) this._revealCleanup();
    if (this._stackCleanup) this._stackCleanup();
    this._revealTargets = null;
    this._stack = null;
    this._stackIndex = 0;
    this._dismissing = false;
    this._onStackDone = null;
    this._detailZoomed = false;
    this.camera.position.z = 9;
    if (this._detailTapCleanup) this._detailTapCleanup();
    this._detailTapCleanup = null;
    this.cardGroup.rotation.set(0, 0, 0);
    this.animations = [];
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

// easing
function easeOutCubic(k) { return 1 - Math.pow(1 - k, 3); }
function easeInCubic(k) { return k * k * k; }
function easeOutBack(k) { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }
function easeOutCubic2(k) { return easeOutCubic(k); }

/** Standalone 3D card mesh (front/back/edge), reusable from other scenes
    (e.g. BattleScene). Same code as SquerScene.makeCardMesh. */
function buildCardMesh(card, scale = 1) {
  const w = 1.6 * scale, h = 2.25 * scale, d = 0.05 * scale;
  // rounded corners: same radius as the white edge drawn on the canvas
  // (14px on 512), so the 3D geometry matches the border and corners
  // aren't pointy
  const radius = 14 / 512 * w;
  const shape = roundedRectShape(w, h, radius);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2); // center on z (front at +d/2, back at -d/2)

  // front/back face UVs: ExtrudeGeometry emits world units (centered
  // shape), so normalize to 0..1 to map the texture
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(nz) > 1e-6) { // front/back face (sides have nz = 0)
      for (let j = 0; j < 3; j++) {
        const x = pos.getX(i + j), y = pos.getY(i + j);
        uv.setXY(i + j, (x + w / 2) / w, (y + h / 2) / h);
      }
    }
  }

  // group triangles by material: front (nz>0), back (nz<0), sides
  const groups = [];
  let cur = null;
  const flush = () => { if (cur && cur.count > 0) groups.push(cur); };
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const idx = Math.abs(nz) > 1e-6 ? (nz > 0 ? 0 : 1) : 2;
    if (!cur || cur.materialIndex !== idx) { flush(); cur = { start: i, count: 0, materialIndex: idx }; }
    cur.count += 3;
  }
  flush();
  geo.clearGroups();
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);

  const frontTex = new THREE.CanvasTexture(card.canvas);
  frontTex.anisotropy = 4;
  const frontMat = new THREE.MeshStandardMaterial({
    map: frontTex, roughness: 0.35, metalness: 0.15,
  });

  // back texture (procedural)
  const backTex = new THREE.CanvasTexture(SQUER.artBack());
  const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.5 });

  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 0.8 });

  const mats = [frontMat, backMat, edgeMat];
  const mesh = new THREE.Mesh(geo, mats);
  mesh.userData = { frontMat, backMat, card, dims: { w, h, d } };
  return mesh;
}

SQUER.SquerScene = SquerScene;
SQUER.buildCardMesh = buildCardMesh;
// Squer TCG BattleScene2: 3D turn-based battle on a perspective table.
// Zones are flat pads, the player hand is a fan; logic stays in game.js.

var SQUER = window.SQUER || (window.SQUER = {});

const Z2 = ['left', 'center', 'right'];
const BZ = {
  CAM_Y: 5.4, CAM_Z: 11.0, CAM_LOOK_Y: -0.7, FOV: 46,
  TABLE_W: 11, TABLE_D: 7.2,
  ZONE_X: { left: -2.3, center: 0, right: 2.3 },
  ROW_BOT: -1.75,
  ROW_PLAYER: 1.75,
  ZONE_Y: 0.035,           // zone cards: laid flat on the table
  PAD_W: 2.05, PAD_H: 2.35,
  HAND_Y: -1.3, HAND_Z: 4.0,     // player hand: low, in front of the table
  BOT_HAND_Y: 3.0, BOT_HAND_Z: 1.0, BOT_HAND_SCALE: 0.8,  // bot backs: big, close together, up front
  CARD_ZONE_SCALE_P: 1.0,   // player zone cards
  CARD_ZONE_SCALE_B: 1.2,   // bot zone cards (bigger: further away)
  CARD_HAND_SCALE: 1.15,   // hand cards (bigger)
  DRAG_PLANE_Y: 1.7,       // drag flight plane
  DRAG_SCALE: 0.95,        // dragged card scale
  DRAG_PIVOT_OFFSET: 1.0,  // cursor grips the card at the BOTTOM (not center)
  DRAG_MIN_Z: 0.9,         // card never passes the player's mid-field (+ offset)
  TAP_DIST: 12, TAP_MAX_MS: 600,
};
const PAD_COLORS = { neutral: 0x3d7bff, place: 0xffc93d, sel: 0xffc93d, front: 0xff8a5f };
// overlay border color per type (consistent with card palettes)
const OV_TYPE_COLORS = {
  fuoco: 0xff6b4a, erba: 0x6bc95f, acqua: 0x4aa8ff, folgore: 0xffd54a,
  psico: 0xb86bff, lottatore: 0xff9a4a, buio: 0x7a5c99, fata: 0xff7ab8,
  drago: 0x5a6bff, metallo: 0xa8b0bf, spettrale: 0x8f7ae8, normale: 0xc8cdd6,
};
const OV_H = 96; // zone overlay height (px)

function fanPos(n, i, baseY, spreadMul = 1) {
  // spread: angle between adjacent cards. Small hands open the fan wider
  // so cards never overlap (even the 2 middle ones out of 4).
  const spread = Math.min(0.85, 1.9 / Math.max(n - 1, 1)) * spreadMul;
  const r = 3.1;
  const a = (i - (n - 1) / 2) * spread;
  return {
    x: Math.sin(a) * r,
    y: baseY - (1 - Math.cos(a)) * r * 0.62,
    z: i * 0.03,
    rotY: -a,
  };
}

class BattleScene2 {
  constructor(container, { onZoneTap, onHandTap, onHandDrop, onHandDrag, onPadMatchup } = {}) {
    this.container = container;
    this.onZoneTap = onZoneTap || (() => {});
    this.onHandTap = onHandTap || (() => {});
    this.onHandDrop = onHandDrop || (() => {});
    this.onHandDrag = onHandDrag || (() => {}); // matchup hint during drag
    this.onPadMatchup = onPadMatchup || (() => {}); // drag sopra un pad: adv 1/-1/0/null
    this.width = container.clientWidth || 340;
    this.height = container.clientHeight || 420;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BZ.FOV, this.width / this.height, 0.1, 100);
    this.camera.position.set(0, BZ.CAM_Y, BZ.CAM_Z);
    this.camera.lookAt(0, BZ.CAM_LOOK_Y, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    const amb = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(amb);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(-3, -1, -2);
    this.scene.add(rim);

    // table (horizontal at y=0)
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(BZ.TABLE_W, BZ.TABLE_D),
      new THREE.MeshStandardMaterial({ color: 0x161b28, roughness: 0.9 })
    );
    table.rotation.x = -Math.PI / 2;
    this.scene.add(table);
    // mid-field line
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(8.4, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x39425c, transparent: true, opacity: 0.65 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.012, 0);
    this.scene.add(line);

    // sparkle pool
    this.sparkles = [];
    this.fxMats = [];
    this._sparkleTex = null;

    // zone
    this.zoneGroup = new THREE.Group();
    this.scene.add(this.zoneGroup);
    this.padMeshes = [];
    this.cardMeshes = {};   // player -> zone -> mesh
    this.zoneState = { p: {}, b: {} };
    for (const pl of ['p', 'b']) for (const z of Z2) this._buildPad(pl, z);

    // player hand (fan)
    this.handGroup = new THREE.Group();
    this.scene.add(this.handGroup);
    this.handMeshes = [];   // hand index -> mesh
    this._handIds = [];

    // bot hand (card backs up)
    this.botHandGroup = new THREE.Group();
    this.scene.add(this.botHandGroup);
    this._botHandCount = 0;

    // HP/ATK overlay + floating damage
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'zone-overlays';
    container.appendChild(this.overlayEl);
    this.ovEls = {};
    for (const pl of ['p', 'b']) for (const z of Z2) this._buildOverlay(pl, z);
    // in-hand card info badge (hover/select)
    this._handInfoEl = document.createElement('div');
    this._handInfoEl.className = 'hand-info hidden';
    this.overlayEl.appendChild(this._handInfoEl);
    this._hoverHand = -1;
    this._selHand = -1;

    this.raycaster = new THREE.Raycaster();
    this._bindInput();
    // tap mini badges to expand/collapse (no hover on mobile)
    this._expandedBadge = null;
    this.overlayEl.addEventListener('click', (e) => {
      const ov = e.target.closest('.zone-ov');
      if (ov) {
        const was = ov.classList.contains('expanded');
        this._collapseBadges();
        if (!was) ov.classList.add('expanded');
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.zone-ov')) this._collapseBadges();
    });
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    this.clock = new THREE.Clock();
    this.animations = [];
    this._loop();
  }

  _buildPad(pl, z) {
    const row = pl === 'p' ? BZ.ROW_PLAYER : BZ.ROW_BOT;
    const geo = new THREE.PlaneGeometry(BZ.PAD_W, BZ.PAD_H);
    const mat = new THREE.MeshBasicMaterial({ color: PAD_COLORS.neutral, transparent: true, opacity: 0.34, depthWrite: false });
    const pad = new THREE.Mesh(geo, mat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(BZ.ZONE_X[z], 0.015, row);
    pad.userData = { kind: 'zone', player: pl, zone: z };
    this.zoneGroup.add(pad);
    this.padMeshes.push(pad);
  }

  _buildOverlay(pl, z) {
    const el = document.createElement('div');
    el.className = 'zone-ov hidden';
    el.innerHTML = '<div class="zo-top"><span class="zo-el"></span><span class="zo-atk"></span><span class="zo-hp-mini"></span><span class="zo-ab-icon"></span></div>' +
      '<div class="zo-hpbar"><div class="zo-hpfill"></div></div>' +
      '<div class="zo-extra"><div class="zo-name"></div>' +
      '<div class="zo-stats"><span class="zo-atk-full"></span><span class="zo-hp"></span></div><div class="zo-ab-text"></div></div>';
    this.overlayEl.appendChild(el);
    this.ovEls[pl + '/' + z] = el;
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    for (let i = this.fxMats.length - 1; i >= 0; i--) {
      const f = this.fxMats[i];
      if (!f.mesh.parent) { this.fxMats.splice(i, 1); continue; }
      const rep = f.repeat || 1;
      f.mat.map.offset.x = f.mesh.rotation.y * 0.6 * rep;
      f.mat.map.offset.y = f.mesh.rotation.x * 0.6 * rep;
    }
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      if (!s.mesh.parent) { this.sparkles.splice(i, 1); continue; }
      const catchF = Math.max(0, 1 - Math.abs(s.x - (s.mesh.parent.rotation.y * 0.5 + 0.5)) * 3);
      s.mesh.material.opacity = 0.15 + catchF * 0.85;
    }
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const a = this.animations[i];
      a.t += dt;
      const k = Math.min(a.t / a.dur, 1);
      const e = a.ease ? a.ease(k) : k;
      a.update(e, t);
      if (k >= 1) { this.animations.splice(i, 1); if (a.onDone) a.onDone(); }
    }
    this.renderer.render(this.scene, this.camera);
  }

  _tween(dur, update, onDone, ease, tag) {
    this.animations.push({ t: 0, dur, update, onDone, ease, tag: tag || null });
  }

  _cancelTag(tag) {
    if (!tag) return;
    for (let i = this.animations.length - 1; i >= 0; i--) {
      if (this.animations[i].tag === tag) this.animations.splice(i, 1);
    }
  }

  // ZONE STATE
  /** stateVis = { p: { zone: {id, orig, curHp, curAtk, hp, ability} | null }, b: {...} } */
  setState(stateVis, sel) {
    for (const pl of ['p', 'b']) {
      for (const z of Z2) {
        const sv = stateVis[pl][z];
        const cur = this.cardMeshes[pl] && this.cardMeshes[pl][z];
        if (sv) {
          if (!cur) this._spawnZoneCard(pl, z, sv);
          else if (cur.userData.cardId !== sv.id) { this._removeZoneCard(pl, z, true); this._spawnZoneCard(pl, z, sv); }
          this._updateOverlay(pl, z, sv);
        } else if (cur) {
          this._removeZoneCard(pl, z, true);
          const el = this.ovEls[pl + '/' + z];
          if (el) el.classList.add('hidden'); // no mini badge on empty zone
        }
        this.zoneState[pl][z] = sv ? sv.id : null;
      }
    }
    this.setHighlight(sel);
  }

  _zonePos(pl, z) {
    return new THREE.Vector3(BZ.ZONE_X[z], BZ.ZONE_Y, pl === 'p' ? BZ.ROW_PLAYER : BZ.ROW_BOT);
  }

  _spawnZoneCard(pl, z, sv) {
    if (!this.cardMeshes[pl]) this.cardMeshes[pl] = {};
    const mesh = buildCardMesh(sv.orig, pl === 'p' ? BZ.CARD_ZONE_SCALE_P : BZ.CARD_ZONE_SCALE_B);
    mesh.userData.kind = 'zone';
    mesh.userData.cardId = sv.id;
    mesh.userData.player = pl;
    mesh.userData.zone = z;
    mesh.userData.orig = sv.orig; // per il matchup del drag (tipo della carta di fronte)
    mesh.rotation.x = -Math.PI / 2; // flat on the table
    mesh.position.copy(this._zonePos(pl, z));
    mesh.scale.setScalar(0.01);
    this.zoneGroup.add(mesh);
    this.cardMeshes[pl][z] = mesh;
    this._applyEffects(sv.orig, mesh);
    this._tween(0.4, (k) => {
      const e = easeOutBack(k);
      mesh.scale.setScalar(Math.max(0.01, e));
      mesh.position.y = BZ.ZONE_Y + Math.sin(k * Math.PI) * 0.5;
    });
  }

  _removeZoneCard(pl, z, animate) {
    const mesh = this.cardMeshes[pl] && this.cardMeshes[pl][z];
    if (!mesh) return;
    if (animate) {
      this._tween(0.35, (k) => {
        mesh.scale.setScalar(Math.max(0.01, 1 - k));
        mesh.position.y = BZ.ZONE_Y - k * 0.5;
      }, () => { this.zoneGroup.remove(mesh); if (mesh.geometry) mesh.geometry.dispose(); });
    } else {
      this.zoneGroup.remove(mesh);
    }
    delete this.cardMeshes[pl][z];
  }

  _updateOverlay(pl, z, sv) {
    const el = this.ovEls[pl + '/' + z];
    if (!el) return;
    const pct = Math.max(0, Math.min(100, Math.round(sv.curHp / sv.hp * 100)));
    el.querySelector('.zo-hpfill').style.width = pct + '%';
    el.querySelector('.zo-hpfill').className = 'zo-hpfill' + (pct < 35 ? ' low' : '');
    el.querySelector('.zo-el').textContent = (sv.orig && sv.orig.typeSymbol) || (sv.typeSymbol) || '';
    el.querySelector('.zo-atk').textContent = sv.curAtk;
    el.querySelector('.zo-hp-mini').textContent = sv.curHp; // remaining HP, red
    el.querySelector('.zo-atk-full').textContent = '⚔️ ' + sv.curAtk;
    el.querySelector('.zo-ab-icon').textContent = sv.ability ? sv.ability.symbol : '';
    el.querySelector('.zo-hp').textContent = '❤️ ' + sv.curHp + '/' + sv.hp;
    el.querySelector('.zo-name').textContent = sv.orig.name;
    el.querySelector('.zo-ab-text').textContent = sv.ability ? (sv.ability.name + ' — ' + sv.ability.text) : '';
    el.style.borderColor = OV_TYPE_COLORS[sv.type] || '#888';
    el.classList.remove('hidden');
    this._positionOverlay(el, pl, z);
  }

  _positionOverlay(el, pl, z) {
    // top-RIGHT corner of the laid-down card
    const p = new THREE.Vector3(BZ.ZONE_X[z] + 0.82, 0.9, pl === 'p' ? BZ.ROW_PLAYER : BZ.ROW_BOT);
    const v = p.clone().project(this.camera);
    const x = (v.x + 1) / 2 * this.width;
    const y = (-v.y + 1) / 2 * this.height;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.transform = 'translate(-50%, -50%)';
  }

  setHighlight(sel) {
    for (const pad of this.padMeshes) {
      const { player, zone } = pad.userData;
      let color = PAD_COLORS.neutral;
      let op = 0.34;
      if (sel && sel.type === 'hand' && player === 'p') { color = PAD_COLORS.place; op = 0.55; }
      if (sel && sel.type === 'zone' && sel.zone === zone && player === 'p') { color = PAD_COLORS.sel; op = 0.6; }
      if (sel && sel.type === 'zone' && sel.zone === zone && player === 'b') { color = PAD_COLORS.front; op = 0.55; }
      pad.material.color.setHex(color);
      pad.material.opacity = op;
    }
  }

  // PLAYER HAND (FAN)
  /** handCards = [{ id, orig }] — player hand (order = index) */
  setHand(handCards, selIndex) {
    const n = handCards.length;
    // remove cards no longer in hand
    for (let i = this.handMeshes.length - 1; i >= 0; i--) {
      const m = this.handMeshes[i];
      if (!handCards.some(hc => hc.id === m.userData.cardId)) {
        this.handGroup.remove(m);
        this.handMeshes.splice(i, 1);
      }
    }
    // add/update cards
    for (let i = 0; i < n; i++) {
      const hc = handCards[i];
      const p = fanPos(n, i, BZ.HAND_Y);
      let mesh = this.handMeshes.find(m => m.userData.cardId === hc.id);
      if (!mesh) {
        mesh = buildCardMesh(hc.orig, BZ.CARD_HAND_SCALE);
        mesh.userData.kind = 'hand';
        mesh.userData.cardId = hc.id;
        mesh.userData.handIndex = i;
        mesh.userData.orig = hc.orig;
        mesh.rotation.x = -0.12;
        mesh.scale.setScalar(0.01);
        this.handGroup.add(mesh);
        this.handMeshes.push(mesh);
        // animated draw: rises from below into the fan
        mesh.position.set(p.x, BZ.HAND_Y - 1.6, BZ.HAND_Z + p.z);
        this._tween(0.45, (k) => {
          const e = easeOutCubic(k);
          mesh.position.set(p.x, BZ.HAND_Y - 1.6 + (p.y - (BZ.HAND_Y - 1.6)) * e, BZ.HAND_Z + p.z);
          mesh.rotation.y = (-Math.PI / 2) * (1 - e) + p.rotY * e;
          mesh.scale.setScalar(Math.max(0.01, e * BZ.CARD_HAND_SCALE));
        }, () => {
          mesh.rotation.y = p.rotY;
          mesh.scale.setScalar(BZ.CARD_HAND_SCALE);
        });
      }
      mesh.userData.handIndex = i;
      mesh.userData.home = { x: p.x, y: p.y, z: BZ.HAND_Z + p.z, rotY: p.rotY };
    }
    this.handMeshes.sort((a, b) => (a.userData.handIndex || 0) - (b.userData.handIndex || 0));
    this._selHand = selIndex != null ? selIndex : -1;
    this._applyHandVisual();
  }

  /** Hand visual: the hovered card moves FORWARD toward the camera,
      upright, while the others recede compressing the fan from both
      sides; the selected card lifts up. Smooth transitions. */
  _applyHandVisual() {
    const hover = this._hoverHand;
    const sel = this._selHand;
    for (const m of this.handMeshes) {
      if (m === this._dragMesh) continue; // dragged card is controlled by follow
      const h = m.userData.home;
      if (!h) continue;
      const i = m.userData.handIndex;
      let tx = h.x, ty = h.y, tz = h.z, tr = h.rotY, ts = BZ.CARD_HAND_SCALE;
      if (i === hover) {
        ty += 0.5;
        tz += 0.55;             // toward the camera
        tr = 0;                 // upright
        ts = BZ.CARD_HAND_SCALE * 1.18;
      } else if (hover >= 0) {
        // compression: pushed out in x while keeping the fan arc,
        // farther the more distant from the focused card
        const d = Math.abs(i - hover);
        const off = 0.28 + d * 0.16;
        tx += (i < hover ? -off : off);
        ty -= 0.1;
        ts = BZ.CARD_HAND_SCALE * 0.9;
      }
      if (i === sel) ty += 0.45;
      this._tween(0.22, (k) => {
        const e = easeOutCubic(k);
        m.position.x += (tx - m.position.x) * e;
        m.position.y += (ty - m.position.y) * e;
        m.position.z += (tz - m.position.z) * e;
        m.rotation.y += (tr - m.rotation.y) * e;
        m.scale.setScalar(m.scale.x + (ts - m.scale.x) * e);
      }, null, null, 'hand');
    }
    this._updateHandInfo();
  }

  /** Data badge for the HOVERED card (hover only: pressing/dragging the
      card hides it to keep the field visible). No HP bar. */
  _updateHandInfo() {
    const el = this._handInfoEl;
    const idx = this._hoverHand;
    const mesh = idx >= 0 ? this.handMeshes[idx] : null;
    if (!mesh || !mesh.userData.orig) { el.classList.add('hidden'); return; }
    const orig = mesh.userData.orig;
    const ab = orig.abilityName ? (orig.abilitySymbol + ' ' + orig.abilityName) : '';
    el.innerHTML = `<div class="hi-name">${orig.typeSymbol || ''} ${orig.name}</div>` +
      `<div class="hi-atk">⚔️ ${orig.atk} · ❤️ ${orig.hp} PV</div>` +
      (ab ? `<div class="hi-ab">${ab} — ${orig.abilityText || ''}</div>` : '');
    const v = mesh.position.clone().project(this.camera);
    let x = (v.x + 1) / 2 * this.width;
    const y = (-v.y + 1) / 2 * this.height;
    // show to measure real width, then clamp inside the screen
    // (shift toward center when the card is near an edge)
    el.classList.remove('hidden');
    const bw = el.offsetWidth || 120;
    const margin = 8;
    x = THREE.MathUtils.clamp(x, bw / 2 + margin, this.width - bw / 2 - margin);
    el.style.left = x + 'px';
    // above the card; if it would go off-screen, place it BELOW
    const bh = 90; // badge height estimate
    let top = y - 125;
    if (top - bh < 6) top = y + 105;
    top = Math.max(6, Math.min(top, this.height - bh - 6));
    el.style.top = top + 'px';
    el.style.transform = 'translate(-50%, 0)';
  }

  /** Bot hand: n card backs up top (dummyCard has the back canvas) */
  setBotHand(n, dummyCard) {
    n = Math.max(0, n || 0);
    if (!this._botHandMeshes) this._botHandMeshes = [];
    while (this._botHandMeshes.length > n) {
      const m = this._botHandMeshes.pop();
      this.botHandGroup.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    for (let i = 0; i < n; i++) {
      let m = this._botHandMeshes[i];
      // tight fan: backs close together
      const p = fanPos(n, i, BZ.BOT_HAND_Y, 0.5);
      if (!m) {
        m = buildCardMesh(dummyCard, BZ.BOT_HAND_SCALE);
        m.rotation.y = Math.PI; // card back
        m.rotation.x = -0.12;
        m.scale.setScalar(0.01);
        m.position.set(p.x, p.y - 1.2, BZ.BOT_HAND_Z + p.z);
        this.botHandGroup.add(m);
        this._botHandMeshes.push(m);
        this._tween(0.35, (k) => {
          const e = easeOutCubic(k);
          m.scale.setScalar(Math.max(0.01, e * BZ.BOT_HAND_SCALE));
          m.position.y = p.y - 1.2 + (p.y - (p.y - 1.2)) * e;
        }, () => m.position.y = p.y);
      } else {
        this._tween(0.25, (k) => {
          const e = easeOutCubic(k);
          m.position.x += (p.x - m.position.x) * e;
          m.position.y += (p.y - m.position.y) * e;
          m.position.z += (BZ.BOT_HAND_Z + p.z - m.position.z) * e;
          m.rotation.y += (Math.PI - p.rotY - m.rotation.y) * e;
        });
      }
    }
  }

  // INPUT (tap vs drag)
  _collapseBadges() {
    for (const el of this.overlayEl.querySelectorAll('.zone-ov.expanded')) {
      el.classList.remove('expanded');
    }
  }

  _bindInput() {
    const el = this.renderer.domElement;
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BZ.DRAG_PLANE_Y);
    let sx = null, sy = null, downTime = 0;
    let pressHand = null;    // pressed hand card index
    let pressZone = null;    // pressed { player, zone }
    let dragging = false;

    const toNdc = (p) => {
      const r = el.getBoundingClientRect();
      return { nx: ((p.clientX - r.left) / r.width) * 2 - 1, ny: -(((p.clientY - r.top) / r.height) * 2 - 1) };
    };
    const pick = (ndc, targets) => {
      this.raycaster.setFromCamera({ x: ndc.nx, y: ndc.ny }, this.camera);
      const hits = this.raycaster.intersectObjects(targets, false);
      return hits.length ? hits[0].object.userData : null;
    };

    this._dragPlane = dragPlane;
    this._lastP = null;
    this._dragOffset = { x: 0, z: 0 };
    // drag debug: log events for analysis
    this._debugLog = [];
    this._logDebug = (entry) => {
      this._debugLog.push(entry);
      if (this._debugLog.length > 300) this._debugLog.shift();
    };

    const down = (e) => {
      const p = e.touches ? e.touches[0] : e;
      this._lastP = p;
      // pressing hides the hover badge to keep the field visible
      if (this._hoverHand !== -1) { this._hoverHand = -1; this._applyHandVisual(); }
      sx = p.clientX; sy = p.clientY; downTime = Date.now();
      dragging = false;
      const ndc = toNdc(p);
      const targets = this.handMeshes.slice();
      for (const pl of ['p', 'b']) {
        const cm = this.cardMeshes[pl];
        for (const z of Z2) if (cm && cm[z]) targets.push(cm[z]);
      }
      targets.push(...this.padMeshes);
      const ud = pick(ndc, targets);
      if (!ud) { pressHand = null; pressZone = null; return; }
      if (ud.kind === 'hand') {
        pressHand = ud.handIndex;
        this._startDrag(pressHand); // card detaches immediately and snaps to the pivot
        this.onHandDrag(pressHand); // matchup hint: card lifted
        // long press (mobile): if the finger doesn't move, show the card
        // info badge after 450ms
        clearTimeout(this._longPressT);
        this._longPressT = setTimeout(() => {
          if (pressHand !== null && !dragging) {
            this._hoverHand = pressHand;
            this._applyHandVisual();
          }
        }, 450);
        this._logDebug({ t: Math.round(performance.now()), e: 'down', x: Math.round(p.clientX), y: Math.round(p.clientY), hand: pressHand });
      } else if (ud.kind === 'zone') {
        pressZone = { player: ud.player, zone: ud.zone };
      }
    };
    const move = (e) => {
      const p = e.touches ? e.touches[0] : e;
      this._lastP = p;
      // hover (desktop) only when no press is in progress
      if (pressHand === null && sx === null && !e.touches && e.pointerType !== 'touch') {
        const ndc = toNdc(p);
        const ud = pick(ndc, this.handMeshes);
        const idx = ud && ud.kind === 'hand' ? ud.handIndex : -1;
        if (idx !== this._hoverHand) { this._hoverHand = idx; this._applyHandVisual(); }
      }
      if (sx === null) return;
      const dx = p.clientX - sx, dy = p.clientY - sy;
      if (Math.hypot(dx, dy) > BZ.TAP_DIST) {
        if (!dragging) {
          clearTimeout(this._longPressT); // finger moved: no badge
          this._hoverHand = -1;
          this._applyHandVisual();
        }
        dragging = true;
      }
      if (pressHand !== null) {
        this._dragFollow(p);
        const m = this._dragMesh;
        if (m) {
          const v = m.position.clone().project(this.camera);
          const px = (v.x + 1) / 2 * this.width;
          const py = (-v.y + 1) / 2 * this.height;
          this._logDebug({
            t: Math.round(performance.now()), e: 'move',
            x: Math.round(p.clientX), y: Math.round(p.clientY),
            px: +px.toFixed(1), py: +py.toFixed(1),
            cz: +m.position.z.toFixed(2), cy: +m.position.y.toFixed(2),
            rotX: +m.rotation.x.toFixed(2),
          });
        }
      }
    };
    const up = (e) => {
      if (sx === null) return;
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const dx = p.clientX - sx, dy = p.clientY - sy;
      const dist = Math.hypot(dx, dy);
      const ndc = toNdc(p);
      sx = null;
      clearTimeout(this._longPressT);
      const idx = pressHand;
      if (idx !== null) {
        this._logDebug({ t: Math.round(performance.now()), e: 'up', x: Math.round(p.clientX), y: Math.round(p.clientY), dist: Math.round(dist), drag: dist >= BZ.TAP_DIST, hand: idx });
        if (dist >= BZ.TAP_DIST) {
          // drag: release over a free player pad -> place
          const ud = pick(ndc, this.padMeshes);
          this._endDrag();
          this.onHandDrag(null); // matchup hint: drag ended
          if (ud && ud.player === 'p') this.onHandDrop(idx, ud.zone);
        } else {
          // tap: back to hand and select; badge hides
          this._endDrag();
          this._hoverHand = -1;
          this._applyHandVisual();
          this.onHandTap(idx);
        }
      } else if (pressZone) {
        this.onZoneTap(pressZone.player, pressZone.zone);
      }
      pressHand = null; pressZone = null;
      dragging = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('pointermove', move);
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('pointerup', up);
    el.addEventListener('touchend', up, { passive: true });
    this._inputCleanup = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('touchend', up);
    };
  }

  _startDrag(idx) {
    const mesh = this.handMeshes[idx];
    if (!mesh) return;
    this._dragMesh = mesh;
    this._hoverHand = -1;
    this._cancelTag('hand'); // stop visual tweens: drag takes control
    // card detaches from the fan: lifts slightly (bottom pivot, so it
    // sits above the finger) and locks to the mouse in PIXELS
    mesh.rotation.y = 0;
    mesh.rotation.x = -0.2;
    this._setCardScale(mesh, BZ.DRAG_SCALE);
    mesh.position.y += 0.6;
    // TOP LAYER: the dragged card always sits above table, pads, cards
    // and badges. It must render in the TRANSPARENT pass (pads and holo
    // foil are transparent and drawn after opaque objects):
    // transparent=true + depthTest=false + renderOrder 1000 (mesh and materials)
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => { m.transparent = true; m.depthTest = false; m.renderOrder = 1000; });
    mesh.renderOrder = 1000;
    // hide zone mini badges while dragging
    for (const pl of ['p', 'b']) for (const z of Z2) {
      const el = this.ovEls[pl + '/' + z];
      if (el) el.classList.add('drag-hide');
    }
    // pixel grab offset: card projection (after detach) vs the mouse, so
    // the card follows 1:1 with no jump
    const v = mesh.position.clone().project(this.camera);
    const sx = (v.x + 1) / 2 * this.width;
    const sy = (-v.y + 1) / 2 * this.height;
    const r = this.renderer.domElement.getBoundingClientRect();
    this._dragOffsetPx = {
      x: (r.left + sx) - this._lastP.clientX,
      y: (r.top + sy) - this._lastP.clientY,
    };
  }

  /** Track the mouse 1:1 and stably: the card ALWAYS stays on the mouse
      ray (screen target = mouse + grab offset). Height (hand to flight
      plane) depends on the depth of the point at height 2.7, so a still
      mouse keeps the card still. Depth is clamped ON THE RAY (point at
      the limit z), so the projection always matches the target: no
      flicker, no explosion, no runaway. */
  _dragFollow(p) {
    const mesh = this._dragMesh;
    if (!mesh) return;
    this._lastP = p;
    const r = this.renderer.domElement.getBoundingClientRect();
    const tx = p.clientX + this._dragOffsetPx.x;
    const ty = p.clientY + this._dragOffsetPx.y;
    const ndc = { nx: ((tx - r.left) / r.width) * 2 - 1, ny: -(((ty - r.top) / r.height) * 2 - 1) };
    this.raycaster.setFromCamera({ x: ndc.nx, y: ndc.ny }, this.camera);
    const d = this.raycaster.ray.direction;
    const cam = this.camera.position;
    const tOfY = (y) => (y - cam.y) / d.y;
    const tOfZ = (z) => (z - cam.z) / d.z;
    const pointAt = (t) => new THREE.Vector3().copy(cam).addScaledVector(d, t);
    const targetY = BZ.DRAG_PLANE_Y + BZ.DRAG_PIVOT_OFFSET;
    // reference depth (at height 2.7) -> rise 0 near the hand,
    // 1 at the friendly mid-field
    const zRef = cam.z + tOfY(targetY) * d.z;
    const salita = THREE.MathUtils.clamp(1 - (zRef - BZ.DRAG_MIN_Z) / 3.4, 0, 1);
    const yDes = (1 - salita) * (BZ.HAND_Y + 0.6) + salita * targetY;
    let pos = pointAt(tOfY(yDes));
    // clamp depth ON THE RAY: never past mid-field or beyond the hand
    if (pos.z < BZ.DRAG_MIN_Z) pos = pointAt(tOfZ(BZ.DRAG_MIN_Z));
    else if (pos.z > 4.3) pos = pointAt(tOfZ(4.3));
    pos.x = THREE.MathUtils.clamp(pos.x, -4.6, 4.6);
    mesh.position.copy(pos);
    mesh.rotation.y = 0; // always upright while dragging
    // tilt synced with position
    const flatAt = BZ.DRAG_MIN_Z + 0.05;
    const zoneDist = THREE.MathUtils.clamp(1 - Math.max(0, pos.z - flatAt) / 3.1, 0, 1);
    mesh.rotation.x = THREE.MathUtils.lerp(-0.25, -Math.PI / 2 + 0.08, zoneDist);
    // pad under the real CURSOR (mouse)
    const ndcMouse = { nx: ((p.clientX - r.left) / r.width) * 2 - 1, ny: -(((p.clientY - r.top) / r.height) * 2 - 1) };
    this.raycaster.setFromCamera({ x: ndcMouse.nx, y: ndcMouse.ny }, this.camera);
    const hits = this.raycaster.intersectObjects(this.padMeshes, false);
    const ud = hits.length ? hits[0].object.userData : null;
    this._setPadHover(ud && ud.player === 'p' ? ud.zone : null);
  }

  /** Current mouse point on the flight plane */
  _mousePoint() {
    if (!this._lastP) return null;
    const el = this.renderer.domElement;
    const r = el.getBoundingClientRect();
    const nx = ((this._lastP.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((this._lastP.clientY - r.top) / r.height) * 2 - 1);
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this._dragPlane, pt)) return null;
    return pt;
  }

  _endDrag() {
    const mesh = this._dragMesh;
    this._dragMesh = null;
    this._setPadHover(null);
    // restore materials (depth test) and show mini badges
    for (const pl of ['p', 'b']) for (const z of Z2) {
      const el = this.ovEls[pl + '/' + z];
      if (el) el.classList.remove('drag-hide');
    }
    if (mesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => { m.transparent = false; m.depthTest = true; m.renderOrder = 0; });
      mesh.renderOrder = 0;
    }
    if (!mesh) return;
    // return to the fan (position from the current fan)
    const idx = this.handMeshes.indexOf(mesh);
    if (idx < 0) return;
    const n = this.handMeshes.length;
    const p = fanPos(n, idx, BZ.HAND_Y);
    this._tween(0.3, (k) => {
      const e = easeOutCubic(k);
      mesh.position.x += (p.x - mesh.position.x) * e;
      mesh.position.y += (p.y - mesh.position.y) * e;
      mesh.position.z += (BZ.HAND_Z + p.z - mesh.position.z) * e;
      mesh.rotation.y += (p.rotY - mesh.rotation.y) * e;
      mesh.rotation.x += (-0.12 - mesh.rotation.x) * e;
      // also restore scale from field (DRAG_SCALE) to the fan one
      mesh.scale.setScalar(mesh.scale.x + (BZ.CARD_HAND_SCALE - mesh.scale.x) * e);
    }, () => this._setOverlay(mesh, false), null, 'hand');
  }

  _setPadHover(zone) {
    for (const pad of this.padMeshes) {
      if (pad.userData.player === 'p') {
        pad.material.color.setHex(zone === pad.userData.zone ? PAD_COLORS.place : PAD_COLORS.neutral);
        pad.material.opacity = zone === pad.userData.zone ? 0.55 : 0.34;
      }
    }
    // matchup della carta trascinata contro la carta sul pad avversario di fronte
    let adv = null;
    const dragCard = this._dragMesh && this._dragMesh.userData.orig;
    const front = zone != null && this.cardMeshes.b && this.cardMeshes.b[zone]
      ? this.cardMeshes.b[zone].userData.orig : null;
    if (dragCard && dragCard.type && front && front.type) {
      adv = SQUER.GAME.typeAdvantage(dragCard.type, front.type); // 1 forte, -1 debole, 0 neutro
    }
    this.onPadMatchup(zone != null ? zone : null, adv);
  }

  // EVENT ANIMATIONS
  animateAttack(attackerId, targetPl, targetZone, cb) {
    const from = this._findCardMesh(attackerId);
    if (!from) { if (cb) cb(); return; }
    const basePos = from.position.clone();
    const baseRot = from.rotation.clone();
    const targetPos = this._zonePos(targetPl, targetZone).clone().setY(BZ.DRAG_PLANE_Y);
    this._tween(0.28, (k) => {
      from.position.lerpVectors(basePos, targetPos, k);
      from.position.y = basePos.y + Math.sin(k * Math.PI) * 0.9;
    }, () => {
      this._tween(0.28, (k) => {
        from.position.lerpVectors(targetPos, basePos, k);
        from.position.y = basePos.y + Math.sin((1 - k) * Math.PI) * 0.9;
      }, () => { from.rotation.copy(baseRot); if (cb) cb(); });
    });
  }

  shakeCard(player, zone) {
    const mesh = this.cardMeshes[player] && this.cardMeshes[player][zone];
    if (!mesh) return;
    const x0 = mesh.position.x;
    this._tween(0.25, (k) => { mesh.position.x = x0 + Math.sin(k * Math.PI * 3) * 0.14; });
  }

  _floatText(player, zone, yAdd, cls, text) {
    const el = document.createElement('div');
    el.className = 'dmg-floating ' + cls;
    el.textContent = text;
    this.overlayEl.appendChild(el);
    const p = this._zonePos(player, zone);
    const v = new THREE.Vector3(p.x, p.y + yAdd, p.z).project(this.camera);
    el.style.left = ((v.x + 1) / 2 * this.width) + 'px';
    el.style.top = ((-v.y + 1) / 2 * this.height) + 'px';
    setTimeout(() => el.remove(), 1400);
  }

  floatDamage(player, zone, dmg, adv) {
    this._floatText(player, zone, 1.0, adv === 1 ? 'crit' : adv === -1 ? 'weak' : '', (adv === 1 ? '×2 ' : adv === -1 ? '×0.5 ' : '') + '-' + dmg);
  }

  flashRamp(player, zone, atk) {
    this._floatText(player, zone, 1.0, 'ramp', '📈 +ATK → ' + atk);
  }

  _findCardMesh(id) {
    for (const pl of ['p', 'b']) {
      const m = this.cardMeshes[pl];
      for (const z of Z2) if (m && m[z] && m[z].userData.cardId === id) return m[z];
    }
    return null;
  }

  // EFFECTS (foil + sparkles)
  _applyEffects(card, mesh) {
    const fx = card.effects || [];
    const { w: cw, h: ch, d: cd } = mesh.userData.dims;
    for (const e of fx) {
      if (e.type === 'sparkle') {
        this._addSparkle(e, mesh, cw, ch, cd);
      } else if (e.type === 'foil' || e.type === 'contrast' || e.type === 'rainbow' || e.type === 'gold') {
        if (!card.foilCanvas) continue;
        const tex = new THREE.CanvasTexture(card.foilCanvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: e.opacity, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const inset = 3 / 512 * cw;
        const radius = 14 / 512 * cw;
        const shape = roundedRectShape(cw - inset * 2, ch - inset * 2, radius);
        const plane = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
        const REPEAT = SQUER.FOIL_REPEAT || 0.5;
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

  _addSparkle(e, mesh, cw, ch, cd) {
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
    sprite.scale.set(e.r * cw * 3.75, e.r * cw * 3.75, 1);
    sprite.position.set((e.x - 0.5) * cw * 0.85, (0.5 - e.y) * ch * 0.85, cd / 2 + 0.02);
    mesh.add(sprite);
    this.sparkles.push({ mesh: sprite, x: e.x });
  }

  _setCardScale(mesh, s) {
    mesh.scale.setScalar(s);
  }

  _setOverlay(mesh, on) {
    // compatibility placeholder (not currently used)
  }

  _onResize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    for (const pl of ['p', 'b']) for (const z of Z2) {
      const el = this.ovEls[pl + '/' + z];
      if (el && !el.classList.contains('hidden')) this._positionOverlay(el, pl, z);
    }
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    if (this._inputCleanup) this._inputCleanup();
    this.animations = [];
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    if (this.overlayEl && this.overlayEl.parentNode) this.overlayEl.parentNode.removeChild(this.overlayEl);
  }
}

SQUER.BattleScene2 = BattleScene2;

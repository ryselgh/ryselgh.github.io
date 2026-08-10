/* =========================================================
   Squer TCG - Scena 3D battaglia "Squer Clash"
   Tavolo a 3 zone con pad colorati e animati, mano del giocatore
   a VENTAGLIO (tap-to-place), mano SquerBot COPERTA che simula la
   scelta, schieramento segreto, rivelazione zona per zona.

   UX:
   - hit-plane NON ruotati, sempre verso la camera, aggiornati ogni
     frame sulla posizione della carta: il tap è deterministico anche
     con carte sovrapposte (vince la più vicina alla camera).
   - il tap seleziona la carta PREMUTA (pressIndex): l'isolamento che
     sposta la carta non cambia più il bersaglio.
   - pad di zona colorati (blu giocatore / rosso bot) con nome della
     zona e pulsazione quando si può piazzare; linea di divisione al
     centro del campo.
   - piazzamento animato (drop con overshoot) e scala portata a quella
     del campo: carte giocatore e bot hanno la STESSA dimensione.
   Dipende da: three.js, rng.js, scene.js (buildCardMesh, artBack),
   sound.js (suoni battaglia).
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});

const BZ = {
  // Camera: leggermente alta e lontana -> il tavolo si vede con un
  // angolo moderato (~27°), niente prospettiva schiacciata né carte
  // coperte dal piano del tavolo.
  CAM_Y: 6.0, CAM_Z: 11.5, CAM_LOOK_Y: 0.0, FOV: 46,
  // Tavolo: piano orizzontale a y=0; TUTTE le carte zona GIACCIONO
  // sopra (y=0.03): nessuna carta può essere coperta dal piano.
  TABLE_W: 11, TABLE_D: 7.2,
  ZONE_X: { left: -2.3, center: 0, right: 2.3 },
  ROW_BOT: -1.75,      // z della fila del bot (IN ALTO, lontano dalla camera)
  ROW_PLAYER: 1.75,    // z della fila del giocatore (IN BASSO, vicino alla camera)
  ZONE_Y: 0.03,        // carte zona: appoggiate sul tavolo (piatta)
  HAND_Y: -2.6,        // mano del giocatore: in basso, DAVANTI al tavolo
  HAND_Z: 3.2,         // (più vicina alla camera: mai coperta dal tavolo)
  BOT_HAND_Y: 3.2,     // mano del bot: dorsi in alto
  BOT_HAND_Z: 0.5,
  SHOW_Z: 0.9,         // showdown: carte bot scoperte, più vicine alla camera
  CARD_ZONE_SCALE: 0.95,   // w 1.52, h 2.14 — uguale per giocatore e bot
  CARD_HAND_SCALE: 1.15,   // w 1.84, h 2.59 — mano giocatore (più grandi)
  CARD_BOT_HAND_SCALE: 0.55, // w 0.88, h 1.24 — mano bot (dorsi)
  CARD_BOT_SHOW_SCALE: 0.85, // w 1.36, h 1.91 — showdown: carte bot ingrandite e leggibili
  PAD_W: 2.05,
  PAD_H: 2.35,
  PAD_OP: 0.34,        // opacità base pad: ben visibili sul tavolo
  // ---- hover / isolate (carta letta da sola) ----
  HOVER_LIFT_Y: 3.2,   // di quanto sale la carta isolata
  HOVER_Z_OFF: -1.5,   // di quanto avanza verso la camera
  HOVER_SCALE: 1.5,   // quanto si ingrandisce
  HOVER_EMISSIVE: 0x2a4a7a, HOVER_EMISSIVE_I: 0.45,
  NEIGHBOR_OP: 0.35, NEIGHBOR_SPREAD: 1.6, NEIGHBOR_DROP_Y: -0.2,
  // ---- selezione (tap su carta, poi tap sulla zona) ----
  SELECT_LIFT_Y: 0.28, // sollevamento della carta selezionata
  SELECT_BORDER_COLOR: 0xffc93d,  // contorno GIALL ORO attorno alla carta
  SELECT_BORDER_W: 0.07,          // spessore del contorno
  SELECT_BORDER_OPACITY: 0.95,
  // ---- drag&drop ----
  DRAG_SCALE: 0.826,   // CARD_ZONE_SCALE/CARD_HAND_SCALE: dimensioni da tavolo
  DRAG_ROT_X: -0.5,    // inclinata verso il tavolo: si vede la zona sotto
  DRAG_PLANE_Y: 1.6,   // quota del piano di volo
  DRAG_EMISSIVE: 0x000000, DRAG_EMISSIVE_I: 0,   // nessuna luce: conta la scala/pad
  OVERLAY_RENDER_ORDER: 500, // layer visibilità: SEMPRE sopra pad, ring, carte
  // ---- hover sui pad in deploy (click o drag) ----
  PAD_HOVER_COLOR: 0xffc93d,   // pad e ring GIALLI quando piazzabili
  RING_HOVER_COLOR: 0xffc93d,
  // ---- hover carte bot scoperte (showdown): zoom leggero per la lettura
  BOT_HOVER_SCALE: 1.18,       // quanto si ingrandisce la carta del bot
  BOT_HOVER_LIFT_Y: 0.25,      // di quanto si alza dal ventaglio
  BOT_HOVER_Z_OFF: -0.35,      // di quanto avanza verso la camera
  // ---- soglie input ----
  TAP_DIST: 12,                // px: sotto = tap, sopra = drag
  TAP_MAX_MS: 600,             // durata massima di un tap
};

// Tag dei tween sulle carte del bot: ogni nuova fase (copertura, mischia,
// schieramento) ANNULLA i tween bot residui, così mai due animazioni
// scrivono sullo stesso mesh (causa di carte rimaste in stati anomali).
const BOT_TAG = 'bot';

/** Posizione "a ventaglio" della carta i su n carte: arco largo con le
    carte poco sovrapposte (ogni carta espone la sua area), l'ultima
    sopra (z più verso la camera). */
function fanPos(n, i, baseY) {
  const spread = Math.min(0.55, 1.4 / Math.max(n - 1, 1));
  const r = 3.1;
  const a = (i - (n - 1) / 2) * spread;
  return {
    x: Math.sin(a) * r,
    y: baseY - (1 - Math.cos(a)) * r * 0.62,
    z: i * 0.03,
    rotY: -a,
  };
}

class BattleScene {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts; // { botTeam, onHandTap, onZoneTap, onUndeployTap, onHandHover }
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

    // luci (stesse della scena normale)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(-3, -1, -2);
    this.scene.add(rim);

    // tavolo: piano orizzontale a y=0; tutte le carte zona ci giacciono sopra
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(BZ.TABLE_W, BZ.TABLE_D),
      new THREE.MeshStandardMaterial({ color: 0x161b28, roughness: 0.9 })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.set(0, 0, 0);
    table.userData.kind = 'table';
    this.scene.add(table);

    // linea di divisione del campo (appena sopra il tavolo, no z-fighting)
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(8.4, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x39425c, transparent: true, opacity: 0.65 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.012, 0);
    this.scene.add(line);

    // stato
    this.phase = 'team';          // 'team' | 'deploy' | 'reveal'
    this.zoneRings = {};          // "side:zone" -> ring mesh
    this.zonePads = {};           // "side:zone" -> pad (plane con texture nome)
    this.playerPads = [];         // pads interattivi del giocatore
    this.zoneMeshes = {};         // "zone" -> carta giocatore piazzata
    this.botZoneMeshes = {};      // "zone" -> carta bot coperta sul tavolo
    this.handMeshes = [];         // mano del giocatore
    this.handPlanes = [];         // hit-plane (livello scena, sempre verso camera)
    this.botHandMeshes = [];      // mano bot (coperte)
    this.botTeamMeshes = [];      // le 3 carte scelte dal bot (coperte)
    this.selectedIndex = -1;
    this._isolated = -1;
    this._pressIndex = null;      // carta premuta (down): bersaglio del tap
    this._selState = null;        // { kind:'team', indices } | { kind:'single', index }
    this._hoverPad = null;        // zona del pad del giocatore sotto il cursore
    this._botZoomMesh = null;     // carta bot ingrandita dall'hover (showdown)
    this.locked = false;          // durante rivelazione/risultato: input bloccato

    this._buildField();
    this.raycaster = new THREE.Raycaster();
    this._bindTap();

    this.animations = [];
    this.clock = new THREE.Clock();
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

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._tick(dt);
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const a = this.animations[i];
      a.t += dt;
      const k = Math.min(a.t / a.dur, 1);
      a.update(k);
      if (k >= 1) {
        this.animations.splice(i, 1);
        if (a.onDone) a.onDone();
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Tick per-frame: hit-plane incollati alle carte + pulsazione pad. */
  _tick(dt) {
    this._syncPlanes();
    // pulsazione dei pad vuoti del giocatore in fase deploy
    if (this.phase === 'deploy' && !this.locked) {
      const t = this.clock.elapsedTime;
      const focus = this.selectedIndex >= 0 ? 1 : 0;
      const wave = 0.5 + 0.5 * Math.sin(t * 2.6);
      const base = BZ.PAD_OP + (focus ? 0.26 : 0.16) * wave;
      for (const z of ['left', 'center', 'right']) {
        if (this.zoneMeshes[z]) continue;
        const pad = this.zonePads['player:' + z];
        const ring = this.zoneRings['player:' + z];
        pad.material.opacity = base;
        ring.material.opacity = 0.45 + 0.4 * wave;
      }
    }
  }

  _tween(dur, update, onDone, tag) {
    this.animations.push({ t: 0, dur, update, onDone, tag: tag || null });
  }

  /** Annulla i tween con un dato tag (splice in place: sicuro anche se
      chiamato da dentro _loop/_tick). */
  _cancelTag(tag) {
    if (!tag) return;
    for (let i = this.animations.length - 1; i >= 0; i--) {
      if (this.animations[i].tag === tag) this.animations.splice(i, 1);
    }
  }

  /** Campo: pad per zona (con nome per il giocatore), anelli, linea. */
  _buildField() {
    const order = ['left', 'center', 'right'];
    for (const z of order) {
      for (const side of ['player', 'bot']) {
        const row = side === 'player' ? BZ.ROW_PLAYER : BZ.ROW_BOT;
        // pad: texture canvas (solo bordo tratteggiato, NIENTE scritte)
        const tex = this._padTexture();
        const pad = new THREE.Mesh(
          new THREE.PlaneGeometry(BZ.PAD_W, BZ.PAD_H),
          new THREE.MeshBasicMaterial({
            map: tex, transparent: true, opacity: BZ.PAD_OP, depthWrite: false,
          })
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(BZ.ZONE_X[z], 0.015, row);
        pad.userData = { kind: 'zonePad', side, zone: z, baseColor: side === 'player' ? 0x3d7bff : 0xff5d6c };
        pad.material.color.setHex(pad.userData.baseColor);
        this.scene.add(pad);
        this.zonePads[side + ':' + z] = pad;
        if (side === 'player') this.playerPads.push(pad);

        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.02, 1.14, 48),
          new THREE.MeshBasicMaterial({
            color: 0x3a4460, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
          })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(BZ.ZONE_X[z], 0.03, row);
        this.scene.add(ring);
        this.zoneRings[side + ':' + z] = ring;
      }
    }
  }

  /** Texture del pad: rettangolo bianco tenue + (per il giocatore) il
      nome della zona. Il colore vero è dato da material.color. */
  /** Pad texture: bordo tratteggiato bianco (senza scritte: i nomi
      delle zone si leggono sotto la scena). */
  _padTexture() {
    const W = 512, H = 586;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    // bordo tratteggiato
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.lineWidth = 6;
    g.setLineDash([20, 14]);
    g.strokeRect(10, 10, W - 20, H - 20);
    g.setLineDash([]);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  _makeCardMesh(card, scale) {
    const mesh = SQUER.buildCardMesh(card, scale);
    mesh.rotation.x = -0.12; // quasi verticale: leggibile in mano
    return mesh;
  }

  /** Hit-plane a livello scena (NON figlio: non eredita la rotazione),
      sempre verso la camera. Posizione aggiornata ogni frame su quella
      della carta. Il raycast è deterministico: vince la carta più
      vicina alla camera (z maggiore). */
  _addHitPlane(mesh) {
    const { w, h } = mesh.userData.dims;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.35, h * 1.35),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    plane.renderOrder = -1;
    plane.userData = { kind: 'handPlane', index: mesh.userData.index };
    this.scene.add(plane);
    this.handPlanes.push(plane);
  }

  /** Incolla i piani alle carte (posizione mondiale corrente). Chiamata
      subito dopo i layout (nessun frame di attesa) e a ogni tick.
      La carta ISOLATA (hover) NON sposta il suo piano: la carta sale in
      alto/ingrandita ma il piano resta alla home, così il cursore che
      l'ha raggiunta non la "perde" mai (niente flicker isolate/de-isolate). */
  _syncPlanes() {
    const n = Math.min(this.handPlanes.length, this.handMeshes.length);
    for (let i = 0; i < n; i++) {
      if (i === this._isolated) continue;   // hover: piano ancorato alla home
      this.handPlanes[i].position.copy(this.handMeshes[i].getWorldPosition());
    }
  }

  /** Layer di visibilità SUPERIORE per una carta: la porta nella passata
      trasparente con renderOrder altissimo, così si disegna SEMPRE sopra
      pad, cerchi, tratteggi e altre carte (mai compenetrata/tagliata).
      on=true attiva, on=false ripristina i materiali originali. */
  _setOverlay(mesh, on) {
    if (!mesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (on) {
      if (!mesh.userData._ovBase) {
        mesh.userData._ovBase = {
          renderOrder: mesh.renderOrder,
          mats: mats.map(m => ({ transparent: m.transparent, depthTest: m.depthTest, opacity: m.opacity })),
        };
      }
      for (const m of mats) {
        m.transparent = true;   // passata trasparente: sopra gli opachi
        m.depthTest = false;    // mai occlusa
        m.opacity = 1;
      }
      mesh.renderOrder = BZ.OVERLAY_RENDER_ORDER;
    } else if (mesh.userData._ovBase) {
      const base = mesh.userData._ovBase;
      mats.forEach((m, k) => {
        const b = base.mats[k] || base.mats[0];
        m.transparent = b.transparent;
        m.depthTest = b.depthTest;
        m.opacity = b.opacity;
      });
      mesh.renderOrder = base.renderOrder;
      delete mesh.userData._ovBase;
    }
  }

  /** Pad del giocatore sotto il cursore (per l'evidenziazione gialla
      quando è piazzabile). Ritorna la zona o null. */
  _hoverPadAt(nx, ny) {
    if (!this.playerPads.length) return null;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hits = this.raycaster.intersectObjects(this.playerPads, false);
    return hits.length ? hits[0].object.userData.zone : null;
  }

  /** Crea il contorno giallo attorno alla carta (anello con lo stesso
      profilo arrotondato della carta, leggermente più grande). */
  _makeSelectBorder(mesh) {
    const { w, h, d } = mesh.userData.dims;
    const T = BZ.SELECT_BORDER_W;
    const r = 14 / 512 * w;
    const outer = SQUER.roundedRectShape(w + T * 2, h + T * 2, r + T);
    const inner = SQUER.roundedRectShape(w, h, r);
    outer.holes.push(inner);
    const geo = new THREE.ExtrudeGeometry(outer, { depth: 0.02, bevelEnabled: false });
    geo.translate(0, 0, -0.01);   // centra sullo spessore
    const mat = new THREE.MeshBasicMaterial({
      color: BZ.SELECT_BORDER_COLOR,
      transparent: true,
      opacity: BZ.SELECT_BORDER_OPACITY,
      depthTest: true,            // anello ESTERNO: non copre mai l'arte,
      depthWrite: false,          // si lascia occludere da carte vicine
    });
    const border = new THREE.Mesh(geo, mat);
    border.renderOrder = BZ.OVERLAY_RENDER_ORDER;  // passata trasparente in coda
    // z centrato nello spessore: il buco dell'anello lascia vedere l'arte
    return border;
  }

  /** Attiva/spegne il contorno giallo della carta selezionata. */
  _setSelectBorder(mesh, on) {
    if (!mesh) return;
    const cur = mesh.userData.selectBorder || null;
    if (on && !cur) {
      const b = this._makeSelectBorder(mesh);
      mesh.add(b);
      mesh.userData.selectBorder = b;
    } else if (!on && cur) {
      mesh.remove(cur);
      if (cur.geometry) cur.geometry.dispose();
      if (cur.material) cur.material.dispose();
      mesh.userData.selectBorder = null;
    }
  }

  /** Smaltisce geometry/materiali (anche dei figli). */
  _disposeMesh(m) {
    for (const c of m.children) this._disposeMesh(c);
    if (m.geometry) m.geometry.dispose();
    if (Array.isArray(m.material)) m.material.forEach(x => x.dispose());
    else if (m.material) m.material.dispose();
  }

  // ---------- setup fasi ----------

  /** Fase scelta squadra: mano del giocatore a VENTAGLIO. */
  showHand(hand) {
    this._clearHand();
    this.phase = 'team';
    hand.forEach((card, i) => {
      const mesh = this._makeCardMesh(card, BZ.CARD_HAND_SCALE);
      mesh.userData.kind = 'hand';
      mesh.userData.index = i;
      mesh.userData.card = card;
      this.scene.add(mesh);
      this.handMeshes.push(mesh);
      this._addHitPlane(mesh);
    });
    this._layoutHand();
  }

  /** Ridistribuisce la mano a ventaglio (dopo piazzamenti/rimozioni). */
  _layoutHand() {
    const n = this.handMeshes.length;
    this.handMeshes.forEach((m, i) => {
      const p = fanPos(n, i, BZ.HAND_Y);
      m.userData.home = {
        x: p.x, y: p.y, z: BZ.HAND_Z + p.z, rotY: p.rotY, rotX: -0.12,
      };
    });
    this._applyHandVisual();
  }

  /** Fase deploy iniziata (il giocatore piazza le carte): i pad vuoti
      pulsano per invitare al piazzamento. */
  beginDeploy() {
    this.phase = 'deploy';
    this.selectedIndex = -1;
    this._selState = null;
  }

  /** Fase rivelazione: i pad smettono di pulsare. */
  beginReveal() {
    this.phase = 'reveal';
    for (const z of ['left', 'center', 'right']) {
      const pad = this.zonePads['player:' + z];
      if (!this.zoneMeshes[z]) {
        pad.material.opacity = BZ.PAD_OP;
        pad.material.color.setHex(pad.userData.baseColor);
      }
      this.zoneRings['player:' + z].material.opacity = 0.5;
    }
  }

  /** Mano SquerBot: 5 carte COPERTE a ventaglio in alto. */
  showBotHand(hand) {
    this._clearBotHand();
    const n = hand.length;
    hand.forEach((card, i) => {
      const mesh = this._makeCardMesh(card, BZ.CARD_BOT_HAND_SCALE);
      const p = fanPos(n, i, BZ.BOT_HAND_Y);
      mesh.position.set(p.x, p.y, BZ.BOT_HAND_Z + p.z);
      mesh.rotation.y = Math.PI;   // coperta: si vede solo il dorso
      mesh.rotation.x = -0.12;
      mesh.userData.kind = 'botHand';
      mesh.userData.index = i;
      mesh.userData.card = card;
      mesh.userData.home = { x: p.x, y: p.y, z: BZ.BOT_HAND_Z + p.z, rotY: Math.PI, rotX: -0.12 };
      this.scene.add(mesh);
      this.botHandMeshes.push(mesh);
    });
  }

  /** Simula la scelta di SquerBot: le carte scelte si alzano una alla
      volta (con suono), le altre 2 svaniscono. Restano tutte coperte. */
  botPick(indices, onDone) {
    this._botChosen = indices.slice().sort((a, b) => a - b);
    const tok = { cancelled: false };
    this._botPickToken = tok;
    const ms = this.botHandMeshes;
    const chosen = this._botChosen;
    const steps = [];
    chosen.forEach((idx, k) => {
      steps.push((next) => setTimeout(() => {
        if (tok.cancelled) return;
        const m = ms[idx];
        if (!m) { next(); return; }
        SQUER.sound.click();
        this._tween(0.24, (t) => {
          m.position.y = m.userData.home.y + t * 0.38;
          m.scale.setScalar(1 + t * 0.16);
        }, next, BOT_TAG);
      }, 900 + k * 480));
    });
    steps.push((next) => {
      setTimeout(() => {
        if (tok.cancelled) return;
        ms.forEach((m, i) => {
          if (chosen.indexOf(i) < 0) {
            this._tween(0.22, (t) => { setOpacity(m, 1 - t); }, () => {
              this.scene.remove(m);
              this._disposeMesh(m);
            }, BOT_TAG);
          }
        });
        this.botHandMeshes = ms.filter((m, i) => chosen.indexOf(i) >= 0);
        this.botTeamMeshes = this.botHandMeshes.slice();
        setTimeout(next, 320);
      }, 200);
    });
    let k = 0;
    const run = () => {
      if (k < steps.length) steps[k++](run);
      else if (onDone && !tok.cancelled) onDone();
    };
    run();
  }

  /** Annulla la simulazione (es. giocatore conferma subito):
      restano solo le 3 carte scelte, coperte.
      ATTENZIONE al filtro: gli indici in _botChosen si riferiscono alla
      MANO ORIGINALE (5 carte). Se botPick ha GIÀ filtrato la mano a 3,
      iterare con forEach(i) ri-userebbe gli indici originali sull'array
      filtrato e RIMUOVEREBBE per errore una carta scelta (es. chosen
      [1,3,4] -> resta 2 carte: il bug della carta bot "invisibile"). */
  botPickCancel() {
    if (this._botPickToken) this._botPickToken.cancelled = true;
    const chosen = this._botChosen || [];
    if (!chosen.length) return;
    if (this.botHandMeshes.length <= chosen.length) return;  // già filtrata
    this.botHandMeshes.forEach((m, i) => {
      if (chosen.indexOf(i) < 0) {
        this.scene.remove(m);
        this._disposeMesh(m);
      }
    });
    this.botHandMeshes = this.botHandMeshes.filter((m, i) => chosen.indexOf(i) >= 0);
    this.botTeamMeshes = this.botHandMeshes.slice();
  }

  // ---------- showdown & mischia ----------

  /** Riduce la mano del bot alle 3 carte della squadra (se la scelta
      simulata non ha fatto in tempo a completarsi) e le scopre a
      VENTAGLIO in alto: lo "showdown" del GDD — entrambe le squadre
      sono visibili, poi parte il countdown per memorizzarle. */
  beginShowdown() {
    // annulla i tween di selezione residui (alzate/svanimenti se il
    // giocatore ha confermato durante la scelta del bot): mai due
    // animazioni sullo stesso mesh
    this._cancelTag(BOT_TAG);
    this._resetBotZoom();   // via l'eventuale zoom hover residuo
    const team = this.opts.botTeam || [];
    const keep = this.botTeamMeshes.filter(m => team.indexOf(m.userData.card) >= 0);
    for (const m of this.botTeamMeshes) {
      if (keep.indexOf(m) >= 0) continue;
      this.scene.remove(m);
      this._disposeMesh(m);
    }
    this.botTeamMeshes = keep;
    this.botHandMeshes = keep.slice();
    this.phase = 'showdown';
    keep.forEach((m, i) => {
      const p = fanPos(3, i, BZ.BOT_HAND_Y);
      const from = m.position.clone();
      const fromScale = m.scale.x;
      const target = { x: p.x, y: p.y, z: BZ.SHOW_Z + p.z };
      const targetScale = BZ.CARD_BOT_SHOW_SCALE / BZ.CARD_BOT_HAND_SCALE;
      m.userData.home = {
        x: p.x, y: p.y, z: BZ.SHOW_Z + p.z, rotY: 0, rotX: -0.12,
        scale: targetScale,   // per l'hover-zoom (ripristino esatto)
      };
      m.userData.kind = 'botShown';
      // geometria a CARD_BOT_HAND_SCALE: scala mesh verso lo showdown size
      SQUER.sound.flip();
      this._tween(0.45, (t) => {
        const e = easeOutCubic(t);
        m.position.lerpVectors(from, target, e);
        m.scale.setScalar(fromScale + (targetScale - fromScale) * e);
        m.rotation.y = Math.PI * (1 - e);   // π -> 0: si scopre
        m.rotation.x = -0.12;
      }, null, BOT_TAG);
    });
  }

  /** Copre le 3 carte del bot e le MISCHIA sul tavolo: gli scambi sono
      animati ma l'ordine finale è una permutazione casuale decisa dal
      gioco (lo shuffle avversario è scenico: l'utente non può seguire
      le posizioni reali, e non deve sapere dove finisce ogni carta).
      Annulla i tween bot residui (es. scoprimento interrotto dal timer
      scaduto) e copre partendo dalla rotazione ATTUALE: nessuna carta
      può restare di faccia né in uno stato anomalo. */
  coverAndShuffle(onDone) {
    const ms = this.botTeamMeshes.slice();
    if (!ms.length) { if (onDone) onDone(); return; }
    this.locked = true;   // input bloccato durante la mischia
    this._cancelTag(BOT_TAG);
    const n = ms.length;
    const step = (k) => {
      if (k >= n) {
        // tutte coperte: ora la permutazione finale
        this._permutePositions(ms, () => {
          this.locked = false;
          if (onDone) onDone();
        });
        return;
      }
      const m = ms[k];
      const fromRot = m.rotation.y;
      SQUER.sound.flip();
      this._tween(0.28, (t) => {
        m.rotation.y = fromRot + (Math.PI - fromRot) * t;  // -> π: si copre
        m.rotation.x = -0.12;
      }, () => {
        m.rotation.y = Math.PI;   // esatto: la carta è coperta, mai di taglio
        m.rotation.x = -0.12;
        step(k + 1);
      }, BOT_TAG);
    };
    step(0);
  }

  /** Scambia le posizioni (home) delle carte coperte con un percorso
      animato che si incrocia al centro del campo: all'arrivo le carte
      sono in ordine casuale (garantito: nessuna carta resta dov'era).
      La logica usa botZones (zona->carta), quindi le posizioni finali
      non contano per il gioco: conta solo che siano illeggibili. */
  _permutePositions(ms, onDone) {
    const n = ms.length;
    const pos = ms.map(m => ({ ...m.userData.home }));
    const target = pos.slice();
    // derangement: permutazione casuale senza punti fissi
    let guard = 0;
    do {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = target[i]; target[i] = target[j]; target[j] = tmp;
      }
      guard++;
    } while (target.every((p, i) => Math.abs(p.x - pos[i].x) < 0.01) && guard < 20);
    // percorsi incrociati: ogni carta va verso la sua posizione finale
    // passando dal centro del campo (le carte si "incontrano" = mischia)
    let done = 0;
    ms.forEach((m, i) => {
      const to = target[i];
      m.userData.home = to;
      const from = m.position.clone();
      const mid = new THREE.Vector3((from.x + to.x) / 2, BZ.BOT_HAND_Y - 0.5, BZ.SHOW_Z - 0.3);
      // salvaguardia: mai invisibile (tween residui potevano lasciare
      // opacità/scala anomale sulla carta)
      m.visible = true;
      if (m.material) setOpacity(m, 1);
      SQUER.sound.swish();
      this._tween(0.5, (t) => {
        const e = easeInOutCubic(t);
        const a = new THREE.Vector3().lerpVectors(from, mid, e);
        const b = new THREE.Vector3().lerpVectors(mid, { x: to.x, y: to.y, z: to.z }, e);
        m.position.lerpVectors(a, b, e);
        m.rotation.x = -0.12;
      }, () => {
        // onDone solo alla fine reale dell'ULTIMA carta (niente dummy:
        // prima, il deploy partiva con timing approssimato)
        if (++done === n) onDone();
      }, BOT_TAG);
    });
  }

  /** Fase schieramento bot: le 3 carte scelte scendono sulle zone
      secondo la mappa botZones (zona -> carta), sempre coperte,
      con drop a scala (dimensione campo) e partenza scaglionata. */
  startDeploy(botZones) {
    this._cancelTag(BOT_TAG);   // residui della mischia: stato stabile
    this._resetBotZoom();       // il deploy blocca l'hover-zoom bot
    const order = ['left', 'center', 'right'];
    order.forEach((z, k) => {
      const card = botZones && botZones[z];
      const mesh = card
        ? this.botTeamMeshes.find(m => m.userData.card === card)
        : null;
      if (!mesh) return;
      mesh.userData.kind = 'botZone';
      mesh.userData.zone = z;
      const to = new THREE.Vector3(BZ.ZONE_X[z], BZ.ZONE_Y, BZ.ROW_BOT);
      const from = mesh.position.clone();
      const scaleTo = BZ.CARD_ZONE_SCALE / BZ.CARD_BOT_HAND_SCALE;
      const stagger = (SQUER.CONFIG && SQUER.CONFIG.BOT_DEPLOY_STAGGER) || 450;
      setTimeout(() => {
        if (this._disposed) return;
        SQUER.sound.place();
        // salvaguardia: la carta parte visibile (mai "sparita")
        mesh.visible = true;
        if (mesh.material) setOpacity(mesh, 1);
        const s0 = mesh.scale.x;   // parte dalla scala attuale (es. dopo lo showdown)
        // rotazione di partenza: eretta (hand/shuffle); arrivo: PIATTA
        // sul tavolo, coperta (rotY π = dorso in alto)
        const rotFrom = mesh.rotation.x;
        this._tween(0.4, (t) => {
          const e = easeOutBack(t);
          mesh.position.lerpVectors(from, to, e);
          mesh.scale.setScalar(s0 + (scaleTo - s0) * e);
          mesh.rotation.x = rotFrom + (-Math.PI / 2 - rotFrom) * e;
          mesh.rotation.y = Math.PI;
        }, () => {
          mesh.rotation.x = -Math.PI / 2;   // esatto: piatto sul tavolo
          this.botZoneMeshes[z] = mesh;
        }, 'deploy');
      }, k * stagger);
    });
  }

  // ---------- interazione del giocatore ----------

  /** Fase squadra: evidenzia i N indici scelti (le altre si attenuano). */
  setTeamSelection(indices) {
    this._selState = { kind: 'team', indices };
    this._applyHandVisual();
  }

  /** Fase deploy: evidenzia la singola carta selezionata. */
  setSelected(index) {
    this.selectedIndex = index;
    this._selState = { kind: 'single', index };
    this._applyHandVisual();
  }

  /** Isola temporaneamente la carta i (hover/press): più grande e davanti,
      le altre si attenuano. -1 = nessuna isolata. */
  isolate(i) {
    if (this._isolated === i) return;
    this._isolated = i;
    this._applyHandVisual();
    if (this.opts.onHandHover) this.opts.onHandHover(i);
  }

  /** Applica lo stato visivo: selezione + isolamento. */
  _applyHandVisual() {
    const iso = this._isolated;
    this.handMeshes.forEach((mesh, i) => {
      const h = mesh.userData.home;
      let sel = false;
      if (this._selState && this._selState.kind === 'team') sel = this._selState.indices.indexOf(i) >= 0;
      else if (this._selState && this._selState.kind === 'single') sel = i === this._selState.index;

      let y = h.y + (sel ? BZ.SELECT_LIFT_Y : 0);
      let z = h.z;
      let x = h.x;
      let rotY = h.rotY;
      let rotX = h.rotX;
      let s = 1;
      let op = 1;
      let emis = 0x000000, emisI = 0;
      let overlay = false;
      if (iso === i) {
        // isolamento: carta SPINTA IN ALTO e MOLTO più grande, dritta
        // (può coprire momentaneamente il campo: l'utente la legge comoda).
        // L'hit-plane della carta isolata NON la segue (vedi _syncPlanes):
        // resta alla home, così il cursore non perde mai il bersaglio
        // e non c'è flicker isolate/de-isolate.
        // LAYER SUPERIORE: la carta ingrandita non deve compenetrare il
        // tavolo -> overlay (vedi _setOverlay).
        y = h.y + BZ.HOVER_LIFT_Y;
        z = h.z + BZ.HOVER_Z_OFF;
        rotY = 0;
        rotX = -0.12;
        s = BZ.HOVER_SCALE;      // molto più grande: ben leggibile
        emis = BZ.HOVER_EMISSIVE; emisI = BZ.HOVER_EMISSIVE_I;
        overlay = true;
      } else if (sel) {
        // carta selezionata (tap su carta, poi tap sulla zona):
        // il contorno giallo (vedi _setSelectBorder a fine loop)
        // dice che è piazzabile; niente emissive, resta leggibile
      } else if (iso >= 0) {
        op = 0.5;
      }
      mesh.position.x = x;
      mesh.position.y = y;
      mesh.position.z = z;
      mesh.rotation.y = rotY;
      mesh.rotation.x = rotX;
      mesh.scale.set(s, s, s);
      setOpacity(mesh, op);
      mesh.userData.frontMat.emissive.setHex(emis);
      mesh.userData.frontMat.emissiveIntensity = emisI;
      this._setOverlay(mesh, overlay);
      // contorno giallo: attivo finché la carta è selezionata
      // (si spegne da solo quando la piazzi: _selState = null)
      this._setSelectBorder(mesh, sel);
    });
    this._syncPlanes();
  }

  /** Piazzamento: la carta vola dalla mano allo slot (drop animato,
      scala portata a quella del campo: uguale alle carte del bot). */
  deployPlayer(zone, card, handIndex) {
    const mesh = this.handMeshes[handIndex];
    if (!mesh) return;
    const plane = this.handPlanes[handIndex];
    this.handMeshes.splice(handIndex, 1);
    this.handPlanes.splice(handIndex, 1);
    this.scene.remove(mesh);
    if (plane) {
      this.scene.remove(plane);
      this._disposeMesh(plane);
    }
    mesh.rotation.y = 0;
    this._setSelectBorder(mesh, false);  // in campo: niente contorno giallo
    mesh.userData.kind = 'playerZone';
    mesh.userData.zone = zone;
    mesh.userData.card = card;
    const from = mesh.position.clone();
    const to = new THREE.Vector3(BZ.ZONE_X[zone], BZ.ZONE_Y, BZ.ROW_PLAYER);
    const scaleTo = BZ.CARD_ZONE_SCALE / BZ.CARD_HAND_SCALE;
    const rotFrom = mesh.rotation.x;   // eretta in mano -> PIATTA sul tavolo
    this.zoneMeshes[zone] = mesh; // occupato SUBITO: niente doppi tap sul pad
    this.scene.add(mesh);
    SQUER.sound.place();
    this._tween(0.34, (t) => {
      const e = easeOutBack(t);
      mesh.position.lerpVectors(from, to, e);
      mesh.scale.setScalar(1 + (scaleTo - 1) * e);
      mesh.rotation.x = rotFrom + (-Math.PI / 2 - rotFrom) * e;
      mesh.rotation.y = 0;
    }, () => {
      mesh.rotation.x = -Math.PI / 2;   // esatto: piatto sul tavolo
      this._setPadOccupied('player', zone);
    });
    this.selectedIndex = -1;
    this._selState = null;
    this._layoutHand();
  }

  /** Rimozione: la carta torna in mano (scala mano + ri-ventaglio). */
  undeployPlayer(zone) {
    const mesh = this.zoneMeshes[zone];
    if (!mesh) return;
    this.zoneMeshes[zone] = null;
    this.scene.remove(mesh);
    mesh.userData.kind = 'hand';
    mesh.scale.setScalar(1);
    this.handMeshes.push(mesh);
    this._addHitPlane(mesh);
    this.handMeshes.forEach((m, i) => {
      m.userData.index = i;
    });
    this._layoutHand();
    this._setPadFree('player', zone);
    SQUER.sound.remove();
    if (this.opts.onUndeploy) this.opts.onUndeploy(zone);
  }

  _setPadOccupied(side, zone) {
    const pad = this.zonePads[side + ':' + zone];
    pad.material.opacity = 0.55;
    pad.material.color.setHex(0xffc93d);
    this.zoneRings[side + ':' + zone].material.color.setHex(0xffc93d);
    this.zoneRings[side + ':' + zone].material.opacity = 0.85;
  }

  _setPadFree(side, zone) {
    const pad = this.zonePads[side + ':' + zone];
    pad.material.opacity = BZ.PAD_OP;
    pad.material.color.setHex(pad.userData.baseColor);
    this.zoneRings[side + ':' + zone].material.color.setHex(0x3a4460);
    this.zoneRings[side + ':' + zone].material.opacity = 0.5;
  }

  /** Evidenzia GIALLI pad+cerchio sotto il cursore quando sono piazzabili
      (carta selezionata per tap, oppure carta in trascinamento). zone=null
      spegne l'evidenziazione corrente. */
  _setPadHover(zone) {
    if (this._hoverPad === zone) return;
    if (this._hoverPad !== null) this._restorePad('player', this._hoverPad);
    this._hoverPad = zone;
    if (zone === null) return;
    const pad = this.zonePads['player:' + zone];
    const ring = this.zoneRings['player:' + zone];
    pad.material.color.setHex(BZ.PAD_HOVER_COLOR);
    pad.material.opacity = 0.85;
    ring.material.color.setHex(BZ.RING_HOVER_COLOR);
    ring.material.opacity = 1;
  }

  /** Riporta pad+cerchio allo stato libero/occupato corrente. */
  _restorePad(side, zone) {
    if (this.zoneMeshes[zone]) this._setPadOccupied(side, zone);
    else this._setPadFree(side, zone);
  }

  // ---------- rivelazione ----------

  /** Rivela la zona: flip della carta bot + impatto + risultato. */
  revealZone(zone, result, onDone) {
    this.locked = true;
    const mesh = this.botZoneMeshes[zone];
    const done = () => {
      this.zoneOutcome(zone, result);
      if (onDone) onDone();
    };
    if (!mesh) { done(); return; }
    // la carta bot è PIATTA sul tavolo (rotX -π/2, rotY π = dorso sopra):
    // il flip la fa alzare in piedi e girare verso il giocatore (rotY 0)
    mesh.rotation.y = Math.PI;
    mesh.rotation.x = -Math.PI / 2;
    SQUER.sound.flip();
    this._tween(0.5, (k) => {
      const e = easeOutBack(k);
      mesh.rotation.y = Math.PI * (1 - e);                 // π -> 0: si scopre
      mesh.rotation.x = -Math.PI / 2 + (Math.PI / 2 - 0.12) * e; // -> in piedi
      mesh.position.y = BZ.ZONE_Y + (1.15 - BZ.ZONE_Y) * e;      // si alza
    }, () => {
      SQUER.sound.hit();
      const w = mesh.position.y;
      this._tween(0.5, (k) => {
        mesh.position.y = w + Math.sin(k * Math.PI) * 0.35;
      }, done);
    });
  }

  /** Esito zona: pad/ring verde per chi vince, rosso per chi perde,
      grigio per pari; la carta vincente si solleva. */
  zoneOutcome(zone, result) {
    const pWin = result.winner === 'a';
    const bWin = result.winner === 'b';
    const pCol = pWin ? 0x3ddc84 : (bWin ? 0xff4d5e : 0x8a93a8);
    const bCol = bWin ? 0x3ddc84 : (pWin ? 0xff4d5e : 0x8a93a8);
    for (const [side, col] of [['player', pCol], ['bot', bCol]]) {
      const pad = this.zonePads[side + ':' + zone];
      const ring = this.zoneRings[side + ':' + zone];
      pad.material.color.setHex(col);
      pad.material.opacity = 0.4;
      ring.material.color.setHex(col);
      ring.material.opacity = 0.9;
    }
    const pMesh = this.zoneMeshes[zone];
    const bMesh = this.botZoneMeshes[zone];
    if (pWin && pMesh) pMesh.position.y = BZ.ZONE_Y + 0.15;   // carta giocatore: piatta, si solleva
    if (bWin && bMesh) bMesh.position.y += 0.15;              // carta bot: in piedi, si solleva
  }

  // ---------- pulizia ----------

  _clearHand() {
    for (const m of this.handMeshes) {
      this.scene.remove(m);
      this._disposeMesh(m);
    }
    for (const p of this.handPlanes) {
      this.scene.remove(p);
      this._disposeMesh(p);
    }
    this.handMeshes = [];
    this.handPlanes = [];
    this.selectedIndex = -1;
    this._isolated = -1;
    this._selState = null;
  }

  _clearBotHand() {
    this._resetBotZoom();   // via lo zoom hover (i mesh stanno per sparire)
    for (const m of this.botHandMeshes) {
      this.scene.remove(m);
      this._disposeMesh(m);
    }
    for (const m of this.botTeamMeshes) {
      this.scene.remove(m);
      this._disposeMesh(m);
    }
    this.botHandMeshes = [];
    this.botTeamMeshes = [];
    this.botZoneMeshes = {};
  }

  // ---------- tap ----------

  /** Carta della mano sotto il punto (hit-plane, deterministico):
      il primo piano colpito è la carta più vicina alla camera. */
  _handAt(nx, ny) {
    if (!this.handPlanes.length) return null;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hits = this.raycaster.intersectObjects(this.handPlanes, false);
    return hits.length ? this.handPlanes.indexOf(hits[0].object) : null;
  }

  /** Carta del bot sotto il cursore (showdown, carte scoperte): il
      raycast usa i MESH veri, così l'hover è preciso sulla sagoma. */
  _hoverBotAt(nx, ny) {
    if (!this.botTeamMeshes.length) return null;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hits = this.raycaster.intersectObjects(this.botTeamMeshes, false);
    return hits.length ? hits[0].object.userData.card : null;
  }

  /** Hover sulle carte bot scoperte (showdown): la carta sotto il cursore
      si ingrandisce LEGGERMENTE e avanza verso la camera per la lettura,
      in overlay (mai compenetrata col tavolo/pad/altre carte). Chiamata
      con (nx, ny): aggiorna o ripristina. Il mesh di partenza dell'hover
      è la "home" salvata in beginShowdown. */
  _hoverBotZoom(nx, ny) {
    // bersaglio: mesh bot sotto il cursore (o nessuno)
    let target = null;
    if (this.botTeamMeshes.length) {
      this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
      const hits = this.raycaster.intersectObjects(this.botTeamMeshes, false);
      if (hits.length) target = hits[0].object;
    }
    if (target === this._botZoomMesh) return;   // già a posto
    // ripristina quella precedente (se diversa o uscita dal cursore)
    const prev = this._botZoomMesh;
    if (prev && prev.userData.home) {
      const h = prev.userData.home;
      const px = prev.position.x, py = prev.position.y, pz = prev.position.z;
      const ps = prev.scale.x;
      this._cancelTag('botzoom');
      this._tween(0.16, (t) => {
        const e = easeOutCubic(t);
        prev.position.x = px + (h.x - px) * e;
        prev.position.y = py + (h.y - py) * e;
        prev.position.z = pz + (h.z - pz) * e;
        prev.scale.setScalar(ps + (h.scale - ps) * e);
        prev.rotation.y = 0;
      }, () => this._setOverlay(prev, false), 'botzoom');
    }
    this._botZoomMesh = target;
    if (!target) return;
    // ingrandisci la nuova carta (interpola dalla posizione ATTUALE:
    // anche se la scopertura è ancora in corso, nessun salto visivo)
    const h = target.userData.home;
    if (!h) return;
    const sx = target.position.x, sy = target.position.y, sz = target.position.z;
    const ss = target.scale.x;
    this._setOverlay(target, true);
    this._tween(0.16, (t) => {
      const e = easeOutCubic(t);
      target.position.x = sx + (h.x - sx) * e;
      target.position.y = sy + (h.y + BZ.BOT_HOVER_LIFT_Y - sy) * e;
      target.position.z = sz + (h.z + BZ.BOT_HOVER_Z_OFF - sz) * e;
      target.scale.setScalar(ss + (h.scale * BZ.BOT_HOVER_SCALE - ss) * e);
      target.rotation.y = 0;
    }, null, 'botzoom');
  }

  /** Azzera l'hover-zoom delle carte bot (uscita dal campo / cambio fase). */
  _resetBotZoom() {
    const prev = this._botZoomMesh;
    if (prev && prev.userData.home) {
      const h = prev.userData.home;
      const sx = prev.position.x, sy = prev.position.y, sz = prev.position.z;
      const ss = prev.scale.x;
      this._cancelTag('botzoom');
      this._tween(0.16, (t) => {
        const e = easeOutCubic(t);
        prev.position.x = sx + (h.x - sx) * e;
        prev.position.y = sy + (h.y - sy) * e;
        prev.position.z = sz + (h.z - sz) * e;
        prev.scale.setScalar(ss + (h.scale - ss) * e);
        prev.rotation.y = 0;
      }, () => this._setOverlay(prev, false), 'botzoom');
    }
    this._botZoomMesh = null;
  }

  _bindTap() {
    const el = this.renderer.domElement;
    let sx = null, sy = null;
    let downTime = 0;
    let touchActive = false;
    let dragIndex = null;       // carta della mano trascinata (fase deploy)
    let dragging = false;       // superata la soglia di movimento
    const toNdc = (p) => {
      const r = el.getBoundingClientRect();
      return {
        nx: ((p.clientX - r.left) / r.width) * 2 - 1,
        ny: -(((p.clientY - r.top) / r.height) * 2 - 1),
      };
    };
    // piano su cui "vola" la carta trascinata: orizzontale, in alto
    // (y=1.6: la carta è alta ~2.6, così resta SEMPRE intera sopra il
    // tavolo; il layer depthTest=false in _startDrag la tiene comunque
    // visibile sopra pad e carte piazzate)
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.6);
    const _dragFollow = (ndc) => {
      const m = this.handMeshes[dragIndex];
      if (!m) return;
      this.raycaster.setFromCamera({ x: ndc.nx, y: ndc.ny }, this.camera);
      const pt = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(dragPlane, pt)) return;
      pt.x = THREE.MathUtils.clamp(pt.x, -4.4, 4.4);
      pt.z = THREE.MathUtils.clamp(pt.z, -2.4, 2.4);
      m.position.set(pt.x, pt.y, pt.z);
    };
    const _startDrag = (idx) => {
      dragIndex = idx;
      dragging = true;
      this._isolated = -1;      // niente hover/attenuazioni durante il drag
      this._applyHandVisual();  // prima: riporta tutte a casa (le altre si attenuano)
      const m = this.handMeshes[idx];
      if (m) {
        m.rotation.y = 0;
        // INCLINATA verso il tavolo + DIMENSIONI da campo: l'utente vede
        // bene la zona sotto la carta (dove la rilascia).
        m.rotation.x = BZ.DRAG_ROT_X;
        m.scale.setScalar(BZ.DRAG_SCALE);
        // LAYER SUPERIORE: depthTest false + passata trasparente con
        // renderOrder altissimo -> SEMPRE sopra pad, cerchi e tratteggi
        // (mai compenetrata, mai tagliata, mai dietro ai contorni).
        setOpacity(m, 1);       // mai trasparente durante il drag
        this._setOverlay(m, true);
        if (m.userData.frontMat) {
          m.userData.frontMat.emissive.setHex(BZ.DRAG_EMISSIVE);
          m.userData.frontMat.emissiveIntensity = BZ.DRAG_EMISSIVE_I;
        }
      }
    };
    const _endDrag = (ndc) => {
      if (dragIndex === null) return;
      const idx = dragIndex;
      const m = this.handMeshes[idx];
      // rilasciata sopra un pad LIBERO del giocatore -> piazzala
      if (m && ndc && this.phase === 'deploy' && !this.locked) {
        this.raycaster.setFromCamera({ x: ndc.nx, y: ndc.ny }, this.camera);
        const padHits = this.raycaster.intersectObjects(this.playerPads, false);
        if (padHits.length) {
          const ud = padHits[0].object.userData;
          if (!this.zoneMeshes[ud.zone]) {
            this.selectedIndex = idx;   // onZoneTap legge selectedIndex
            _dragReset(dragIndex);      // const locale della closure (non this._dragReset)
            dragIndex = null;
            dragging = false;
            this._setPadHover(null);    // il pad ora è occupato (giallo)
            if (this.opts.onZoneTap) this.opts.onZoneTap(ud.zone);
            return;
          }
        }
      }
      // altrimenti torna in mano
      _dragReset(dragIndex);
      dragIndex = null;
      dragging = false;
      this._setPadHover(null);
    };
    const _dragReset = (idx) => {
      this._isolated = -2;      // forzare isolate(-1): guardia interno
      this.isolate(-1);         // riapplica home e attenuazioni
      const m = this.handMeshes[idx];
      if (m) {
        // ripristina il layer normale (via il depthTest false del drag)
        this._setOverlay(m, false);
        if (m.userData.frontMat) {
          m.userData.frontMat.emissive.setHex(0x000000);
          m.userData.frontMat.emissiveIntensity = 0;
        }
      }
    };

    const down = (e) => {
      const p = e.touches ? e.touches[0] : e;
      sx = p.clientX; sy = p.clientY;
      downTime = Date.now();
      touchActive = true;
      if (this.locked) return;
      // press: isola la carta sotto il dito per leggerla e MEMORIZZA
      // l'indice: il tap selezionerà proprio quella carta.
      const ndc = toNdc(p);
      this._pressIndex = this._handAt(ndc.nx, ndc.ny);
      if (this._pressIndex !== null) this.isolate(this._pressIndex);
      // touch in showdown su una carta del bot: mostra gli effetti
      if (this.phase === 'showdown' && this._pressIndex === null
          && this.opts.onBotHover && e.pointerType !== 'mouse') {
        this.opts.onBotHover(this._hoverBotAt(ndc.nx, ndc.ny));
      }
    };
    const move = (e) => {
      if (this.locked) return;
      const p = e.touches ? e.touches[0] : e;
      if (!p) return;
      const ndc = toNdc(p);
      // ---- drag&drop (fase deploy): carta premuta + movimento > soglia
      if (this.phase === 'deploy' && this._pressIndex !== null && !dragging) {
        const d = Math.hypot(p.clientX - sx, p.clientY - sy);
        if (d > BZ.TAP_DIST) {
          _startDrag(this._pressIndex);
          _dragFollow(ndc);
        }
      }
      // ---- hover sui pad (deploy): il pad sotto il cursore si illumina
      // GIALLI quando è piazzabile — sia con carta selezionata (tap) sia
      // durante il trascinamento (drag)
      if (this.phase === 'deploy' && (this.selectedIndex >= 0 || dragging)) {
        const padZone = this._hoverPadAt(ndc.nx, ndc.ny);
        this._setPadHover(padZone !== null && !this.zoneMeshes[padZone] ? padZone : null);
      } else {
        this._setPadHover(null);
      }
      if (dragging) {
        _dragFollow(ndc);
        return;
      }
      if (e.pointerType === 'mouse') {
        // hover con il mouse: isola la carta sotto il cursore (solo lettura)
        const i = this._handAt(ndc.nx, ndc.ny);
        this.isolate(i === null ? -1 : i);
        // in showdown, hover sulle carte del bot scoperte: zoom leggero
        // per la lettura + mostra gli effetti
        if (this.phase === 'showdown') {
          if (i === null) {
            this._hoverBotZoom(ndc.nx, ndc.ny);
            if (this.opts.onBotHover) this.opts.onBotHover(this._hoverBotAt(ndc.nx, ndc.ny));
          } else {
            this._resetBotZoom();   // cursore sopra la mano: niente zoom bot
            if (this.opts.onBotHover) this.opts.onBotHover(null);
          }
        }
      } else if (touchActive) {
        const i = this._handAt(ndc.nx, ndc.ny);
        if (i !== null) this.isolate(i);
      }
    };
    const up = (e) => {
      if (sx === null) return;
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const d = Math.hypot(p.clientX - sx, p.clientY - sy);
      const wasTap = d <= BZ.TAP_DIST && (Date.now() - downTime) < BZ.TAP_MAX_MS;
      sx = null;
      touchActive = false;
      if (this.locked) { this.isolate(-1); this._pressIndex = null; return; }
      // ---- rilascio di un drag: piazza o torna in mano
      if (dragging || d > BZ.TAP_DIST) {
        const ndc = toNdc(p);
        _endDrag(ndc);
        this._pressIndex = null;
        return;
      }
      if (wasTap) {
        // 1) carta premuta -> selezione carta (WYSIWYG, indice del down)
        if (this._pressIndex !== null) {
          const idx = this._pressIndex;
          this.isolate(-1);
          if (this.opts.onHandTap) this.opts.onHandTap(idx);
          this._pressIndex = null;
          return;
        }
        // 2) carta giocatore già piazzata -> rimozione
        const ndc = toNdc(p);
        this.raycaster.setFromCamera({ x: ndc.nx, y: ndc.ny }, this.camera);
        const placed = Object.values(this.zoneMeshes).filter(Boolean);
        const hits = this.raycaster.intersectObjects(placed, false);
        if (hits.length) {
          const zone = hits[0].object.userData.zone;
          this.isolate(-1);
          if (this.opts.onUndeployTap) this.opts.onUndeployTap(zone);
          this._pressIndex = null;
          return;
        }
        // 3) pad vuoto del giocatore -> piazza qui
        const padHits = this.raycaster.intersectObjects(this.playerPads, false);
        if (padHits.length) {
          const ud = padHits[0].object.userData;
          if (!this.zoneMeshes[ud.zone]) {
            this.isolate(-1);
            if (this.opts.onZoneTap) this.opts.onZoneTap(ud.zone);
            this._pressIndex = null;
            return;
          }
        }
      }
      this.isolate(-1);
      this._pressIndex = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('pointermove', move);
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('pointerup', up);
    el.addEventListener('touchend', up, { passive: true });
    el.addEventListener('pointerleave', () => {
      if (this._isolated >= 0 && !touchActive) this.isolate(-1);
      this._resetBotZoom();   // cursore fuori dal campo: via lo zoom bot
      if (this.opts.onBotHover) this.opts.onBotHover(null);
    });
    this._tapCleanup = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('touchend', up);
    };
  }

  dispose() {
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    if (this._tapCleanup) this._tapCleanup();
    this._clearHand();
    this._clearBotHand();
    for (const key of Object.keys(this.zonePads)) {
      this.scene.remove(this.zonePads[key]);
      this._disposeMesh(this.zonePads[key]);
    }
    for (const key of Object.keys(this.zoneRings)) {
      this.scene.remove(this.zoneRings[key]);
      this._disposeMesh(this.zoneRings[key]);
    }
    this.zonePads = {};
    this.zoneRings = {};
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

// easing locali (non collidono con scene.js)
function easeOutBack(k) {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
}

function easeOutCubic(k) {
  return 1 - Math.pow(1 - k, 3);
}

function easeInOutCubic(k) {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** Opacità uniforme su tutti i materiali della mesh carta. */
function setOpacity(mesh, opacity) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    m.transparent = opacity < 1;
    m.opacity = opacity;
  }
}

SQUER.BattleScene = BattleScene;

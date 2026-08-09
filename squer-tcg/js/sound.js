/* =========================================================
   Squer TCG - tiny WebAudio sound effects (no assets)
   ========================================================= */

var SQUER = window.SQUER || (window.SQUER = {});
SQUER.sound = (() => {
  let ctx = null;
  let muted = false;

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
    const c = ac();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  return {
    unlock() { ac(); },
    setMuted(m) { muted = m; },
    isMuted() { return muted; },
    click() { tone(600, 0.06, 'square', 0.06); },
    packRip() {
      // white-noise rip
      const c = ac(); if (!c || muted) return;
      const t0 = c.currentTime;
      const len = 0.45;
      const buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) * (Math.random() < 0.15 ? 1.6 : 0.7);
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.setValueAtTime(4000, t0);
      f.frequency.exponentialRampToValueAtTime(300, t0 + len);
      const g = c.createGain(); g.gain.value = 0.5;
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start(t0);
    },
    whoosh() { tone(300, 0.3, 'sine', 0.12, 1200); },
    flip() { tone(880, 0.08, 'triangle', 0.1, 1320); },
    newCard() {
      tone(523, 0.12, 'triangle', 0.16);
      tone(659, 0.12, 'triangle', 0.16, null, 0.09);
      tone(784, 0.2, 'triangle', 0.18, null, 0.18);
    },
    rare() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.16, null, i * 0.08));
    },
    epic() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'triangle', 0.18, null, i * 0.07));
      tone(1568, 0.5, 'sine', 0.1, null, 0.35);
    },
    legendary() {
      [392, 523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.2, 'triangle', 0.2, null, i * 0.08));
      tone(2093, 0.8, 'sine', 0.08, null, 0.56);
    },
  };
})();
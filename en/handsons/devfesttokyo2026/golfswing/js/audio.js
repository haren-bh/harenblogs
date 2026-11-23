/**
 * Procedural Web Audio Synthesizer for Golf Driving Simulation
 * Synthesizes realistic driver whoosh, forged titanium club-ball strike resonance,
 * turf bounce thuds, and tee reload clicks with zero external audio assets.
 * Respects WCAG 1.4.2 Audio Control: starts muted-safe / user-gesture unlocked with explicit toggle.
 */

export class GolfAudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noiseBuffer = null;
    this.userGestureUnlocked = false;

    const unlock = () => {
      this.userGestureUnlocked = true;
    };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
  }

  _ensureContext() {
    if (!this.enabled || !this.userGestureUnlocked) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this._buildNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _buildNoiseBuffer() {
    if (!this.ctx) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
  }

  setEnabled(flag) {
    this.enabled = Boolean(flag);
    if (!this.enabled && this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    } else if (this.enabled && this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /** Aerodynamic shaft/clubhead downswing whoosh */
  playSwingWhoosh(clubSpeedMs = 50) {
    const ctx = this._ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(2.6, now);
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(1150 * (clubSpeedMs / 50), now + 0.19);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.34);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    src.start(now);
    src.stop(now + 0.38);
  }

  /** Forged titanium 460cc driver face strike + acoustic metallic ping */
  playDriverImpact(clubSpeedMs = 50, smashQuality = 1.0) {
    const ctx = this._ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    const energy = Math.min(1.25, Math.max(0.45, (clubSpeedMs / 50) * smashQuality));

    // 1. Sharp transient compression crack (filtered noise burst)
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.setValueAtTime(2400, now);
    crackFilter.Q.setValueAtTime(1.4, now);
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.55 * energy, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(ctx.destination);
    crack.start(now);
    crack.stop(now + 0.06);

    // 2. Forged titanium crown acoustic resonance (dual harmonic ping ~2.8kHz + ~4.3kHz)
    const partials = [
      { freq: 2780, amp: 0.24 * energy, decay: 0.16 },
      { freq: 4320, amp: 0.14 * energy, decay: 0.11 },
      { freq: 1120, amp: 0.18 * energy, decay: 0.09 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(p.freq, now);
      osc.frequency.exponentialRampToValueAtTime(p.freq * 0.96, now + p.decay);

      const g = ctx.createGain();
      g.gain.setValueAtTime(p.amp, now);
      g.gain.exponentialRampToValueAtTime(0.0008, now + p.decay);

      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + p.decay + 0.02);
    }

    // 3. Low-end clubhead compression thump
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(195, now);
    thump.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.38 * energy, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    thump.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.12);
  }

  /** Turf / sand landing impact thud scaled by vertical bounce velocity */
  playTurfBounce(impactSpeed, surface = 'fairway') {
    const ctx = this._ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    const intensity = Math.min(1.0, Math.max(0.08, impactSpeed / 16));

    // Soft earthy thud
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const baseFreq = surface === 'bunker' ? 95 : 135;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28 * intensity, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);

    // Grass / sand scatter rustle
    const rustle = ctx.createBufferSource();
    rustle.buffer = this.noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(surface === 'bunker' ? 1800 : 1100, now);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.18 * intensity, now);
    rg.gain.exponentialRampToValueAtTime(0.001, now + (surface === 'bunker' ? 0.18 : 0.09));
    rustle.connect(filt);
    filt.connect(rg);
    rg.connect(ctx.destination);
    rustle.start(now);
    rustle.stop(now + 0.2);
  }

  /** Crisp subtle wooden tee reload tap */
  playTeeReset() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.045);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }
}

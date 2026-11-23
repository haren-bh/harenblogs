/**
 * 100% Procedural Web Audio API Formula 1 Sound Engine (zero external audio files).
 *
 * Synthesizes:
 *  - 1.6L V6 Turbo-Hybrid ICE (fundamental rpm/60 * 1.5 + sub + 3rd & 6th firing harmonics,
 *    soft-clipping waveshaper, and dual RPM-tracking resonant exhaust bandpass filters)
 *  - High-pitched turbocharger spool whistle (2.2-7.2 kHz sine + narrow bandpass noise)
 *  - MGU-K electric deployment & braking regeneration whine
 *  - Upshift 40 ms ignition-cut crack & downshift rev-match throttle blip
 *  - Slip-proportional tire scrub/screech, quadratic-speed aero wind rush,
 *    45 Hz kerb rumble oscillator, and metallic titanium spark / barrier scrape bursts
 */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function makeSoftClipCurve(amount = 3.2, samples = 2048) {
  const curve = new Float32Array(samples);
  const norm = Math.tanh(amount);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = Math.tanh(x * amount) / norm;
  }
  return curve;
}

function createLoopingNoiseBuffer(ctx, durationSec = 2.0) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic LCG PRNG for reproducible clean noise texture
  let seed = 0x13579bdf;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

export class F1AudioEngine {
  constructor() {
    this._ctx = null;
    this._initialized = false;
    this._muted = false;
    this._paused = false;
    this._inShowroom = true;

    // Smoothed internal synthesis states
    this._smoothRpm = 4000;
    this._smoothThrottle = 0;
    this._smoothBoost = 0;
    this._blipBoost = 0;
    this._ignitionCutTimer = 0;
    this._shiftCooldown = 0;
    this._lastGear = null;
    this._lastShiftToken = null;
    this._sparkPulsePhase = 0;

    // Audio nodes (populated lazily in unlock())
    this._nodes = null;
  }

  /**
   * Gesture-gated initialization and AudioContext resume.
   * Safe to invoke multiple times from pointerdown/keydown/click handlers.
   * @returns {boolean} True if AudioContext is created and usable
   */
  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    try {
      if (!this._ctx) {
        this._ctx = new AudioCtx();
      }
      if (!this._initialized) {
        this._buildGraph(this._ctx);
        this._initialized = true;
      }
      if (this._ctx.state === 'suspended') {
        this._ctx.resume().catch(() => {});
      }
      this._applyMasterGain(0.05);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Smoothly mute or unmute master output over ~50 ms.
   * @param {boolean} muted
   */
  setMuted(muted) {
    this._muted = Boolean(muted);
    this._applyMasterGain(0.05);
  }

  /**
   * Toggle mute state with smooth master gain ramp.
   * @returns {boolean} New muted state
   */
  toggleMute() {
    this.setMuted(!this._muted);
    return this._muted;
  }

  /** @returns {boolean} */
  isMuted() {
    return this._muted;
  }

  /** @returns {boolean} */
  isUnlocked() {
    return Boolean(this._ctx && this._initialized && this._ctx.state === 'running');
  }

  /** @param {boolean} paused */
  setPaused(paused) {
    this._paused = Boolean(paused);
    this._applyMasterGain(0.06);
  }

  /** @param {boolean} inShowroom */
  setShowroomMode(inShowroom) {
    this._inShowroom = Boolean(inShowroom);
    this._applyMasterGain(0.08);
  }

  /**
   * Optional FIA gantry countdown tone (440 Hz red light, 880 Hz lights out).
   * @param {boolean} [isLightsOut=false]
   */
  playStartLightBeep(isLightsOut = false) {
    if (!this._ctx || !this._nodes || this._muted || this._ctx.state !== 'running') return;
    try {
      const now = this._ctx.currentTime;
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isLightsOut ? 880 : 440, now);

      const dur = isLightsOut ? 0.34 : 0.14;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(isLightsOut ? 0.14 : 0.10, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      osc.connect(gain);
      gain.connect(this._nodes.masterGain);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch {
      // Ignore audio scheduling errors in restricted contexts
    }
  }

  /**
   * Trigger an upshift ignition-cut crack or downshift rev-match throttle blip.
   * @param {'up'|'down'} direction
   */
  triggerShift(direction) {
    if (!this._ctx || !this._nodes || this._ctx.state !== 'running') return;
    const now = this._ctx.currentTime;
    const n = this._nodes;

    if (direction === 'up') {
      // Crisp 40 ms ignition-cut dip + resonant exhaust pop
      this._ignitionCutTimer = 0.045;
      n.shiftCrackFilter.frequency.setValueAtTime(1450, now);
      n.shiftCrackFilter.Q.setValueAtTime(2.4, now);
      n.shiftCrackGain.gain.cancelScheduledValues(now);
      n.shiftCrackGain.gain.setValueAtTime(0.0001, now);
      n.shiftCrackGain.gain.linearRampToValueAtTime(0.32, now + 0.006);
      n.shiftCrackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    } else if (direction === 'down') {
      // Downshift throttle blip pitch surge + lower exhaust bark
      this._blipBoost = 1.0;
      n.shiftCrackFilter.frequency.setValueAtTime(680, now);
      n.shiftCrackFilter.Q.setValueAtTime(2.0, now);
      n.shiftCrackGain.gain.cancelScheduledValues(now);
      n.shiftCrackGain.gain.setValueAtTime(0.0001, now);
      n.shiftCrackGain.gain.linearRampToValueAtTime(0.24, now + 0.012);
      n.shiftCrackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
    }
  }

  /**
   * Update continuous procedural audio synthesis parameters from live vehicle state.
   * Supports both update(dt, carState, options) and update(carState, options).
   *
   * @param {number|object} dtOrState
   * @param {object} [maybeState]
   * @param {object|string} [maybeOptions]
   */
  update(dtOrState, maybeState, maybeOptions = {}) {
    let dt = 1 / 60;
    let carState = null;
    let options = {};

    if (typeof dtOrState === 'number') {
      dt = clamp(Number.isFinite(dtOrState) ? dtOrState : 1 / 60, 0.001, 0.1);
      carState = maybeState || null;
      options = maybeOptions || {};
    } else {
      carState = dtOrState || null;
      options = maybeState || {};
    }

    if (typeof options === 'string') {
      this._paused = options === 'PAUSED' || options === 'STATE_PAUSED';
      this._inShowroom =
        options === 'SHOWROOM_GRID' ||
        options === 'STATE_SHOWROOM_GRID' ||
        options === 'SESSION_SUMMARY' ||
        options === 'STATE_SESSION_SUMMARY';
    } else if (options && typeof options === 'object') {
      if (typeof options.paused === 'boolean') this._paused = options.paused;
      if (typeof options.showroom === 'boolean') this._inShowroom = options.showroom;
      if (typeof options.inShowroom === 'boolean') this._inShowroom = options.inShowroom;
    }

    if (!this._ctx || !this._nodes) return;
    if (this._ctx.state !== 'running') return;

    this._applyMasterGain(0.05);
    if (this._muted || this._paused) return;

    const now = this._ctx.currentTime;
    const tau = 0.025;
    const n = this._nodes;

    // Extract vehicle telemetry safely
    const rawRpm = Number.isFinite(carState?.rpm) ? carState.rpm : 4000;
    const throttle = clamp(carState?.throttle ?? 0, 0, 1);
    const brake = clamp(carState?.brake ?? 0, 0, 1);
    const speedMs = Number.isFinite(carState?.speed)
      ? Math.abs(carState.speed)
      : Number.isFinite(carState?.speedKmh)
        ? Math.abs(carState.speedKmh) / 3.6
        : 0;
    const drsOpen = Boolean(carState?.drsOpen || carState?.drsActive);

    // Detect upshift/downshift events (explicit shiftEvent or gear edge detection)
    this._shiftCooldown = Math.max(0, this._shiftCooldown - dt);
    this._processShiftEvents(carState);

    // Decay ignition-cut dip and downshift rev-match blip
    if (this._ignitionCutTimer > 0) {
      this._ignitionCutTimer = Math.max(0, this._ignitionCutTimer - dt);
    }
    this._blipBoost *= Math.exp(-16.0 * dt);
    if (this._blipBoost < 0.005) this._blipBoost = 0;

    // Smooth RPM & throttle
    const rpmAlpha = 1.0 - Math.exp(-26.0 * dt);
    this._smoothRpm += (clamp(rawRpm, 2800, 14500) - this._smoothRpm) * rpmAlpha;
    this._smoothThrottle += (throttle - this._smoothThrottle) * (1.0 - Math.exp(-18.0 * dt));

    const rpmEff = this._smoothRpm * (1.0 + this._blipBoost * 0.14);
    const rpmNorm = clamp((rpmEff - 3800) / (13200 - 3800), 0, 1);

    // 1. 1.6L V6 Turbo-Hybrid Power Unit (f0 = rpm / 60 * 1.5)
    const f0 = Math.max(45, (rpmEff / 60) * 1.5);
    n.oscFund.frequency.setTargetAtTime(f0, now, tau);
    n.oscSub.frequency.setTargetAtTime(f0 * 0.5, now, tau);
    n.oscHarm3.frequency.setTargetAtTime(f0 * 3.0, now, tau);
    n.oscHarm6.frequency.setTargetAtTime(f0 * 6.0, now, tau);

    // Dynamic load bark & RPM-tracking exhaust resonators
    const loadDrive = 0.42 + 0.58 * this._smoothThrottle + 0.25 * this._blipBoost;
    n.gainFund.gain.setTargetAtTime(0.42 * loadDrive, now, tau);
    n.gainSub.gain.setTargetAtTime(0.28 * (0.75 + 0.25 * loadDrive), now, tau);
    n.gainHarm3.gain.setTargetAtTime(0.18 + 0.24 * rpmNorm * loadDrive, now, tau);
    n.gainHarm6.gain.setTargetAtTime(0.06 + 0.14 * rpmNorm * rpmNorm * loadDrive, now, tau);

    n.exhaustBP1.frequency.setTargetAtTime(clamp(f0 * 2.25 + this._smoothThrottle * 180, 140, 2600), now, tau);
    n.exhaustBP2.frequency.setTargetAtTime(clamp(f0 * 4.55 + this._smoothThrottle * 320, 320, 5400), now, tau);
    n.exhaustLP.frequency.setTargetAtTime(520 + rpmNorm * 1650 + this._smoothThrottle * 650, now, tau);

    const cutScale = this._ignitionCutTimer > 0 ? 0.18 : 1.0;
    const engineLevel = (0.28 + 0.34 * loadDrive + 0.16 * rpmNorm) * cutScale;
    n.engineOutGain.gain.setTargetAtTime(engineLevel, now, 0.012);

    // 2. Turbocharger Spool Whistle (2.2-7.2 kHz)
    const boostTarget = clamp(this._smoothThrottle * 0.72 + rpmNorm * 0.42, 0, 1);
    const spoolRate = boostTarget > this._smoothBoost ? 6.5 : 4.2;
    this._smoothBoost += (boostTarget - this._smoothBoost) * (1.0 - Math.exp(-spoolRate * dt));

    const turboFreq = 2200 + 5000 * this._smoothBoost;
    n.oscTurbo.frequency.setTargetAtTime(turboFreq, now, 0.03);
    n.turboNoiseFilter.frequency.setTargetAtTime(turboFreq * 1.04, now, 0.03);

    const showroomQuiet = this._inShowroom ? 0.12 : 1.0;
    const turboLevel = (0.012 + 0.068 * this._smoothBoost * this._smoothBoost) * showroomQuiet;
    n.turboGain.gain.setTargetAtTime(turboLevel, now, 0.03);

    // 3. MGU-K Electric Deployment & Braking Regen Whine
    const speedNorm = clamp(speedMs / 95.0, 0, 1);
    const mgukDeploy = clamp((this._smoothThrottle - 0.25) * 1.35, 0, 1) * (0.25 + 0.75 * speedNorm);
    const mgukRegen = brake > 0.1 && speedMs > 8.0 ? clamp(brake * speedNorm * 1.2, 0, 1) : 0;
    const mgukFreq = 440 + speedNorm * 1850 + (mgukRegen > mgukDeploy ? -160 : 120);
    n.oscMguk.frequency.setTargetAtTime(clamp(mgukFreq, 320, 2600), now, 0.03);
    n.mgukFilter.frequency.setTargetAtTime(clamp(mgukFreq, 320, 2800), now, 0.03);
    const mgukLevel = Math.max(mgukDeploy * 0.055, mgukRegen * 0.068) * showroomQuiet;
    n.mgukGain.gain.setTargetAtTime(mgukLevel, now, 0.03);

    // 4. Tire Scrub / Screech (driven by max wheel skidIntensity)
    const skid = this._extractMaxSkid(carState);
    const skidFreq = 980 + 780 * clamp(skid, 0, 1) + 220 * speedNorm;
    n.skidFilter.frequency.setTargetAtTime(skidFreq, now, 0.025);
    const skidLevel = this._inShowroom ? 0 : Math.pow(skid, 1.35) * 0.26;
    n.skidGain.gain.setTargetAtTime(skidLevel, now, 0.025);

    // 5. Quadratic-Speed Aerodynamic Wind Rush
    const windQuad = speedNorm * speedNorm;
    const drsWindBoost = drsOpen ? 1.15 : 1.0;
    n.windFilter.frequency.setTargetAtTime(240 + 1420 * speedNorm * drsWindBoost, now, 0.04);
    const windLevel = this._inShowroom ? 0 : windQuad * 0.22 * drsWindBoost;
    n.windGain.gain.setTargetAtTime(windLevel, now, 0.04);

    // 6. 45 Hz Kerb Rumble Oscillator
    const kerb = clamp(carState?.kerbRumbleIntensity ?? carState?.kerbIntensity ?? 0, 0, 1);
    const kerbFreq = 34 + 28 * speedNorm;
    n.oscKerb.frequency.setTargetAtTime(clamp(kerbFreq, 30, 65), now, 0.02);
    const kerbLevel = this._inShowroom ? 0 : kerb * 0.34;
    n.kerbGain.gain.setTargetAtTime(kerbLevel, now, 0.02);

    // 7. Titanium Sparks & Barrier Scrape Burst
    const spark = clamp(carState?.sparkIntensity ?? 0, 0, 1);
    const scrape = clamp(carState?.barrierScrapeIntensity ?? 0, 0, 1);
    const metallic = Math.max(spark, scrape);
    this._sparkPulsePhase += dt * 78.0;
    const crackleMod = 0.65 + 0.35 * Math.sin(this._sparkPulsePhase) * Math.cos(this._sparkPulsePhase * 1.73);
    n.sparkBP.frequency.setTargetAtTime(scrape > spark ? 3900 : 5800, now, 0.02);
    const sparkLevel = this._inShowroom ? 0 : metallic * 0.28 * crackleMod;
    n.sparkGain.gain.setTargetAtTime(sparkLevel, now, 0.015);
  }

  /**
   * Release Web Audio resources cleanly.
   */
  dispose() {
    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
      this._nodes = null;
      this._initialized = false;
    }
  }

  // --------------------------------------------------------------------------
  // Internal Synthesis Graph Construction & Helpers
  // --------------------------------------------------------------------------

  _buildGraph(ctx) {
    const now = ctx.currentTime;

    // Master dynamics protection + master gain
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-10, now);
    compressor.knee.setValueAtTime(14, now);
    compressor.ratio.setValueAtTime(4.5, now);
    compressor.attack.setValueAtTime(0.004, now);
    compressor.release.setValueAtTime(0.12, now);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);

    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Shared looping noise source (zero per-frame buffer allocations)
    const noiseBuffer = createLoopingNoiseBuffer(ctx, 2.0);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;

    // --- 1. 1.6L V6 Turbo-Hybrid Power Unit ---
    const oscFund = ctx.createOscillator();
    oscFund.type = 'sawtooth';
    oscFund.frequency.setValueAtTime(100, now);

    const oscSub = ctx.createOscillator();
    oscSub.type = 'triangle';
    oscSub.frequency.setValueAtTime(50, now);

    const oscHarm3 = ctx.createOscillator();
    oscHarm3.type = 'sawtooth';
    oscHarm3.frequency.setValueAtTime(300, now);

    const oscHarm6 = ctx.createOscillator();
    oscHarm6.type = 'triangle';
    oscHarm6.frequency.setValueAtTime(600, now);

    const gainFund = ctx.createGain();
    const gainSub = ctx.createGain();
    const gainHarm3 = ctx.createGain();
    const gainHarm6 = ctx.createGain();
    gainFund.gain.setValueAtTime(0.35, now);
    gainSub.gain.setValueAtTime(0.24, now);
    gainHarm3.gain.setValueAtTime(0.18, now);
    gainHarm6.gain.setValueAtTime(0.07, now);

    const engineMix = ctx.createGain();
    engineMix.gain.setValueAtTime(0.75, now);

    const waveshaper = ctx.createWaveShaper();
    waveshaper.curve = makeSoftClipCurve(3.4);
    waveshaper.oversample = '2x';

    const exhaustBP1 = ctx.createBiquadFilter();
    exhaustBP1.type = 'bandpass';
    exhaustBP1.frequency.setValueAtTime(240, now);
    exhaustBP1.Q.setValueAtTime(2.2, now);

    const exhaustBP2 = ctx.createBiquadFilter();
    exhaustBP2.type = 'bandpass';
    exhaustBP2.frequency.setValueAtTime(520, now);
    exhaustBP2.Q.setValueAtTime(3.4, now);

    const exhaustLP = ctx.createBiquadFilter();
    exhaustLP.type = 'lowpass';
    exhaustLP.frequency.setValueAtTime(700, now);
    exhaustLP.Q.setValueAtTime(0.8, now);

    const gainBP1 = ctx.createGain();
    gainBP1.gain.setValueAtTime(0.65, now);
    const gainBP2 = ctx.createGain();
    gainBP2.gain.setValueAtTime(0.48, now);
    const gainLP = ctx.createGain();
    gainLP.gain.setValueAtTime(0.45, now);

    const engineOutGain = ctx.createGain();
    engineOutGain.gain.setValueAtTime(0.32, now);

    oscFund.connect(gainFund).connect(engineMix);
    oscSub.connect(gainSub).connect(engineMix);
    oscHarm3.connect(gainHarm3).connect(engineMix);
    oscHarm6.connect(gainHarm6).connect(engineMix);

    engineMix.connect(waveshaper);
    waveshaper.connect(exhaustBP1).connect(gainBP1).connect(engineOutGain);
    waveshaper.connect(exhaustBP2).connect(gainBP2).connect(engineOutGain);
    waveshaper.connect(exhaustLP).connect(gainLP).connect(engineOutGain);
    engineOutGain.connect(compressor);

    // --- 2. Turbocharger Spool Whistle (2.2-7.2 kHz) ---
    const oscTurbo = ctx.createOscillator();
    oscTurbo.type = 'sine';
    oscTurbo.frequency.setValueAtTime(2400, now);

    const turboOscWeight = ctx.createGain();
    turboOscWeight.gain.setValueAtTime(0.55, now);

    const turboNoiseFilter = ctx.createBiquadFilter();
    turboNoiseFilter.type = 'bandpass';
    turboNoiseFilter.frequency.setValueAtTime(2500, now);
    turboNoiseFilter.Q.setValueAtTime(8.5, now);

    const turboNoiseWeight = ctx.createGain();
    turboNoiseWeight.gain.setValueAtTime(0.75, now);

    const turboGain = ctx.createGain();
    turboGain.gain.setValueAtTime(0.0001, now);

    oscTurbo.connect(turboOscWeight).connect(turboGain);
    noiseSrc.connect(turboNoiseFilter).connect(turboNoiseWeight).connect(turboGain);
    turboGain.connect(compressor);

    // --- 3. MGU-K Hybrid Electric Whine ---
    const oscMguk = ctx.createOscillator();
    oscMguk.type = 'triangle';
    oscMguk.frequency.setValueAtTime(520, now);

    const mgukFilter = ctx.createBiquadFilter();
    mgukFilter.type = 'bandpass';
    mgukFilter.frequency.setValueAtTime(520, now);
    mgukFilter.Q.setValueAtTime(2.0, now);

    const mgukGain = ctx.createGain();
    mgukGain.gain.setValueAtTime(0.0001, now);

    oscMguk.connect(mgukFilter).connect(mgukGain).connect(compressor);

    // --- 4. Tire Scrub / Screech ---
    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.setValueAtTime(1150, now);
    skidFilter.Q.setValueAtTime(5.2, now);

    const skidGain = ctx.createGain();
    skidGain.gain.setValueAtTime(0.0001, now);

    noiseSrc.connect(skidFilter).connect(skidGain).connect(compressor);

    // --- 5. Aerodynamic Wind Rush ---
    const windHP = ctx.createBiquadFilter();
    windHP.type = 'highpass';
    windHP.frequency.setValueAtTime(140, now);

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(320, now);
    windFilter.Q.setValueAtTime(0.7, now);

    const windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0.0001, now);

    noiseSrc.connect(windHP).connect(windFilter).connect(windGain).connect(compressor);

    // --- 6. Kerb Rumble Oscillator (45 Hz nominal) ---
    const oscKerb = ctx.createOscillator();
    oscKerb.type = 'sawtooth';
    oscKerb.frequency.setValueAtTime(45, now);

    const kerbLP = ctx.createBiquadFilter();
    kerbLP.type = 'lowpass';
    kerbLP.frequency.setValueAtTime(130, now);

    const kerbGain = ctx.createGain();
    kerbGain.gain.setValueAtTime(0.0001, now);

    oscKerb.connect(kerbLP).connect(kerbGain).connect(compressor);

    // --- 7. Metallic Titanium Sparks & Barrier Scrape ---
    const sparkHP = ctx.createBiquadFilter();
    sparkHP.type = 'highpass';
    sparkHP.frequency.setValueAtTime(3200, now);

    const sparkBP = ctx.createBiquadFilter();
    sparkBP.type = 'bandpass';
    sparkBP.frequency.setValueAtTime(5600, now);
    sparkBP.Q.setValueAtTime(3.2, now);

    const sparkGain = ctx.createGain();
    sparkGain.gain.setValueAtTime(0.0001, now);

    noiseSrc.connect(sparkHP).connect(sparkBP).connect(sparkGain).connect(compressor);

    // --- 8. Gearbox Shift Crack / Blip Burst Channel ---
    const shiftCrackFilter = ctx.createBiquadFilter();
    shiftCrackFilter.type = 'bandpass';
    shiftCrackFilter.frequency.setValueAtTime(1400, now);
    shiftCrackFilter.Q.setValueAtTime(2.4, now);

    const shiftCrackGain = ctx.createGain();
    shiftCrackGain.gain.setValueAtTime(0.0001, now);

    noiseSrc.connect(shiftCrackFilter).connect(shiftCrackGain).connect(compressor);

    // Start all continuous oscillators and looping noise source
    oscFund.start(now);
    oscSub.start(now);
    oscHarm3.start(now);
    oscHarm6.start(now);
    oscTurbo.start(now);
    oscMguk.start(now);
    oscKerb.start(now);
    noiseSrc.start(now);

    this._nodes = {
      compressor,
      masterGain,
      noiseSrc,
      oscFund,
      oscSub,
      oscHarm3,
      oscHarm6,
      gainFund,
      gainSub,
      gainHarm3,
      gainHarm6,
      exhaustBP1,
      exhaustBP2,
      exhaustLP,
      engineOutGain,
      oscTurbo,
      turboNoiseFilter,
      turboGain,
      oscMguk,
      mgukFilter,
      mgukGain,
      skidFilter,
      skidGain,
      windFilter,
      windGain,
      oscKerb,
      kerbGain,
      sparkBP,
      sparkGain,
      shiftCrackFilter,
      shiftCrackGain,
    };
  }

  _applyMasterGain(rampSec = 0.05) {
    if (!this._ctx || !this._nodes) return;
    const now = this._ctx.currentTime;
    let target = 0.78;
    if (this._muted || this._paused) {
      target = 0.0;
    } else if (this._inShowroom) {
      target = 0.26;
    }
    const timeConstant = Math.max(0.01, rampSec / 3);
    this._nodes.masterGain.gain.setTargetAtTime(target, now, timeConstant);
  }

  _extractMaxSkid(carState) {
    if (!carState) return 0;
    let maxSkid = Number.isFinite(carState.skidIntensity) ? carState.skidIntensity : 0;

    if (Array.isArray(carState.wheelSkid)) {
      for (let i = 0; i < carState.wheelSkid.length; i++) {
        const s = carState.wheelSkid[i];
        if (s > maxSkid) maxSkid = s;
      }
    } else if (Array.isArray(carState.wheels)) {
      for (let i = 0; i < carState.wheels.length; i++) {
        const w = carState.wheels[i];
        const s = w?.skidIntensity ?? w?.skid ?? 0;
        if (s > maxSkid) maxSkid = s;
      }
    }
    return clamp(maxSkid, 0, 1);
  }

  _processShiftEvents(carState) {
    if (!carState) return;

    const ev = carState.shiftEvent;
    let dir = null;
    let token = null;

    if (ev === 'up' || ev === 'upshift' || ev === 1) {
      dir = 'up';
      token = `up:${carState.gear ?? ''}:${carState.shiftSeq ?? ''}`;
    } else if (ev === 'down' || ev === 'downshift' || ev === -1) {
      dir = 'down';
      token = `down:${carState.gear ?? ''}:${carState.shiftSeq ?? ''}`;
    } else if (ev && typeof ev === 'object') {
      const t = ev.type || ev.direction;
      if (t === 'up' || t === 'upshift' || t === 1) dir = 'up';
      else if (t === 'down' || t === 'downshift' || t === -1) dir = 'down';
      token = `${dir}:${ev.seq ?? ev.time ?? ''}`;
    }

    if (dir && (token !== this._lastShiftToken || this._shiftCooldown <= 0)) {
      this._lastShiftToken = token;
      this._shiftCooldown = 0.08;
      this.triggerShift(dir);
    } else if (!ev) {
      this._lastShiftToken = null;
    }

    // Fallback gear-edge detection if physics changes carState.gear without shiftEvent
    const gear = typeof carState.gear === 'number' ? carState.gear : null;
    if (gear !== null) {
      if (
        this._lastGear !== null &&
        gear !== this._lastGear &&
        gear >= 1 &&
        this._lastGear >= 1 &&
        this._shiftCooldown <= 0
      ) {
        this._shiftCooldown = 0.08;
        this.triggerShift(gear > this._lastGear ? 'up' : 'down');
      }
      this._lastGear = gear;
    }
  }
}

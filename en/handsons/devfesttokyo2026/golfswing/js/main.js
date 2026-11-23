/**
 * Photorealistic Golf Driving Simulator — Core Runtime & Deterministic Finite-State Machine
 * Orchestrates all subsystems specified in specs/golfswing.md:
 *  - 5-State Deterministic FSM (STATE_TEE_ADDRESS -> STATE_SWING_EXECUTION ->
 *    STATE_BALL_FLIGHT -> STATE_LANDING_ROLLOUT -> STATE_RELOAD_RESET)
 *  - ACES Filmic Linear Rendering Pipeline (WebGL2 + ACESFilmicToneMapping + PCFSoftShadowMap)
 *  - OpenUSD Layered Stage Graph (USDStageGraph)
 *  - Biomechanical Golfer + RK4 Aerodynamics + CameraDirector + Procedural Web Audio
 *  - Optional Interactive Skill Timing Swing Gauge alongside 1-click Deterministic Tour Drive
 */

import * as THREE from 'three';
import {
  DEFAULT_LAUNCH,
  GAME_STATES,
  METERS_TO_YARDS,
  MS_TO_MPH,
  STATE_METADATA,
  SWING_TIMING,
} from './constants.js';
import { BallPhysicsEngine, getSurfacePhysicsProps } from './physics.js';
import { createSkyAndEnvironment, pbrAuditRecords } from './materials.js';
import { BiomechanicalGolfer } from './golfer.js';
import { GolfEnvironment } from './environment.js';
import { CameraDirector } from './camera.js';
import { GolfAudioEngine } from './audio.js';
import { USDStageGraph } from './usdStage.js';
import { SWING_25_KEYFRAMES } from './swingKeyframes.js';

const PRESETS = {
  spec_reference: {
    label: 'Spec Reference Drive',
    clubSpeedMs: 50.0,
    launchElevationDeg: 11.5,
    launchAzimuthDeg: 0.0,
    backspinRpm: 2600,
    sidespinRpm: 0,
    windSpeedMs: 0.0,
    windDirectionDeg: 0,
  },
  tour_bomber: {
    label: 'Tour Bomber (124 mph)',
    clubSpeedMs: 55.4,
    launchElevationDeg: 12.2,
    launchAzimuthDeg: -0.6,
    backspinRpm: 2250,
    sidespinRpm: -180,
    windSpeedMs: 3.5,
    windDirectionDeg: 10,
  },
  power_draw: {
    label: 'High Power Draw',
    clubSpeedMs: 51.5,
    launchElevationDeg: 13.0,
    launchAzimuthDeg: 3.2,
    backspinRpm: 2450,
    sidespinRpm: -640,
    windSpeedMs: 2.5,
    windDirectionDeg: 30,
  },
  stinger_fade: {
    label: 'Piercing Fade',
    clubSpeedMs: 52.0,
    launchElevationDeg: 9.2,
    launchAzimuthDeg: -3.0,
    backspinRpm: 2850,
    sidespinRpm: 580,
    windSpeedMs: 5.5,
    windDirectionDeg: 170,
  },
  crosswind: {
    label: 'Crosswind Challenge',
    clubSpeedMs: 50.0,
    launchElevationDeg: 11.5,
    launchAzimuthDeg: -2.0,
    backspinRpm: 2650,
    sidespinRpm: 0,
    windSpeedMs: 8.5,
    windDirectionDeg: 90,
  },
};

class GolfDrivingSimulatorApp {
  constructor() {
    this.canvas = document.getElementById('sim-canvas');
    this.state = GAME_STATES.TEE_ADDRESS;
    this.launchConfig = { ...DEFAULT_LAUNCH };
    this.swingMode = 'deterministic'; // 'deterministic' | 'skill'
    this.paused = false;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Timing counters
    this.postImpactTimer = 0;
    this.reloadDwellTimer = 0;
    this.whooshPlayed = false;

    // Interactive Skill Swing gauge state (2-tap: Power -> Face Timing)
    this.skillPhase = 'IDLE'; // 'IDLE' | 'POWER' | 'ACCURACY'
    this.skillCursor = 0;     // 0..1 oscillating
    this.skillDir = 1;
    this.skillPowerNorm = 1.0;
    this.skillAccuracyOffset = 0; // -1..+1 (0 = dead square sweet spot)

    // Session metrics & shot history
    this.shotHistory = [];
    this.bestTotalYds = 0;
    this.bestCarryYds = 0;
    this.lastAnnouncement = '';
    this.inspectorUpdateAccum = 0;

    this._initRendererAndScene();
    this._initLightingAndSky();
    this._initSubsystems();
    this._bindUI();
    this._syncUIControlsFromConfig();
    this._updateStateHUD();
    this._populateStaticInspectorData();

    // Start deterministic 60Hz render + 240Hz RK4 physics loop
    this.lastFrameTs = performance.now();
    requestAnimationFrame((ts) => this._animate(ts));
  }

  _initRendererAndScene() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    // Section 5: Linear floating-point lighting -> ACES Filmic Output Transform (RRT + ODT)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    // Soft cascaded-style dynamic shadow mapping
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    // Atmospheric aerial perspective fog matched to Rayleigh horizon scattering
    this.scene.fog = new THREE.FogExp2(new THREE.Color(0.68, 0.78, 0.88), 0.00145);

    this.camera = new THREE.PerspectiveCamera(
      27,
      window.innerWidth / window.innerHeight,
      0.08,
      1100
    );

    // OpenUSD LIVRPS Layered Stage Graph (Section 8)
    this.usdStage = new USDStageGraph(this.scene);

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    });
  }

  _initLightingAndSky() {
    this.skySystem = createSkyAndEnvironment(this.renderer, this.launchConfig.sunElevationDeg);
    this.scene.environment = this.skySystem.envMap;
    this.scene.environmentIntensity = 0.72;
    this.usdStage.attachToLayer('lighting_rig', this.skySystem.skyMesh);

    this.sunDirUniform = { value: this.skySystem.sunDir.clone() };

    // Primary directional solar illumination
    this.sunLight = new THREE.DirectionalLight(new THREE.Color(1.0, 0.96, 0.89), 3.15);
    this.sunLight.name = 'Light_Sun_Directional';
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.025;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 160;
    this._setShadowFrustumFocus(new THREE.Vector3(0, 0, -2), 14);
    this.usdStage.attachToLayer('lighting_rig', this.sunLight);
    this.usdStage.attachToLayer('lighting_rig', this.sunLight.target);

    // Sky-to-fairway hemisphere bounce fill
    this.hemiLight = new THREE.HemisphereLight(
      new THREE.Color(0.68, 0.82, 0.98),
      new THREE.Color(0.24, 0.34, 0.19),
      0.62
    );
    this.hemiLight.name = 'Light_Hemisphere_BounceFill';
    this.usdStage.attachToLayer('lighting_rig', this.hemiLight);
  }

  _setShadowFrustumFocus(center, halfExtent) {
    const d = this.sunDirUniform.value;
    this.sunLight.target.position.copy(center);
    this.sunLight.position.copy(center).addScaledVector(d, 68);
    const cam = this.sunLight.shadow.camera;
    cam.left = -halfExtent;
    cam.right = halfExtent;
    cam.top = halfExtent;
    cam.bottom = -halfExtent;
    cam.updateProjectionMatrix();
  }

  _initSubsystems() {
    this.physics = new BallPhysicsEngine();
    this.physics.setWind(this.launchConfig.windSpeedMs, this.launchConfig.windDirectionDeg);
    this.physics.resetToTee();

    this.golfer = new BiomechanicalGolfer(this.sunDirUniform);
    this.usdStage.attachToLayer('character_hero', this.golfer.root);

    this.environment = new GolfEnvironment(this.sunDirUniform);
    this.usdStage.attachToLayer('environment_fairway', this.environment.environmentGroup);
    this.usdStage.attachToLayer('assets_props', this.environment.propsGroup);

    this.cameraDirector = new CameraDirector(this.camera, this.canvas);
    this.audio = new GolfAudioEngine();
  }

  _bindUI() {
    this.dom = {
      stateBadge: document.getElementById('hud-state-badge'),
      cameraBadge: document.getElementById('hud-camera-badge'),
      windBadge: document.getElementById('hud-wind-badge'),
      windArrow: document.getElementById('hud-wind-arrow'),

      // Telemetry strip
      telBallSpeed: document.getElementById('tel-ball-speed'),
      telLaunch: document.getElementById('tel-launch-angle'),
      telSpin: document.getElementById('tel-backspin'),
      telCarry: document.getElementById('tel-carry'),
      telTotal: document.getElementById('tel-total'),
      telApex: document.getElementById('tel-apex'),
      telBest: document.getElementById('tel-best-drive'),
      telShotCount: document.getElementById('tel-shot-count'),

      // Primary action & Skill Swing gauge
      driveBtn: document.getElementById('btn-drive'),
      driveLabel: document.getElementById('btn-drive-label'),
      driveSub: document.getElementById('btn-drive-sub'),
      resetBtn: document.getElementById('btn-reset-tee'),
      pauseBtn: document.getElementById('btn-pause'),
      audioBtn: document.getElementById('btn-audio'),
      cameraSelect: document.getElementById('select-camera'),

      skillGauge: document.getElementById('skill-gauge'),
      skillGaugeLabel: document.getElementById('skill-gauge-label'),
      skillGaugeCursor: document.getElementById('skill-gauge-cursor'),

      // Post-landing summary banner
      shotSummaryBanner: document.getElementById('shot-summary-banner'),
      summaryTotal: document.getElementById('summary-total'),
      summaryDetail: document.getElementById('summary-detail'),
      summarySurface: document.getElementById('summary-surface'),

      // Launch Lab controls inside popover
      modeRadios: document.querySelectorAll('input[name="swing-mode"]'),
      sliderClubSpeed: document.getElementById('ctrl-club-speed'),
      sliderLaunchAngle: document.getElementById('ctrl-launch-angle'),
      sliderBackspin: document.getElementById('ctrl-backspin'),
      sliderSidespin: document.getElementById('ctrl-sidespin'),
      sliderWindSpeed: document.getElementById('ctrl-wind-speed'),
      sliderWindDir: document.getElementById('ctrl-wind-dir'),
      sliderSunElev: document.getElementById('ctrl-sun-elev'),
      toggleTracer: document.getElementById('ctrl-tracer'),

      outClubSpeed: document.getElementById('out-club-speed'),
      outLaunchAngle: document.getElementById('out-launch-angle'),
      outBackspin: document.getElementById('out-backspin'),
      outSidespin: document.getElementById('out-sidespin'),
      outWindSpeed: document.getElementById('out-wind-speed'),
      outWindDir: document.getElementById('out-wind-dir'),
      outSunElev: document.getElementById('out-sun-elev'),
      presetButtons: document.querySelectorAll('[data-preset]'),

      // Inspector dialog live containers
      inspectorDialog: document.getElementById('inspector-dialog'),
      bioContainer: document.getElementById('inspector-biomechanics'),
      pbrContainer: document.getElementById('inspector-pbr-audit'),
      usdContainer: document.getElementById('inspector-usd-stage'),
      historyBody: document.getElementById('shot-history-body'),
      liveAnnouncer: document.getElementById('live-announcer'),
    };

    // Drive / Swing trigger button
    this.dom.driveBtn.addEventListener('click', () => this.handlePrimaryAction());

    // Manual instant tee reload button
    this.dom.resetBtn.addEventListener('click', () => {
      this.transitionToReloadReset(true);
    });

    // WCAG 2.2.2 Pause / Resume animation control (label changes without aria-pressed)
    this.dom.pauseBtn.addEventListener('click', () => {
      this.paused = !this.paused;
      this.dom.pauseBtn.textContent = this.paused ? 'Resume' : 'Pause';
      this._announce(this.paused ? 'Simulation paused.' : 'Simulation resumed.');
    });

    // Audio mute toggle
    this.dom.audioBtn.addEventListener('click', () => {
      const next = !this.audio.enabled;
      this.audio.setEnabled(next);
      this.dom.audioBtn.setAttribute('aria-pressed', String(next));
      this.dom.audioBtn.textContent = next ? 'Sound On' : 'Sound Off';
    });

    // Camera Director override selector
    this.dom.cameraSelect.addEventListener('change', (e) => {
      this.cameraDirector.setCameraMode(e.target.value);
      this._updateStateHUD();
    });

    // Swing mode radios (Deterministic Spec Drive vs Interactive Timing Swing)
    this.dom.modeRadios.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.swingMode = e.target.value;
          this.skillPhase = 'IDLE';
          this._updateDriveButtonCopy();
        }
      });
    });

    // Launch Lab sliders
    const bindSlider = (input, key, onUpdate) => {
      input.addEventListener('input', () => {
        this.launchConfig[key] = parseFloat(input.value);
        this._syncUIControlsFromConfig();
        if (onUpdate) onUpdate(this.launchConfig[key]);
      });
    };

    bindSlider(this.dom.sliderClubSpeed, 'clubSpeedMs');
    bindSlider(this.dom.sliderLaunchAngle, 'launchElevationDeg');
    bindSlider(this.dom.sliderBackspin, 'backspinRpm');
    bindSlider(this.dom.sliderSidespin, 'sidespinRpm');
    bindSlider(this.dom.sliderWindSpeed, 'windSpeedMs', () => {
      this.physics.setWind(this.launchConfig.windSpeedMs, this.launchConfig.windDirectionDeg);
    });
    bindSlider(this.dom.sliderWindDir, 'windDirectionDeg', () => {
      this.physics.setWind(this.launchConfig.windSpeedMs, this.launchConfig.windDirectionDeg);
    });
    bindSlider(this.dom.sliderSunElev, 'sunElevationDeg', (val) => {
      const baked = this.skySystem.bakeEnvironment(val);
      this.scene.environment = baked.envMap;
      this.sunDirUniform.value.copy(baked.sunDir);
      this._setShadowFrustumFocus(this.sunLight.target.position, 14);
    });

    this.dom.toggleTracer.addEventListener('change', () => {
      this.environment.setTracerVisible(this.dom.toggleTracer.checked);
    });

    // Presets
    this.dom.presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = PRESETS[btn.dataset.preset];
        if (!preset) return;
        Object.assign(this.launchConfig, preset);
        this.physics.setWind(this.launchConfig.windSpeedMs, this.launchConfig.windDirectionDeg);
        this._syncUIControlsFromConfig();
        this._announce(`Loaded preset: ${preset.label}.`);
      });
    });

    // Global keyboard controls (ignoring when typing inside controls or when modal dialog is open)
    window.addEventListener('keydown', (e) => {
      if (this.dom.inspectorDialog?.open) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        // Don't double-trigger if a button itself has focus (native button activates on Space)
        if (tag === 'BUTTON') return;
        e.preventDefault();
        this.handlePrimaryAction();
      } else if (e.key === 'r' || e.key === 'R') {
        this.transitionToReloadReset(true);
      } else if (e.key === 'p' || e.key === 'P') {
        this.dom.pauseBtn.click();
      }
    });

    // Track reduced-motion live changes
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      this.reducedMotion = e.matches;
    });

    this._initSwingRefPopover();
  }

  _initSwingRefPopover() {
    const popover = document.getElementById('swing-ref-popover');
    const triggerBtn = document.getElementById('btn-swing-ref');
    const closeBtn = document.getElementById('btn-close-swing-ref');
    const previewImg = document.getElementById('swing-ref-img');
    const phasePill = document.getElementById('swing-ref-phase');
    const captionEl = document.getElementById('swing-ref-caption');
    const frameSlider = document.getElementById('ctrl-swing-frame');
    const frameOut = document.getElementById('out-swing-frame');
    const prevBtn = document.getElementById('btn-frame-prev');
    const nextBtn = document.getElementById('btn-frame-next');
    const playBtn = document.getElementById('btn-frame-play');
    const resetBtn = document.getElementById('btn-frame-reset');
    const grid = document.getElementById('swing-ref-grid');
    if (!popover || !grid) return;

    this._swingRefActiveFrame = 1;
    this._swingRefSweepTimer = null;
    const thumbButtons = [];

    const stopSweep = () => {
      if (this._swingRefSweepTimer) {
        clearInterval(this._swingRefSweepTimer);
        this._swingRefSweepTimer = null;
      }
      if (playBtn) playBtn.textContent = 'Step Sweep';
    };

    const selectFrame = (frameNum, applyTo3D = true) => {
      const clamped = Math.max(1, Math.min(SWING_25_KEYFRAMES.length, Math.round(frameNum)));
      this._swingRefActiveFrame = clamped;
      const kf = SWING_25_KEYFRAMES[clamped - 1];
      if (!kf) return;

      const resolvedImgUrl = new URL(`../${kf.image.replace(/^\.?\//, '')}`, import.meta.url).href;
      previewImg.src = resolvedImgUrl;
      previewImg.alt = `Frame ${String(kf.frame).padStart(2, '0')}: ${kf.label}`;
      phasePill.textContent = `${kf.phaseNum}. ${kf.phase}`;
      captionEl.textContent = kf.label;
      frameSlider.value = String(kf.frame);
      frameOut.textContent = `Frame ${String(kf.frame).padStart(2, '0')} / 25`;

      thumbButtons.forEach((btn, idx) => {
        if (idx === clamped - 1) {
          btn.setAttribute('aria-current', 'true');
        } else {
          btn.removeAttribute('aria-current');
        }
      });

      if (applyTo3D && this.state === GAME_STATES.TEE_ADDRESS) {
        this.golfer.setPreviewFrame(kf.frame);
      }
    };

    for (const kf of SWING_25_KEYFRAMES) {
      const thumbImgUrl = new URL(`../${kf.image.replace(/^\.?\//, '')}`, import.meta.url).href;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swing-thumb-btn';
      btn.setAttribute('role', 'listitem');
      btn.title = `${kf.phaseNum}. ${kf.phase} — ${kf.label}`;
      btn.innerHTML =
        `<img src="${thumbImgUrl}" alt="${kf.label}" width="64" height="85" loading="lazy" fetchpriority="low">` +
        `<span class="swing-thumb-num">${String(kf.frame).padStart(2, '0')}</span>`;
      btn.addEventListener('click', () => {
        stopSweep();
        selectFrame(kf.frame, true);
      });
      grid.appendChild(btn);
      thumbButtons.push(btn);
    }

    frameSlider.addEventListener('input', () => {
      stopSweep();
      selectFrame(parseInt(frameSlider.value, 10), true);
    });

    prevBtn.addEventListener('click', () => {
      stopSweep();
      const prev = this._swingRefActiveFrame > 1 ? this._swingRefActiveFrame - 1 : 25;
      selectFrame(prev, true);
    });

    nextBtn.addEventListener('click', () => {
      stopSweep();
      const next = this._swingRefActiveFrame < 25 ? this._swingRefActiveFrame + 1 : 1;
      selectFrame(next, true);
    });

    playBtn.addEventListener('click', () => {
      if (this._swingRefSweepTimer) {
        stopSweep();
        return;
      }
      playBtn.textContent = 'Stop Sweep';
      this._swingRefSweepTimer = setInterval(() => {
        const next = this._swingRefActiveFrame < 25 ? this._swingRefActiveFrame + 1 : 1;
        selectFrame(next, true);
      }, 240);
    });

    resetBtn.addEventListener('click', () => {
      stopSweep();
      selectFrame(1, false);
      this.golfer.clearPreviewFrame();
    });

    // Return focus to trigger button when closed via internal hide-popover button (accessibility best practice)
    closeBtn?.addEventListener('click', () => {
      requestAnimationFrame(() => triggerBtn?.focus());
    });

    popover.addEventListener('toggle', (e) => {
      const isOpen = e.newState === 'open';
      triggerBtn?.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        this._prevCameraMode = this.cameraDirector.mode;
        this.cameraDirector.setFaceOnSplitOffset(true);
        this.cameraDirector.setCameraMode('Camera_Face_On');
        if (this.dom.cameraSelect) this.dom.cameraSelect.value = 'Camera_Face_On';
        selectFrame(this._swingRefActiveFrame || 1, true);
      } else {
        stopSweep();
        this.golfer.clearPreviewFrame();
        this.cameraDirector.setFaceOnSplitOffset(false);
        const restoreMode = this._prevCameraMode || 'AUTO';
        this.cameraDirector.setCameraMode(restoreMode);
        if (this.dom.cameraSelect) this.dom.cameraSelect.value = restoreMode;
      }
    });

    selectFrame(1, false);
    this._selectSwingRefFrame = selectFrame;
  }

  _syncUIControlsFromConfig() {
    const c = this.launchConfig;
    this.dom.sliderClubSpeed.value = String(c.clubSpeedMs);
    this.dom.sliderLaunchAngle.value = String(c.launchElevationDeg);
    this.dom.sliderBackspin.value = String(c.backspinRpm);
    this.dom.sliderSidespin.value = String(c.sidespinRpm);
    this.dom.sliderWindSpeed.value = String(c.windSpeedMs);
    this.dom.sliderWindDir.value = String(c.windDirectionDeg);
    this.dom.sliderSunElev.value = String(c.sunElevationDeg);

    this.dom.outClubSpeed.textContent = `${c.clubSpeedMs.toFixed(1)} m/s (${Math.round(c.clubSpeedMs * MS_TO_MPH)} mph)`;
    this.dom.outLaunchAngle.textContent = `${c.launchElevationDeg.toFixed(1)}°`;
    this.dom.outBackspin.textContent = `${Math.round(c.backspinRpm)} rpm`;
    const sideDir = c.sidespinRpm > 40 ? 'Fade' : c.sidespinRpm < -40 ? 'Draw' : 'Neutral';
    this.dom.outSidespin.textContent = `${Math.round(c.sidespinRpm)} rpm (${sideDir})`;
    this.dom.outWindSpeed.textContent = `${c.windSpeedMs.toFixed(1)} m/s (${(c.windSpeedMs * MS_TO_MPH).toFixed(0)} mph)`;
    this.dom.outWindDir.textContent = `${Math.round(c.windDirectionDeg)}°`;
    this.dom.outSunElev.textContent = `${Math.round(c.sunElevationDeg)}°`;

    // Update top HUD compact wind pill
    const mph = (c.windSpeedMs * MS_TO_MPH).toFixed(0);
    this.dom.windBadge.textContent = `${mph} mph`;
    this.dom.windArrow.style.setProperty('--wind-rot', `${c.windDirectionDeg}deg`);
  }

  _announce(text) {
    if (!this.dom.liveAnnouncer || text === this.lastAnnouncement) return;
    this.lastAnnouncement = text;
    this.dom.liveAnnouncer.textContent = '';
    requestAnimationFrame(() => {
      this.dom.liveAnnouncer.textContent = text;
    });
  }

  handlePrimaryAction() {
    if (this.paused) {
      this.paused = false;
      this.dom.pauseBtn.textContent = 'Pause';
    }

    if (this.state === GAME_STATES.RELOAD_RESET) {
      this.transitionToReloadReset(true);
      return;
    }

    if (this.state !== GAME_STATES.TEE_ADDRESS) {
      return;
    }

    if (this.swingMode === 'deterministic') {
      // Exact 1-click deterministic kinetic drive per Section 1 of golfswing.md
      this.skillPowerNorm = 1.0;
      this.skillAccuracyOffset = 0.0;
      this.initiateSwing();
      return;
    }

    // Interactive Skill Swing mode (2-tap precision timing bar)
    if (this.skillPhase === 'IDLE') {
      this.skillPhase = 'POWER';
      this.skillCursor = 0.05;
      this.skillDir = 1;
      this.dom.skillGauge.hidden = false;
      this.dom.skillGaugeLabel.textContent = 'Tap to Lock Power';
      this._updateDriveButtonCopy();
    } else if (this.skillPhase === 'POWER') {
      // Peak power sits near 0.88 on the gauge
      const distFromPeak = Math.abs(this.skillCursor - 0.88);
      this.skillPowerNorm = THREE.MathUtils.clamp(1.04 - distFromPeak * 0.45, 0.72, 1.04);
      this.skillPhase = 'ACCURACY';
      this.skillCursor = 0.05;
      this.skillDir = 1;
      this.dom.skillGaugeLabel.textContent = 'Tap Center Sweet Spot';
      this._updateDriveButtonCopy();
    } else if (this.skillPhase === 'ACCURACY') {
      // Center sweet spot is 0.50 (-1 = pull/hook left, +1 = push/slice right)
      this.skillAccuracyOffset = THREE.MathUtils.clamp((this.skillCursor - 0.5) * 2.0, -1, 1);
      this.skillPhase = 'IDLE';
      this.dom.skillGauge.hidden = true;
      this.initiateSwing();
    }
  }

  initiateSwing() {
    this.state = GAME_STATES.SWING_EXECUTION;
    this.postImpactTimer = 0;
    this.whooshPlayed = false;
    this.dom.shotSummaryBanner.hidden = true;

    const effectiveClubSpeed = this.launchConfig.clubSpeedMs * this.skillPowerNorm;
    this.golfer.startSwing(effectiveClubSpeed);
    this._updateStateHUD();
    this._updateDriveButtonCopy();
    this._announce('Executing kinetic drive sequence.');
  }

  _executeImpactMomentumTransfer() {
    const c = this.launchConfig;
    const effectiveClubSpeed = c.clubSpeedMs * this.skillPowerNorm;
    const missMag = Math.abs(this.skillAccuracyOffset);
    // Sweet-spot smash factor degrades gently off-center in Skill Mode
    const smashModifier = this.swingMode === 'skill' ? 1.0 - missMag * 0.08 : 1.0;

    // Face angle error induces launch azimuth & realistic gear-effect sidespin
    const faceAzimError = this.swingMode === 'skill' ? this.skillAccuracyOffset * 5.2 : 0;
    const faceSidespinError = this.swingMode === 'skill' ? this.skillAccuracyOffset * 920 : 0;

    this.physics.launch({
      clubSpeedMs: effectiveClubSpeed,
      launchElevationDeg: c.launchElevationDeg,
      launchAzimuthDeg: c.launchAzimuthDeg + faceAzimError,
      backspinRpm: c.backspinRpm + missMag * 280,
      sidespinRpm: c.sidespinRpm + faceSidespinError,
      smashModifier,
    });

    // Trigger physical sensory feedback on impact frame
    this.audio.playDriverImpact(effectiveClubSpeed, smashModifier);
    this.cameraDirector.triggerImpactShake();
    this.cameraDirector.prepareLandingCamera(this.physics.predictedLandingPos);
    this.environment.kickWoodenTee(effectiveClubSpeed);
    this.environment.spawnTurfBurst(new THREE.Vector3(0, 0.01, 0), 'fairway', 0.45);

    // Update immediate launch telemetry
    this.dom.telBallSpeed.textContent = `${Math.round(this.physics.launchSpeedMs * MS_TO_MPH)} mph`;
    this.dom.telLaunch.textContent = `${this.physics.launchAngleDeg.toFixed(1)}°`;
    this.dom.telSpin.textContent = `${Math.round(this.physics.initialBackspinRpm)} rpm`;
  }

  transitionToReloadReset(immediate = false) {
    this.state = GAME_STATES.RELOAD_RESET;
    this.reloadDwellTimer = 0;

    if (immediate) {
      this._completeNonDestructiveReload();
    } else {
      this._showShotSummary();
      this._updateStateHUD();
      this._updateDriveButtonCopy();
    }
  }

  _completeNonDestructiveReload() {
    // Non-destructive USD stage reload: zero transform caches without memory reallocation (Section 1 & 8)
    this.physics.resetToTee();
    this.golfer.resetToAddress();
    this.environment.resetTee();
    this.cameraDirector.snapToAddress();
    this._setShadowFrustumFocus(new THREE.Vector3(0, 0, -2), 14);
    this.usdStage.recordNonDestructiveReload();

    this.skillPhase = 'IDLE';
    this.dom.skillGauge.hidden = true;
    this.dom.shotSummaryBanner.hidden = true;
    this.state = GAME_STATES.TEE_ADDRESS;

    this.audio.playTeeReset();
    this._updateStateHUD();
    this._updateDriveButtonCopy();
    this._populateStaticInspectorData();
    this._announce('Tee reloaded. Ready at address for next drive.');
  }

  _showShotSummary() {
    const carryYds = this.physics.carryDistanceM * METERS_TO_YARDS;
    const totalYds = this.physics.totalDistanceM * METERS_TO_YARDS;
    const rolloutYds = Math.max(0, totalYds - carryYds);
    const apexYds = this.physics.apexHeightM * METERS_TO_YARDS;
    const offlineYds = this.physics.offlineM * METERS_TO_YARDS;
    const surfProps = getSurfacePhysicsProps(this.physics.landingSurface);

    if (totalYds > this.bestTotalYds) this.bestTotalYds = totalYds;
    if (carryYds > this.bestCarryYds) this.bestCarryYds = carryYds;

    const shotNum = this.shotHistory.length + 1;
    const offlineStr =
      Math.abs(offlineYds) < 0.8
        ? 'Center'
        : `${Math.abs(offlineYds).toFixed(1)}y ${offlineYds > 0 ? 'R' : 'L'}`;

    this.shotHistory.unshift({
      num: shotNum,
      ballMph: Math.round(this.physics.launchSpeedMs * MS_TO_MPH),
      launchDeg: this.physics.launchAngleDeg.toFixed(1),
      spinRpm: Math.round(this.physics.initialBackspinRpm),
      carryYds: carryYds.toFixed(1),
      totalYds: totalYds.toFixed(1),
      apexFt: Math.round(this.physics.apexHeightM * 3.28084),
      offline: offlineStr,
      surface: surfProps.label,
    });
    if (this.shotHistory.length > 20) this.shotHistory.pop();

    this.dom.summaryTotal.textContent = `${totalYds.toFixed(1)} yds`;
    this.dom.summaryDetail.textContent = `Carry ${carryYds.toFixed(1)} yds · Roll ${rolloutYds.toFixed(1)} yds · Apex ${Math.round(apexYds * 3)} ft · ${offlineStr}`;
    this.dom.summarySurface.textContent = surfProps.label;
    this.dom.shotSummaryBanner.hidden = false;

    this.dom.telBest.textContent = `${this.bestTotalYds.toFixed(1)} yds`;
    this.dom.telShotCount.textContent = String(shotNum);

    this._renderShotHistoryTable();
    this._announce(
      `Drive complete. Total distance ${totalYds.toFixed(0)} yards, carry ${carryYds.toFixed(0)} yards, landed on ${surfProps.label}. Reloading tee.`
    );
  }

  _updateStateHUD() {
    const meta = STATE_METADATA[this.state];
    this.dom.stateBadge.textContent = this.state;
    this.dom.stateBadge.dataset.state = meta.shortLabel.toLowerCase();

    const camSpec = this.cameraDirector.getActiveSpec();
    this.dom.cameraBadge.textContent = `${camSpec.id} · ${camSpec.focalLengthMm}mm ${camSpec.aperture}`;
  }

  _updateDriveButtonCopy() {
    const btn = this.dom.driveBtn;
    if (this.state === GAME_STATES.TEE_ADDRESS) {
      btn.disabled = false;
      if (this.swingMode === 'skill') {
        if (this.skillPhase === 'IDLE') {
          this.dom.driveLabel.textContent = 'START SWING';
          this.dom.driveSub.textContent = 'Skill Timing · Space';
        } else if (this.skillPhase === 'POWER') {
          this.dom.driveLabel.textContent = 'SET POWER';
          this.dom.driveSub.textContent = 'Tap at Peak · Space';
        } else {
          this.dom.driveLabel.textContent = 'STRIKE BALL';
          this.dom.driveSub.textContent = 'Hit Center · Space';
        }
      } else {
        this.dom.driveLabel.textContent = 'DRIVE';
        this.dom.driveSub.textContent = 'Deterministic Swing · Space';
      }
    } else if (this.state === GAME_STATES.RELOAD_RESET) {
      btn.disabled = false;
      this.dom.driveLabel.textContent = 'TEE NEXT';
      this.dom.driveSub.textContent = 'Instant Reload · Space';
    } else {
      btn.disabled = true;
      this.dom.driveLabel.textContent = STATE_METADATA[this.state].shortLabel;
      this.dom.driveSub.textContent = 'Simulation Active';
    }
  }

  _updateTelemetryReadout() {
    if (this.state === GAME_STATES.TEE_ADDRESS) return;
    const carryM = this.physics.hasBounced ? this.physics.carryDistanceM : this.physics.totalDistanceM;
    this.dom.telCarry.textContent = `${(carryM * METERS_TO_YARDS).toFixed(1)} yds`;
    this.dom.telTotal.textContent = `${(this.physics.totalDistanceM * METERS_TO_YARDS).toFixed(1)} yds`;
    this.dom.telApex.textContent = `${Math.round(this.physics.apexHeightM * 3.28084)} ft`;
  }

  _populateStaticInspectorData() {
    // 1. PBR Validation & ACES Color Pipeline Audit
    const pbrRows = pbrAuditRecords
      .map(
        (r) => `
      <tr>
        <td>${r.name}</td>
        <td>${r.type}</td>
        <td><code>rgb(${r.srgb.join(', ')})</code></td>
        <td>${r.bounds}</td>
        <td><span class="badge-pass">${r.passed ? 'VALID' : 'CLAMPED'}</span></td>
      </tr>`
      )
      .join('');

    this.dom.pbrContainer.innerHTML = `
      <p class="inspector-note">
        Working space: <strong>Linear Floating-Point</strong> &rarr; Output Transform: <strong>ACES Filmic (RRT + ODT)</strong>.
        Color maps tagged <code>Utility - sRGB - Texture</code>; roughness, normal, and metallic data maps strictly <code>Utility - Raw</code>.
      </p>
      <div class="table-scroll">
        <table>
          <caption>PBR Reflectance Range &amp; Metallicity Audit (${pbrAuditRecords.length} validated materials)</caption>
          <thead>
            <tr>
              <th scope="col">Material Asset</th>
              <th scope="col">Class</th>
              <th scope="col">sRGB BaseColor</th>
              <th scope="col">Spec Bounds</th>
              <th scope="col">Audit</th>
            </tr>
          </thead>
          <tbody>${pbrRows}</tbody>
        </table>
      </div>
    `;

    // 2. OpenUSD LIVRPS Layered Stage Diagnostics
    const layers = this.usdStage.getStageDiagnostics();
    const skel = this.golfer.getSkeletonVerification();
    const usdRows = layers
      .map(
        (l) => `
      <tr>
        <td><code>${l.file}</code></td>
        <td>${l.arc}</td>
        <td>${l.nodeCount} prims (${l.meshCount} renderable)</td>
        <td>${l.role}</td>
      </tr>`
      )
      .join('');

    this.dom.usdContainer.innerHTML = `
      <p class="inspector-note">
        Root Stage: <code>shot_teedrive_01.usda</code> &middot; Non-Destructive Reloads: <strong>${this.usdStage.reloadCount}</strong>
        &middot; Standardized Bones Verified: <strong>${skel.presentCount}/${skel.expectedCount}</strong>
        &middot; ARKit Blendshapes: <strong>${skel.arkitBlendshapeCount}/52</strong>
      </p>
      <div class="table-scroll">
        <table>
          <caption>OpenUSD LIVRPS Composed SubLayer Hierarchy</caption>
          <thead>
            <tr>
              <th scope="col">Layer File</th>
              <th scope="col">LIVRPS Arc</th>
              <th scope="col">Prim Count</th>
              <th scope="col">Department Responsibility</th>
            </tr>
          </thead>
          <tbody>${usdRows}</tbody>
        </table>
      </div>
    `;
  }

  _updateLiveBiomechanicsInspector() {
    if (!this.dom.inspectorDialog?.open) return;

    const rbf = this.golfer.rbfWeights;
    const mus = this.golfer.muscleStress;
    const au = this.golfer.facsAU;

    const barRow = (label, val) => {
      const pct = Math.round(Math.max(0, Math.min(1, val)) * 100);
      return `
        <div class="metric-bar-row">
          <span class="metric-bar-label">${label}</span>
          <div class="metric-bar-track" style="--bar-pct: ${pct}%">
            <div class="metric-bar-fill"></div>
          </div>
          <span class="metric-bar-val">${val.toFixed(2)}</span>
        </div>`;
    };

    this.dom.bioContainer.innerHTML = `
      <div class="bio-grid">
        <div>
          <h4>SO(3) RBF Pose Space Deformation W<sub>k</sub>(q)</h4>
          ${barRow('Left Deltoid Corrective', rbf.leftDeltoid)}
          ${barRow('Right Deltoid Corrective', rbf.rightDeltoid)}
          ${barRow('Forearm Pronation Anti-Twist', rbf.leftForearmPronation)}
          ${barRow('Right Elbow Flexion Volume', rbf.rightElbowFlexion)}
          ${barRow('Thoracic X-Factor Torque', rbf.thoracicTorque)}
        </div>
        <div>
          <h4>Volumetric Muscle Stress &amp; Fascia</h4>
          ${barRow('Latissimus Dorsi (FEM)', mus.latissimusDorsi)}
          ${barRow('Pectoralis Major (FEM)', mus.pectoralisMajor)}
          ${barRow('Biceps Brachii / Triceps', (mus.bicepsBrachii + mus.triceps) * 0.5)}
          ${barRow('Forearm Extensors', mus.forearmExtensors)}
          ${barRow('Subcutaneous Jiggle Inertia', mus.fasciaDampingJiggle)}
        </div>
        <div>
          <h4>FACS Action Units (52 ARKit Rig)</h4>
          ${barRow('AU1 · Inner Brow Raiser (Focus)', au.AU1)}
          ${barRow('AU4 · Brow Lowerer (Downswing)', au.AU4)}
          ${barRow('AU9 · Nose Wrinkler (Impact)', au.AU9)}
          ${barRow('AU12 · Lip Corner Puller (Follow)', au.AU12)}
          ${barRow('AU26 · Jaw Drop (Release)', au.AU26)}
        </div>
      </div>
    `;
  }

  _renderShotHistoryTable() {
    if (this.shotHistory.length === 0) {
      this.dom.historyBody.innerHTML =
        '<tr><td colspan="9" class="empty-cell">No drives recorded yet. Press DRIVE or Space to tee off.</td></tr>';
      return;
    }
    this.dom.historyBody.innerHTML = this.shotHistory
      .map(
        (s) => `
      <tr>
        <td>#${s.num}</td>
        <td>${s.ballMph} mph</td>
        <td>${s.launchDeg}°</td>
        <td>${s.spinRpm} rpm</td>
        <td>${s.carryYds} yds</td>
        <td><strong>${s.totalYds} yds</strong></td>
        <td>${s.apexFt} ft</td>
        <td>${s.offline}</td>
        <td>${s.surface}</td>
      </tr>`
      )
      .join('');
  }

  _animate(now) {
    requestAnimationFrame((ts) => this._animate(ts));

    const dt = Math.min((now - this.lastFrameTs) / 1000, 0.05);
    this.lastFrameTs = now;

    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // 1. Update sky cloud drift & wind-animated environment foliage
    this.skySystem.skyUniforms.uTime.value += dt;
    this.environment.update(dt, this.launchConfig.windSpeedMs, this.launchConfig.windDirectionDeg);

    // 2. Update Interactive Skill Timing Gauge if active
    if (this.state === GAME_STATES.TEE_ADDRESS && this.skillPhase !== 'IDLE') {
      const speed = this.skillPhase === 'POWER' ? 1.35 : 1.75;
      this.skillCursor += this.skillDir * speed * dt;
      if (this.skillCursor >= 1.0) {
        this.skillCursor = 1.0;
        this.skillDir = -1;
      } else if (this.skillCursor <= 0.0) {
        this.skillCursor = 0.0;
        this.skillDir = 1;
      }
      this.dom.skillGaugeCursor.style.setProperty('--meter-pos', `${(this.skillCursor * 100).toFixed(2)}%`);
    }

    // 3. Deterministic State Machine Tick
    const golferResult = this.golfer.update(dt, this.launchConfig.windSpeedMs);

    if (this.state === GAME_STATES.SWING_EXECUTION) {
      if (!this.whooshPlayed && this.golfer.swingTime >= SWING_TIMING.TRANSITION_END_S) {
        this.whooshPlayed = true;
        this.audio.playSwingWhoosh(this.launchConfig.clubSpeedMs * this.skillPowerNorm);
      }

      if (golferResult.impactJustOccurred) {
        this._executeImpactMomentumTransfer();
      }

      if (this.golfer.impactTriggered) {
        this.physics.step(dt);
        this.postImpactTimer += dt;
        // Brief 0.14s cinematic beat so player feels the titanium strike before cutting to Chase Cam
        if (this.postImpactTimer >= SWING_TIMING.POST_IMPACT_CUT_DELAY_S) {
          this.state = GAME_STATES.BALL_FLIGHT;
          this._updateStateHUD();
          this._updateDriveButtonCopy();
        }
      }
    } else if (this.state === GAME_STATES.BALL_FLIGHT) {
      const ev = this.physics.step(dt);
      if (ev.firstLanding) {
        this.state = GAME_STATES.LANDING_ROLLOUT;
        this.audio.playTurfBounce(ev.bounceSpeed, ev.bounceSurface);
        this.environment.spawnTurfBurst(ev.bouncePos, ev.bounceSurface, Math.min(1.3, ev.bounceSpeed / 12));
        this._setShadowFrustumFocus(ev.bouncePos, 24);
        this._updateStateHUD();
        this._updateDriveButtonCopy();
      }
    } else if (this.state === GAME_STATES.LANDING_ROLLOUT) {
      const ev = this.physics.step(dt);
      if (ev.bounced) {
        this.audio.playTurfBounce(ev.bounceSpeed, ev.bounceSurface);
        this.environment.spawnTurfBurst(ev.bouncePos, ev.bounceSurface, Math.min(0.9, ev.bounceSpeed / 14));
      }
      // Keep sharp shadow frustum centered on rolling golf ball downrange
      this._setShadowFrustumFocus(this.physics.position, 20);

      if (ev.cameToRest || this.physics.atRest) {
        this.transitionToReloadReset(false);
      }
    } else if (this.state === GAME_STATES.RELOAD_RESET) {
      this.reloadDwellTimer += dt;
      if (this.reloadDwellTimer >= SWING_TIMING.RELOAD_DWELL_S) {
        this._completeNonDestructiveReload();
      }
    }

    // 4. Sync visual ball mesh, spin orientation, motion blur streak, and tracer ribbon
    this.cameraDirector.update(dt, this.state, this.golfer, this.physics, this.reducedMotion);
    this.environment.syncBallAndTracer(this.physics, this.camera.position);

    // 5. Update live broadcast HUD and Inspector telemetry
    this._updateStateHUD();
    this._updateTelemetryReadout();

    this.inspectorUpdateAccum += dt;
    if (this.inspectorUpdateAccum >= 0.08) {
      this.inspectorUpdateAccum = 0;
      this._updateLiveBiomechanicsInspector();
    }

    // 6. Render linear HDR scene through ACES Filmic Output Transform
    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__golfSimApp = new GolfDrivingSimulatorApp();
});

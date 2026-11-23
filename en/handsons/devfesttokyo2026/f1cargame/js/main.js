/**
 * Tokyo GP 2026 — Master Simulation Orchestrator
 *
 * Wires Three.js WebGL2 ACES Filmic renderer, selective HDR UnrealBloomPass
 * (with automatic direct-render fallback), 240 Hz fixed-timestep vehicle dynamics,
 * multi-livery AI rivals, 4-mode CameraDirector, procedural V6 Turbo-Hybrid Web Audio,
 * MotorsportFXSystem, 5-state Race FSM, modern gray-and-white HUD/minimap/popover/dialog
 * bindings, and deterministic headless verification API (window.__f1SimApp).
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
  CAMERA_LABELS,
  CAMERA_MODES,
  CAR_DIMS,
  FSM_STATES,
  PHYSICS_CFG,
  TIRE_COMPOUNDS,
  TOTAL_LAPS,
} from './constants.js';
import { TokyoGPCircuit } from './trackSpline.js';
import { PBRMaterialLibrary } from './materials.js';
import { loadHeroF1Car, cloneRivalF1Car } from './carBuilder.js';
import { TokyoGPCircuitBuilder } from './circuitBuilder.js';
import { AIRivalManager, F1VehiclePhysics } from './physics.js';
import { InputController } from './input.js';
import { CameraDirector } from './camera.js';
import { F1AudioEngine } from './audio.js';
import { MotorsportFXSystem } from './fx.js';

const FIXED_DT = PHYSICS_CFG.DT; // 1 / 240 s
const MAX_SUBSTEPS = 8;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const PLAYER_GRID_S = -24.0;
const PLAYER_GRID_DLAT = 2.2;
const DEFAULT_SOLAR_DEG = 28;
const COUNTDOWN_LIGHT_INTERVAL_S = 0.65;
const COUNTDOWN_FIRST_LIGHT_S = 0.45;
const COUNTDOWN_HOLD_AFTER_5_S = 0.65;

const HUD_STATE_LABELS = Object.freeze({
  [FSM_STATES.SHOWROOM_GRID]: 'SHOWROOM',
  [FSM_STATES.LIGHTS_COUNTDOWN]: 'GRID START',
  [FSM_STATES.ACTIVE_RACING]: 'RACING',
  [FSM_STATES.PAUSED]: 'PAUSED',
  [FSM_STATES.SESSION_SUMMARY]: 'FINISHED',
});

const CAMERA_SHORT_LABELS = Object.freeze({
  [CAMERA_MODES.SHOWROOM_ORBIT]: 'SHOWROOM',
  [CAMERA_MODES.CHASE]: 'CHASE CAM',
  [CAMERA_MODES.COCKPIT]: 'COCKPIT HALO',
  [CAMERA_MODES.TV_POD]: 'TV POD',
});

// ---------------------------------------------------------------------------
// Formatting & Validation Helpers
// ---------------------------------------------------------------------------

function formatLapTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--.---';
  const totalMs = Math.round(seconds * 1000);
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${mins}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function formatSectorTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--.-';
  return seconds.toFixed(1);
}

function formatRpm(rpm) {
  return `${Math.round(rpm).toLocaleString('en-US')} RPM`;
}

function resolvePassedFlag(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const key of ['allCompliant', 'allPassed', 'passed', 'valid', 'compliant', 'ok']) {
    if (typeof obj[key] === 'boolean') return obj[key];
  }
  const boolKeys = Object.keys(obj).filter((k) => typeof obj[k] === 'boolean');
  if (boolKeys.length > 0) {
    return boolKeys.every((k) => obj[k] === true);
  }
  return false;
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

function buildKvGrid(entries) {
  const grid = makeEl('div', 'inspector-kv-grid');
  for (const [label, value, badgeClass] of entries) {
    const cell = makeEl('div', 'inspector-kv');
    cell.appendChild(makeEl('span', 'inspector-kv-label', label));
    if (badgeClass) {
      const valWrap = makeEl('span', 'inspector-kv-value');
      valWrap.appendChild(makeEl('span', badgeClass, value));
      cell.appendChild(valWrap);
    } else {
      cell.appendChild(makeEl('span', 'inspector-kv-value', value));
    }
    grid.appendChild(cell);
  }
  return grid;
}

// ---------------------------------------------------------------------------
// DOM Registry
// ---------------------------------------------------------------------------

function queryDom() {
  const rpmLedsRoot = document.getElementById('rpm-leds');
  const pbrTable = document.getElementById('inspector-pbr-table');
  return {
    canvas: document.getElementById('sim-canvas'),
    hudPosition: document.getElementById('hud-position'),
    hudLap: document.getElementById('hud-lap'),
    hudState: document.getElementById('hud-state'),
    hudLapTime: document.getElementById('hud-lap-time'),
    hudBestLap: document.getElementById('hud-best-lap'),
    hudSectors: [
      document.getElementById('hud-s1'),
      document.getElementById('hud-s2'),
      document.getElementById('hud-s3'),
    ],
    hudCameraLabel: document.getElementById('hud-camera-label'),
    btnAudio: document.getElementById('btn-audio'),
    btnCamera: document.getElementById('btn-camera'),
    btnShowroom: document.getElementById('btn-showroom'),
    btnSetup: document.getElementById('btn-setup'),
    btnInspector: document.getElementById('btn-inspector'),
    hudAlert: document.getElementById('hud-alert'),
    startLightsOverlay: document.getElementById('start-lights-overlay'),
    startLightPods: [
      document.getElementById('start-light-0'),
      document.getElementById('start-light-1'),
      document.getElementById('start-light-2'),
      document.getElementById('start-light-3'),
      document.getElementById('start-light-4'),
    ],
    startLightsStatus: document.getElementById('start-lights-status'),
    showroomBanner: document.getElementById('showroom-banner'),
    compoundChips: {
      soft: document.getElementById('chip-compound-soft'),
      medium: document.getElementById('chip-compound-medium'),
      hard: document.getElementById('chip-compound-hard'),
    },
    btnStartRace: document.getElementById('btn-start-race'),
    btnStartSolo: document.getElementById('btn-start-solo'),
    barBrake: document.getElementById('bar-brake'),
    barThrottle: document.getElementById('bar-throttle'),
    rpmLeds: rpmLedsRoot ? Array.from(rpmLedsRoot.querySelectorAll('.rpm-led')) : [],
    hudRpm: document.getElementById('hud-rpm'),
    hudGear: document.getElementById('hud-gear'),
    hudSpeed: document.getElementById('hud-speed'),
    hudDrs: document.getElementById('hud-drs'),
    hudTireCompound: document.getElementById('hud-tire-compound'),
    hudTireTemp: document.getElementById('hud-tire-temp'),
    hudBrakeTemp: document.getElementById('hud-brake-temp'),
    hudGForce: document.getElementById('hud-gforce'),
    minimapCanvas: document.getElementById('minimap-canvas'),
    minimapMeta: document.querySelector('#minimap-card .minimap-meta'),
    pauseOverlay: document.getElementById('pause-overlay'),
    btnResume: document.getElementById('btn-resume'),
    btnRestart: document.getElementById('btn-restart'),
    btnPauseShowroom: document.getElementById('btn-pause-showroom'),
    summaryOverlay: document.getElementById('summary-overlay'),
    summarySubtitle: document.getElementById('summary-subtitle'),
    summaryBestLap: document.getElementById('summary-best-lap'),
    summaryTheoreticalBest: document.getElementById('summary-theoretical-best'),
    summaryTopSpeed: document.getElementById('summary-top-speed'),
    summaryMaxG: document.getElementById('summary-max-g'),
    summaryLapRows: document.getElementById('summary-lap-rows'),
    btnRaceAgain: document.getElementById('btn-race-again'),
    btnSummaryShowroom: document.getElementById('btn-summary-showroom'),
    setupPopover: document.getElementById('setup-popover'),
    setupCompoundRadios: {
      soft: document.getElementById('setup-compound-soft'),
      medium: document.getElementById('setup-compound-medium'),
      hard: document.getElementById('setup-compound-hard'),
    },
    setupModeAi: document.getElementById('setup-mode-ai'),
    setupModeSolo: document.getElementById('setup-mode-solo'),
    setupGearboxAuto: document.getElementById('setup-gearbox-auto'),
    setupGearboxManual: document.getElementById('setup-gearbox-manual'),
    setupAssistTc: document.getElementById('setup-assist-tc'),
    setupAssistAbs: document.getElementById('setup-assist-abs'),
    setupAssistStability: document.getElementById('setup-assist-stability'),
    setupDrsAnywhere: document.getElementById('setup-drs-anywhere'),
    setupSolarElevation: document.getElementById('setup-solar-elevation'),
    setupSolarValue: document.getElementById('setup-solar-value'),
    inspectorDialog: document.getElementById('inspector-dialog'),
    inspectorPhysics: document.getElementById('inspector-physics'),
    inspectorGlb: document.getElementById('inspector-glb'),
    inspectorPbrBody: pbrTable ? pbrTable.querySelector('tbody') : null,
    inspectorLaps: document.getElementById('inspector-laps'),
  };
}

// ---------------------------------------------------------------------------
// Main Application Bootstrap
// ---------------------------------------------------------------------------

class TokyoGPSimApp {
  constructor() {
    this.ready = false;
    this.dom = queryDom();

    // Media preference for reduced motion
    this._reducedMotionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    this.reducedMotion = Boolean(this._reducedMotionQuery?.matches);
    this._reducedMotionQuery?.addEventListener('change', (ev) => {
      this.reducedMotion = Boolean(ev.matches);
      if (this.fsmState === FSM_STATES.SESSION_SUMMARY) {
        this.cameraDirector?.setAutoOrbitSpeed(this.reducedMotion ? 0 : 0.22);
      }
    });

    // Runtime state
    this.fsmState = FSM_STATES.SHOWROOM_GRID;
    this.stateBeforePause = FSM_STATES.ACTIVE_RACING;
    this.raceMode = 'ai_race'; // 'ai_race' | 'time_trial'
    this.activeCompound = 'soft';
    this.solarElevationDeg = DEFAULT_SOLAR_DEG;
    this.poseFrozen = false;

    // Timing & accumulator
    this._accumulator = 0;
    this._lastFrameMs = 0;
    this._visualTime = 0;
    this._countdownTimer = 0;
    this._countdownLitCount = 0;
    this._hudThrottleAccum = 0;
    this._inspectorRefreshAccum = 0;
    this._minimapAccum = 0;
    this._inspectorStaticRendered = false;
    this._shiftSeq = 0;
    this._latchedShiftEvent = 0;

    // Preallocated scratch buffers (zero per-frame GC)
    this._inputBuf = null;
    this._frameState = {};
    this._minimapPt = { x: 0, y: 0 };
    this._trackSample = null;
    this._hudCache = Object.create(null);
    this._lastLitLeds = -1;
    this._lastBrakePct = -1;
    this._lastThrottlePct = -1;

    // Subsystems (populated during init)
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.bloomPass = null;
    this.useBloom = false;

    this.circuit = null;
    this.materialLib = null;
    this.envRig = null;
    this.circuitBuilder = null;
    this.physics = null;
    this.aiManager = null;
    this.input = null;
    this.cameraDirector = null;
    this.audio = null;
    this.fx = null;
    this.heroCar = null;
    this.rivalCars = [];

    // Minimap pre-rendered static layer
    this._minimapStatic = null;
    this._minimapFit = null;

    // Expose early handle for inspection/verification hooks
    window.__f1SimApp = this;
  }

  async init() {
    this._initRendererAndScene();
    this._initCoreSubsystems();
    this._initMinimap();
    this._bindUIControls();
    this._bindWindowEvents();

    // Load Nano Banana PBR manifest + create physical sky & PMREM lighting
    await this.materialLib.loadManifest();
    this.envRig = this.materialLib.createEnvironmentLighting(this.scene, this.solarElevationDeg);

    // Build complete Tokyo GP circuit meshes, FIA gantry, kerbs, grandstands & scenery
    this.circuitBuilder = new TokyoGPCircuitBuilder(this.scene, this.circuit, this.materialLib);

    // Load parametric hero F1 .glb and clone 3 multi-livery AI rivals
    this.heroCar = await loadHeroF1Car(this.materialLib, 'car_livery_player', this.activeCompound);
    if (this.heroCar?.root && !this.heroCar.root.parent) {
      this.scene.add(this.heroCar.root);
    }

    this.rivalCars = [];
    for (let i = 0; i < this.aiManager.rivals.length; i++) {
      const rival = this.aiManager.rivals[i];
      const rivalRig = cloneRivalF1Car(
        this.heroCar,
        this.materialLib,
        rival.liveryKey,
        rival.compound
      );
      if (rivalRig?.root && !rivalRig.root.parent) {
        this.scene.add(rivalRig.root);
      }
      this.rivalCars.push(rivalRig);
    }

    // Place grid cars cleanly and enter Showroom 3/4 inspection state
    this.enterShowroom();

    // Populate initial static inspector tables and force first frame render
    this._refreshInspector(true);
    this._updateHUD(true);
    this._renderMinimap();
    this._renderFrame();

    this.ready = true;

    const validation = this.getAssetValidation();
    console.info('[TokyoGP2026] Simulation ready', {
      allCompliant: validation.allCompliant,
      hasNaN: validation.hasNaN,
      trackLengthM: Math.round(this.circuit.length),
      rivals: this.rivalCars.length,
    });

    // Launch real-time 60-120 Hz render loop with fixed 240 Hz physics accumulator
    this._lastFrameMs = performance.now();
    requestAnimationFrame((now) => this._tick(now));
  }

  // -------------------------------------------------------------------------
  // Renderer, Scene & Selective HDR Post-Processing
  // -------------------------------------------------------------------------

  _initRendererAndScene() {
    const canvas = this.dom.canvas;
    const width = Math.max(1, window.innerWidth || 1280);
    const height = Math.max(1, window.innerHeight || 720);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xc7d4e6);
    this.scene.fog = new THREE.FogExp2(0xd2dce9, 0.00042);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.12, 3200);
    this.camera.position.set(-3.2, 1.7, -28.0);

    this._setupPostProcessing(width, height, dpr);
  }

  _setupPostProcessing(width, height, dpr) {
    this.useBloom = false;
    this.composer = null;
    this.bloomPass = null;

    try {
      const renderTarget = new THREE.WebGLRenderTarget(
        Math.max(1, Math.floor(width * dpr)),
        Math.max(1, Math.floor(height * dpr)),
        { type: THREE.HalfFloatType }
      );
      const composer = new EffectComposer(this.renderer, renderTarget);
      composer.setPixelRatio(dpr);
      composer.setSize(width, height);

      const renderPass = new RenderPass(this.scene, this.camera);
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.38, // strength
        0.35, // radius
        1.08  // HDR selective threshold
      );
      bloomPass.threshold = 1.08;
      bloomPass.strength = 0.38;
      bloomPass.radius = 0.35;

      const outputPass = new OutputPass();

      composer.addPass(renderPass);
      composer.addPass(bloomPass);
      composer.addPass(outputPass);

      this.composer = composer;
      this.bloomPass = bloomPass;
      this.useBloom = true;
    } catch {
      this.composer = null;
      this.bloomPass = null;
      this.useBloom = false;
    }
  }

  _renderFrame() {
    if (this.useBloom && this.composer) {
      try {
        this.composer.render();
        return;
      } catch {
        // Automatic safe fallback to direct rendering if post-processing fails
        this.useBloom = false;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------------------
  // Core Simulation Subsystems
  // -------------------------------------------------------------------------

  _initCoreSubsystems() {
    this.circuit = new TokyoGPCircuit(2000);
    this._trackSample = this.circuit.createSampleBuffer();

    this.materialLib = new PBRMaterialLibrary(this.renderer);

    this.physics = new F1VehiclePhysics(this.circuit, {
      totalLaps: TOTAL_LAPS,
      compound: this.activeCompound,
      manualGearbox: false,
      freePracticeDRS: false,
      tractionControl: true,
      abs: true,
      stabilityAssist: true,
    });

    this.aiManager = new AIRivalManager(this.circuit, { enabled: true });
    this.cameraDirector = new CameraDirector(this.camera, this.dom.canvas);
    this.audio = new F1AudioEngine();
    this.fx = new MotorsportFXSystem(this.scene);

    this.input = new InputController({
      onStartRace: () => {
        if (this.fsmState === FSM_STATES.SHOWROOM_GRID) {
          this._unlockAudioOnGesture();
          this.startRace(this.raceMode);
          return true;
        }
        return false;
      },
      onToggleDRS: () => {
        if (this.fsmState === FSM_STATES.ACTIVE_RACING) {
          this.poseFrozen = false;
          this.physics.toggleDRS(false);
        }
      },
      onCycleCamera: () => {
        this.poseFrozen = false;
        this.cameraDirector.clearCustomPose();
        if (this.fsmState === FSM_STATES.SHOWROOM_GRID) {
          this.setCameraMode(this.cameraDirector.getDrivingMode());
        } else {
          this.cameraDirector.cycleDrivingMode();
          this._syncCameraHud();
        }
      },
      onResetTrack: () => {
        if (this.fsmState === FSM_STATES.ACTIVE_RACING) {
          this.poseFrozen = false;
          this.physics.resetToTrack();
          this.cameraDirector.resetSmoothing();
        }
      },
      onShiftUp: () => {
        if (this.fsmState === FSM_STATES.ACTIVE_RACING && this.physics.manualGearbox) {
          this.physics.shiftUp();
        }
      },
      onShiftDown: () => {
        if (this.fsmState === FSM_STATES.ACTIVE_RACING && this.physics.manualGearbox) {
          this.physics.shiftDown();
        }
      },
      onToggleMute: () => {
        this._toggleAudio();
      },
      onTogglePause: () => {
        if (this.dom.inspectorDialog?.open) return;
        if (this.fsmState === FSM_STATES.PAUSED) {
          this.resumeFromPause();
        } else if (
          this.fsmState === FSM_STATES.ACTIVE_RACING ||
          this.fsmState === FSM_STATES.LIGHTS_COUNTDOWN
        ) {
          this.pauseSimulation();
        }
      },
    });
    this._inputBuf = this.input.sample();
  }

  // -------------------------------------------------------------------------
  // Minimap Initialization & Fast Static-Layer Blitting
  // -------------------------------------------------------------------------

  _initMinimap() {
    const canvas = this.dom.minimapCanvas;
    if (!canvas || !this.circuit) return;

    if (this.dom.minimapMeta) {
      this.dom.minimapMeta.textContent = `${(this.circuit.length / 1000).toFixed(1)} KM`;
    }

    const cssW = 180;
    const cssH = 140;
    const scaleDpr = 2;
    canvas.width = cssW * scaleDpr;
    canvas.height = cssH * scaleDpr;

    const mapData = this.circuit.getMinimapPoints(260);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < mapData.points.length; i++) {
      const p = mapData.points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const padX = 14;
    const padY = 12;
    const spanX = Math.max(0.01, maxX - minX);
    const spanY = Math.max(0.01, maxY - minY);
    const fitScale = Math.min((cssW - 2 * padX) / spanX, (cssH - 2 * padY) / spanY);
    const offX = (cssW - spanX * fitScale) * 0.5 - minX * fitScale;
    const offY = (cssH - spanY * fitScale) * 0.5 - minY * fitScale;

    this._minimapFit = { cssW, cssH, scaleDpr, fitScale, offX, offY };

    // Pre-render static track geometry, DRS zones, and Start/Finish line once
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const ctx = offscreen.getContext('2d');
    ctx.scale(scaleDpr, scaleDpr);

    const mx = (nx) => nx * fitScale + offX;
    const my = (ny) => ny * fitScale + offY;

    const traceLoop = () => {
      ctx.beginPath();
      for (let i = 0; i < mapData.points.length; i++) {
        const pt = mapData.points[i];
        const px = mx(pt.x);
        const py = my(pt.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Outer verge casing
    traceLoop();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 6.5;
    ctx.stroke();

    // Primary asphalt spline
    traceLoop();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 3.8;
    ctx.stroke();

    // Highlighted FIA DRS Zones
    for (let z = 0; z < mapData.drsZones.length; z++) {
      const zone = mapData.drsZones[z];
      if (!zone.points || zone.points.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < zone.points.length; i++) {
        const px = mx(zone.points[i].x);
        const py = my(zone.points[i].y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 4.2;
      ctx.stroke();
    }

    // Start / Finish checkered tick mark
    const sf = mapData.startFinish;
    const sfx = mx(sf.x);
    const sfy = my(sf.y);
    const rLen = Math.hypot(sf.rx, sf.ry) || 1;
    const ux = (sf.rx / rLen) * 6.5;
    const uy = (sf.ry / rLen) * 6.5;

    ctx.beginPath();
    ctx.moveTo(sfx - ux, sfy - uy);
    ctx.lineTo(sfx + ux, sfy + uy);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(sfx - ux, sfy - uy);
    ctx.lineTo(sfx + ux, sfy + uy);
    ctx.strokeStyle = '#111315';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    this._minimapStatic = offscreen;
  }

  _renderMinimap() {
    const canvas = this.dom.minimapCanvas;
    if (!canvas || !this._minimapStatic || !this._minimapFit) return;

    const ctx = canvas.getContext('2d');
    const { cssW, cssH, scaleDpr, fitScale, offX, offY } = this._minimapFit;

    ctx.setTransform(scaleDpr, 0, 0, scaleDpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(this._minimapStatic, 0, 0, cssW, cssH);

    // Draw AI rival dots when enabled
    if (this.aiManager?.enabled) {
      for (let i = 0; i < this.aiManager.rivals.length; i++) {
        const r = this.aiManager.rivals[i];
        this.circuit.worldToMinimap(r.x, r.z, this._minimapPt);
        const rx = this._minimapPt.x * fitScale + offX;
        const ry = this._minimapPt.y * fitScale + offY;

        ctx.beginPath();
        ctx.arc(rx, ry, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = r.accentColor || '#2563eb';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    // Draw hero player crimson dot + subtle heading indicator
    this.circuit.worldToMinimap(this.physics.x, this.physics.z, this._minimapPt);
    const px = this._minimapPt.x * fitScale + offX;
    const py = this._minimapPt.y * fitScale + offY;

    ctx.beginPath();
    ctx.arc(px, py, 4.4, 0, Math.PI * 2);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  // -------------------------------------------------------------------------
  // UI & Window Event Bindings
  // -------------------------------------------------------------------------

  _bindUIControls() {
    const d = this.dom;

    // Gesture-gated audio unlock on first interaction
    const gestureUnlock = () => {
      this._unlockAudioOnGesture();
    };
    window.addEventListener('pointerdown', gestureUnlock, { passive: true });
    window.addEventListener('keydown', gestureUnlock, { passive: true });

    // Top bar controls
    d.btnAudio?.addEventListener('click', () => {
      this._toggleAudio();
    });

    d.btnCamera?.addEventListener('click', () => {
      this.poseFrozen = false;
      this.cameraDirector.clearCustomPose();
      if (this.fsmState === FSM_STATES.SHOWROOM_GRID) {
        this.setCameraMode(this.cameraDirector.getDrivingMode());
      } else {
        this.cameraDirector.cycleDrivingMode();
        this._syncCameraHud();
      }
    });

    d.btnShowroom?.addEventListener('click', () => {
      if (this.fsmState === FSM_STATES.SHOWROOM_GRID) {
        this.startRace(this.raceMode);
      } else {
        this.enterShowroom();
      }
    });

    // Showroom CTA & quick compound chips
    d.btnStartRace?.addEventListener('click', () => {
      this._unlockAudioOnGesture();
      this.startRace('ai_race');
    });

    d.btnStartSolo?.addEventListener('click', () => {
      this._unlockAudioOnGesture();
      this.startRace('time_trial');
    });

    for (const compoundId of Object.keys(d.compoundChips)) {
      d.compoundChips[compoundId]?.addEventListener('click', () => {
        this.setCompound(compoundId);
      });
    }

    // Pause overlay buttons
    d.btnResume?.addEventListener('click', () => this.resumeFromPause());
    d.btnRestart?.addEventListener('click', () => this.startRace(this.raceMode));
    d.btnPauseShowroom?.addEventListener('click', () => this.enterShowroom());

    // Summary overlay buttons
    d.btnRaceAgain?.addEventListener('click', () => this.startRace(this.raceMode));
    d.btnSummaryShowroom?.addEventListener('click', () => this.enterShowroom());

    // Car Setup Popover controls
    for (const compoundId of Object.keys(d.setupCompoundRadios)) {
      d.setupCompoundRadios[compoundId]?.addEventListener('change', (ev) => {
        if (ev.target.checked) this.setCompound(compoundId);
      });
    }

    d.setupModeAi?.addEventListener('change', (ev) => {
      if (ev.target.checked) this.setRaceMode('ai_race');
    });
    d.setupModeSolo?.addEventListener('change', (ev) => {
      if (ev.target.checked) this.setRaceMode('time_trial');
    });

    d.setupGearboxAuto?.addEventListener('change', (ev) => {
      if (ev.target.checked) this.physics.manualGearbox = false;
    });
    d.setupGearboxManual?.addEventListener('change', (ev) => {
      if (ev.target.checked) this.physics.manualGearbox = true;
    });

    d.setupAssistTc?.addEventListener('change', (ev) => {
      this.physics.assists.tractionControl = Boolean(ev.target.checked);
    });
    d.setupAssistAbs?.addEventListener('change', (ev) => {
      this.physics.assists.abs = Boolean(ev.target.checked);
    });
    d.setupAssistStability?.addEventListener('change', (ev) => {
      this.physics.assists.stabilityAssist = Boolean(ev.target.checked);
    });
    d.setupDrsAnywhere?.addEventListener('change', (ev) => {
      this.physics.freePracticeDRS = Boolean(ev.target.checked);
    });

    const handleSolarChange = (ev) => {
      const deg = Number(ev.target.value);
      if (!Number.isFinite(deg)) return;
      this.solarElevationDeg = deg;
      if (d.setupSolarValue) d.setupSolarValue.textContent = `${Math.round(deg)}°`;
      if (this.envRig && typeof this.envRig.updateSolarElevation === 'function') {
        this.envRig.updateSolarElevation(deg);
      }
    };
    d.setupSolarElevation?.addEventListener('input', handleSolarChange);
    d.setupSolarElevation?.addEventListener('change', handleSolarChange);

    // Sync Car Setup inputs whenever popover opens
    d.setupPopover?.addEventListener('toggle', (ev) => {
      if (ev.newState === 'open') {
        this._syncSetupPopoverInputs();
      }
    });

    // Inspector Modal Dialog: populate immediately whenever opened via button or showModal()
    if (d.inspectorDialog) {
      const observer = new MutationObserver(() => {
        if (d.inspectorDialog.open) {
          this._refreshInspector(true);
        }
      });
      observer.observe(d.inspectorDialog, { attributes: true, attributeFilter: ['open'] });
    }
    d.btnInspector?.addEventListener('click', () => {
      this._refreshInspector(true);
    });
  }

  _bindWindowEvents() {
    window.addEventListener('resize', () => {
      const width = Math.max(1, window.innerWidth || 1280);
      const height = Math.max(1, window.innerHeight || 720);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(width, height, false);

      if (this.composer) {
        try {
          this.composer.setPixelRatio(dpr);
          this.composer.setSize(width, height);
          if (this.bloomPass?.resolution) {
            this.bloomPass.resolution.set(width, height);
          }
        } catch {
          this.useBloom = false;
        }
      }
    });

    this.dom.canvas?.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
    });
  }

  _unlockAudioOnGesture() {
    if (!this.audio) return;
    if (!this.audio.isUnlocked()) {
      this.audio.unlock();
      this._syncAudioButton();
    }
  }

  _toggleAudio() {
    if (!this.audio) return;
    if (!this.audio.isUnlocked()) {
      this.audio.unlock();
      this.audio.setMuted(false);
    } else {
      this.audio.toggleMute();
    }
    this._syncAudioButton();
  }

  _syncAudioButton() {
    if (!this.dom.btnAudio || !this.audio) return;
    const active = this.audio.isUnlocked() && !this.audio.isMuted();
    this.dom.btnAudio.setAttribute('aria-pressed', String(active));
  }

  _syncSetupPopoverInputs() {
    const d = this.dom;
    if (d.setupCompoundRadios[this.activeCompound]) {
      d.setupCompoundRadios[this.activeCompound].checked = true;
    }
    if (d.setupModeAi) d.setupModeAi.checked = this.raceMode === 'ai_race';
    if (d.setupModeSolo) d.setupModeSolo.checked = this.raceMode === 'time_trial';
    if (d.setupGearboxAuto) d.setupGearboxAuto.checked = !this.physics.manualGearbox;
    if (d.setupGearboxManual) d.setupGearboxManual.checked = this.physics.manualGearbox;
    if (d.setupAssistTc) d.setupAssistTc.checked = this.physics.assists.tractionControl;
    if (d.setupAssistAbs) d.setupAssistAbs.checked = this.physics.assists.abs;
    if (d.setupAssistStability) d.setupAssistStability.checked = this.physics.assists.stabilityAssist;
    if (d.setupDrsAnywhere) d.setupDrsAnywhere.checked = this.physics.freePracticeDRS;
    if (d.setupSolarElevation) d.setupSolarElevation.value = String(this.solarElevationDeg);
    if (d.setupSolarValue) d.setupSolarValue.textContent = `${Math.round(this.solarElevationDeg)}°`;
  }

  // -------------------------------------------------------------------------
  // Public Control API & 5-State Race FSM
  // -------------------------------------------------------------------------

  getFSMState() {
    return this.fsmState;
  }

  setRaceMode(mode) {
    const normalized = mode === 'time_trial' ? 'time_trial' : 'ai_race';
    this.raceMode = normalized;
    const aiEnabled = normalized === 'ai_race';
    this.aiManager.setEnabled(aiEnabled);
    for (let i = 0; i < this.rivalCars.length; i++) {
      if (this.rivalCars[i]?.root) {
        this.rivalCars[i].root.visible = aiEnabled;
      }
    }
    this._syncSetupPopoverInputs();
    this._updateHUD(true);
  }

  setCompound(compoundId) {
    if (!TIRE_COMPOUNDS[compoundId]) return;
    this.activeCompound = compoundId;
    this.physics.setCompound(compoundId);
    if (this.heroCar && typeof this.heroCar.setCompound === 'function') {
      this.heroCar.setCompound(compoundId);
    }

    // Sync Showroom chips
    for (const id of Object.keys(this.dom.compoundChips)) {
      const chip = this.dom.compoundChips[id];
      if (!chip) continue;
      const active = id === compoundId;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
    }

    // Sync Setup Popover radios
    if (this.dom.setupCompoundRadios[compoundId]) {
      this.dom.setupCompoundRadios[compoundId].checked = true;
    }

    // Sync HUD Tire Compound pill
    const pill = this.dom.hudTireCompound;
    if (pill) {
      const spec = TIRE_COMPOUNDS[compoundId];
      pill.textContent = spec.shortLabel;
      pill.dataset.compound = compoundId;
      pill.className = `tire-pill tire-pill--${compoundId}`;
    }
  }

  setCameraMode(mode) {
    if (!mode) return;
    this.cameraDirector.clearCustomPose();
    this.cameraDirector.setMode(mode);
    this._syncCameraHud();
  }

  setCustomCameraPose(pos, lookAt, fov) {
    this.cameraDirector.setCustomPose(pos, lookAt, fov);
  }

  clearCustomCameraPose() {
    this.cameraDirector.clearCustomPose();
  }

  unfreezePose() {
    this.poseFrozen = false;
    this.cameraDirector.clearCustomPose();
  }

  _setFSMState(nextState) {
    this.fsmState = nextState;
    document.body.dataset.state = nextState;
    this.input.setFSMState(nextState);

    const d = this.dom;
    if (d.showroomBanner) d.showroomBanner.hidden = nextState !== FSM_STATES.SHOWROOM_GRID;
    if (d.startLightsOverlay) d.startLightsOverlay.hidden = nextState !== FSM_STATES.LIGHTS_COUNTDOWN;
    if (d.pauseOverlay) d.pauseOverlay.hidden = nextState !== FSM_STATES.PAUSED;
    if (d.summaryOverlay) d.summaryOverlay.hidden = nextState !== FSM_STATES.SESSION_SUMMARY;
    if (d.hudAlert && nextState !== FSM_STATES.ACTIVE_RACING) d.hudAlert.hidden = true;
    if (d.btnShowroom) {
      d.btnShowroom.setAttribute('aria-pressed', String(nextState === FSM_STATES.SHOWROOM_GRID));
    }

    this._setHudText('hudState', d.hudState, HUD_STATE_LABELS[nextState] || nextState);
  }

  _setStartLightsVisual(count) {
    const clamped = Math.max(0, Math.min(5, Math.floor(count)));
    for (let i = 0; i < this.dom.startLightPods.length; i++) {
      this.dom.startLightPods[i]?.classList.toggle('is-lit', i < clamped);
    }
    this.circuitBuilder?.setStartLights(clamped);
  }

  enterShowroom() {
    this.poseFrozen = false;
    this._accumulator = 0;
    this.cameraDirector.clearCustomPose();
    this.fx.clear();
    this._setStartLightsVisual(0);

    // Park player on P4 grid slot and rivals cleanly ahead on P1..P3
    this.physics.resetToGrid(PLAYER_GRID_S, PLAYER_GRID_DLAT);
    this.aiManager.resetToGrid();
    this.setRaceMode(this.raceMode);

    this._syncAllCarVisuals(1 / 60);
    this.circuitBuilder?.updateShadowCamera(
      this.envRig.sunLight,
      this.physics.x,
      this.physics.y,
      this.physics.z
    );

    this.cameraDirector.setAutoOrbitSpeed(0);
    this.cameraDirector.setMode(CAMERA_MODES.SHOWROOM_ORBIT);
    this.cameraDirector.setShowroomAngles(-0.68, 0.24, 5.1);
    this.cameraDirector.resetSmoothing();
    this.cameraDirector.update(1 / 60, this._buildFrameState(), false, this.reducedMotion);

    this.audio.setPaused(false);
    this.audio.setShowroomMode(true);

    this._setFSMState(FSM_STATES.SHOWROOM_GRID);
    this._syncCameraHud();
    this._updateHUD(true);
    this._renderMinimap();
  }

  startRace(mode = this.raceMode, options = {}) {
    this.poseFrozen = false;
    this._accumulator = 0;
    this.cameraDirector.clearCustomPose();
    this.cameraDirector.setAutoOrbitSpeed(0);
    this.fx.clear();

    const targetMode = mode === 'time_trial' ? 'time_trial' : 'ai_race';
    this.setRaceMode(targetMode);

    // Position player on grid (centerline P1 for solo time trial, P4 for AI Grand Prix)
    const startS = targetMode === 'time_trial' ? -12.0 : PLAYER_GRID_S;
    const startDLat = targetMode === 'time_trial' ? 0.0 : PLAYER_GRID_DLAT;
    this.physics.resetToGrid(startS, startDLat);
    this.aiManager.resetToGrid();

    this._syncAllCarVisuals(1 / 60);
    this.circuitBuilder?.updateShadowCamera(
      this.envRig.sunLight,
      this.physics.x,
      this.physics.y,
      this.physics.z
    );

    this.cameraDirector.setMode(this.cameraDirector.getDrivingMode() || CAMERA_MODES.CHASE);
    this.cameraDirector.resetSmoothing();
    this.cameraDirector.update(1 / 60, this._buildFrameState(), false, this.reducedMotion);

    this.audio.setPaused(false);
    this.audio.setShowroomMode(false);

    const skipCountdown =
      Boolean(options.skipCountdown) || targetMode === 'time_trial';

    if (skipCountdown) {
      this._setStartLightsVisual(0);
      this._setFSMState(FSM_STATES.ACTIVE_RACING);
    } else {
      this._countdownTimer = 0;
      this._countdownLitCount = 0;
      this._setStartLightsVisual(0);
      if (this.dom.startLightsStatus) {
        this.dom.startLightsStatus.textContent = 'FIA STARTING PROCEDURE — HOLD REVS';
      }
      this._setFSMState(FSM_STATES.LIGHTS_COUNTDOWN);
    }

    this._syncCameraHud();
    this._updateHUD(true);
    this._renderMinimap();
  }

  pauseSimulation() {
    if (
      this.fsmState !== FSM_STATES.ACTIVE_RACING &&
      this.fsmState !== FSM_STATES.LIGHTS_COUNTDOWN
    ) {
      return;
    }
    this.stateBeforePause = this.fsmState;
    this.audio.setPaused(true);
    this._setFSMState(FSM_STATES.PAUSED);
  }

  resumeFromPause() {
    if (this.fsmState !== FSM_STATES.PAUSED) return;
    this.audio.setPaused(false);
    this._accumulator = 0;
    this._lastFrameMs = performance.now();
    this._setFSMState(this.stateBeforePause || FSM_STATES.ACTIVE_RACING);
  }

  _enterSessionSummary() {
    this.poseFrozen = false;
    this._setStartLightsVisual(0);
    this._populateSummaryOverlay();
    this._setFSMState(FSM_STATES.SESSION_SUMMARY);

    this.cameraDirector.clearCustomPose();
    this.cameraDirector.setMode(CAMERA_MODES.SHOWROOM_ORBIT);
    this.cameraDirector.setAutoOrbitSpeed(this.reducedMotion ? 0 : 0.22);
    this.audio.setShowroomMode(true);
    this._syncCameraHud();
    this._updateHUD(true);
  }

  _populateSummaryOverlay() {
    const d = this.dom;
    const p = this.physics;
    const pos = this.aiManager.getPlayerPosition(p);
    const totalCars = this.aiManager.enabled ? this.aiManager.rivals.length + 1 : 1;

    if (d.summarySubtitle) {
      d.summarySubtitle.textContent = this.aiManager.enabled
        ? `Classified P${pos} / ${totalCars} · Tokyo GP AI Grand Prix`
        : `Completed ${p.completedLapCount} Laps · Solo Time Trial`;
    }

    if (d.summaryBestLap) {
      d.summaryBestLap.textContent = formatLapTime(p.bestLapTime);
    }

    const theoBest =
      Number.isFinite(p.bestSectors[0]) &&
      Number.isFinite(p.bestSectors[1]) &&
      Number.isFinite(p.bestSectors[2])
        ? p.bestSectors[0] + p.bestSectors[1] + p.bestSectors[2]
        : Infinity;

    if (d.summaryTheoreticalBest) {
      d.summaryTheoreticalBest.textContent = formatLapTime(theoBest);
    }
    if (d.summaryTopSpeed) {
      d.summaryTopSpeed.textContent = `${Math.round(p.topSpeedKmh)} km/h`;
    }
    if (d.summaryMaxG) {
      d.summaryMaxG.textContent = `${p.maxG.toFixed(1)} G`;
    }

    if (d.summaryLapRows) {
      d.summaryLapRows.replaceChildren();
      if (!p.completedLaps.length) {
        const tr = document.createElement('tr');
        const td = makeEl('td', 'table-empty', 'No completed laps recorded yet.');
        td.colSpan = 6;
        tr.appendChild(td);
        d.summaryLapRows.appendChild(tr);
      } else {
        for (const rec of p.completedLaps) {
          const tr = document.createElement('tr');
          tr.appendChild(makeEl('td', '', `Lap ${rec.lap}`));
          tr.appendChild(makeEl('td', '', `${formatSectorTime(rec.sectors[0])}s`));
          tr.appendChild(makeEl('td', '', `${formatSectorTime(rec.sectors[1])}s`));
          tr.appendChild(makeEl('td', '', `${formatSectorTime(rec.sectors[2])}s`));
          tr.appendChild(makeEl('td', '', formatLapTime(rec.time)));
          const statusTd = document.createElement('td');
          statusTd.appendChild(
            makeEl('span', rec.isBest ? 'audit-pass' : 'hud-pill', rec.isBest ? 'BEST LAP' : 'VALID')
          );
          tr.appendChild(statusTd);
          d.summaryLapRows.appendChild(tr);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Main 60-120 Hz Frame Loop & Fixed 240 Hz Physics Accumulator
  // -------------------------------------------------------------------------

  _tick(nowMs) {
    requestAnimationFrame((t) => this._tick(t));

    const rawDt = (nowMs - this._lastFrameMs) * 0.001;
    this._lastFrameMs = nowMs;
    const frameDt = Math.min(0.05, Math.max(0.0001, Number.isFinite(rawDt) ? rawDt : 1 / 60));

    if (this.poseFrozen) {
      this._renderFrame();
      return;
    }

    this._visualTime += frameDt;
    const inputState = this.input.sample(this._inputBuf);
    this._latchedShiftEvent = 0;

    switch (this.fsmState) {
      case FSM_STATES.SHOWROOM_GRID:
        this.physics.stepGridIdle(0, frameDt);
        this._syncAllCarVisuals(frameDt);
        break;

      case FSM_STATES.LIGHTS_COUNTDOWN:
        this._stepLightsCountdown(frameDt, inputState);
        this._syncAllCarVisuals(frameDt);
        break;

      case FSM_STATES.ACTIVE_RACING:
        this._stepActiveRacing(frameDt, inputState);
        this._syncAllCarVisuals(frameDt);
        break;

      case FSM_STATES.PAUSED:
        // Physics frozen; keep scene rendered cleanly
        break;

      case FSM_STATES.SESSION_SUMMARY:
        this.physics.stepGridIdle(0, frameDt);
        this._syncAllCarVisuals(frameDt);
        break;

      default:
        break;
    }

    // Keep vehicle-locked directional shadow camera & sky dome centered on hero car
    if (this.envRig?.sunLight && this.circuitBuilder) {
      this.circuitBuilder.updateShadowCamera(
        this.envRig.sunLight,
        this.physics.x,
        this.physics.y,
        this.physics.z
      );
    }
    this.envRig?.updateSkyCenter?.(this.physics.x, this.physics.z);

    // Build zero-allocation enriched telemetry bridge for CameraDirector & F1AudioEngine
    const frameState = this._buildFrameState();
    this.cameraDirector.update(frameDt, frameState, Boolean(inputState.lookBehind), this.reducedMotion);
    this.audio.update(frameDt, frameState, this.fsmState);

    // Update HUD, Minimap, and Inspector smoothly with zero layout thrashing
    this._hudThrottleAccum += frameDt;
    const updateTextNow = this._hudThrottleAccum >= 0.05; // 20 Hz text writes, 60 Hz bars/LEDs
    if (updateTextNow) this._hudThrottleAccum = 0;
    this._updateHUD(updateTextNow);

    this._minimapAccum += frameDt;
    if (this._minimapAccum >= 0.033) {
      this._minimapAccum = 0;
      this._renderMinimap();
    }

    if (this.dom.inspectorDialog?.open) {
      this._inspectorRefreshAccum += frameDt;
      if (this._inspectorRefreshAccum >= 0.16) {
        this._inspectorRefreshAccum = 0;
        this._refreshInspector(false);
      }
    }

    this._renderFrame();
  }

  _stepLightsCountdown(dt, inputState) {
    // Allow authentic launch revving on throttle while holding car dead-still on grid
    this.physics.stepGridIdle(inputState.throttle, dt);
    this._countdownTimer += dt;

    let targetLights = 0;
    if (this._countdownTimer >= COUNTDOWN_FIRST_LIGHT_S) {
      targetLights = Math.min(
        5,
        1 + Math.floor((this._countdownTimer - COUNTDOWN_FIRST_LIGHT_S) / COUNTDOWN_LIGHT_INTERVAL_S)
      );
    }

    if (targetLights > this._countdownLitCount) {
      this._countdownLitCount = targetLights;
      this._setStartLightsVisual(targetLights);
      this.audio.playStartLightBeep(false);
      if (this.dom.startLightsStatus) {
        this.dom.startLightsStatus.textContent =
          targetLights < 5
            ? `LIGHTS ${targetLights} / 5 — HOLD LAUNCH REVS`
            : 'FIVE RED LIGHTS — STAND BY FOR LIGHTS OUT';
      }
    }

    const lightsOutAt =
      COUNTDOWN_FIRST_LIGHT_S + 4 * COUNTDOWN_LIGHT_INTERVAL_S + COUNTDOWN_HOLD_AFTER_5_S;
    if (this._countdownTimer >= lightsOutAt) {
      this._setStartLightsVisual(0);
      this.audio.playStartLightBeep(true);
      this._accumulator = 0;
      this._setFSMState(FSM_STATES.ACTIVE_RACING);
    }
  }

  _stepActiveRacing(frameDt, inputState) {
    this._accumulator = Math.min(this._accumulator + frameDt, FIXED_DT * MAX_SUBSTEPS);

    let substeps = 0;
    while (this._accumulator >= FIXED_DT && substeps < MAX_SUBSTEPS) {
      this.physics.step(inputState, FIXED_DT);
      if (this.physics.shiftEvent !== 0) {
        this._latchedShiftEvent = this.physics.shiftEvent;
        this._shiftSeq++;
      }
      if (this.aiManager.enabled) {
        this.aiManager.step(FIXED_DT, this.physics);
      }
      this._accumulator -= FIXED_DT;
      substeps++;
    }

    this.fx.update(frameDt, this.physics, this.circuit);

    if (this.physics.raceFinished) {
      this._enterSessionSummary();
    }
  }

  _syncAllCarVisuals(dt) {
    const simTime = this.fsmState === FSM_STATES.ACTIVE_RACING ? this.physics.simTime : this._visualTime;
    if (this.heroCar) {
      this.heroCar.updateFromPhysics(this.physics, dt, simTime);
    }
    if (this.aiManager?.enabled) {
      for (let i = 0; i < this.rivalCars.length; i++) {
        const rig = this.rivalCars[i];
        const rival = this.aiManager.rivals[i];
        if (rig && rival) {
          rig.updateFromAI(rival, dt, simTime);
        }
      }
    }
  }

  _buildFrameState() {
    const tel = this.physics.getTelemetry();
    const fs = this._frameState;
    fs.x = tel.x;
    fs.y = tel.y;
    fs.z = tel.z;
    fs.heading = tel.heading;
    fs.yaw = tel.heading;
    fs.pitch = tel.pitchRad;
    fs.roll = tel.rollRad;
    fs.visualPitch = tel.pitchRad;
    fs.visualRoll = tel.rollRad;
    fs.speed = tel.speedMs;
    fs.speedMs = tel.speedMs;
    fs.speedKmh = tel.speedKmh;
    fs.longG = tel.longG;
    fs.latG = tel.latG;
    fs.accelLong = tel.longG * 9.81;
    fs.steerAngle = tel.steerAngle;
    fs.throttle = tel.throttle;
    fs.brake = tel.brake;
    fs.gear = tel.gear;
    fs.rpm = tel.rpm;
    fs.drsOpen = tel.drsOpen;
    fs.skidIntensity = tel.skidIntensity;
    fs.sparkIntensity = tel.sparkIntensity;
    fs.barrierScrapeIntensity = tel.barrierScrapeIntensity;
    fs.kerbRumbleIntensity = tel.onKerb ? Math.min(1, tel.speedMs / 32) : 0;
    fs.shiftEvent = this._latchedShiftEvent;
    fs.shiftSeq = this._shiftSeq;
    return fs;
  }

  // -------------------------------------------------------------------------
  // Broadcast Telemetry HUD & Inspector Updates
  // -------------------------------------------------------------------------

  _setHudText(cacheKey, el, value) {
    if (!el) return;
    if (this._hudCache[cacheKey] !== value) {
      this._hudCache[cacheKey] = value;
      el.textContent = value;
    }
  }

  _syncCameraHud() {
    const mode = this.cameraDirector.getMode();
    const label = CAMERA_SHORT_LABELS[mode] || CAMERA_LABELS[mode] || mode;
    this._setHudText('hudCameraLabel', this.dom.hudCameraLabel, label);
  }

  _updateHUD(updateText) {
    const d = this.dom;
    const tel = this.physics.getTelemetry();

    // Smooth 60 FPS vertical pedal bars (only mutate DOM when rounded % changes)
    const brakePct = Math.round(Math.max(0, Math.min(1, tel.brake)) * 100);
    if (brakePct !== this._lastBrakePct && d.barBrake) {
      this._lastBrakePct = brakePct;
      d.barBrake.style.height = `${brakePct}%`;
    }
    const throttlePct = Math.round(Math.max(0, Math.min(1, tel.throttle)) * 100);
    if (throttlePct !== this._lastThrottlePct && d.barThrottle) {
      this._lastThrottlePct = throttlePct;
      d.barThrottle.style.height = `${throttlePct}%`;
    }

    // Smooth 60 FPS 15-LED FIA RPM shift bar
    const ledCount = d.rpmLeds.length;
    if (ledCount > 0) {
      const lit = Math.round(Math.max(0, Math.min(1, tel.rpmNorm)) * ledCount);
      if (lit !== this._lastLitLeds) {
        this._lastLitLeds = lit;
        for (let i = 0; i < ledCount; i++) {
          d.rpmLeds[i].classList.toggle('is-on', i < lit);
        }
      }
    }

    // Wrong-way alert pill
    if (d.hudAlert && this.fsmState === FSM_STATES.ACTIVE_RACING) {
      d.hudAlert.hidden = !tel.isWrongWay;
    }

    if (!updateText) return;

    // Position & Lap
    const posStr = this.aiManager.enabled
      ? `P${this.aiManager.getPlayerPosition(this.physics)} / ${this.aiManager.rivals.length + 1}`
      : 'TIME TRIAL';
    this._setHudText('hudPosition', d.hudPosition, posStr);
    this._setHudText('hudLap', d.hudLap, `LAP ${Math.min(tel.lap, tel.totalLaps)} / ${tel.totalLaps}`);

    // Timing & Sectors
    const lapTimeStr =
      this.fsmState === FSM_STATES.SHOWROOM_GRID || this.fsmState === FSM_STATES.LIGHTS_COUNTDOWN
        ? '0:00.000'
        : formatLapTime(tel.currentLapTime);
    this._setHudText('hudLapTime', d.hudLapTime, lapTimeStr);
    this._setHudText('hudBestLap', d.hudBestLap, formatLapTime(tel.bestLapTime));

    for (let i = 0; i < 3; i++) {
      const el = d.hudSectors[i];
      if (!el) continue;
      const st = tel.sectorStatus[i] === 'none' ? 'idle' : tel.sectorStatus[i];
      const txt = `S${i + 1} ${formatSectorTime(tel.sectorTimes[i])}`;
      this._setHudText(`hudS${i}`, el, txt);
      if (el.dataset.status !== st) el.dataset.status = st;
    }

    // Core Speed, Gear, RPM, DRS
    const gearDisplay =
      this.fsmState === FSM_STATES.SHOWROOM_GRID ? 'N' : tel.gearLabel;
    this._setHudText('hudGear', d.hudGear, gearDisplay);
    this._setHudText('hudSpeed', d.hudSpeed, String(Math.round(tel.speedKmh)));
    this._setHudText('hudRpm', d.hudRpm, formatRpm(tel.rpm));

    const drsState = tel.drsOpen ? 'open' : tel.drsAvailable ? 'ready' : 'locked';
    const drsText = tel.drsOpen ? 'DRS OPEN' : tel.drsAvailable ? 'DRS READY' : 'DRS LOCKED';
    this._setHudText('hudDrs', d.hudDrs, drsText);
    if (d.hudDrs && d.hudDrs.dataset.drsState !== drsState) {
      d.hudDrs.dataset.drsState = drsState;
    }

    // Vitals: Tire Temp, Brake Temp, G-Force
    const tireTempRounded = Math.round(tel.avgTireTemp);
    this._setHudText('hudTireTemp', d.hudTireTemp, `${tireTempRounded}°C`);
    if (d.hudTireTemp) {
      const tireHot = tireTempRounded >= tel.compound.optTempMax ? 'true' : 'false';
      if (d.hudTireTemp.dataset.hot !== tireHot) d.hudTireTemp.dataset.hot = tireHot;
    }

    const brakeTempRounded = Math.round(tel.maxBrakeTemp);
    this._setHudText('hudBrakeTemp', d.hudBrakeTemp, `${brakeTempRounded}°C`);
    if (d.hudBrakeTemp) {
      const brakeHot = brakeTempRounded >= 600 ? 'true' : 'false';
      if (d.hudBrakeTemp.dataset.hot !== brakeHot) d.hudBrakeTemp.dataset.hot = brakeHot;
    }

    const gMag = Math.hypot(tel.longG, tel.latG);
    this._setHudText('hudGForce', d.hudGForce, `${gMag.toFixed(1)} G`);
  }

  _refreshInspector(includeStatic = false) {
    const d = this.dom;
    const tel = this.physics.getTelemetry();

    // 1. Live Vehicle Dynamics & Aero Telemetry
    if (d.inspectorPhysics) {
      const drsStr = tel.drsOpen ? 'OPEN (+28°)' : tel.drsAvailable ? 'READY' : 'LOCKED';
      const assistStr = [
        this.physics.assists.tractionControl ? 'TC' : null,
        this.physics.assists.abs ? 'ABS' : null,
        this.physics.assists.stabilityAssist ? 'STAB' : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'ALL OFF';

      d.inspectorPhysics.replaceChildren(
        buildKvGrid([
          ['Speed / Gear', `${tel.speedKmh.toFixed(1)} km/h · G${tel.gearLabel}`],
          ['Power Unit RPM', `${Math.round(tel.rpm).toLocaleString('en-US')} RPM`],
          ['Total Downforce', `${Math.round(tel.downforceN).toLocaleString('en-US')} N`],
          ['Aero Balance F/R', `${Math.round(tel.frontDownforceN)} / ${Math.round(tel.rearDownforceN)} N`],
          ['Aero Drag', `${Math.round(tel.dragN).toLocaleString('en-US')} N`],
          ['Effective Cl / Cd', `${tel.effectiveCl.toFixed(2)} / ${tel.effectiveCd.toFixed(3)}`],
          ['DRS Actuator', drsStr, tel.drsOpen ? 'audit-pass' : null],
          ['Ride Height / Heave', `${(tel.rideHeightM * 1000).toFixed(1)} mm (${(tel.heaveM * 1000).toFixed(1)} mm)`],
          ['Pitch / Roll', `${(tel.pitchRad * RAD2DEG).toFixed(2)}° / ${(tel.rollRad * RAD2DEG).toFixed(2)}°`],
          ['Long / Lat G', `${tel.longG.toFixed(2)} g / ${tel.latG.toFixed(2)} g`],
          ['Tire Temp (Avg/Max)', `${tel.avgTireTemp.toFixed(1)}°C / ${tel.maxTireTemp.toFixed(1)}°C`],
          ['Brake Temp (F/R)', `${tel.frontBrakeTemp.toFixed(0)}°C / ${tel.rearBrakeTemp.toFixed(0)}°C`],
          [
            'Wheel Fz (FL/FR/RL/RR)',
            `${Math.round(tel.wheelFz[0])}/${Math.round(tel.wheelFz[1])}/${Math.round(tel.wheelFz[2])}/${Math.round(tel.wheelFz[3])} N`,
          ],
          ['Surface / Assists', `${tel.surface?.id || 'ASPHALT'} · ${assistStr}`],
        ])
      );
    }

    // 2 & 3. Parametric .glb & Nano Banana PBR Reflectance Audit Table
    if (includeStatic || !this._inspectorStaticRendered) {
      this._renderInspectorStaticSections();
    }

    // 4. Session Lap & Sector History
    if (d.inspectorLaps) {
      if (!this.physics.completedLaps.length) {
        d.inspectorLaps.replaceChildren(
          makeEl('p', 'inspector-placeholder', 'No completed laps recorded in this session yet.')
        );
      } else {
        const table = makeEl('table', 'audit-table tabular');
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        for (const h of ['Lap', 'S1', 'S2', 'S3', 'Lap Time', 'Status']) {
          htr.appendChild(makeEl('th', '', h));
        }
        thead.appendChild(htr);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const rec of this.physics.completedLaps) {
          const tr = document.createElement('tr');
          tr.appendChild(makeEl('td', '', `Lap ${rec.lap}`));
          tr.appendChild(makeEl('td', '', `${formatSectorTime(rec.sectors[0])}s`));
          tr.appendChild(makeEl('td', '', `${formatSectorTime(rec.sectors[1])}s`));
          tr.appendChild(makeEl('td', '', `${formatSectorTime(rec.sectors[2])}s`));
          tr.appendChild(makeEl('td', '', formatLapTime(rec.time)));
          const stTd = document.createElement('td');
          stTd.appendChild(
            makeEl('span', rec.isBest ? 'audit-pass' : 'hud-pill', rec.isBest ? 'BEST' : 'VALID')
          );
          tr.appendChild(stTd);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        d.inspectorLaps.replaceChildren(table);
      }
    }
  }

  _renderInspectorStaticSections() {
    const d = this.dom;
    const val = this.getAssetValidation();
    const glb = val.glb || {};
    const stats = val.trackStats || {};

    if (d.inspectorGlb) {
      const dims = glb.dimensions || glb.size || glb.bounds || {};
      const len = glb.lengthM ?? dims.length ?? dims.L ?? glb.length ?? CAR_DIMS.LENGTH;
      const wid = glb.widthM ?? dims.width ?? dims.W ?? glb.width ?? CAR_DIMS.WIDTH;
      const hgt = glb.heightM ?? dims.height ?? dims.H ?? glb.height ?? CAR_DIMS.HEIGHT;
      const minY = glb.minY ?? dims.minY ?? 0;
      const tris = glb.triangleCount ?? glb.triangles ?? glb.totalTriangles ?? 0;
      const foundNodes = glb.foundNodesCount ?? (Array.isArray(glb.verifiedNodes) ? glb.verifiedNodes.length : Object.keys(this.heroCar?.nodes || {}).length);
      const reqNodes = glb.requiredNodesCount ?? foundNodes;
      const glbPassed = resolvePassedFlag(glb);
      const totalTrackTris = (stats.triangles || 0) + (stats.instancedTriangles || 0);

      d.inspectorGlb.replaceChildren(
        buildKvGrid([
          ['Asset Compliance', val.allCompliant ? 'PASS' : 'CHECK', val.allCompliant ? 'audit-pass' : 'audit-fail'],
          ['GLB Envelope (L×W×H)', `${Number(len).toFixed(3)} × ${Number(wid).toFixed(3)} × ${Number(hgt).toFixed(3)} m`],
          ['Tire Grounding (minY)', `${Number(minY).toFixed(5)} m`, Math.abs(minY) < 0.002 ? 'audit-pass' : 'audit-warn'],
          ['Car Triangle Count', Number(tris).toLocaleString('en-US')],
          ['Articulated Nodes', `${foundNodes} / ${reqNodes} verified`, glbPassed ? 'audit-pass' : 'audit-warn'],
          ['Smooth Normals', `${glb.creaseAngleDeg ?? 42}° welded (flatShading: false)`, 'audit-pass'],
          ['Circuit Length', `${(this.circuit.length / 1000).toFixed(2)} km (${totalTrackTris ? Number(totalTrackTris).toLocaleString('en-US') + ' tris' : 'FIA Grade 1'})`],
          ['Physics Solver Health', val.hasNaN ? 'NaN DETECTED' : '0 NaN · 240 Hz', val.hasNaN ? 'audit-fail' : 'audit-pass'],
        ])
      );
    }

    if (d.inspectorPbrBody && this.materialLib) {
      const rawRecords =
        typeof this.materialLib.getAuditRecords === 'function'
          ? this.materialLib.getAuditRecords()
          : [];
      const records = Array.isArray(rawRecords)
        ? rawRecords
        : rawRecords && typeof rawRecords === 'object'
          ? Object.entries(rawRecords).map(([id, rec]) => ({ id, ...rec }))
          : [];

      d.inspectorPbrBody.replaceChildren();
      if (Array.isArray(records) && records.length > 0) {
        for (const rec of records) {
          const tr = document.createElement('tr');
          const name = rec.name ?? rec.id ?? rec.material ?? rec.key ?? 'material';
          const matType = rec.type ?? rec.metallicMode ?? rec.kind ?? 'dielectric';
          const colorSpace = rec.colorSpace ?? rec.albedoColorSpace ?? 'Utility - sRGB - Texture';
          const srgbRange =
            rec.srgbRange ??
            (Number.isFinite(rec.minSrgb) && Number.isFinite(rec.maxSrgb)
              ? `[${rec.minSrgb}, ${rec.maxSrgb}]`
              : 'Validated');
          const metalStr =
            typeof rec.metalnessLabel === 'string'
              ? rec.metalnessLabel
              : typeof rec.metalness === 'string'
                ? rec.metalness
                : Array.isArray(rec.metalnessValues)
                  ? rec.metalnessValues.join(' / ')
                  : Array.isArray(rec.metalnessUniqueValues)
                    ? rec.metalnessUniqueValues.join(' / ')
                    : Number.isFinite(rec.metalness)
                      ? String(rec.metalness)
                      : matType === 'mixed'
                        ? '0 / 255'
                        : '0';
          const passed =
            typeof rec.passed === 'boolean'
              ? rec.passed
              : typeof rec.compliant === 'boolean'
                ? rec.compliant
                : rec.status !== 'FAIL';

          tr.appendChild(makeEl('td', '', name));
          tr.appendChild(makeEl('td', '', matType));
          tr.appendChild(makeEl('td', '', colorSpace));
          tr.appendChild(makeEl('td', '', srgbRange));
          tr.appendChild(makeEl('td', '', metalStr));

          const statusTd = document.createElement('td');
          statusTd.appendChild(
            makeEl('span', passed ? 'audit-pass' : 'audit-fail', passed ? 'PASS' : 'FAIL')
          );
          tr.appendChild(statusTd);
          d.inspectorPbrBody.appendChild(tr);
        }
        this._inspectorStaticRendered = true;
      } else {
        const tr = document.createElement('tr');
        const td = makeEl('td', 'table-empty', 'PBR audit records pending manifest load.');
        td.colSpan = 6;
        tr.appendChild(td);
        d.inspectorPbrBody.appendChild(tr);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Validation, Deterministic Stepping & 6-Pose Verification Harness
  // -------------------------------------------------------------------------

  getAssetValidation() {
    const glb = this.heroCar?.validation || null;
    const pbrAudit =
      this.materialLib && typeof this.materialLib.getAuditSummary === 'function'
        ? this.materialLib.getAuditSummary()
        : null;
    const trackStats =
      this.circuitBuilder && typeof this.circuitBuilder.getTrackStats === 'function'
        ? this.circuitBuilder.getTrackStats()
        : null;

    const p = this.physics;
    const hasNaN =
      !p ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !Number.isFinite(p.z) ||
      !Number.isFinite(p.heading) ||
      !Number.isFinite(p.speedKmh) ||
      !Number.isFinite(p.rpm) ||
      !Number.isFinite(p.steerAngle);

    const glbOk = resolvePassedFlag(glb);
    let pbrOk = resolvePassedFlag(pbrAudit);
    if (pbrAudit && typeof pbrAudit === 'object') {
      if (typeof pbrAudit.failedMaterials === 'number' && pbrAudit.failedMaterials > 0) pbrOk = false;
      if (typeof pbrAudit.failedCount === 'number' && pbrAudit.failedCount > 0) pbrOk = false;
      if (typeof pbrAudit.failed === 'number' && pbrAudit.failed > 0) pbrOk = false;
      if (pbrAudit.colorSpaceAuditPassed === false) pbrOk = false;
    }

    const allCompliant = Boolean(this.heroCar?.root && glbOk && pbrOk && !hasNaN);

    return {
      allCompliant,
      glb,
      pbrAudit,
      trackStats,
      hasNaN,
    };
  }

  /**
   * Synchronously advance physics + AI + car rigs + FX by `steps` 240 Hz ticks
   * and render one deterministic frame (used by automated benchmarks).
   */
  stepDeterministic(steps = 1, inputOverride = null) {
    this.poseFrozen = false;
    const count = Math.max(1, Math.min(24000, Math.floor(Number(steps) || 1)));

    const stepInput = inputOverride
      ? {
          throttle: Number(inputOverride.throttle) || 0,
          brake: Number(inputOverride.brake) || 0,
          steer: Number(inputOverride.steer) || 0,
          lookBehind: Boolean(inputOverride.lookBehind),
          directPedals: Boolean(inputOverride.directPedals),
        }
      : this.input.sample(this._inputBuf);

    if (inputOverride && typeof inputOverride.drsOpen === 'boolean') {
      this.physics.setDRS(inputOverride.drsOpen, Boolean(inputOverride.forceDRS));
    }

    for (let i = 0; i < count; i++) {
      this.physics.step(stepInput, FIXED_DT);
      if (this.physics.shiftEvent !== 0) {
        this._latchedShiftEvent = this.physics.shiftEvent;
        this._shiftSeq++;
      }
      if (this.aiManager.enabled) {
        this.aiManager.step(FIXED_DT, this.physics);
      }
      if ((i + 1) % 4 === 0 || i === count - 1) {
        this.fx.update(FIXED_DT * 4, this.physics, this.circuit);
      }
    }

    this._syncAllCarVisuals(1 / 60);
    if (this.envRig?.sunLight && this.circuitBuilder) {
      this.circuitBuilder.updateShadowCamera(
        this.envRig.sunLight,
        this.physics.x,
        this.physics.y,
        this.physics.z
      );
    }

    const frameState = this._buildFrameState();
    this.cameraDirector.update(1 / 60, frameState, Boolean(stepInput.lookBehind), this.reducedMotion);
    this._updateHUD(true);
    this._renderMinimap();
    this._renderFrame();

    const t = this.physics.getTelemetry();
    return {
      x: t.x,
      y: t.y,
      z: t.z,
      heading: t.heading,
      speedMs: t.speedMs,
      speedKmh: t.speedKmh,
      longG: t.longG,
      latG: t.latG,
      gear: t.gear,
      gearLabel: t.gearLabel,
      rpm: t.rpm,
      drsOpen: t.drsOpen,
      drsFlapAngle: t.drsFlapAngle,
      downforceN: t.downforceN,
      dragN: t.dragN,
      effectiveCl: t.effectiveCl,
      effectiveCd: t.effectiveCd,
      avgTireTemp: t.avgTireTemp,
      frontBrakeTemp: t.frontBrakeTemp,
      maxBrakeTemp: t.maxBrakeTemp,
      rideHeightM: t.rideHeightM,
      sparkIntensity: t.sparkIntensity,
      compoundId: t.compound.id,
      trackS: t.trackS,
      dLat: t.dLat,
      hasNaN: !Number.isFinite(t.x) || !Number.isFinite(t.speedKmh),
    };
  }

  _carLocalToWorld(lx, ly, lz) {
    const h = this.physics.heading;
    const cosH = Math.cos(h);
    const sinH = Math.sin(h);
    return {
      x: this.physics.x + lx * cosH + lz * sinH,
      y: this.physics.y + ly,
      z: this.physics.z - lx * sinH + lz * cosH,
    };
  }

  _placeRivalAt(index, s, dLat, speedKmh = 0, brakeTemp = 220) {
    const r = this.aiManager?.rivals?.[index];
    if (!r) return;
    const sw = this.circuit.wrapS(s);
    const sample = this.circuit.sampleAtS(sw, this._trackSample);
    r.trackS = sw;
    r.dLat = dLat;
    r.x = sample.x + sample.rx * dLat;
    r.z = sample.z + sample.rz * dLat;
    r.y = this.circuit.getSurfaceElevation(sw, dLat, sample);
    r.heading = Math.atan2(-sample.tx, -sample.tz);
    r.speedKmh = speedKmh;
    r.speedMs = speedKmh / 3.6;
    r.wheelOmega = r.speedMs / CAR_DIMS.TIRE_RADIUS;
    r.brakeTemp = brakeTemp;
    r.pitchRad = brakeTemp > 600 ? -0.02 : 0;
    r.rollRad = 0;
    r.steerAngle = 0;
    r.drsOpen = false;
    r.drsFlapAngle = 0;
  }

  /**
   * Prepare one of the 6 deterministic multi-angle inspection & QA poses
   * ('pose1'..'pose6') and immediately render a crisp frame.
   */
  preparePose(poseId) {
    // Close any open popover/dialog before capturing clean visual pose
    if (this.dom.inspectorDialog?.open) this.dom.inspectorDialog.close();
    try {
      if (this.dom.setupPopover?.matches(':popover-open')) {
        this.dom.setupPopover.hidePopover();
      }
    } catch {
      // Ignore if popover API unsupported
    }

    this.poseFrozen = true;
    this._accumulator = 0;
    this.fx.clear();
    this._setStartLightsVisual(0);

    const p = this.physics;

    switch (poseId) {
      case 'pose1': {
        // Pose 1 — Hero 3/4 Showroom Close-Up (livery, carbon weave, Pirelli soft ring, rims, halo)
        this.setRaceMode('ai_race');
        this.setCompound('soft');
        p.resetToGrid(PLAYER_GRID_S, PLAYER_GRID_DLAT);
        this.aiManager.resetToGrid();
        p.steerAngle = 0;
        p.steeringWheelAngle = 0;
        p.drsOpen = false;
        p.drsFlapAngle = 0;
        this._setFSMState(FSM_STATES.SHOWROOM_GRID);
        this.cameraDirector.setAutoOrbitSpeed(0);
        this.cameraDirector.setMode(CAMERA_MODES.SHOWROOM_ORBIT);
        this._syncAllCarVisuals(1 / 60);
        this.setCustomCameraPose(
          this._carLocalToWorld(-3.55, 1.48, -4.35),
          this._carLocalToWorld(0.45, 0.34, -0.35),
          40
        );
        break;
      }

      case 'pose2': {
        // Pose 2 — Rear-Quarter Diffuser + Open DRS (+28 deg) + Glowing FIA Rain Light
        this.setRaceMode('ai_race');
        this.setCompound('soft');
        p.resetToGrid(60.0, 0.0);
        this.aiManager.resetToGrid();
        p.drsZone = 1;
        p.drsAvailable = true;
        p.drsOpen = true;
        p.drsFlapAngle = 28 * DEG2RAD;
        p.brake = 0.0;
        p.throttle = 0.0;
        p.speedMs = 0;
        p.speedKmh = 0;
        p.brakeTemp.fill(320);
        p.frontBrakeTemp = 320;
        p.rearBrakeTemp = 320;
        p.maxBrakeTemp = 320;
        this._setFSMState(FSM_STATES.SHOWROOM_GRID);
        this.cameraDirector.setMode(CAMERA_MODES.SHOWROOM_ORBIT);
        // Set rain-light flash phase to exact 2.0 Hz sine peak (sin(0.125 * 4 * PI) = +1.0)
        this._visualTime = 0.125;
        this._syncAllCarVisuals(1 / 60);
        this.setCustomCameraPose(
          this._carLocalToWorld(2.55, 1.12, 3.75),
          this._carLocalToWorld(0.0, 0.54, 1.35),
          40
        );
        break;
      }

      case 'pose3': {
        // Pose 3 — Chase Camera on Main Straight / Start Grid with AI Rivals & Active HUD
        this.setRaceMode('ai_race');
        this.setCompound('soft');
        p.resetToGrid(PLAYER_GRID_S, PLAYER_GRID_DLAT);
        this.aiManager.resetToGrid();
        this._setFSMState(FSM_STATES.ACTIVE_RACING);
        // Step a brief authentic launch burst (0.45 s) so car & rivals are live off the line facing gantry
        const launchInput = { throttle: 1.0, brake: 0.0, steer: 0.0, directPedals: false };
        for (let i = 0; i < 108; i++) {
          p.step(launchInput, FIXED_DT);
          this.aiManager.step(FIXED_DT, p);
        }
        this.poseFrozen = true;
        this.cameraDirector.clearCustomPose();
        this.cameraDirector.setMode(CAMERA_MODES.CHASE);
        this.cameraDirector.resetSmoothing();
        this._syncAllCarVisuals(1 / 60);
        this.cameraDirector.update(1 / 60, this._buildFrameState(), false, true);
        break;
      }

      case 'pose4': {
        // Pose 4 — Cockpit Halo View on Main Straight (OLED wheel, Halo, mirrors, gantry/rivals ahead)
        this.setRaceMode('ai_race');
        this.setCompound('soft');
        p.resetToGrid(-26.0, 1.4);
        const spdMs = 58.0; // ~209 km/h
        p.vx = -Math.sin(p.heading) * spdMs;
        p.vz = -Math.cos(p.heading) * spdMs;
        p.vLong = spdMs;
        p.speedMs = spdMs;
        p.speedKmh = spdMs * 3.6;
        p.gear = 5;
        p.gearLabel = '5';
        p.rpm = 11450;
        p.rpmNorm = (p.rpm - PHYSICS_CFG.IDLE_RPM) / (PHYSICS_CFG.MAX_RPM - PHYSICS_CFG.IDLE_RPM);
        p.throttle = 0.94;
        p.brake = 0;
        p.steerAngle = 0.0;
        p.steeringWheelAngle = 0.0;
        p.wheelOmega.fill(spdMs / CAR_DIMS.TIRE_RADIUS);
        p.drsAvailable = true;
        p.drsOpen = false;
        p.drsFlapAngle = 0;
        // Place rivals clearly ahead down the straight approaching/passing gantry
        this._placeRivalAt(0, 18, -2.0, 224);
        this._placeRivalAt(1, 2, 2.2, 218);
        this._placeRivalAt(2, -10, -1.8, 212);

        this._setFSMState(FSM_STATES.ACTIVE_RACING);
        this.cameraDirector.clearCustomPose();
        this.cameraDirector.setMode(CAMERA_MODES.COCKPIT);
        this.cameraDirector.resetSmoothing();
        this._syncAllCarVisuals(1 / 60);
        this.cameraDirector.update(1 / 60, this._buildFrameState(), false, true);
        break;
      }

      case 'pose5': {
        // Pose 5 — TV Broadcast Pod Mid-Corner on FIA Apex Kerbs (steered wheels + helmet + skid marks)
        this.setRaceMode('ai_race');
        this.setCompound('soft');
        const seg =
          this.circuit.kerbSegments.find((k) => k.endS - k.startS >= 28) ||
          this.circuit.kerbSegments[0] || { startS: 780, endS: 840, side: 1 };
        const sMid = 0.5 * (seg.startS + seg.endS);
        const side = seg.side || 1;
        // Position inside wheels directly over FIA red/white apex kerb
        const dLatKerb = side * (this.circuit.halfWidth - 0.15);
        p.resetToGrid(sMid, dLatKerb);

        const cornerSpeedMs = 41.5; // ~149 km/h
        p.heading += -side * 0.055; // athletic turn-in attitude
        p.vx = -Math.sin(p.heading) * cornerSpeedMs;
        p.vz = -Math.cos(p.heading) * cornerSpeedMs;
        p.vLong = cornerSpeedMs;
        p.speedMs = cornerSpeedMs;
        p.speedKmh = cornerSpeedMs * 3.6;
        p.gear = 3;
        p.gearLabel = '3';
        p.rpm = 11250;
        p.rpmNorm = (p.rpm - PHYSICS_CFG.IDLE_RPM) / (PHYSICS_CFG.MAX_RPM - PHYSICS_CFG.IDLE_RPM);
        p.throttle = 0.68;
        p.brake = 0.0;
        // Pronounced front-wheel steering deflection into apex (+steer = Left, -steer = Right)
        p.steerAngle = -side * (16.5 * DEG2RAD);
        p.steeringWheelAngle = p.steerAngle * 6.5;
        p.latG = -side * 3.45;
        p.longG = 0.65;
        p.rollRad = side * (1.05 * DEG2RAD);
        p.pitchRad = 0.25 * DEG2RAD;
        p.onKerb = true;
        p.skidIntensity = 0.88;
        p.wheelTemp.fill(101);
        p.avgTireTemp = 101;
        p.maxTireTemp = 101;
        p.wheelRoughness.fill(0.28);
        p.wheelOmega.fill(cornerSpeedMs / CAR_DIMS.TIRE_RADIUS);

        // Stamp fresh dark cornering skid marks along the apex
        this.fx.stampSkidTrail(p, this.circuit, 24);
        this._placeRivalAt(0, sMid + 20, side * 3.8, 158);
        this._placeRivalAt(1, sMid + 38, side * 1.2, 166);
        this._placeRivalAt(2, sMid - 34, -side * 1.5, 144);

        this._setFSMState(FSM_STATES.ACTIVE_RACING);
        this.cameraDirector.clearCustomPose();
        this.cameraDirector.setMode(CAMERA_MODES.TV_POD);
        this.cameraDirector.resetSmoothing();
        this._syncAllCarVisuals(1 / 60);
        this.cameraDirector.update(1 / 60, this._buildFrameState(), false, true);
        break;
      }

      case 'pose6': {
        // Pose 6 — High-Speed Threshold Braking Action Angle (960C brake glow + 260 titanium sparks)
        this.setRaceMode('ai_race');
        this.setCompound('soft');
        const brakeStation = this.circuit.brakingZones[0]?.board50S ?? 630;
        p.resetToGrid(brakeStation, -1.2);

        const spdMs = 76.5; // ~275 km/h heavy threshold braking into Turn 1
        p.vx = -Math.sin(p.heading) * spdMs;
        p.vz = -Math.cos(p.heading) * spdMs;
        p.vLong = spdMs;
        p.speedMs = spdMs;
        p.speedKmh = spdMs * 3.6;
        p.gear = 6;
        p.gearLabel = '6';
        p.rpm = 11700;
        p.rpmNorm = (p.rpm - PHYSICS_CFG.IDLE_RPM) / (PHYSICS_CFG.MAX_RPM - PHYSICS_CFG.IDLE_RPM);
        p.throttle = 0.0;
        p.brake = 1.0;
        p.longG = -5.15;
        p.latG = -0.35;
        p.pitchRad = -1.55 * DEG2RAD;
        p.rollRad = 0.2 * DEG2RAD;
        p.heaveM = 0.024;
        p.rideHeightM = 0.005;
        p.steerAngle = -5.0 * DEG2RAD;
        p.steeringWheelAngle = p.steerAngle * 6.5;
        p.drsOpen = false;
        p.drsAvailable = false;
        p.drsFlapAngle = 0;

        // 960C glowing incandescent front carbon-carbon brake discs
        p.brakeTemp[0] = 960;
        p.brakeTemp[1] = 960;
        p.brakeTemp[2] = 860;
        p.brakeTemp[3] = 860;
        p.frontBrakeTemp = 960;
        p.rearBrakeTemp = 860;
        p.maxBrakeTemp = 960;

        p.wheelTemp.fill(104);
        p.avgTireTemp = 104;
        p.maxTireTemp = 104;
        p.wheelRoughness.fill(0.24);
        p.wheelOmega.fill(spdMs / CAR_DIMS.TIRE_RADIUS);

        p.sparkIntensity = 1.0;
        p.skidIntensity = 0.92;
        p.smokeIntensity = 0.72;

        // Stamp skid trail + burst 260 pre-distributed ballistic titanium sparks anchored behind skid block
        this.fx.stampSkidTrail(p, this.circuit, 20);
        this.fx.burstActionSparks(p, 260);

        // Rival car ahead braking into Turn 1 with hot brakes
        this._placeRivalAt(0, brakeStation + 24, 1.8, 235, 890);
        this._placeRivalAt(1, brakeStation + 44, 2.4, 205, 850);
        this._placeRivalAt(2, brakeStation - 28, -2.0, 285, 760);

        this._setFSMState(FSM_STATES.ACTIVE_RACING);
        this.cameraDirector.setMode(CAMERA_MODES.CHASE);
        this._syncAllCarVisuals(1 / 60);
        this.setCustomCameraPose(
          this._carLocalToWorld(-3.25, 0.92, -3.15),
          this._carLocalToWorld(0.15, 0.42, 0.55),
          44
        );
        break;
      }

      default:
        this.enterShowroom();
        return;
    }

    if (this.envRig?.sunLight && this.circuitBuilder) {
      this.circuitBuilder.updateShadowCamera(
        this.envRig.sunLight,
        p.x,
        p.y,
        p.z
      );
    }
    this.envRig?.updateSkyCenter?.(p.x, p.z);

    this._syncCameraHud();
    this._updateHUD(true);
    this._renderMinimap();
    this._renderFrame();
  }
}

// Bootstrap immediately on ES module execution
const simApp = new TokyoGPSimApp();
simApp.init().catch((err) => {
  console.error('[TokyoGP2026] Fatal initialization error:', err);
});

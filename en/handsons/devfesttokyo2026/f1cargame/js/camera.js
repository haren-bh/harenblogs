import * as THREE from 'three';
import { CAMERA_LABELS, CAMERA_MODES } from './constants.js';

const DEG2RAD = Math.PI / 180;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const ORBIT_MIN_RADIUS = 3.4;
const ORBIT_MAX_RADIUS = 9.5;
const ORBIT_MIN_ELEV = 0.08;
const ORBIT_MAX_ELEV = 0.85;

const DEFAULT_ORBIT_AZIMUTH = -0.68;
const DEFAULT_ORBIT_ELEVATION = 0.24;
const DEFAULT_ORBIT_RADIUS = 5.3;

const CHASE_BASE_BACK = 4.90;
const CHASE_BASE_UP = 1.45;
const CHASE_MIN_FOV = 54;
const CHASE_MAX_FOV = 70;

const COCKPIT_LOCAL_POS = new THREE.Vector3(0, 0.76, -0.10);
const TV_POD_LOCAL_POS = new THREE.Vector3(0, 1.12, 0.28);
const TV_POD_PITCH_RAD = -4.5 * DEG2RAD;

function wrapAngle(rad) {
  let a = (rad + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

function readVec3(src, out, fallbackX = 0, fallbackY = 0, fallbackZ = 0) {
  if (Array.isArray(src)) {
    out.set(src[0] ?? fallbackX, src[1] ?? fallbackY, src[2] ?? fallbackZ);
  } else if (src && typeof src === 'object') {
    out.set(src.x ?? fallbackX, src.y ?? fallbackY, src.z ?? fallbackZ);
  } else {
    out.set(fallbackX, fallbackY, fallbackZ);
  }
  return out;
}

function isUiControlTarget(target, canvasEl) {
  if (!target) return true;
  if (canvasEl && target !== canvasEl) return true;
  if (typeof target.closest === 'function') {
    const uiHit = target.closest(
      'button, input, select, textarea, a, label, summary, dialog, [popover], ' +
      '.hud-top-bar, .showroom-banner, .telemetry-dock, .minimap-card, ' +
      '.fullscreen-overlay, .setup-popover, .inspector-dialog'
    );
    if (uiHit) return true;
  }
  return false;
}

/**
 * 4-Mode Motorsport Camera Director (Showroom Orbit, Chase, Cockpit, TV Pod).
 *
 * Strictly obeys right-handed metric Y-up vehicle conventions:
 *   - Forward (Nosecone): -Z
 *   - Rearward (Diffuser/Rear Wing): +Z
 *   - Starboard (Right): +X, Port (Left): -X
 */
export class CameraDirector {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement|null} [domElement=null]
   */
  constructor(camera, domElement = null) {
    this.camera = camera;
    this._domElement = null;

    this._mode = CAMERA_MODES.SHOWROOM_ORBIT;
    this._drivingMode = CAMERA_MODES.CHASE;
    this._needsSnap = true;
    this._prevLookBack = false;
    this._autoOrbitSpeed = 0;

    // Showroom spherical orbit state (car-yaw-referenced, azimuth 0 = dead front -Z)
    this._orbitAzimuth = DEFAULT_ORBIT_AZIMUTH;
    this._orbitElevation = DEFAULT_ORBIT_ELEVATION;
    this._orbitRadius = DEFAULT_ORBIT_RADIUS;

    this._targetAzimuth = DEFAULT_ORBIT_AZIMUTH;
    this._targetElevation = DEFAULT_ORBIT_ELEVATION;
    this._targetRadius = DEFAULT_ORBIT_RADIUS;

    this._velAzimuth = 0;
    this._velElevation = 0;

    this._isDragging = false;
    this._activePointerId = null;
    this._lastPointerX = 0;
    this._lastPointerY = 0;

    // Chase spring-arm state
    this._chasePos = new THREE.Vector3(0, CHASE_BASE_UP, CHASE_BASE_BACK);
    this._chaseLookAt = new THREE.Vector3(0, 0.78, -6.0);
    this._chaseYaw = 0;
    this._chasePullback = 0;
    this._chaseLatOffset = 0;
    this._chaseLatRoll = 0;

    // Cockpit / TV Pod smoothing state
    this._lookAheadYaw = 0;
    this._currentFov = camera ? camera.fov : 42;
    this._vibTime = 0;

    // Programmatic custom pose override (for deterministic multi-angle inspection)
    this._customPose = null;

    // Preallocated scratch math objects (zero per-frame GC allocations)
    this._carPos = new THREE.Vector3();
    this._carQuat = new THREE.Quaternion();
    this._carEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._yawQuat = new THREE.Quaternion();
    this._forward = new THREE.Vector3(0, 0, -1);
    this._back = new THREE.Vector3(0, 0, 1);
    this._right = new THREE.Vector3(1, 0, 0);
    this._up = new THREE.Vector3(0, 1, 0);
    this._desiredPos = new THREE.Vector3();
    this._desiredLookAt = new THREE.Vector3();
    this._localVec = new THREE.Vector3();
    this._localDir = new THREE.Vector3();
    this._camUp = new THREE.Vector3(0, 1, 0);
    this._lookRotQuat = new THREE.Quaternion();

    // Bound event handlers
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);

    if (domElement) {
      this.attachDomElement(domElement);
    }
  }

  /**
   * Bind pointer & wheel orbit controls to the WebGL canvas element.
   * @param {HTMLElement} domElement
   */
  attachDomElement(domElement) {
    if (this._domElement === domElement) return;
    this.dispose();
    this._domElement = domElement;
    if (!domElement) return;

    domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
  }

  /**
   * Clean up DOM event listeners.
   */
  dispose() {
    if (this._domElement) {
      this._domElement.removeEventListener('pointerdown', this._onPointerDown);
      this._domElement.removeEventListener('wheel', this._onWheel);
    }
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    this._domElement = null;
    this._isDragging = false;
    this._activePointerId = null;
  }

  /**
   * Switch active camera mode.
   * @param {string} mode One of CAMERA_MODES.*
   * @returns {string} Active camera mode
   */
  setMode(mode) {
    if (!mode) return this._mode;
    const prevMode = this._mode;
    this._mode = mode;

    if (
      mode === CAMERA_MODES.CHASE ||
      mode === CAMERA_MODES.COCKPIT ||
      mode === CAMERA_MODES.TV_POD
    ) {
      this._drivingMode = mode;
    }

    if (prevMode !== mode) {
      this._needsSnap = true;
      this._isDragging = false;
      this._activePointerId = null;
      this._velAzimuth = 0;
      this._velElevation = 0;
    }
    return this._mode;
  }

  /**
   * Cycle seamlessly across driving perspectives: CHASE -> COCKPIT -> TV_POD -> CHASE.
   * @returns {string} Newly selected driving camera mode
   */
  cycleDrivingMode() {
    const order = [CAMERA_MODES.CHASE, CAMERA_MODES.COCKPIT, CAMERA_MODES.TV_POD];
    const idx = order.indexOf(this._mode);
    const next = idx === -1 ? order[0] : order[(idx + 1) % order.length];
    return this.setMode(next);
  }

  /**
   * Return currently active camera mode.
   * @returns {string}
   */
  getMode() {
    return this._mode;
  }

  /**
   * Return last selected driving mode (for exiting Showroom into racing).
   * @returns {string}
   */
  getDrivingMode() {
    return this._drivingMode;
  }

  /**
   * Human-readable broadcast HUD label for the active mode.
   * @returns {string}
   */
  getModeLabel() {
    return CAMERA_LABELS[this._mode] ?? 'Chase Cam';
  }

  /**
   * Enable or disable gentle showroom auto-orbit (e.g. during Session Summary).
   * @param {number} radPerSec Angular velocity in rad/s (0 disables)
   */
  setAutoOrbitSpeed(radPerSec = 0) {
    this._autoOrbitSpeed = Number.isFinite(radPerSec) ? radPerSec : 0;
  }

  /**
   * Programmatically set showroom orbit spherical coordinates and snap immediately.
   * @param {number} azimuth Radians around car +Y (0 = dead front -Z, -0.68 = hero front-left 3/4)
   * @param {number} elevation Radians above horizon (clamped 0.08..0.85)
   * @param {number} radius Orbit distance in meters (clamped 3.4..9.5)
   */
  setShowroomAngles(azimuth, elevation, radius) {
    if (Number.isFinite(azimuth)) {
      this._orbitAzimuth = azimuth;
      this._targetAzimuth = azimuth;
    }
    if (Number.isFinite(elevation)) {
      const clampedE = THREE.MathUtils.clamp(elevation, ORBIT_MIN_ELEV, ORBIT_MAX_ELEV);
      this._orbitElevation = clampedE;
      this._targetElevation = clampedE;
    }
    if (Number.isFinite(radius)) {
      const clampedR = THREE.MathUtils.clamp(radius, ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS);
      this._orbitRadius = clampedR;
      this._targetRadius = clampedR;
    }
    this._velAzimuth = 0;
    this._velElevation = 0;
  }

  /**
   * Lock camera to an exact world-space position, lookAt point, and optional FOV.
   * @param {{x:number,y:number,z:number}|number[]} posObj
   * @param {{x:number,y:number,z:number}|number[]} lookAtObj
   * @param {number} [fov]
   */
  setCustomPose(posObj, lookAtObj, fov) {
    const pos = readVec3(posObj, new THREE.Vector3(), 0, 2, 5);
    const lookAt = readVec3(lookAtObj, new THREE.Vector3(), 0, 0.5, 0);
    this._customPose = {
      position: pos,
      lookAt,
      fov: Number.isFinite(fov) ? fov : null,
    };
    this._applyCustomPose();
  }

  /**
   * Release programmatic custom pose override and resume normal camera mode.
   */
  clearCustomPose() {
    this._customPose = null;
    this._needsSnap = true;
  }

  /**
   * Force next frame to snap spring-arm without lag (useful after car reset/teleport).
   */
  resetSmoothing() {
    this._needsSnap = true;
  }

  // --------------------------------------------------------------------------
  // Pointer & Wheel Handlers (Showroom Orbit)
  // --------------------------------------------------------------------------

  _handlePointerDown(event) {
    if (this._mode !== CAMERA_MODES.SHOWROOM_ORBIT || this._customPose) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (isUiControlTarget(event.target, this._domElement)) return;

    this._isDragging = true;
    this._activePointerId = event.pointerId;
    this._lastPointerX = event.clientX;
    this._lastPointerY = event.clientY;
    this._velAzimuth = 0;
    this._velElevation = 0;

    if (this._domElement && typeof this._domElement.setPointerCapture === 'function') {
      try {
        this._domElement.setPointerCapture(event.pointerId);
      } catch {
        // Ignore synthetic pointer events without an active pointer ID
      }
    }
  }

  _handlePointerMove(event) {
    if (!this._isDragging) return;
    if (this._activePointerId !== null && event.pointerId !== this._activePointerId) return;

    if (this._mode !== CAMERA_MODES.SHOWROOM_ORBIT || this._customPose) {
      this._isDragging = false;
      this._activePointerId = null;
      return;
    }

    const dx = event.clientX - this._lastPointerX;
    const dy = event.clientY - this._lastPointerY;
    this._lastPointerX = event.clientX;
    this._lastPointerY = event.clientY;

    const dAz = -dx * 0.0065;
    const dEl = dy * 0.0052;

    this._targetAzimuth += dAz;
    this._targetElevation = THREE.MathUtils.clamp(
      this._targetElevation + dEl,
      ORBIT_MIN_ELEV,
      ORBIT_MAX_ELEV
    );

    // Track gentle release inertia
    this._velAzimuth = THREE.MathUtils.lerp(this._velAzimuth, dAz * 22, 0.35);
    this._velElevation = THREE.MathUtils.lerp(this._velElevation, dEl * 22, 0.35);
  }

  _handlePointerUp(event) {
    if (!this._isDragging) return;
    if (this._activePointerId !== null && event.pointerId !== this._activePointerId) return;

    if (this._domElement && typeof this._domElement.releasePointerCapture === 'function') {
      try {
        if (this._domElement.hasPointerCapture?.(event.pointerId)) {
          this._domElement.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore release errors on detached pointers
      }
    }
    this._isDragging = false;
    this._activePointerId = null;
  }

  _handleWheel(event) {
    if (this._mode !== CAMERA_MODES.SHOWROOM_ORBIT || this._customPose) return;
    if (isUiControlTarget(event.target, this._domElement)) return;

    event.preventDefault();
    const delta = THREE.MathUtils.clamp(event.deltaY, -160, 160);
    this._targetRadius = THREE.MathUtils.clamp(
      this._targetRadius + delta * 0.0045,
      ORBIT_MIN_RADIUS,
      ORBIT_MAX_RADIUS
    );
  }

  // --------------------------------------------------------------------------
  // Per-Frame Update
  // --------------------------------------------------------------------------

  /**
   * Update Three.js PerspectiveCamera transform & FOV for the active rig.
   *
   * @param {number} dt Delta time in seconds
   * @param {object} carState Vehicle telemetry/transform snapshot
   * @param {boolean} [lookBack=false] True while rear-view key (B) is held
   * @param {boolean} [reducedMotion=false] True when prefers-reduced-motion: reduce
   */
  update(dt, carState, lookBack = false, reducedMotion = false) {
    if (!this.camera) return;

    if (this._customPose) {
      this._applyCustomPose();
      return;
    }

    const safeDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 1 / 60, 0.0001, 0.1);
    const carYaw = this._extractCarTransform(carState);

    switch (this._mode) {
      case CAMERA_MODES.SHOWROOM_ORBIT:
        this._updateShowroomOrbit(safeDt, carYaw, reducedMotion);
        break;
      case CAMERA_MODES.COCKPIT:
        this._updateCockpit(safeDt, carState, lookBack, reducedMotion);
        break;
      case CAMERA_MODES.TV_POD:
        this._updateTvPod(safeDt, carState, lookBack, reducedMotion);
        break;
      case CAMERA_MODES.CHASE:
      default:
        this._updateChase(safeDt, carState, carYaw, lookBack, reducedMotion);
        break;
    }

    this._prevLookBack = Boolean(lookBack);
    this._needsSnap = false;
  }

  _applyCustomPose() {
    if (!this.camera || !this._customPose) return;
    this.camera.up.copy(WORLD_UP);
    this.camera.position.copy(this._customPose.position);
    this.camera.lookAt(this._customPose.lookAt);
    if (this._customPose.fov !== null) {
      this._setFov(this._customPose.fov);
    }
  }

  _setFov(targetFov) {
    if (!this.camera) return;
    this._currentFov = targetFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Extract car world position, chassis quaternion, and planar yaw from carState.
   * Supports both nested Vector3/Quaternion and flat x/y/z/yaw/pitch/roll layouts.
   */
  _extractCarTransform(carState) {
    if (!carState) {
      this._carPos.set(0, 0, 0);
      this._carQuat.identity();
      this._yawQuat.identity();
      return 0;
    }

    if (carState.position) {
      readVec3(carState.position, this._carPos, 0, 0, 0);
    } else {
      this._carPos.set(carState.x ?? 0, carState.y ?? 0, carState.z ?? 0);
    }

    let carYaw = 0;
    if (carState.quaternion && typeof carState.quaternion === 'object') {
      const q = carState.quaternion;
      this._carQuat.set(q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 1).normalize();
      this._forward.set(0, 0, -1).applyQuaternion(this._carQuat);
      carYaw = Math.atan2(-this._forward.x, -this._forward.z);
    } else {
      carYaw = carState.yaw ?? carState.heading ?? 0;
      const pitch = carState.visualPitch ?? carState.pitch ?? 0;
      const roll = carState.visualRoll ?? carState.roll ?? 0;
      this._carEuler.set(pitch, carYaw, roll, 'YXZ');
      this._carQuat.setFromEuler(this._carEuler);
    }

    this._yawQuat.setFromAxisAngle(WORLD_UP, carYaw);
    return carYaw;
  }

  _extractTelemetry(carState) {
    if (!carState) {
      return { speedMs: 0, accelLong: 0, latG: 0, steerAngle: 0, kerbRumble: 0 };
    }

    let speedMs = 0;
    if (Number.isFinite(carState.speed)) {
      speedMs = Math.abs(carState.speed);
    } else if (Number.isFinite(carState.speedMs)) {
      speedMs = Math.abs(carState.speedMs);
    } else if (Number.isFinite(carState.speedKmh)) {
      speedMs = Math.abs(carState.speedKmh) / 3.6;
    } else if (carState.velocity) {
      const v = carState.velocity;
      speedMs = Math.hypot(v.x ?? 0, v.y ?? 0, v.z ?? 0);
    }

    const accelLong = Number.isFinite(carState.accelLong)
      ? carState.accelLong
      : Number.isFinite(carState.ax)
        ? carState.ax
        : Number.isFinite(carState.longG)
          ? carState.longG * 9.81
          : 0;

    const latG = Number.isFinite(carState.latG)
      ? carState.latG
      : Number.isFinite(carState.accelLat)
        ? carState.accelLat / 9.81
        : Number.isFinite(carState.ay)
          ? carState.ay / 9.81
          : 0;

    const steerAngle = Number.isFinite(carState.steerAngle)
      ? carState.steerAngle
      : Number.isFinite(carState.steer)
        ? carState.steer
        : 0;

    const kerbRumble = THREE.MathUtils.clamp(
      carState.kerbRumbleIntensity ?? carState.kerbIntensity ?? 0,
      0,
      1
    );

    return { speedMs, accelLong, latG, steerAngle, kerbRumble };
  }

  _updateShowroomOrbit(dt, carYaw, reducedMotion) {
    if (!this._isDragging) {
      if (reducedMotion) {
        this._velAzimuth = 0;
        this._velElevation = 0;
      } else {
        // Apply gentle release inertia
        this._targetAzimuth += this._velAzimuth * dt;
        this._targetElevation = THREE.MathUtils.clamp(
          this._targetElevation + this._velElevation * dt,
          ORBIT_MIN_ELEV,
          ORBIT_MAX_ELEV
        );
        const inertiaDecay = Math.exp(-8.0 * dt);
        this._velAzimuth *= inertiaDecay;
        this._velElevation *= inertiaDecay;
        if (Math.abs(this._velAzimuth) < 0.0005) this._velAzimuth = 0;
        if (Math.abs(this._velElevation) < 0.0005) this._velElevation = 0;

        if (this._autoOrbitSpeed !== 0) {
          this._targetAzimuth += this._autoOrbitSpeed * dt;
        }
      }
    }

    const damp = reducedMotion ? 1.0 : 1.0 - Math.exp(-11.0 * dt);
    this._orbitAzimuth += (this._targetAzimuth - this._orbitAzimuth) * damp;
    this._orbitElevation += (this._targetElevation - this._orbitElevation) * damp;
    this._orbitRadius += (this._targetRadius - this._orbitRadius) * damp;

    // LookAt target centered cleanly on the F1 chassis silhouette
    this._localVec.set(0, 0.48, -0.15).applyQuaternion(this._yawQuat);
    this._desiredLookAt.copy(this._carPos).add(this._localVec);

    // Car-local spherical offset: azimuth 0 is dead front (-Z), -0.68 is hero front-left 3/4
    const horizR = Math.cos(this._orbitElevation) * this._orbitRadius;
    const offX = Math.sin(this._orbitAzimuth) * horizR;
    const offY = Math.sin(this._orbitElevation) * this._orbitRadius;
    const offZ = -Math.cos(this._orbitAzimuth) * horizR;

    this._localVec.set(offX, offY, offZ).applyQuaternion(this._yawQuat);
    this._desiredPos.copy(this._desiredLookAt).add(this._localVec);

    const minGroundY = this._carPos.y + 0.28;
    if (this._desiredPos.y < minGroundY) {
      this._desiredPos.y = minGroundY;
    }

    this.camera.up.copy(WORLD_UP);
    this.camera.position.copy(this._desiredPos);
    this.camera.lookAt(this._desiredLookAt);

    // Telephoto studio focal length avoids nosecone perspective distortion
    const nextFov = this._needsSnap
      ? 42
      : THREE.MathUtils.lerp(this._currentFov, 42, 1.0 - Math.exp(-10 * dt));
    this._setFov(nextFov);
  }

  _updateChase(dt, carState, carYaw, lookBack, reducedMotion) {
    const { speedMs, accelLong, latG } = this._extractTelemetry(carState);
    const lookBackToggled = Boolean(lookBack) !== this._prevLookBack;
    const teleported = this._chasePos.distanceToSquared(this._carPos) > 144; // > 12m jump
    const snap = this._needsSnap || lookBackToggled || teleported;

    if (snap) {
      this._chaseYaw = carYaw;
    } else {
      const yawDelta = wrapAngle(carYaw - this._chaseYaw);
      const yawLerp = 1.0 - Math.exp(-9.0 * dt);
      this._chaseYaw = wrapAngle(this._chaseYaw + yawDelta * yawLerp);
    }

    // Build orthonormal horizontal basis from damped chase yaw
    const sinY = Math.sin(this._chaseYaw);
    const cosY = Math.cos(this._chaseYaw);
    this._forward.set(-sinY, 0, -cosY);
    this._back.set(sinY, 0, cosY);
    this._right.set(cosY, 0, -sinY);

    // Dynamic acceleration pullback & lateral G spring lean
    const targetPullback = lookBack
      ? 0
      : THREE.MathUtils.clamp(accelLong * 0.032, -0.22, 0.56);
    const targetLatOffset = lookBack
      ? 0
      : THREE.MathUtils.clamp(-latG * 0.10, -0.38, 0.38);
    const targetLatRoll = (lookBack || reducedMotion)
      ? 0
      : THREE.MathUtils.clamp(-latG * 0.011, -0.036, 0.036);

    const dynLerp = snap ? 1.0 : 1.0 - Math.exp(-7.5 * dt);
    this._chasePullback += (targetPullback - this._chasePullback) * dynLerp;
    this._chaseLatOffset += (targetLatOffset - this._chaseLatOffset) * dynLerp;
    this._chaseLatRoll += (targetLatRoll - this._chaseLatRoll) * dynLerp;

    if (lookBack) {
      this._desiredPos
        .copy(this._carPos)
        .addScaledVector(this._forward, CHASE_BASE_BACK)
        .addScaledVector(WORLD_UP, CHASE_BASE_UP);
      this._desiredLookAt
        .copy(this._carPos)
        .addScaledVector(this._back, 6.5)
        .addScaledVector(WORLD_UP, 0.78);
    } else {
      const backDist = CHASE_BASE_BACK + this._chasePullback;
      this._desiredPos
        .copy(this._carPos)
        .addScaledVector(this._back, backDist)
        .addScaledVector(WORLD_UP, CHASE_BASE_UP)
        .addScaledVector(this._right, this._chaseLatOffset);

      this._desiredLookAt
        .copy(this._carPos)
        .addScaledVector(this._forward, 6.5)
        .addScaledVector(WORLD_UP, 0.78)
        .addScaledVector(this._right, this._chaseLatOffset * 0.25);
    }

    if (snap) {
      this._chasePos.copy(this._desiredPos);
      this._chaseLookAt.copy(this._desiredLookAt);
    } else {
      const posLerpXZ = 1.0 - Math.exp(-15.0 * dt);
      const posLerpY = 1.0 - Math.exp(-12.0 * dt);
      this._chasePos.x += (this._desiredPos.x - this._chasePos.x) * posLerpXZ;
      this._chasePos.z += (this._desiredPos.z - this._chasePos.z) * posLerpXZ;
      this._chasePos.y += (this._desiredPos.y - this._chasePos.y) * posLerpY;

      const lookLerp = 1.0 - Math.exp(-18.0 * dt);
      this._chaseLookAt.lerp(this._desiredLookAt, lookLerp);
    }

    // Never clip below local track plane
    const minY = this._carPos.y + 0.55;
    if (this._chasePos.y < minY) {
      this._chasePos.y = minY;
    }

    // Apply subtle horizon roll via camera.up vector
    this._camUp
      .copy(WORLD_UP)
      .addScaledVector(this._right, Math.sin(this._chaseLatRoll))
      .normalize();

    this.camera.up.copy(this._camUp);
    this.camera.position.copy(this._chasePos);
    this.camera.lookAt(this._chaseLookAt);

    // Speed-proportional dynamic FOV (54° -> 70°; damped range if reducedMotion)
    const speedNorm = THREE.MathUtils.clamp(speedMs / 95.0, 0, 1);
    const fovSpan = reducedMotion ? 4.0 : (CHASE_MAX_FOV - CHASE_MIN_FOV);
    const targetFov = CHASE_MIN_FOV + fovSpan * (0.65 * speedNorm + 0.35 * speedNorm * speedNorm);
    const nextFov = snap
      ? targetFov
      : THREE.MathUtils.lerp(this._currentFov, targetFov, 1.0 - Math.exp(-8.0 * dt));
    this._setFov(nextFov);
  }

  _updateCockpit(dt, carState, lookBack, reducedMotion) {
    const { speedMs, steerAngle, kerbRumble } = this._extractTelemetry(carState);
    this._vibTime += dt;

    // Smooth steering apex look-ahead
    const targetLookYaw = lookBack
      ? 0
      : THREE.MathUtils.clamp(steerAngle * 0.52, -0.22, 0.22);
    const yawRate = this._needsSnap ? 1.0 : 1.0 - Math.exp(-8.5 * dt);
    this._lookAheadYaw += (targetLookYaw - this._lookAheadYaw) * yawRate;

    // Eye anchor in chassis local space (0, 0.72, -0.05)
    this._localVec.copy(COCKPIT_LOCAL_POS);
    if (lookBack) {
      this._localVec.set(0, 0.90, 0.12);
    }

    // Subtle high-frequency road + kerb micro-vibration (disabled under reducedMotion)
    if (!reducedMotion && speedMs > 1.5) {
      const speedNorm = THREE.MathUtils.clamp(speedMs / 95.0, 0, 1);
      const ampY = speedNorm * speedNorm * 0.0042 + kerbRumble * 0.011;
      const ampX = speedNorm * speedNorm * 0.0020 + kerbRumble * 0.006;
      const t = this._vibTime;
      this._localVec.y += Math.sin(t * 53.0) * ampY * 0.65 + Math.cos(t * 89.0) * ampY * 0.35;
      this._localVec.x += Math.sin(t * 37.0) * ampX;
    }

    this._desiredPos.copy(this._localVec).applyQuaternion(this._carQuat).add(this._carPos);

    // Forward sightline past Halo & steering wheel OLED
    if (lookBack) {
      this._localDir.set(0, -0.02, 1.0).normalize();
    } else {
      this._localDir.set(0, -0.018, -1.0).normalize();
      this._lookRotQuat.setFromAxisAngle(WORLD_UP, this._lookAheadYaw);
      this._localDir.applyQuaternion(this._lookRotQuat);
    }
    this._localDir.applyQuaternion(this._carQuat);
    this._desiredLookAt.copy(this._desiredPos).addScaledVector(this._localDir, 25.0);

    // Chassis-locked horizon roll
    this._camUp.copy(WORLD_UP).applyQuaternion(this._carQuat).normalize();
    this.camera.up.copy(this._camUp);
    this.camera.position.copy(this._desiredPos);
    this.camera.lookAt(this._desiredLookAt);

    const speedNorm = THREE.MathUtils.clamp(speedMs / 95.0, 0, 1);
    const targetFov = reducedMotion ? 62 : 62 + 6 * speedNorm;
    const nextFov = this._needsSnap
      ? targetFov
      : THREE.MathUtils.lerp(this._currentFov, targetFov, 1.0 - Math.exp(-9.0 * dt));
    this._setFov(nextFov);
  }

  _updateTvPod(dt, carState, lookBack, reducedMotion) {
    const { speedMs, steerAngle, kerbRumble } = this._extractTelemetry(carState);
    this._vibTime += dt;

    // Gentle steering lead for onboard broadcast camera
    const targetLookYaw = lookBack
      ? 0
      : THREE.MathUtils.clamp(steerAngle * 0.14, -0.08, 0.08);
    const yawRate = this._needsSnap ? 1.0 : 1.0 - Math.exp(-8.0 * dt);
    this._lookAheadYaw += (targetLookYaw - this._lookAheadYaw) * yawRate;

    // Classic FIA onboard T-Cam mount atop roll-hoop airbox (0, 1.12, +0.28)
    this._localVec.copy(TV_POD_LOCAL_POS);

    if (!reducedMotion && speedMs > 2.0) {
      const speedNorm = THREE.MathUtils.clamp(speedMs / 95.0, 0, 1);
      const amp = speedNorm * speedNorm * 0.0022 + kerbRumble * 0.0065;
      const t = this._vibTime;
      this._localVec.y += Math.sin(t * 47.0) * amp;
    }

    this._desiredPos.copy(this._localVec).applyQuaternion(this._carQuat).add(this._carPos);

    // Angled down -4.5° to frame helmet, Halo, nosecone, and front wheel steering
    if (lookBack) {
      this._localDir.set(0, Math.sin(-3.0 * DEG2RAD), Math.cos(-3.0 * DEG2RAD));
    } else {
      this._localDir.set(0, Math.sin(TV_POD_PITCH_RAD), -Math.cos(TV_POD_PITCH_RAD));
      this._lookRotQuat.setFromAxisAngle(WORLD_UP, this._lookAheadYaw);
      this._localDir.applyQuaternion(this._lookRotQuat);
    }
    this._localDir.applyQuaternion(this._carQuat);
    this._desiredLookAt.copy(this._desiredPos).addScaledVector(this._localDir, 25.0);

    // Broadcast T-cam gyro-damped horizon (65% chassis up + 35% world up)
    this._up.copy(WORLD_UP).applyQuaternion(this._carQuat);
    this._camUp.copy(this._up).multiplyScalar(0.65).addScaledVector(WORLD_UP, 0.35).normalize();

    this.camera.up.copy(this._camUp);
    this.camera.position.copy(this._desiredPos);
    this.camera.lookAt(this._desiredLookAt);

    const speedNorm = THREE.MathUtils.clamp(speedMs / 95.0, 0, 1);
    const targetFov = reducedMotion ? 64 : 64 + 6 * speedNorm;
    const nextFov = this._needsSnap
      ? targetFov
      : THREE.MathUtils.lerp(this._currentFov, targetFov, 1.0 - Math.exp(-9.0 * dt));
    this._setFov(nextFov);
  }
}

/**
 * Unified Cinematic Camera Director Controller
 * Implements Section 7 of specs/golfswing.md:
 *  - Camera_Address_Tee (50mm f/2.8, 45° rear-quarter framing, dynamic swing pull-in, 0.02m impact shake)
 *  - Camera_Flight_Chase (85mm f/4.0, trailing -3.5m behind & +0.8m above flight vector)
 *  - Camera_Landing_Downrange (135mm f/2.0, reverse telephoto near predicted landing corridor)
 *  - Camera_FACS_Closeup (85mm f/2.0 close-up inspection of golfer FACS facial exertion)
 */

import * as THREE from 'three';
import {
  CAMERA_SPECS,
  GAME_STATES,
  SWING_TIMING,
  focalLengthToVerticalFov,
} from './constants.js';
import { getTerrainHeight } from './physics.js';

export class CameraDirector {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.mode = 'AUTO'; // 'AUTO' | 'Camera_Address_Tee' | 'Camera_Flight_Chase' | 'Camera_Landing_Downrange' | 'Camera_FACS_Closeup'
    this.activeRigId = 'Camera_Address_Tee';

    this.currentPos = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.targetLookAt = new THREE.Vector3();

    // Impact high-frequency camera shake impulse (0.02m amplitude per Section 7)
    this.shakeTime = 0;
    this.shakeDuration = 0.28;
    this.shakeActive = false;

    // Optional interactive address orbit offset (drag on canvas during Tee Address to inspect rig/materials)
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.orbitZoom = 1.0;
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    // Locked downrange telephoto tripod position per shot
    this.landingTripodPos = new THREE.Vector3(14, 4.8, -280);
    this.landingTripodSet = false;
    this.faceOnPopoverOffset = false;

    this._bindPointerInspect();
    this.snapToAddress();
  }

  setFaceOnSplitOffset(enabled) {
    this.faceOnPopoverOffset = Boolean(enabled);
  }

  _bindPointerInspect() {
    const el = this.domElement;
    if (!el) return;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.orbitYaw = THREE.MathUtils.clamp(this.orbitYaw - dx * 0.0055, -1.6, 1.6);
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.004, -0.35, 0.55);
    });

    const endDrag = () => {
      this._dragging = false;
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.orbitZoom = THREE.MathUtils.clamp(this.orbitZoom + e.deltaY * 0.0008, 0.55, 1.6);
      },
      { passive: false }
    );
  }

  setCameraMode(mode) {
    this.mode = mode;
    if (
      mode === 'Camera_Address_Tee' ||
      mode === 'AUTO' ||
      mode === 'Camera_Face_On' ||
      mode === 'Camera_Down_The_Line'
    ) {
      this.resetOrbit();
    }
  }

  resetOrbit() {
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.orbitZoom = 1.0;
  }

  triggerImpactShake() {
    this.shakeActive = true;
    this.shakeTime = 0;
  }

  prepareLandingCamera(predictedLandingPos) {
    // Place reverse-angle 135mm telephoto tripod downrange ahead and slightly offset right of predicted landing corridor
    const px = predictedLandingPos.x;
    const pz = predictedLandingPos.z;
    const sideSign = px >= 0 ? -1 : 1;
    const camX = px + sideSign * 17.5;
    const camZ = pz - 32.0; // Further downrange looking back up the descent corridor!
    const groundY = getTerrainHeight(camX, camZ);
    this.landingTripodPos.set(camX, groundY + 4.4, camZ);
    this.landingTripodSet = true;
  }

  snapToAddress() {
    this.activeRigId = 'Camera_Address_Tee';
    this.landingTripodSet = false;
    this.shakeActive = false;
    this.resetOrbit();

    const spec = CAMERA_SPECS.Camera_Address_Tee;
    this.camera.fov = focalLengthToVerticalFov(spec.focalLengthMm, spec.sensorHeightMm);
    this.camera.updateProjectionMatrix();

    // 45-degree rear-quarter framing showcasing full golfer, titanium driver behind ball on wooden tee, and sweeping fairway
    this.currentPos.set(-2.55, 1.54, 5.45);
    this.currentLookAt.set(-0.22, 0.72, -1.8);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }

  getActiveSpec() {
    return CAMERA_SPECS[this.activeRigId] || CAMERA_SPECS.Camera_Address_Tee;
  }

  update(dt, gameState, golfer, physics, reducedMotion = false) {
    // Determine which camera rig is active based on Auto Director or manual override
    let desiredRig = 'Camera_Address_Tee';
    if (this.mode !== 'AUTO') {
      desiredRig = this.mode;
    } else if (gameState === GAME_STATES.TEE_ADDRESS || gameState === GAME_STATES.SWING_EXECUTION) {
      desiredRig = 'Camera_Address_Tee';
    } else if (gameState === GAME_STATES.BALL_FLIGHT) {
      // Switch smoothly to Downrange Landing telephoto as ball descends below 13m approaching ground
      const alt = physics.getAltitudeAboveTurf();
      if (physics.flightTime > 1.6 && physics.velocity.y < -2.5 && alt < 14.0) {
        desiredRig = 'Camera_Landing_Downrange';
      } else {
        desiredRig = 'Camera_Flight_Chase';
      }
    } else if (gameState === GAME_STATES.LANDING_ROLLOUT || gameState === GAME_STATES.RELOAD_RESET) {
      desiredRig = 'Camera_Landing_Downrange';
    }

    const rigChanged = desiredRig !== this.activeRigId;
    this.activeRigId = desiredRig;
    const spec = CAMERA_SPECS[desiredRig];

    // Update optical focal length -> Full-Frame 36x24mm vertical FOV
    const targetFov =
      desiredRig === 'Camera_Flight_Chase'
        ? focalLengthToVerticalFov(spec.focalLengthMm * 0.56, spec.sensorHeightMm) // ~28° cinematic chase clarity
        : focalLengthToVerticalFov(spec.focalLengthMm, spec.sensorHeightMm);

    if (rigChanged) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    } else {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 6));
      this.camera.updateProjectionMatrix();
    }

    if (desiredRig === 'Camera_Address_Tee') {
      this._updateAddressCamera(dt, gameState, golfer, rigChanged, reducedMotion);
    } else if (desiredRig === 'Camera_Flight_Chase') {
      this._updateFlightChaseCamera(dt, physics, rigChanged);
    } else if (desiredRig === 'Camera_Landing_Downrange') {
      this._updateLandingDownrangeCamera(dt, physics, rigChanged);
    } else if (desiredRig === 'Camera_FACS_Closeup') {
      this._updateFACSCloseupCamera(dt, golfer, rigChanged);
    } else if (desiredRig === 'Camera_Face_On') {
      this._updateFaceOnCamera(dt, rigChanged);
    } else if (desiredRig === 'Camera_Down_The_Line') {
      this._updateDownTheLineCamera(dt, rigChanged);
    }

    this.camera.position.copy(this.currentPos);

    // Apply 0.02m high-frequency kinetic impact impulse shake (disabled under prefers-reduced-motion)
    if (this.shakeActive && !reducedMotion) {
      this.shakeTime += dt;
      if (this.shakeTime >= this.shakeDuration) {
        this.shakeActive = false;
      } else {
        const decay = Math.exp(-this.shakeTime * 14.0);
        const amp = CAMERA_SPECS.Camera_Address_Tee.impactShakeAmplitudeM * decay;
        this.camera.position.x += Math.sin(this.shakeTime * 145.0) * amp;
        this.camera.position.y += Math.cos(this.shakeTime * 190.0) * amp * 0.85;
      }
    }

    this.camera.lookAt(this.currentLookAt);
  }

  _updateAddressCamera(dt, gameState, golfer, immediate, reducedMotion) {
    // Base 45-degree rear-quarter composition framing full golfer + driver + ball + fairway corridor
    const pivot = new THREE.Vector3(-0.34, 0.82, 0.0);
    const baseOffset = new THREE.Vector3(-2.21, 0.72, 5.45);

    // Subtle dynamic focal pull-in during downswing acceleration (Section 7)
    let swingPull = 1.0;
    if (gameState === GAME_STATES.SWING_EXECUTION && !reducedMotion) {
      const p = THREE.MathUtils.clamp(
        (golfer.swingTime - SWING_TIMING.BACKSWING_END_S) /
          (SWING_TIMING.IMPACT_S - SWING_TIMING.BACKSWING_END_S),
        0,
        1
      );
      swingPull = 1.0 - 0.11 * p;
    }

    const offset = baseOffset.clone().multiplyScalar(this.orbitZoom * swingPull);
    if (Math.abs(this.orbitYaw) > 0.001 || Math.abs(this.orbitPitch) > 0.001) {
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitYaw);
      offset.y = Math.max(0.28, offset.y + this.orbitPitch * 2.4);
    }

    this.targetPos.copy(pivot).add(offset);
    // Keep camera above terrain
    const minGroundY = getTerrainHeight(this.targetPos.x, this.targetPos.z) + 0.35;
    this.targetPos.y = Math.max(minGroundY, this.targetPos.y);

    // Look ahead toward golfer, ball on tee, and downrange fairway horizon
    this.targetLookAt.set(-0.22, 0.72, -1.8);
    if (Math.abs(this.orbitYaw) > 0.05) {
      this.targetLookAt.set(-0.32, 0.82, 0.0);
    }

    const blend = immediate ? 1.0 : Math.min(1, dt * 7.5);
    this.currentPos.lerp(this.targetPos, blend);
    this.currentLookAt.lerp(this.targetLookAt, blend);
  }

  _updateFlightChaseCamera(dt, physics, immediate) {
    const spec = CAMERA_SPECS.Camera_Flight_Chase;
    const ballPos = physics.position;
    const vel = physics.velocity;

    // Flight tangent vector (fallback to downrange -Z if speed very low)
    const dir = vel.lengthSq() > 0.25 ? vel.clone().normalize() : new THREE.Vector3(0, 0, -1);

    // Spec Section 7 exact offset: -3.5m along velocity vector, +0.8m vertical elevation
    this.targetPos
      .copy(ballPos)
      .addScaledVector(dir, -spec.trailDistanceM)
      .add(new THREE.Vector3(0, spec.elevationOffsetM, 0));

    const minGroundY = getTerrainHeight(this.targetPos.x, this.targetPos.z) + 0.45;
    this.targetPos.y = Math.max(minGroundY, this.targetPos.y);

    // Smooth over-the-shoulder look-at focused through ball toward downrange fairway landscape
    this.targetLookAt.copy(ballPos).addScaledVector(dir, 5.5);
    this.targetLookAt.y = Math.max(this.targetLookAt.y - 0.35, getTerrainHeight(this.targetLookAt.x, this.targetLookAt.z));

    const blendPos = immediate ? 1.0 : Math.min(1, dt * 11.0);
    const blendLook = immediate ? 1.0 : Math.min(1, dt * 14.0);
    this.currentPos.lerp(this.targetPos, blendPos);
    this.currentLookAt.lerp(this.targetLookAt, blendLook);
  }

  _updateLandingDownrangeCamera(dt, physics, immediate) {
    if (!this.landingTripodSet) {
      this.prepareLandingCamera(physics.predictedLandingPos);
    }

    // Gentle tracking drift once ball rolls closer so ball remains hero-sized in 135mm frame
    const ballPos = physics.position;
    const distToCam = this.landingTripodPos.distanceTo(ballPos);
    this.targetPos.copy(this.landingTripodPos);

    if (physics.hasBounced && distToCam > 22) {
      const toBall = new THREE.Vector3().subVectors(ballPos, this.landingTripodPos).normalize();
      this.targetPos.addScaledVector(toBall, Math.min(12, (distToCam - 22) * 0.35));
      const gy = getTerrainHeight(this.targetPos.x, this.targetPos.z);
      this.targetPos.y = Math.max(gy + 1.85, this.targetPos.y - 1.2);
    }

    this.targetLookAt.copy(ballPos);
    this.targetLookAt.y += 0.14;

    const blendPos = immediate ? 1.0 : Math.min(1, dt * 3.5);
    const blendLook = immediate ? 1.0 : Math.min(1, dt * 10.0);
    this.currentPos.lerp(this.targetPos, blendPos);
    this.currentLookAt.lerp(this.targetLookAt, blendLook);
  }

  _updateFACSCloseupCamera(dt, golfer, immediate) {
    const headPos = golfer.getHeadWorldPosition();
    // Slightly below eye level looking gently upward under the golf cap visor to showcase FACS AU1–AU26
    this.targetPos.set(headPos.x + 0.88, headPos.y - 0.24, headPos.z + 0.22);
    this.targetLookAt.set(headPos.x, headPos.y - 0.02, headPos.z);
    const blend = immediate ? 1.0 : Math.min(1, dt * 8.0);
    this.currentPos.lerp(this.targetPos, blend);
    this.currentLookAt.lerp(this.targetLookAt, blend);
  }

  _updateFaceOnCamera(dt, immediate) {
    // True face-on biomechanics view; shift lookAt toward -Z (screen right) when 25-Frame Ref popover is docked right
    const zShift = this.faceOnPopoverOffset ? -0.78 : 0.04;
    const xDist = (this.faceOnPopoverOffset ? 4.15 : 3.25) * this.orbitZoom;
    this.targetPos.set(xDist, 1.15, zShift);
    this.targetLookAt.set(-0.82, 1.05, zShift);
    const blend = immediate ? 1.0 : Math.min(1, dt * 8.0);
    this.currentPos.lerp(this.targetPos, blend);
    this.currentLookAt.lerp(this.targetLookAt, blend);
  }

  _updateDownTheLineCamera(dt, immediate) {
    // Classic Down-The-Line swing plane camera directly behind hands & target line
    this.targetPos.set(-0.45, 1.18, 3.85 * this.orbitZoom);
    this.targetLookAt.set(-0.45, 1.04, 0.0);
    const blend = immediate ? 1.0 : Math.min(1, dt * 8.0);
    this.currentPos.lerp(this.targetPos, blend);
    this.currentLookAt.lerp(this.targetLookAt, blend);
  }
}

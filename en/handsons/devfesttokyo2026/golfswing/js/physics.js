/**
 * Aerodynamic Golf Ball Trajectory & Turf Restitution Physics Engine
 * Implements Section 6 of specs/golfswing.md:
 *  - Momentum-transfer driver impact launch solver
 *  - Fixed-timestep 240Hz RK4 integration of gravity, Reynolds-dependent dimpled drag,
 *    spin-ratio Magnus lift, and exponential spin decay
 *  - Procedural championship terrain heightfield + surface classification
 *  - Turf impact restitution (e_turf = 0.42), kinetic friction (mu_k = 0.35),
 *    and pure rolling deceleration (mu_r = 0.08)
 *
 * World coordinate convention (right-handed Y-up):
 *  - Downrange along fairway centerline: -Z (distance = -z)
 *  - Lateral offset: +X = right, -X = left
 *  - Elevation: +Y = up
 */

import * as THREE from 'three';
import { PHYSICS, RPM_TO_RADS, DEG_TO_RAD } from './constants.js';

export const BUNKERS = Object.freeze([
  { x: -23, z: -172, rx: 9.5, rz: 14.5, depth: 0.72 },
  { x: 25, z: -218, rx: 10.5, rz: 16.0, depth: 0.78 },
  { x: -25, z: -268, rx: 9.0, rz: 13.5, depth: 0.68 },
  { x: 21, z: -316, rx: 8.5, rz: 12.0, depth: 0.65 },
  { x: -18, z: -346, rx: 8.5, rz: 11.5, depth: 0.65 },
]);

export const GREEN_CENTER = Object.freeze({ x: 0, z: -335, rx: 16.5, rz: 20.0 });
export const FLAG_POSITION = Object.freeze({ x: 1.5, z: -338 });

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Computes the fairway centerline lateral curve as a function of downrange distance (d = -z).
 * Kept nearly straight for clean tee driving alignment while introducing organic visual flow.
 */
export function getFairwayCenterX(z) {
  const d = Math.max(0, -z);
  return Math.sin(d * 0.0085) * 3.8 * smoothstep(35, 180, d);
}

/**
 * Fairway half-width in meters at world z.
 */
export function getFairwayHalfWidth(z) {
  const d = Math.max(0, -z);
  if (d < 16) return 8.0;
  return 18.5 + 4.5 * Math.sin(d * 0.017) + 3.0 * smoothstep(140, 260, d);
}

/**
 * Deterministic surface height y(x, z) in meters across the entire driving range / golf hole.
 * Tee box sits at y = 0.0 m around (0, 0) so ball on tee is cleanly at (0, TEE_HEIGHT, 0).
 */
export function getTerrainHeight(x, z) {
  const d = -z;

  // Flat precision tee box around (0, 0) with gentle sloped apron dropping into fairway
  const teeBoxDist = Math.hypot(x * 0.85, (z - 0.5) * 0.72);
  const teeBlend = smoothstep(5.5, 16.0, teeBoxDist);

  // Rolling championship fairway elevation profile
  const valleyDrop = -1.65 * smoothstep(12, 85, d) + 1.25 * smoothstep(180, 340, d);
  const gentleRoll =
    0.58 * Math.sin(d * 0.022 + 0.4) * Math.cos(x * 0.032) +
    0.34 * Math.sin(x * 0.055 + d * 0.014) +
    0.18 * Math.cos(d * 0.068 - x * 0.048);

  // Subtle amphitheater flanking hills outside the fairway corridor
  const centerX = getFairwayCenterX(z);
  const lateral = Math.abs(x - centerX);
  const bankLift =
    smoothstep(24, 72, lateral) *
    (3.8 + 2.4 * Math.sin(d * 0.028 + Math.sign(x) * 1.1) + 1.4 * Math.cos(x * 0.04));

  // Distant horizon backdrop rise beyond green
  const backRidge = smoothstep(355, 445, d) * (12.0 + 4.5 * Math.sin(x * 0.03));

  // Sculpted bunker bowls
  let bunkerCarve = 0;
  for (let i = 0; i < BUNKERS.length; i++) {
    const b = BUNKERS[i];
    const nx = (x - b.x) / b.rx;
    const nz = (z - b.z) / b.rz;
    const r2 = nx * nx + nz * nz;
    if (r2 < 1.55) {
      const r = Math.sqrt(r2);
      const lip = Math.exp(-Math.pow((r - 1.02) * 5.2, 2)) * 0.24;
      const bowl = (1 - smoothstep(0.15, 0.96, r)) * b.depth;
      bunkerCarve += lip - bowl;
    }
  }

  // Smooth level putting green crown around z = -335
  const gx = (x - GREEN_CENTER.x) / GREEN_CENTER.rx;
  const gz = (z - GREEN_CENTER.z) / GREEN_CENTER.rz;
  const gDist = Math.hypot(gx, gz);
  const greenCrown = (1 - smoothstep(0.55, 1.15, gDist)) * 0.45;

  const naturalHeight = valleyDrop + gentleRoll + bankLift + backRidge + bunkerCarve + greenCrown;
  return naturalHeight * teeBlend;
}

/**
 * Analytic central-difference surface normal at (x, z).
 */
export function getTerrainNormal(x, z, out = new THREE.Vector3()) {
  const eps = 0.25;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  return out.set(hL - hR, 2 * eps, hD - hU).normalize();
}

/**
 * Classifies ground surface material at world (x, z) for both shading and physics restitution.
 * Returns: 'tee' | 'fairway' | 'rough' | 'bunker' | 'green'
 */
export function getSurfaceType(x, z) {
  if (Math.abs(x) < 4.8 && z > -6.0 && z < 4.5) {
    return 'tee';
  }
  for (let i = 0; i < BUNKERS.length; i++) {
    const b = BUNKERS[i];
    const nx = (x - b.x) / b.rx;
    const nz = (z - b.z) / b.rz;
    if (nx * nx + nz * nz < 0.92) {
      return 'bunker';
    }
  }
  const gx = (x - GREEN_CENTER.x) / GREEN_CENTER.rx;
  const gz = (z - GREEN_CENTER.z) / GREEN_CENTER.rz;
  if (gx * gx + gz * gz < 1.0) {
    return 'green';
  }
  const d = -z;
  if (d >= 16 && d <= 345) {
    const centerX = getFairwayCenterX(z);
    const halfW = getFairwayHalfWidth(z);
    if (Math.abs(x - centerX) <= halfW) {
      return 'fairway';
    }
  }
  return 'rough';
}

export function getSurfacePhysicsProps(surfaceType) {
  switch (surfaceType) {
    case 'bunker':
      return {
        restitution: PHYSICS.BUNKER_RESTITUTION,
        kineticFriction: 0.65,
        rollingResist: PHYSICS.BUNKER_ROLLING_RESIST,
        label: 'Greenside / Fairway Bunker',
      };
    case 'rough':
      return {
        restitution: PHYSICS.ROUGH_RESTITUTION,
        kineticFriction: 0.48,
        rollingResist: PHYSICS.ROUGH_ROLLING_RESIST,
        label: 'Primary Rough',
      };
    case 'green':
      return {
        restitution: PHYSICS.GREEN_RESTITUTION,
        kineticFriction: 0.28,
        rollingResist: PHYSICS.GREEN_ROLLING_RESIST,
        label: 'Putting Green',
      };
    case 'tee':
    case 'fairway':
    default:
      return {
        restitution: PHYSICS.TURF_RESTITUTION,
        kineticFriction: PHYSICS.TURF_FRICTION_KINETIC,
        rollingResist: PHYSICS.TURF_ROLLING_RESIST,
        label: 'Bentgrass Fairway',
      };
  }
}

/**
 * Momentum-transfer clubface impact velocity equation from Section 6:
 *   v_launch = v_club * (1 + e) / (1 + m_ball / m_club)
 */
export function computeLaunchSpeed(clubSpeedMs, smashModifier = 1.0) {
  const nominal =
    clubSpeedMs * ((1 + PHYSICS.COR_DRIVER) / (1 + PHYSICS.BALL_MASS / PHYSICS.CLUB_MASS));
  return nominal * smashModifier;
}

/**
 * Reynolds-number dependent drag coefficient C_d for a dimpled golf ball.
 * Turbulent boundary layer induced by dimples keeps C_d around 0.24 - 0.28 at high velocities
 * rather than 0.47 for a smooth sphere (Section 6).
 */
export function computeDragCoefficient(speedRel, spinRatio) {
  const re = (PHYSICS.AIR_DENSITY * speedRel * PHYSICS.BALL_DIAMETER) / PHYSICS.AIR_VISCOSITY;
  let cdBase;
  if (re < 5.0e4) {
    cdBase = 0.44 - 0.14 * smoothstep(2.0e4, 5.0e4, re);
  } else if (re < 9.5e4) {
    // Drag crisis transition into turbulent dimple boundary layer
    cdBase = 0.30 - 0.065 * smoothstep(5.0e4, 9.5e4, re);
  } else {
    // High-velocity dimpled regime maintaining ~0.235 - 0.265
    cdBase = 0.235 + 0.018 * smoothstep(9.5e4, 2.4e5, re);
  }
  const cdSpin = Math.min(0.08, 0.18 * spinRatio);
  return cdBase + cdSpin;
}

/**
 * Magnus lift coefficient C_L parameterized by spin ratio S = r * ||omega|| / ||v_rel||.
 */
export function computeLiftCoefficient(spinRatio) {
  if (spinRatio <= 1e-5) return 0;
  // Empirical dimpled golf ball lift curve saturating smoothly near 0.30
  return Math.min(0.32, 0.04 + 1.68 * spinRatio - 2.35 * spinRatio * spinRatio);
}

/**
 * Computes wind velocity vector in world coordinates (m/s).
 * windDirectionDeg: 0 = tailwind (blowing downrange -Z), 90 = left-to-right (+X), 180 = headwind (+Z).
 */
export function getWindVector(windSpeedMs, windDirectionDeg, altitudeM = 1.0, out = new THREE.Vector3()) {
  const rad = windDirectionDeg * DEG_TO_RAD;
  // Subtle logarithmic atmospheric boundary layer gradient with altitude
  const altScale = 0.75 + 0.25 * Math.min(2.0, Math.log1p(Math.max(0, altitudeM) * 0.25) + 0.8);
  const speed = windSpeedMs * altScale;
  out.set(Math.sin(rad) * speed, 0, -Math.cos(rad) * speed);
  return out;
}

export class BallPhysicsEngine {
  constructor() {
    this.position = new THREE.Vector3(0, PHYSICS.TEE_HEIGHT, 0);
    this.velocity = new THREE.Vector3();
    this.spin = new THREE.Vector3();      // rad/s in world space (+X = backspin, -Y = slice right)
    this.initialSpin = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();

    this.windSpeedMs = 2.2;
    this.windDirectionDeg = 35;

    this.flightTime = 0;
    this.airborne = false;
    this.rolling = false;
    this.atRest = true;
    this.hasBounced = false;
    this.bounceCount = 0;

    this.carryDistanceM = 0;
    this.totalDistanceM = 0;
    this.apexHeightM = 0;
    this.offlineM = 0;
    this.launchSpeedMs = 0;
    this.launchAngleDeg = 0;
    this.initialBackspinRpm = 0;
    this.initialSidespinRpm = 0;
    this.landingSurface = 'fairway';
    this.firstLandingPos = new THREE.Vector3();
    this.predictedLandingPos = new THREE.Vector3(0, 0, -255);

    this.accumulator = 0;
    this.trajectoryPoints = [];

    // Reusable scratch vectors (zero per-step GC allocation)
    this._wind = new THREE.Vector3();
    this._vRel = new THREE.Vector3();
    this._omegaDir = new THREE.Vector3();
    this._magnus = new THREE.Vector3();
    this._acc = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._vTangential = new THREE.Vector3();
    this._rollAxis = new THREE.Vector3();
    this._dq = new THREE.Quaternion();

    // RK4 scratch buffers
    this._p1 = new THREE.Vector3();
    this._v1 = new THREE.Vector3();
    this._a1 = new THREE.Vector3();
    this._p2 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._a2 = new THREE.Vector3();
    this._p3 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._a3 = new THREE.Vector3();
    this._p4 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._a4 = new THREE.Vector3();
    this._spinTmp = new THREE.Vector3();
  }

  resetToTee() {
    const teeY = getTerrainHeight(0, 0);
    this.position.set(0, teeY + PHYSICS.TEE_HEIGHT, 0);
    this.velocity.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.initialSpin.set(0, 0, 0);
    this.orientation.identity();
    this.flightTime = 0;
    this.airborne = false;
    this.rolling = false;
    this.atRest = true;
    this.hasBounced = false;
    this.bounceCount = 0;
    this.carryDistanceM = 0;
    this.totalDistanceM = 0;
    this.apexHeightM = 0;
    this.offlineM = 0;
    this.landingSurface = 'tee';
    this.accumulator = 0;
    this.trajectoryPoints.length = 0;
  }

  setWind(speedMs, directionDeg) {
    this.windSpeedMs = speedMs;
    this.windDirectionDeg = directionDeg;
  }

  /**
   * Launches the ball from the tee with given parameters and pre-computes the
   * predicted landing corridor so Camera_Landing_Downrange can frame the landing smoothly.
   */
  launch(params) {
    this.resetToTee();
    const {
      clubSpeedMs = 50.0,
      launchElevationDeg = 11.5,
      launchAzimuthDeg = 0.0,
      backspinRpm = 2600,
      sidespinRpm = 0,
      smashModifier = 1.0,
    } = params;

    const vLaunch = computeLaunchSpeed(clubSpeedMs, smashModifier);
    const elev = launchElevationDeg * DEG_TO_RAD;
    const azim = launchAzimuthDeg * DEG_TO_RAD;

    const horiz = vLaunch * Math.cos(elev);
    this.velocity.set(
      horiz * Math.sin(azim),
      vLaunch * Math.sin(elev),
      -horiz * Math.cos(azim)
    );

    // Backspin vector oriented perpendicular to launch azimuth in horizontal plane
    // so backspin always generates upward lift and slight lateral tilt from azimuth
    const backspinRad = backspinRpm * RPM_TO_RADS;
    const sidespinRad = sidespinRpm * RPM_TO_RADS;
    this.initialSpin.set(
      Math.cos(azim) * backspinRad,
      -sidespinRad, // negative Y spin creates +X (right / fade) Magnus force for -Z velocity
      Math.sin(azim) * backspinRad
    );
    this.spin.copy(this.initialSpin);

    this.launchSpeedMs = vLaunch;
    this.launchAngleDeg = launchElevationDeg;
    this.initialBackspinRpm = backspinRpm;
    this.initialSidespinRpm = sidespinRpm;

    this.airborne = true;
    this.rolling = false;
    this.atRest = false;
    this.trajectoryPoints.push(this.position.clone());

    // Pre-simulate landing point using same RK4 model for predictive downrange camera placement
    this.predictedLandingPos.copy(this._predictFirstLanding());
  }

  /**
   * Evaluates total aerodynamic + gravitational acceleration at state (pos, vel, spin).
   * Implements F_g + F_d + F_m / m_ball from Section 6.
   */
  _evaluateAcceleration(pos, vel, spin, outAcc) {
    const terrainY = getTerrainHeight(pos.x, pos.z);
    const altitude = Math.max(0.05, pos.y - terrainY);
    getWindVector(this.windSpeedMs, this.windDirectionDeg, altitude, this._wind);

    // Relative velocity of ball through moving air mass
    this._vRel.subVectors(vel, this._wind);
    const speedRel = this._vRel.length();

    // Start with gravity (-g * Y)
    outAcc.set(0, -PHYSICS.GRAVITY, 0);

    if (speedRel > 1e-4) {
      const spinMag = spin.length();
      const spinRatio = (PHYSICS.BALL_RADIUS * spinMag) / speedRel;

      const cd = computeDragCoefficient(speedRel, spinRatio);
      const qArea = 0.5 * PHYSICS.AIR_DENSITY * PHYSICS.BALL_AREA;

      // Drag force: F_d = -0.5 * rho * A * C_d * ||v_rel|| * v_rel
      const dragFactor = -(qArea * cd * speedRel) / PHYSICS.BALL_MASS;
      outAcc.addScaledVector(this._vRel, dragFactor);

      // Magnus lift force: F_m = 0.5 * rho * A * C_L * ||v_rel|| * ((omega x v_rel) / ||omega||)
      if (spinMag > 1e-4) {
        const cl = computeLiftCoefficient(spinRatio);
        this._omegaDir.copy(spin).divideScalar(spinMag);
        this._magnus.crossVectors(this._omegaDir, this._vRel);
        const magnusFactor = (qArea * cl * speedRel) / PHYSICS.BALL_MASS;
        outAcc.addScaledVector(this._magnus, magnusFactor);
      }
    }
    return outAcc;
  }

  /**
   * Executes one exact 4th-order Runge-Kutta (RK4) integration step at fixed dt = 1/240 s.
   */
  _rk4AirborneStep(pos, vel, initSpin, t, dt) {
    const decay1 = Math.exp(-PHYSICS.SPIN_DECAY_BETA * t);
    const decayMid = Math.exp(-PHYSICS.SPIN_DECAY_BETA * (t + 0.5 * dt));
    const decay2 = Math.exp(-PHYSICS.SPIN_DECAY_BETA * (t + dt));

    // k1
    this._spinTmp.copy(initSpin).multiplyScalar(decay1);
    this._v1.copy(vel);
    this._evaluateAcceleration(pos, this._v1, this._spinTmp, this._a1);

    // k2
    this._p2.copy(pos).addScaledVector(this._v1, 0.5 * dt);
    this._v2.copy(vel).addScaledVector(this._a1, 0.5 * dt);
    this._spinTmp.copy(initSpin).multiplyScalar(decayMid);
    this._evaluateAcceleration(this._p2, this._v2, this._spinTmp, this._a2);

    // k3
    this._p3.copy(pos).addScaledVector(this._v2, 0.5 * dt);
    this._v3.copy(vel).addScaledVector(this._a2, 0.5 * dt);
    this._evaluateAcceleration(this._p3, this._v3, this._spinTmp, this._a3);

    // k4
    this._p4.copy(pos).addScaledVector(this._v3, dt);
    this._v4.copy(vel).addScaledVector(this._a3, dt);
    this._spinTmp.copy(initSpin).multiplyScalar(decay2);
    this._evaluateAcceleration(this._p4, this._v4, this._spinTmp, this._a4);

    // Combine weighted RK4 derivatives
    const dt6 = dt / 6;
    pos.x += dt6 * (this._v1.x + 2 * this._v2.x + 2 * this._v3.x + this._v4.x);
    pos.y += dt6 * (this._v1.y + 2 * this._v2.y + 2 * this._v3.y + this._v4.y);
    pos.z += dt6 * (this._v1.z + 2 * this._v2.z + 2 * this._v3.z + this._v4.z);

    vel.x += dt6 * (this._a1.x + 2 * this._a2.x + 2 * this._a3.x + this._a4.x);
    vel.y += dt6 * (this._a1.y + 2 * this._a2.y + 2 * this._a3.y + this._a4.y);
    vel.z += dt6 * (this._a1.z + 2 * this._a2.z + 2 * this._a3.z + this._a4.z);
  }

  _predictFirstLanding() {
    const p = this.position.clone();
    const v = this.velocity.clone();
    const s0 = this.initialSpin.clone();
    const dt = 1 / 120;
    let t = 0;
    for (let i = 0; i < 1600; i++) {
      this._rk4AirborneStep(p, v, s0, t, dt);
      t += dt;
      const groundY = getTerrainHeight(p.x, p.z) + PHYSICS.BALL_RADIUS;
      if (t > 0.15 && p.y <= groundY) {
        p.y = groundY;
        break;
      }
    }
    return p;
  }

  /**
   * Advances simulation by frame delta time using fixed 240Hz substeps.
   * Returns events generated during the frame (e.g., bounce impacts).
   */
  step(frameDt) {
    const events = {
      firstLanding: false,
      bounced: false,
      bounceSpeed: 0,
      bouncePos: null,
      bounceSurface: null,
      cameToRest: false,
    };

    if (this.atRest) return events;

    const clampedDt = Math.min(frameDt, 0.05);
    this.accumulator += clampedDt;
    const dt = PHYSICS.RK4_DT;

    while (this.accumulator >= dt && !this.atRest) {
      this.accumulator -= dt;
      this.flightTime += dt;

      if (this.airborne) {
        this._rk4AirborneStep(this.position, this.velocity, this.initialSpin, this.flightTime, dt);
        const decay = Math.exp(-PHYSICS.SPIN_DECAY_BETA * this.flightTime);
        this.spin.copy(this.initialSpin).multiplyScalar(decay);

        // Rotate visual ball mesh by physical angular velocity
        const spinMag = this.spin.length();
        if (spinMag > 1e-3) {
          this._omegaDir.copy(this.spin).divideScalar(spinMag);
          this._dq.setFromAxisAngle(this._omegaDir, spinMag * dt);
          this.orientation.premultiply(this._dq).normalize();
        }

        // Track apex height relative to tee elevation
        if (this.position.y > this.apexHeightM) {
          this.apexHeightM = this.position.y;
        }

        // Check turf contact
        const groundY = getTerrainHeight(this.position.x, this.position.z) + PHYSICS.BALL_RADIUS;
        if (this.position.y <= groundY && this.velocity.y < 0) {
          this.position.y = groundY;
          this._resolveTurfImpact(events);
        }
      } else if (this.rolling) {
        this._stepRolling(dt, events);
      }

      // Record trajectory point periodically for tracer visualization
      const last = this.trajectoryPoints[this.trajectoryPoints.length - 1];
      if (!last || last.distanceToSquared(this.position) > 0.36) {
        this.trajectoryPoints.push(this.position.clone());
      }
    }

    this.totalDistanceM = Math.hypot(this.position.x, this.position.z);
    this.offlineM = this.position.x;

    return events;
  }

  _resolveTurfImpact(events) {
    const surface = getSurfaceType(this.position.x, this.position.z);
    const props = getSurfacePhysicsProps(surface);
    getTerrainNormal(this.position.x, this.position.z, this._normal);

    const vn = this.velocity.dot(this._normal);
    const impactSpeed = Math.abs(vn);

    if (!this.hasBounced) {
      this.hasBounced = true;
      this.firstLandingPos.copy(this.position);
      this.carryDistanceM = Math.hypot(this.position.x, this.position.z);
      this.landingSurface = surface;
      events.firstLanding = true;
    }

    this.bounceCount++;
    events.bounced = true;
    events.bounceSpeed = impactSpeed;
    events.bouncePos = this.position.clone();
    events.bounceSurface = surface;

    // Separate normal and tangential components
    this._vTangential.copy(this.velocity).addScaledVector(this._normal, -vn);
    const vtSpeed = this._vTangential.length();

    // Post-collision normal velocity: v_n' = -e_turf * v_n
    const vnPost = -props.restitution * vn;

    // Tangential kinetic friction impulse: arrests slip & couples backspin check
    // F_f = -mu_k * N * v_t_hat plus turf compression bite on steep descent
    const normalImpulse = (1 + props.restitution) * impactSpeed;
    const frictionDeltaV = props.kineticFriction * normalImpulse;

    // Backspin checks forward momentum on initial steep landing
    const backspinCheck = Math.max(0, this.spin.x) * PHYSICS.BALL_RADIUS * 0.42;
    const newVtSpeed = Math.max(
      0,
      vtSpeed - frictionDeltaV * 0.92 - backspinCheck * (this.bounceCount === 1 ? 1.0 : 0.25)
    );

    if (vtSpeed > 1e-4) {
      this._vTangential.multiplyScalar(newVtSpeed / vtSpeed);
    }

    // Reconstruct velocity
    this.velocity.copy(this._vTangential).addScaledVector(this._normal, vnPost);

    // Damp spin sharply on turf contact & align toward forward rolling
    this.initialSpin.multiplyScalar(0.28);
    this.spin.copy(this.initialSpin);

    // Transition from bouncing to pure rolling once normal bounce velocity is low
    if (vnPost < 0.85 || surface === 'bunker') {
      this.airborne = false;
      this.rolling = true;
      // Project velocity onto tangent plane and account for turf landing compression
      const remVn = this.velocity.dot(this._normal);
      this.velocity.addScaledVector(this._normal, -remVn);
      this.velocity.multiplyScalar(surface === 'bunker' ? 0.28 : 0.78);
    }
  }

  _stepRolling(dt, events) {
    const surface = getSurfaceType(this.position.x, this.position.z);
    const props = getSurfacePhysicsProps(surface);
    this.landingSurface = surface;
    getTerrainNormal(this.position.x, this.position.z, this._normal);

    // Gravity component along terrain slope
    const slopeGravity = new THREE.Vector3(0, -PHYSICS.GRAVITY, 0);
    const gn = slopeGravity.dot(this._normal);
    slopeGravity.addScaledVector(this._normal, -gn);

    this.velocity.addScaledVector(slopeGravity, dt);

    // Project onto surface tangent plane
    const vn = this.velocity.dot(this._normal);
    this.velocity.addScaledVector(this._normal, -vn);

    // Rolling deceleration: a_roll = -mu_r * g (Section 6)
    const speed = this.velocity.length();
    const decel = props.rollingResist * PHYSICS.GRAVITY * dt;

    if (speed <= decel || speed < PHYSICS.STOP_VELOCITY_THRESHOLD) {
      // Stop threshold reached (||v|| < 0.05 m/s)
      this.velocity.set(0, 0, 0);
      this.spin.set(0, 0, 0);
      this.rolling = false;
      this.airborne = false;
      this.atRest = true;
      events.cameToRest = true;
      return;
    }

    this.velocity.multiplyScalar((speed - decel) / speed);

    // Integrate position and clamp to exact terrain surface
    this.position.addScaledVector(this.velocity, dt);
    this.position.y = getTerrainHeight(this.position.x, this.position.z) + PHYSICS.BALL_RADIUS;

    // Pure rolling angular rotation: omega = (n x v) / r
    this._rollAxis.crossVectors(this._normal, this.velocity);
    const rollMag = this._rollAxis.length();
    if (rollMag > 1e-4) {
      this._rollAxis.divideScalar(rollMag);
      const angle = (speed / PHYSICS.BALL_RADIUS) * dt;
      this._dq.setFromAxisAngle(this._rollAxis, angle);
      this.orientation.premultiply(this._dq).normalize();
    }
  }

  getAltitudeAboveTurf() {
    const groundY = getTerrainHeight(this.position.x, this.position.z) + PHYSICS.BALL_RADIUS;
    return Math.max(0, this.position.y - groundY);
  }
}

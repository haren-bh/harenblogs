/**
 * Zero-allocation 240 Hz Formula 1 Vehicle Dynamics Engine & Multi-Livery AI Rival Manager.
 *
 * Coordinate Convention (Section 1.2):
 *   World: Right-handed, meters, +Y up.
 *   heading = 0 faces -Z; +heading rotates counter-clockwise around +Y (Left).
 *   Forward unit vector = (-sin(heading), 0, -cos(heading))
 *   Right   unit vector = ( cos(heading), 0, -sin(heading))
 *   Left steering (+steer) => positive front knuckle angle +delta around +Y.
 *   Forward wheel rotation => positive wheelOmega (renderer applies rotation.x -= omega * dt).
 */

import {
  CAR_DIMS,
  PHYSICS_CFG,
  SURFACE_TYPES,
  TIRE_COMPOUNDS,
  TOTAL_LAPS,
} from './constants.js';

const DEG2RAD = Math.PI / 180;
const GRAVITY = 9.81;

// Authentic F1 crankshaft-to-layshaft primary reduction so all 8 spec gears span 0..355 km/h
const PRIMARY_REDUCTION = 1.54;
const WHEEL_INERTIA = 1.25; // kg*m^2 (18-inch rim + slick + halfshaft reflected inertia)
const MAX_BRAKE_TORQUE_TOTAL = 20800; // N*m total clamping capacity (~5.5-6.2 g peak at 300 km/h)
const MAX_ENGINE_TORQUE_NM = 680; // Peak V6 Turbo + MGU-K combined crankshaft torque
const STEER_LOW_RAD = 22.0 * DEG2RAD;
const STEER_HIGH_RAD = 3.5 * DEG2RAD;
const STEER_V_THRESH = 25.0;
const STEER_RATE_IN = 8.5;
const STEER_RATE_OUT = 14.0;
const DRS_FLAP_MAX_RAD = 28.0 * DEG2RAD;
const CAR_HALF_WIDTH_COLLISION = 1.02;

// Corner positions in local chassis space: (x = right, z = rear)
const WHEEL_POS_X = new Float64Array([
  -CAR_DIMS.FRONT_TRACK * 0.5,
  CAR_DIMS.FRONT_TRACK * 0.5,
  -CAR_DIMS.REAR_TRACK * 0.5,
  CAR_DIMS.REAR_TRACK * 0.5,
]);
const WHEEL_POS_Z = new Float64Array([
  CAR_DIMS.FRONT_AXLE_Z,
  CAR_DIMS.FRONT_AXLE_Z,
  CAR_DIMS.REAR_AXLE_Z,
  CAR_DIMS.REAR_AXLE_Z,
]);

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Pacejka Magic Formula scalar evaluation:
 *   F(x) = D * sin(C * atan(B*x - E*(B*x - atan(B*x))))
 */
function pacejka(x, B, C, D, E) {
  const bx = B * x;
  return D * Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

/**
 * Compute smooth thermal grip multiplier for a tire compound.
 */
function tireTempGripFactor(tempC, compound) {
  if (tempC < compound.optTempMin) {
    const t = clamp((tempC - 65) / (compound.optTempMin - 65), 0, 1);
    return 0.90 + 0.10 * t;
  }
  if (tempC > compound.optTempMax) {
    const o = clamp((tempC - compound.optTempMax) / (130 - compound.optTempMax), 0, 1);
    return 1.0 - 0.16 * o;
  }
  return 1.0;
}

export class F1VehiclePhysics {
  constructor(track, options = {}) {
    this.track = track || null;
    this.totalLaps = options.totalLaps || TOTAL_LAPS;
    this.compound = TIRE_COMPOUNDS[options.compound] || TIRE_COMPOUNDS.soft;

    // Driver assists & modes
    this.manualGearbox = Boolean(options.manualGearbox);
    this.freePracticeDRS = Boolean(options.freePracticeDRS);
    this.assists = {
      tractionControl: options.tractionControl !== false,
      abs: options.abs !== false,
      stabilityAssist: options.stabilityAssist !== false,
    };

    // Callbacks (optional, zero allocation)
    this.onLapComplete = options.onLapComplete || null;
    this.onRaceFinish = options.onRaceFinish || null;

    // Rigid body world pose & velocities
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.heading = 0; // 0 => facing -Z
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yawRate = 0;

    // Body-frame telemetry
    this.vLong = 0;
    this.vLat = 0; // +rightward
    this.speedMs = 0;
    this.speedKmh = 0;
    this.longG = 0;
    this.latG = 0;
    this.maxG = 0;
    this.topSpeedKmh = 0;

    // Low-pass filtered body accelerations for smooth load transfer & chassis attitude
    this._aLongFilt = 0;
    this._aRightFilt = 0;

    // Drive-by-wire control states
    this.throttle = 0;
    this.brake = 0;
    this._throttleHoldTime = 0;
    this._reverseHoldTime = 0;
    this.steerAngle = 0;
    this.steeringWheelAngle = 0;

    // Powertrain & 8-speed seamless gearbox
    this.gear = 1; // -1 = R, 0 = N, 1..8 = Forward gears
    this.gearLabel = '1';
    this.rpm = PHYSICS_CFG.IDLE_RPM;
    this.rpmNorm = 0;
    this._shiftCutTimer = 0;
    this._shiftCooldown = 0;
    this._downshiftBlipTimer = 0;
    this.isShifting = false;
    this.shiftEvent = 0; // +1 upshift, -1 downshift (consumed/reset each step)
    this.tcActive = false;
    this.absActive = false;

    // Aerodynamics & DRS
    this.drsOpen = false;
    this.drsForced = false;
    this.drsAvailable = false;
    this.drsFlapAngle = 0;
    this.drsZone = 0;
    this.downforceN = 0;
    this.frontDownforceN = 0;
    this.rearDownforceN = 0;
    this.dragN = 0;
    this.effectiveCl = PHYSICS_CFG.CL_BASE;
    this.effectiveCd = PHYSICS_CFG.CD_BASE;

    // Chassis suspension attitude & FX triggers
    this.pitchRad = 0;
    this.rollRad = 0;
    this.heaveM = 0;
    this.rideHeightM = 0.032;
    this.sparkIntensity = 0;
    this.barrierScrapeIntensity = 0;
    this.skidIntensity = 0;
    this.smokeIntensity = 0;

    // Preallocated 4-wheel typed arrays (0:FL, 1:FR, 2:RL, 3:RR)
    this.wheelOmega = new Float64Array(4);
    this.wheelAngle = new Float64Array(4);
    this.wheelFz = new Float64Array(4);
    this.wheelFx = new Float64Array(4);
    this.wheelFy = new Float64Array(4);
    this.wheelSlipRatio = new Float64Array(4);
    this.wheelSlipAngle = new Float64Array(4);
    this.wheelTemp = new Float64Array([76, 76, 76, 76]);
    this.wheelRoughness = new Float64Array([0.56, 0.56, 0.56, 0.56]);
    this.brakeTemp = new Float64Array([220, 220, 220, 220]);
    this.suspCompression = new Float64Array(4);
    this.suspOffset = new Float64Array(4);
    this.wheelGroundY = new Float64Array(4);
    this.wheelSurface = [
      SURFACE_TYPES.ASPHALT,
      SURFACE_TYPES.ASPHALT,
      SURFACE_TYPES.ASPHALT,
      SURFACE_TYPES.ASPHALT,
    ];

    // Thermal & surface aggregates
    this.avgTireTemp = 76;
    this.maxTireTemp = 76;
    this.maxBrakeTemp = 220;
    this.frontBrakeTemp = 220;
    this.rearBrakeTemp = 220;
    this.currentSurface = SURFACE_TYPES.ASPHALT;
    this.onKerb = false;
    this.onGrass = false;
    this.onGravel = false;

    // Track projection & timing state
    this._proj = track ? track.createSampleBuffer() : null;
    this._wheelProj = track ? track.createSampleBuffer() : null;
    this.trackS = 0;
    this.prevTrackS = 0;
    this.dLat = 0;
    this.sector = 1;
    this.lap = 1;
    this.completedLapCount = 0;
    this._hasStartedLap = false;
    this._maxSectorReached = 1;
    this.currentLapTime = 0;
    this.lastLapTime = 0;
    this.bestLapTime = Infinity;
    this.sectorTimes = [0, 0, 0];
    this.bestSectors = [Infinity, Infinity, Infinity];
    this.sectorStatus = ['none', 'none', 'none'];
    this._sectorStartTime = 0;
    this.completedLaps = [];
    this.totalRaceDistance = 0;
    this.raceFinished = false;
    this.isWrongWay = false;
    this._wrongWayTimer = 0;
    this.simTime = 0;

    // Preallocated telemetry snapshot object (zero runtime allocation)
    this._telemetry = {
      x: 0, y: 0, z: 0, heading: 0,
      speedMs: 0, speedKmh: 0, vLong: 0, vLat: 0, yawRate: 0,
      longG: 0, latG: 0, maxG: 0, topSpeedKmh: 0,
      throttle: 0, brake: 0, steerAngle: 0, steeringWheelAngle: 0,
      gear: 1, gearLabel: '1', rpm: 4000, rpmNorm: 0,
      drsOpen: false, drsAvailable: false, drsFlapAngle: 0, drsZone: 0,
      downforceN: 0, frontDownforceN: 0, rearDownforceN: 0, dragN: 0,
      effectiveCl: PHYSICS_CFG.CL_BASE, effectiveCd: PHYSICS_CFG.CD_BASE,
      pitchRad: 0, rollRad: 0, heaveM: 0, rideHeightM: 0.032,
      sparkIntensity: 0, barrierScrapeIntensity: 0, skidIntensity: 0, smokeIntensity: 0,
      avgTireTemp: 76, maxTireTemp: 76, maxBrakeTemp: 220, frontBrakeTemp: 220, rearBrakeTemp: 220,
      compound: this.compound, surface: this.currentSurface,
      onKerb: false, onGrass: false, onGravel: false,
      tcActive: false, absActive: false,
      trackS: 0, dLat: 0, sector: 1, lap: 1, totalLaps: this.totalLaps,
      currentLapTime: 0, lastLapTime: 0, bestLapTime: Infinity,
      sectorTimes: this.sectorTimes, bestSectors: this.bestSectors, sectorStatus: this.sectorStatus,
      totalRaceDistance: 0, raceFinished: false, isWrongWay: false,
      wheelOmega: this.wheelOmega, wheelAngle: this.wheelAngle,
      wheelFz: this.wheelFz, wheelFx: this.wheelFx, wheelFy: this.wheelFy,
      wheelSlipRatio: this.wheelSlipRatio, wheelSlipAngle: this.wheelSlipAngle,
      wheelTemp: this.wheelTemp, wheelRoughness: this.wheelRoughness,
      brakeTemp: this.brakeTemp, suspOffset: this.suspOffset,
    };

    // Initialize static wheel loads cleanly
    const fzF = 0.5 * PHYSICS_CFG.MASS * GRAVITY * PHYSICS_CFG.FRONT_WEIGHT_RATIO;
    const fzR = 0.5 * PHYSICS_CFG.MASS * GRAVITY * PHYSICS_CFG.REAR_WEIGHT_RATIO;
    this.wheelFz[0] = fzF;
    this.wheelFz[1] = fzF;
    this.wheelFz[2] = fzR;
    this.wheelFz[3] = fzR;

    if (this.track) {
      this.resetToGrid(-24, 2.2);
    }
  }

  setCompound(compoundId) {
    if (TIRE_COMPOUNDS[compoundId]) {
      this.compound = TIRE_COMPOUNDS[compoundId];
    }
  }

  /**
   * Place the car at a specific spline station `s` (may be negative, e.g. -24 m behind S/F)
   * and lateral offset `dLat` (+right, -left) with zero velocity and clean race timers.
   */
  resetToGrid(sOffset = -24, dLat = 2.2) {
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.vLong = 0;
    this.vLat = 0;
    this.speedMs = 0;
    this.speedKmh = 0;
    this.longG = 0;
    this.latG = 0;
    this.maxG = 0;
    this.topSpeedKmh = 0;
    this._aLongFilt = 0;
    this._aRightFilt = 0;

    this.throttle = 0;
    this.brake = 0;
    this._throttleHoldTime = 0;
    this._reverseHoldTime = 0;
    this.steerAngle = 0;
    this.steeringWheelAngle = 0;

    this.gear = 1;
    this.gearLabel = '1';
    this.rpm = PHYSICS_CFG.IDLE_RPM;
    this.rpmNorm = 0;
    this._shiftCutTimer = 0;
    this._shiftCooldown = 0;
    this._downshiftBlipTimer = 0;
    this.isShifting = false;
    this.shiftEvent = 0;
    this.tcActive = false;
    this.absActive = false;

    this.drsOpen = false;
    this.drsForced = false;
    this.drsFlapAngle = 0;
    this.downforceN = 0;
    this.frontDownforceN = 0;
    this.rearDownforceN = 0;
    this.dragN = 0;

    this.pitchRad = 0;
    this.rollRad = 0;
    this.heaveM = 0;
    this.rideHeightM = 0.032;
    this.sparkIntensity = 0;
    this.barrierScrapeIntensity = 0;
    this.skidIntensity = 0;
    this.smokeIntensity = 0;

    for (let i = 0; i < 4; i++) {
      this.wheelOmega[i] = 0;
      this.wheelAngle[i] = 0;
      this.wheelFx[i] = 0;
      this.wheelFy[i] = 0;
      this.wheelSlipRatio[i] = 0;
      this.wheelSlipAngle[i] = 0;
      this.wheelTemp[i] = 76;
      this.wheelRoughness[i] = 0.56;
      this.brakeTemp[i] = 220;
      this.suspCompression[i] = 0;
      this.suspOffset[i] = 0;
    }
    this.avgTireTemp = 76;
    this.maxTireTemp = 76;
    this.maxBrakeTemp = 220;
    this.frontBrakeTemp = 220;
    this.rearBrakeTemp = 220;

    const fzF = 0.5 * PHYSICS_CFG.MASS * GRAVITY * PHYSICS_CFG.FRONT_WEIGHT_RATIO;
    const fzR = 0.5 * PHYSICS_CFG.MASS * GRAVITY * PHYSICS_CFG.REAR_WEIGHT_RATIO;
    this.wheelFz[0] = fzF;
    this.wheelFz[1] = fzF;
    this.wheelFz[2] = fzR;
    this.wheelFz[3] = fzR;

    this.lap = 1;
    this.completedLapCount = 0;
    this.sector = 1;
    this._maxSectorReached = 1;
    this.currentLapTime = 0;
    this.lastLapTime = 0;
    this.bestLapTime = Infinity;
    this.sectorTimes[0] = 0;
    this.sectorTimes[1] = 0;
    this.sectorTimes[2] = 0;
    this.bestSectors[0] = Infinity;
    this.bestSectors[1] = Infinity;
    this.bestSectors[2] = Infinity;
    this.sectorStatus[0] = 'none';
    this.sectorStatus[1] = 'none';
    this.sectorStatus[2] = 'none';
    this._sectorStartTime = 0;
    this.completedLaps.length = 0;
    this.raceFinished = false;
    this.isWrongWay = false;
    this._wrongWayTimer = 0;
    this.simTime = 0;

    if (this.track) {
      const sWrap = this.track.wrapS(sOffset);
      this.track.sampleAtS(sWrap, this._proj);
      this.x = this._proj.x + this._proj.rx * dLat;
      this.z = this._proj.z + this._proj.rz * dLat;
      this.y = this.track.getSurfaceElevation(sWrap, dLat, this._proj);
      // heading = 0 faces -Z => (-sin(h), -cos(h)) = (tx, tz) => h = atan2(-tx, -tz)
      this.heading = Math.atan2(-this._proj.tx, -this._proj.tz);
      this.trackS = sWrap;
      this.prevTrackS = sWrap;
      this.dLat = dLat;
      this.drsZone = this._proj.drsZone;
      this.drsAvailable = this.freePracticeDRS || this.drsZone !== 0;
      this.currentSurface = this.track.classifySurface(sWrap, dLat, this._proj);
      this._hasStartedLap = sOffset >= 0;
      this.totalRaceDistance = sOffset;
    } else {
      this.x = dLat;
      this.y = 0;
      this.z = -sOffset;
      this.heading = 0;
      this.trackS = Math.max(0, sOffset);
      this.prevTrackS = this.trackS;
      this.dLat = dLat;
      this._hasStartedLap = true;
      this.totalRaceDistance = sOffset;
    }
  }

  /**
   * Recover car cleanly onto the nearest circuit spline centerline aligned with tangent at 0 km/h.
   */
  resetToTrack() {
    if (!this.track) {
      this.vx = 0;
      this.vz = 0;
      this.yawRate = 0;
      this.wheelOmega.fill(0);
      return;
    }
    this.track.projectPoint(this.x, this.z, this.trackS, this._proj);
    const s = this._proj.s;
    this.x = this._proj.x;
    this.z = this._proj.z;
    this.y = this._proj.y;
    this.heading = Math.atan2(-this._proj.tx, -this._proj.tz);
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.vLong = 0;
    this.vLat = 0;
    this.speedMs = 0;
    this.speedKmh = 0;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this._throttleHoldTime = 0;
    this.drsOpen = false;
    this.drsForced = false;
    this.gear = 1;
    this.gearLabel = '1';
    this.rpm = PHYSICS_CFG.IDLE_RPM;
    this.wheelOmega.fill(0);
    this.dLat = 0;
    this.trackS = s;
    this.prevTrackS = s;
    this.isWrongWay = false;
    this._wrongWayTimer = 0;
    this.barrierScrapeIntensity = 0;
  }

  /**
   * Rev engine cleanly on grid during LIGHTS_COUNTDOWN without moving the vehicle.
   */
  stepGridIdle(throttleInput = 0, dt = PHYSICS_CFG.DT) {
    const targetRpm = PHYSICS_CFG.IDLE_RPM + clamp(throttleInput, 0, 1) * 7600;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 10);
    this.rpmNorm = clamp((this.rpm - PHYSICS_CFG.IDLE_RPM) / (PHYSICS_CFG.MAX_RPM - PHYSICS_CFG.IDLE_RPM), 0, 1);
    this.throttle = clamp(throttleInput, 0, 1);
    this.drsFlapAngle += ((this.drsOpen ? DRS_FLAP_MAX_RAD : 0) - this.drsFlapAngle) * Math.min(1, dt * 14);
  }

  toggleDRS(forceAllow = false) {
    if (this.drsOpen) {
      this.drsOpen = false;
      this.drsForced = false;
      return false;
    }
    return this.setDRS(true, forceAllow);
  }

  setDRS(open, forceAllow = false) {
    if (!open) {
      this.drsOpen = false;
      this.drsForced = false;
      return false;
    }
    const allowed = forceAllow || this.freePracticeDRS || this.drsZone !== 0;
    if (allowed && this.brake <= 0.05 && Math.abs(this.latG) <= 2.2) {
      this.drsOpen = true;
      this.drsForced = Boolean(forceAllow);
      return true;
    }
    return false;
  }

  shiftUp() {
    if (this.gear < 8 && this._shiftCooldown <= 0) {
      this.gear = this.gear === -1 ? 0 : (this.gear === 0 ? 1 : this.gear + 1);
      this._triggerShift(1);
    }
  }

  shiftDown() {
    if (this.gear > -1 && this._shiftCooldown <= 0) {
      if (this.gear === 1 && this.vLong > 2.0) return; // protect gearbox from money shift into reverse
      this.gear = this.gear === 1 ? (this.vLong < 0.5 ? -1 : 1) : this.gear - 1;
      this._triggerShift(-1);
    }
  }

  _triggerShift(dir) {
    this._shiftCutTimer = dir > 0 ? PHYSICS_CFG.SHIFT_CUT_S : PHYSICS_CFG.SHIFT_CUT_S * 0.75;
    this._shiftCooldown = 0.14;
    if (dir < 0) this._downshiftBlipTimer = 0.06;
    this.shiftEvent = dir;
    this.gearLabel = this.gear === -1 ? 'R' : (this.gear === 0 ? 'N' : String(this.gear));
  }

  /**
   * Evaluate 1.6L V6 Turbo + 120 kW MGU-K hybrid engine power (Watts) at current RPM & speed.
   * Implements authentic 2026 FIA MGU-K high-speed deployment taper above 320 km/h.
   */
  _evaluateEnginePowerW(rpm, speedMs) {
    let fCurve;
    if (rpm < 10500) {
      const u = clamp((rpm - PHYSICS_CFG.IDLE_RPM) / (10500 - PHYSICS_CFG.IDLE_RPM), 0, 1);
      fCurve = 0.36 + 0.64 * Math.pow(u, 0.72);
    } else if (rpm <= 12100) {
      fCurve = 1.0;
    } else {
      const o = clamp((rpm - 12100) / (PHYSICS_CFG.MAX_RPM - 12100), 0, 1);
      fCurve = 1.0 - 0.14 * o * o;
    }

    // Soft rev limiter above 13,250 RPM
    if (rpm > 13250) {
      const lim = clamp((PHYSICS_CFG.MAX_RPM - rpm) / 250, 0, 1);
      fCurve *= lim;
    }

    const iceW = 625000 * fCurve;
    // 2026 FIA MGU-K 120 kW electric deployment tapers smoothly above 320 km/h (88.89 m/s)
    let mgukFactor = 1.0;
    if (speedMs > 88.89) {
      const uDerate = clamp((speedMs - 88.89) / (98.61 - 88.89), 0, 1);
      mgukFactor = 1.0 - 0.84 * uDerate;
    }
    const mgukW = 120000 * mgukFactor * Math.min(1.0, fCurve + 0.18);
    return (iceW + mgukW) * PHYSICS_CFG.DRIVETRAIN_EFF;
  }

  /**
   * Advance vehicle dynamics by one deterministic 240 Hz step (dt = 1/240 s).
   * Strictly zero heap allocations.
   */
  step(input, dt = PHYSICS_CFG.DT) {
    this.simTime += dt;
    this.shiftEvent = 0;

    const rawThrottle = input ? clamp(input.throttle || 0, 0, 1) : 0;
    const rawBrake = input ? clamp(input.brake || 0, 0, 1) : 0;
    const rawSteer = input ? clamp(input.steer || 0, -1, 1) : 0;
    const directPedals = Boolean(input && input.directPedals);

    // 1. Heading basis vectors (-Z forward at heading = 0, +X right)
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const fwdX = -sinH;
    const fwdZ = -cosH;
    const rightX = cosH;
    const rightZ = -sinH;

    // Project world velocity into chassis frame
    let vLong = this.vx * fwdX + this.vz * fwdZ;
    let vLat = this.vx * rightX + this.vz * rightZ; // +right
    const speedMs = Math.hypot(this.vx, this.vz);
    this.vLong = vLong;
    this.vLat = vLat;
    this.speedMs = speedMs;
    this.speedKmh = speedMs * 3.6;
    if (this.speedKmh > this.topSpeedKmh) this.topSpeedKmh = this.speedKmh;

    // 2. Speed-sensitive steering with asymmetric slew filter (Section 3.2)
    const absV = Math.abs(vLong);
    const lowRatio = STEER_V_THRESH / (STEER_V_THRESH + absV);
    const maxSteer = STEER_LOW_RAD * lowRatio + STEER_HIGH_RAD * (1 - lowRatio);
    const targetSteer = rawSteer * maxSteer;
    const slewRate = Math.abs(targetSteer) > Math.abs(this.steerAngle) ? STEER_RATE_IN : STEER_RATE_OUT;
    this.steerAngle += slewRate * (targetSteer - this.steerAngle) * dt;
    this.steeringWheelAngle = this.steerAngle * 6.5;

    // 3. Drive-by-wire throttle spool (t^1.8 over 0.35 s), linear brake (0.12 s), & auto-reverse
    let driveCommand = 0;
    let brakeCommand = 0;

    if (this.gear === -1) {
      // Currently in Reverse
      if (rawThrottle > 0.05) {
        this.gear = 1;
        this.gearLabel = '1';
        this._reverseHoldTime = 0;
        this._throttleHoldTime = dt;
        driveCommand = directPedals ? rawThrottle : rawThrottle * Math.pow(this._throttleHoldTime / 0.35, 1.8);
        brakeCommand = 0;
      } else if (rawBrake > 0.05) {
        // S / ArrowDown propels in Reverse (capped cleanly at 25 km/h = 6.944 m/s)
        this._throttleHoldTime = Math.min(0.35, this._throttleHoldTime + dt);
        driveCommand = directPedals ? rawBrake : rawBrake * Math.pow(this._throttleHoldTime / 0.35, 1.8);
        brakeCommand = 0;
      } else {
        this._throttleHoldTime = 0;
        driveCommand = 0;
        brakeCommand = 0.15;
      }
    } else {
      // Forward / Neutral gear
      if (rawThrottle > 0.01) {
        this._reverseHoldTime = 0;
        if (this.gear === 0) {
          this.gear = 1;
          this.gearLabel = '1';
        }
        if (directPedals) {
          driveCommand = rawThrottle;
        } else {
          this._throttleHoldTime = Math.min(0.35, this._throttleHoldTime + dt);
          driveCommand = rawThrottle * Math.pow(this._throttleHoldTime / 0.35, 1.8);
        }
      } else {
        this._throttleHoldTime = 0;
        driveCommand = Math.max(0, this.throttle - dt * 28);
      }

      if (rawBrake > 0.01) {
        if (!this.manualGearbox && vLong < 0.5 && rawThrottle <= 0.05) {
          this._reverseHoldTime += dt;
          if (vLong <= 0.25 && this._reverseHoldTime >= 0.12) {
            this.gear = -1;
            this.gearLabel = 'R';
            this._throttleHoldTime = 0;
            brakeCommand = 0;
          } else {
            brakeCommand = directPedals ? rawBrake : Math.min(rawBrake, this.brake + dt / 0.12);
          }
        } else {
          this._reverseHoldTime = 0;
          brakeCommand = directPedals ? rawBrake : Math.min(rawBrake, this.brake + dt / 0.12);
        }
      } else {
        this._reverseHoldTime = 0;
        brakeCommand = Math.max(0, this.brake - dt * 24);
      }
    }

    this.throttle = driveCommand;
    this.brake = brakeCommand;

    // 4. Standstill static hold guard (Section 4.4)
    // Guarantees zero drift, zero jitter, and zero NaN when stationary with no drive input.
    if (speedMs < 1.0 && Math.abs(this.yawRate) < 0.08 && driveCommand < 0.01 && (brakeCommand > 0.01 || speedMs < 0.18)) {
      const holdDecay = Math.exp(-22 * dt);
      this.vx *= holdDecay;
      this.vz *= holdDecay;
      this.yawRate *= holdDecay;
      if (speedMs < 0.04) {
        this.vx = 0;
        this.vz = 0;
        this.yawRate = 0;
      }
      for (let i = 0; i < 4; i++) {
        this.wheelOmega[i] *= holdDecay;
        if (Math.abs(this.wheelOmega[i]) < 0.05) this.wheelOmega[i] = 0;
        this.wheelFx[i] = 0;
        this.wheelFy[i] = 0;
        this.wheelSlipRatio[i] = 0;
        this.wheelSlipAngle[i] = 0;
      }
      this._aLongFilt *= Math.exp(-12 * dt);
      this._aRightFilt *= Math.exp(-12 * dt);
      this.longG = this._aLongFilt / GRAVITY;
      this.latG = -this._aRightFilt / GRAVITY;
      this.vLong = this.vx * fwdX + this.vz * fwdZ;
      this.vLat = this.vx * rightX + this.vz * rightZ;
      this.speedMs = Math.hypot(this.vx, this.vz);
      this.speedKmh = this.speedMs * 3.6;
      this.rpm += (PHYSICS_CFG.IDLE_RPM - this.rpm) * Math.min(1, dt * 10);
      this.rpmNorm = clamp((this.rpm - PHYSICS_CFG.IDLE_RPM) / (PHYSICS_CFG.MAX_RPM - PHYSICS_CFG.IDLE_RPM), 0, 1);
      this.downforceN = 0;
      this.frontDownforceN = 0;
      this.rearDownforceN = 0;
      this.dragN = 0;
      this.effectiveCl = PHYSICS_CFG.CL_BASE;
      this.effectiveCd = PHYSICS_CFG.CD_BASE;
      this.pitchRad *= Math.exp(-10 * dt);
      this.rollRad *= Math.exp(-10 * dt);
      this.heaveM *= Math.exp(-10 * dt);
      this.rideHeightM = 0.032;
      this.sparkIntensity = 0;
      this.barrierScrapeIntensity = 0;
      this.skidIntensity = 0;
      this.smokeIntensity = 0;
      this.tcActive = false;
      this.absActive = false;
      this.drsFlapAngle += ((this.drsOpen ? DRS_FLAP_MAX_RAD : 0) - this.drsFlapAngle) * Math.min(1, dt * 14);
      this._updateThermalsOnly(dt, 0);
      this._updateTrackAndTiming(dt, fwdX, fwdZ);
      return;
    }

    // 5. Aerodynamics & DRS (Section 4.3)
    // Auto-close DRS on braking, high lateral G (> 2.2g), or exiting DRS zone
    if (this.drsOpen) {
      const outsideZone = this.track && !this.freePracticeDRS && !this.drsForced && this.drsZone === 0;
      if (brakeCommand > 0.05 || Math.abs(this.latG) > 2.2 || outsideZone) {
        this.drsOpen = false;
        this.drsForced = false;
      }
    }
    this.drsFlapAngle += ((this.drsOpen ? DRS_FLAP_MAX_RAD : 0) - this.drsFlapAngle) * Math.min(1, dt * 16);

    const kAero = 0.5 * PHYSICS_CFG.RHO * PHYSICS_CFG.FRONTAL_AREA;
    const clFront = PHYSICS_CFG.CL_BASE * PHYSICS_CFG.AERO_FRONT_RATIO;
    const clRearBase = PHYSICS_CFG.CL_BASE * PHYSICS_CFG.AERO_REAR_RATIO;
    const clRear = this.drsOpen ? clRearBase * (1 - PHYSICS_CFG.DRS_REAR_CL_REDUCTION) : clRearBase;
    const clEff = clFront + clRear;
    const cdEff = this.drsOpen ? PHYSICS_CFG.CD_BASE * (1 - PHYSICS_CFG.DRS_CD_REDUCTION) : PHYSICS_CFG.CD_BASE;

    const vAero2 = vLong > 0 ? vLong * vLong : 0;
    const frontDownN = kAero * clFront * vAero2;
    const rearDownN = kAero * clRear * vAero2;
    const totalDownN = frontDownN + rearDownN;
    const dragN = kAero * cdEff * speedMs * speedMs;

    this.effectiveCl = clEff;
    this.effectiveCd = cdEff;
    this.frontDownforceN = frontDownN;
    this.rearDownforceN = rearDownN;
    this.downforceN = totalDownN;
    this.dragN = dragN;

    // 6. 4-Wheel Dynamic Load Transfer & ARBs (Section 4.5)
    const weightN = PHYSICS_CFG.MASS * GRAVITY;
    const fzFrontStatic = weightN * PHYSICS_CFG.FRONT_WEIGHT_RATIO;
    const fzRearStatic = weightN * PHYSICS_CFG.REAR_WEIGHT_RATIO;
    const dFzLong = (PHYSICS_CFG.MASS * this._aLongFilt * CAR_DIMS.COG_HEIGHT) / CAR_DIMS.WHEELBASE;

    const fzFrontAxle = Math.max(400, fzFrontStatic + frontDownN - dFzLong);
    const fzRearAxle = Math.max(400, fzRearStatic + rearDownN + dFzLong);

    // ARB roll stiffness distribution (front stiffer than rear)
    const arbSum = PHYSICS_CFG.ARB_FRONT + PHYSICS_CFG.ARB_REAR;
    const frontRollShare = 0.50 * (PHYSICS_CFG.ARB_FRONT / arbSum) + 0.50 * PHYSICS_CFG.FRONT_WEIGHT_RATIO;
    const rearRollShare = 1.0 - frontRollShare;

    // Turning left => aRightFilt < 0 => positive dFzLat shifts load onto RIGHT wheels (FR, RR)
    const dFzLatFront = -(PHYSICS_CFG.MASS * this._aRightFilt * CAR_DIMS.COG_HEIGHT / CAR_DIMS.FRONT_TRACK) * frontRollShare;
    const dFzLatRear = -(PHYSICS_CFG.MASS * this._aRightFilt * CAR_DIMS.COG_HEIGHT / CAR_DIMS.REAR_TRACK) * rearRollShare;

    this.wheelFz[0] = Math.max(200, 0.5 * fzFrontAxle - dFzLatFront); // FL
    this.wheelFz[1] = Math.max(200, 0.5 * fzFrontAxle + dFzLatFront); // FR
    this.wheelFz[2] = Math.max(200, 0.5 * fzRearAxle - dFzLatRear);   // RL
    this.wheelFz[3] = Math.max(200, 0.5 * fzRearAxle + dFzLatRear);   // RR

    // 7. Powertrain, Automatic/Manual Shifting & Drive Torque (Section 4.2)
    if (this._shiftCutTimer > 0) this._shiftCutTimer = Math.max(0, this._shiftCutTimer - dt);
    if (this._shiftCooldown > 0) this._shiftCooldown = Math.max(0, this._shiftCooldown - dt);
    if (this._downshiftBlipTimer > 0) this._downshiftBlipTimer = Math.max(0, this._downshiftBlipTimer - dt);
    this.isShifting = this._shiftCutTimer > 0;

    const gearRatio = PHYSICS_CFG.GEAR_RATIOS[this.gear + 1];
    const totalRatio = Math.abs(gearRatio) * PHYSICS_CFG.FINAL_DRIVE * PRIMARY_REDUCTION;
    const rearAvgOmega = 0.5 * (this.wheelOmega[2] + this.wheelOmega[3]);

    // Couple engine RPM to driven rear wheels with realistic launch clutch slip below 80 km/h
    const wheelLinkedRpm = Math.abs(rearAvgOmega) * totalRatio * (60 / (2 * Math.PI));
    const launchSlipRpm = PHYSICS_CFG.IDLE_RPM + driveCommand * 5600 * clamp(1 - absV / 22, 0, 1);
    const targetRpm = this.gear === 0
      ? PHYSICS_CFG.IDLE_RPM + driveCommand * 8500
      : Math.max(wheelLinkedRpm, this._downshiftBlipTimer > 0 ? wheelLinkedRpm + 900 : launchSlipRpm);

    const rpmLerp = Math.min(1, dt * 26);
    this.rpm += (clamp(targetRpm, PHYSICS_CFG.IDLE_RPM, PHYSICS_CFG.MAX_RPM) - this.rpm) * rpmLerp;
    this.rpmNorm = clamp((this.rpm - PHYSICS_CFG.IDLE_RPM) / (PHYSICS_CFG.MAX_RPM - PHYSICS_CFG.IDLE_RPM), 0, 1);

    // Automatic seamless shifting (G1..G8)
    if (!this.manualGearbox && this.gear >= 1 && this._shiftCooldown <= 0) {
      const wheelSpeedRpm = (Math.max(0, vLong) / CAR_DIMS.TIRE_RADIUS) * totalRatio * (60 / (2 * Math.PI));
      if (this.gear < 8 && wheelSpeedRpm >= PHYSICS_CFG.UPSHIFT_RPM && driveCommand > 0.25) {
        this.gear++;
        this._triggerShift(1);
      } else if (this.gear > 1 && wheelSpeedRpm <= PHYSICS_CFG.DOWNSHIFT_RPM) {
        // Ensure downshifting won't immediately over-rev the lower gear
        const lowerRatio = PHYSICS_CFG.GEAR_RATIOS[this.gear] * PHYSICS_CFG.FINAL_DRIVE * PRIMARY_REDUCTION;
        const nextRpm = (Math.max(0, vLong) / CAR_DIMS.TIRE_RADIUS) * lowerRatio * (60 / (2 * Math.PI));
        if (nextRpm < PHYSICS_CFG.UPSHIFT_RPM - 500) {
          this.gear--;
          this._triggerShift(-1);
        }
      }
    }

    const activeRatio = PHYSICS_CFG.GEAR_RATIOS[this.gear + 1];
    const effTotalRatio = Math.abs(activeRatio) * PHYSICS_CFG.FINAL_DRIVE * PRIMARY_REDUCTION;

    // Compute rear wheel drive torque (split 50/50 across RL & RR via limited-slip diff)
    let rearDriveTorquePerWheel = 0;
    this.tcActive = false;

    if (!this.isShifting && this.gear !== 0 && driveCommand > 0.005) {
      const powerWheelW = this._evaluateEnginePowerW(this.rpm, speedMs);
      const omegaEngine = Math.max(this.rpm * (2 * Math.PI / 60), 400);
      const engTorque = Math.min(MAX_ENGINE_TORQUE_NM, powerWheelW / (omegaEngine * PHYSICS_CFG.DRIVETRAIN_EFF));
      let totalWheelTorque = engTorque * PHYSICS_CFG.DRIVETRAIN_EFF * effTotalRatio * driveCommand;

      // Progressive F1 1st-gear launch torque map for authentic 2.4-2.8 s 0-100 km/h starts
      if (this.gear === 1 && absV < 28.0) {
        const launchTorqueCap = (3550 + 48 * absV) * driveCommand;
        if (totalWheelTorque > launchTorqueCap) totalWheelTorque = launchTorqueCap;
      }

      if (this.gear === -1) {
        // Reverse speed cap at 25 km/h (6.944 m/s)
        const revSpeed = Math.max(0, -vLong);
        const revLim = clamp((6.944 - revSpeed) / 1.2, 0, 1);
        rearDriveTorquePerWheel = -0.35 * totalWheelTorque * 0.5 * revLim;
      } else {
        // Traction control in Gears 1-3 (monitors rear slip ratio kappa > 0.14)
        if (this.assists.tractionControl && this.gear <= 3) {
          const maxRearSlip = Math.max(this.wheelSlipRatio[2], this.wheelSlipRatio[3]);
          if (maxRearSlip > 0.11) {
            const tcCut = clamp((maxRearSlip - 0.11) / 0.08, 0, 0.72);
            totalWheelTorque *= (1 - tcCut);
            this.tcActive = maxRearSlip > 0.135;
          }
        }
        rearDriveTorquePerWheel = totalWheelTorque * 0.5;
      }
    } else if (this.gear >= 1 && driveCommand <= 0.01 && vLong > 2.0) {
      // Subtle V6 + MGU-K regeneration engine braking on lift-off
      rearDriveTorquePerWheel = -95.0 * (effTotalRatio / 10.0);
    }

    // Dynamic brake bias: 56.5% front / 43.5% rear shifting slightly forward under heavy pitch
    const dynFrontBias = clamp(0.565 + Math.max(0, -this.longG) * 0.008, 0.565, 0.61);
    const dynRearBias = 1.0 - dynFrontBias;
    const totalBrakeTorque = brakeCommand * MAX_BRAKE_TORQUE_TOTAL;
    const frontBrakePerWheel = 0.5 * totalBrakeTorque * dynFrontBias;
    const rearBrakePerWheel = 0.5 * totalBrakeTorque * dynRearBias;

    // 8. Per-Wheel Surface Query, Implicit Wheel Spin & Pacejka Magic Formula (Section 4.4)
    let sumFxChassis = 0; // +forward along chassis fwd
    let sumFyChassis = 0; // +rightward along chassis right
    let sumYawTorque = 0; // +CCW (Left) around +Y
    let sumRollDrag = 0;
    let maxSkid = 0;
    let maxSmoke = 0;
    let anyKerb = false;
    let anyGrass = false;
    let anyGravel = false;
    this.absActive = false;

    const rEff = CAR_DIMS.TIRE_RADIUS;
    const vEps = PHYSICS_CFG.V_EPS;
    const cosSteer = Math.cos(this.steerAngle);
    const sinSteer = Math.sin(this.steerAngle);

    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      const px = WHEEL_POS_X[i];
      const pz = WHEEL_POS_Z[i];

      // Surface lookup per wheel
      let surf = SURFACE_TYPES.ASPHALT;
      let groundY = 0;
      if (this.track) {
        const wx = this.x + rightX * px - fwdX * pz;
        const wz = this.z + rightZ * px - fwdZ * pz;
        this.track.projectPoint(wx, wz, this.trackS, this._wheelProj);
        surf = this._wheelProj.surface;
        groundY = this.track.getSurfaceElevation(this._wheelProj.s, this._wheelProj.dLat, this._wheelProj);
      }
      this.wheelSurface[i] = surf;
      this.wheelGroundY[i] = groundY;
      if (surf === SURFACE_TYPES.KERB) anyKerb = true;
      else if (surf === SURFACE_TYPES.GRASS) anyGrass = true;
      else if (surf === SURFACE_TYPES.GRAVEL) anyGravel = true;

      // Wheel contact patch velocity in chassis frame:
      // v_wheel = v_cg + omega_yaw x r_wheel
      // For omega = (0, r, 0) and r_wheel = (px right, 0, pz rear):
      //   v_right_w = vLat + r * pz   (front pz < 0 => +r moves front left!)
      //   v_long_w  = vLong + r * px  (right px > 0 => +r moves right faster forward!)
      const vLongC = vLong + this.yawRate * px;
      const vRightC = vLat + this.yawRate * pz;

      // Rotate into wheel frame (front wheels steered by +steerAngle toward Left = -right)
      const cD = isFront ? cosSteer : 1.0;
      const sD = isFront ? sinSteer : 0.0;
      // wheelFwd = cD*fwd - sD*right; wheelRight = sD*fwd + cD*right
      const vWheelLong = vLongC * cD - vRightC * sD;
      const vWheelRight = vLongC * sD + vRightC * cD;

      const fz = this.wheelFz[i];
      const tempFactor = tireTempGripFactor(this.wheelTemp[i], this.compound);
      // Tire vertical load sensitivity (nominal 1.00 at static load, slight falloff at extreme aero loads)
      const loadSens = clamp(1.00 - 0.04 * Math.max(0, (fz - 2500) / 10000), 0.92, 1.00);
      const muX = this.compound.muX * surf.grip * tempFactor * loadSens;
      const muY = this.compound.muY * surf.grip * tempFactor * loadSens;

      const Dx = muX * fz;
      const Dy = muY * fz;
      const Cx = 1.55;
      const Ex = -0.20;
      const Bx = 12.2;
      const Cy = 1.30;
      const Ey = -0.22;
      const By = 12.4 * clamp(1.0 - 0.06 * (fz / 10000), 0.85, 1.05);

      const vDen = Math.max(Math.abs(vWheelLong), vEps);

      // Brake torque with optional ABS modulation
      let tBrake = isFront ? frontBrakePerWheel : rearBrakePerWheel;
      const prevKappa = this.wheelSlipRatio[i];
      if (this.assists.abs && tBrake > 0 && vWheelLong > 3.5 && prevKappa < -0.13) {
        const absCut = clamp((-prevKappa - 0.13) / 0.09, 0, 0.72);
        tBrake *= (1 - absCut);
        this.absActive = true;
      }

      const tDrive = isFront ? 0 : rearDriveTorquePerWheel;

      // Implicitly stabilized wheel spin integration at 240 Hz
      const omega0 = this.wheelOmega[i];
      const kappa0 = clamp((omega0 * rEff - vWheelLong) / vDen, -1.5, 1.5);
      const fx0 = pacejka(kappa0, Bx, Cx, Dx, Ex);

      // Linearized positive tire damping slope dFx/d(omega) for unconditional 240 Hz stability
      const kSlope = (Bx * Cx * Dx * rEff) / vDen;
      const kEff = kSlope / (1 + 2.2 * Math.abs(kappa0));
      const invI = dt / WHEEL_INERTIA;

      let netTorque = tDrive - rEff * fx0;
      if (tBrake > 0 && Math.abs(omega0) > 1e-4) {
        netTorque -= Math.sign(omega0) * tBrake;
      }
      let omegaStar = (omega0 + invI * (netTorque + rEff * kEff * omega0)) / (1 + invI * rEff * kEff);

      // Prevent Coulomb brake torque from reversing wheel rotation past zero
      if (tBrake > 0) {
        if (omega0 * omegaStar < 0 || (Math.abs(omega0) <= 1e-4 && Math.abs(tDrive) <= tBrake)) {
          omegaStar = 0;
        }
      }

      this.wheelOmega[i] = omegaStar;
      this.wheelAngle[i] += omegaStar * dt;

      // Final regularized Pacejka slip ratio & slip angle (Section 4.4)
      const kappa = clamp((omegaStar * rEff - vWheelLong) / vDen, -1.5, 1.5);
      const alpha = Math.atan2(vWheelRight, vDen);
      this.wheelSlipRatio[i] = kappa;
      this.wheelSlipAngle[i] = alpha;

      // Raw longitudinal & lateral Pacejka forces in wheel frame
      // Positive alpha (wheel sliding rightward) produces leftward (-wheelRight) restoring force
      let fxW = pacejka(kappa, Bx, Cx, Dx, Ex);
      let fyW = -pacejka(alpha, By, Cy, Dy, Ey);

      // Strict Combined Friction Ellipse: (Fx/Dx)^2 + (Fy/Dy)^2 <= 1.0
      const nxRatio = Dx > 1 ? fxW / Dx : 0;
      const nyRatio = Dy > 1 ? fyW / Dy : 0;
      const ellipseMag = Math.hypot(nxRatio, nyRatio);
      if (ellipseMag > 1.0) {
        const invE = 1.0 / ellipseMag;
        fxW *= invE;
        fyW *= invE;
      }

      this.wheelFx[i] = fxW;
      this.wheelFy[i] = fyW;

      // Transform wheel force back into chassis frame
      // F_chassis_long  = fxW * cD + fyW * sD
      // F_chassis_right = fyW * cD - fxW * sD
      const fxC = fxW * cD + fyW * sD;
      const fyC = fyW * cD - fxW * sD;

      sumFxChassis += fxC;
      sumFyChassis += fyC;

      // Yaw torque around +Y: tau_y = z_i * F_right + x_i * F_long
      sumYawTorque += pz * fyC + px * fxC;

      // Surface rolling & off-track sinkage drag
      const baseCrr = 0.008;
      const surfDragExtra = surf.drag > 1.05 ? (surf.drag - 1.0) * 0.085 : 0;
      sumRollDrag += (baseCrr * (weightN * 0.25) + surfDragExtra * fz) * (vLong >= 0 ? 1 : -1);

      // Skid & smoke telemetry triggers
      const absK = Math.abs(kappa);
      const absA = Math.abs(alpha);
      if (absV > 4.0) {
        const skid = Math.max(clamp((absK - 0.18) / 0.30, 0, 1), clamp((absA - 0.18) / 0.22, 0, 1));
        if (skid > maxSkid) maxSkid = skid;
        const smoke = Math.max(clamp((absK - 0.22) / 0.35, 0, 1), clamp((absA - 0.24) / 0.25, 0, 1));
        if (smoke > maxSmoke) maxSmoke = smoke;
      }

      // Coupled Tire & Carbon-Carbon Brake Rotor Thermals (Section 4.5)
      // Slip work heats tire surface; airflow cools toward 65°C ambient
      const slipPowerW = Math.abs(kappa * fxW * vDen) + Math.abs(alpha * fyW * vDen);
      const tireHeatRate = slipPowerW * 0.00024;
      const tireCoolRate = (0.015 + 0.00055 * speedMs) * (this.wheelTemp[i] - 65.0);
      this.wheelTemp[i] = clamp(this.wheelTemp[i] + (tireHeatRate - tireCoolRate) * dt, 65.0, 125.0);

      // Dynamic tire tread shader roughness: 0.65 (cold matte) -> 0.22 (hot scrubbed)
      const hotFrac = clamp((this.wheelTemp[i] - 65.0) / 42.0, 0, 1);
      this.wheelRoughness[i] = 0.65 - 0.43 * hotFrac;

      // Brake rotor thermal model (ambient 220°C, heats > 650°C on threshold braking from > 280 km/h)
      // Effective braking power dissipated into disc = |brake_force_contribution| * v
      const brakeHeatPowerW = brakeCommand > 0.01 && absV > 1.5
        ? Math.abs(Math.min(0, fxW)) * absV * (isFront ? 1.10 : 0.92)
        : 0;
      const discThermalCapJPerK = isFront ? 1240.0 : 1380.0;
      const brakeHeatRate = brakeHeatPowerW / discThermalCapJPerK;
      const brakeCoolRate = (0.00018 * Math.pow(speedMs, 1.6) + 0.025) * (this.brakeTemp[i] - 220.0);
      this.brakeTemp[i] = clamp(this.brakeTemp[i] + (brakeHeatRate - brakeCoolRate) * dt, 220.0, 1050.0);
    }

    // 9. Stability Assist & Natural Aerodynamic Yaw Damping
    if (this.assists.stabilityAssist && absV > 8.0) {
      const idealYawRate = (vLong * Math.tan(this.steerAngle)) / (CAR_DIMS.WHEELBASE + 0.00045 * vLong * vLong);
      const yawErr = this.yawRate - idealYawRate;
      sumYawTorque -= yawErr * 900.0;
    }
    // High-speed aero yaw damping (shark fin & rear wing endplates)
    sumYawTorque -= this.yawRate * (140.0 + 5.5 * speedMs);

    // 10. Combine Aerodynamic Drag, Rolling Resistance & Banking Gravity Component
    const dragLong = speedMs > 0.1 ? dragN * (vLong / speedMs) : 0;
    const dragRight = speedMs > 0.1 ? dragN * (vLat / speedMs) : 0;

    let bankForceRight = 0;
    let gradeForceLong = 0;
    if (this.track && this._proj) {
      // Road grade along forward direction and banking lateral component
      gradeForceLong = -weightN * this._proj.ty * (fwdX * this._proj.tx + fwdZ * this._proj.tz);
      bankForceRight = -weightN * Math.sin(this._proj.banking);
    }

    const netFx = sumFxChassis - dragLong - sumRollDrag + gradeForceLong;
    const netFy = sumFyChassis - dragRight + bankForceRight;

    const aLong = netFx / PHYSICS_CFG.MASS;
    const aRight = netFy / PHYSICS_CFG.MASS;
    const yawAccel = sumYawTorque / PHYSICS_CFG.IZZ;

    // Low-pass filter accelerations for smooth load transfer & HUD G-force readout
    const filtAlpha = Math.min(1, dt * 32);
    this._aLongFilt += (aLong - this._aLongFilt) * filtAlpha;
    this._aRightFilt += (aRight - this._aRightFilt) * filtAlpha;
    this.longG = this._aLongFilt / GRAVITY;
    this.latG = -this._aRightFilt / GRAVITY; // +latG = cornering left
    const totalG = Math.hypot(this.longG, this.latG);
    if (totalG > this.maxG) this.maxG = totalG;

    // Integrate chassis velocities in world XZ (semi-implicit symplectic Euler)
    const axWorld = aLong * fwdX + aRight * rightX;
    const azWorld = aLong * fwdZ + aRight * rightZ;

    this.vx += axWorld * dt;
    this.vz += azWorld * dt;
    this.yawRate += yawAccel * dt;

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // 11. Suspension Visual Kinematics, Ride Height & Underbody Titanium Sparks (Section 4.5 & 8.2)
    // Aero heave compression lowers plank toward asphalt at high speed
    const heaveTarget = clamp(totalDownN / 1150000, 0, 0.025);
    this.heaveM += (heaveTarget - this.heaveM) * Math.min(1, dt * 18);

    // Kerb bump excitation
    const kerbRipple = anyKerb && speedMs > 12 ? 0.0065 * Math.abs(Math.sin(this.trackS * 3.8)) : 0;
    this.rideHeightM = Math.max(0.003, 0.032 - this.heaveM - kerbRipple);

    // Pitch (+nose up on acceleration, -nose down on braking), clamped +/-1.6 deg
    const maxPitch = 1.6 * DEG2RAD;
    const targetPitch = clamp(this.longG * 0.0055, -maxPitch, maxPitch);
    this.pitchRad += (targetPitch - this.pitchRad) * Math.min(1, dt * 14);

    // Roll (-rotation.z dips right side when turning left), clamped +/-1.2 deg
    const maxRoll = 1.2 * DEG2RAD;
    const targetRoll = clamp(-this.latG * 0.0042, -maxRoll, maxRoll);
    this.rollRad += (targetRoll - this.rollRad) * Math.min(1, dt * 14);

    for (let i = 0; i < 4; i++) {
      const comp = clamp((this.wheelFz[i] - 1800) / 380000, -0.015, 0.028);
      this.suspCompression[i] += (comp - this.suspCompression[i]) * Math.min(1, dt * 24);
      const kerbBump = this.wheelSurface[i] === SURFACE_TYPES.KERB && speedMs > 8
        ? 0.014 * Math.sin(this.trackS * 4.5 + i)
        : 0;
      this.suspOffset[i] = this.suspCompression[i] + kerbBump;
    }

    // Spark cascade trigger when titanium skid plank drops below 8 mm at high speed
    const plankSpark = this.rideHeightM < 0.0085 && speedMs > 48
      ? clamp((0.0085 - this.rideHeightM) / 0.0045, 0, 1) * clamp((speedMs - 48) / 30, 0, 1)
      : 0;

    // 12. Aggregates
    this.avgTireTemp = 0.25 * (this.wheelTemp[0] + this.wheelTemp[1] + this.wheelTemp[2] + this.wheelTemp[3]);
    this.maxTireTemp = Math.max(this.wheelTemp[0], this.wheelTemp[1], this.wheelTemp[2], this.wheelTemp[3]);
    this.frontBrakeTemp = 0.5 * (this.brakeTemp[0] + this.brakeTemp[1]);
    this.rearBrakeTemp = 0.5 * (this.brakeTemp[2] + this.brakeTemp[3]);
    this.maxBrakeTemp = Math.max(this.brakeTemp[0], this.brakeTemp[1], this.brakeTemp[2], this.brakeTemp[3]);
    this.onKerb = anyKerb;
    this.onGrass = anyGrass;
    this.onGravel = anyGravel;
    this.skidIntensity = maxSkid;
    this.smokeIntensity = maxSmoke;

    // 13. Track Projection, Sliding Barrier Collisions & 3-Sector Timing
    this._updateTrackAndTiming(dt, -Math.sin(this.heading), -Math.cos(this.heading));
    this.sparkIntensity = Math.max(plankSpark, this.barrierScrapeIntensity);
  }

  _updateThermalsOnly(dt, speedMs) {
    for (let i = 0; i < 4; i++) {
      const tireCool = (0.012 + 0.0004 * speedMs) * (this.wheelTemp[i] - 65.0);
      this.wheelTemp[i] = clamp(this.wheelTemp[i] - tireCool * dt, 65.0, 125.0);
      const hotFrac = clamp((this.wheelTemp[i] - 65.0) / 42.0, 0, 1);
      this.wheelRoughness[i] = 0.65 - 0.43 * hotFrac;

      const brakeCool = 0.025 * (this.brakeTemp[i] - 220.0);
      this.brakeTemp[i] = clamp(this.brakeTemp[i] - brakeCool * dt, 220.0, 1050.0);
    }
    this.avgTireTemp = 0.25 * (this.wheelTemp[0] + this.wheelTemp[1] + this.wheelTemp[2] + this.wheelTemp[3]);
    this.maxTireTemp = Math.max(this.wheelTemp[0], this.wheelTemp[1], this.wheelTemp[2], this.wheelTemp[3]);
    this.frontBrakeTemp = 0.5 * (this.brakeTemp[0] + this.brakeTemp[1]);
    this.rearBrakeTemp = 0.5 * (this.brakeTemp[2] + this.brakeTemp[3]);
    this.maxBrakeTemp = Math.max(this.brakeTemp[0], this.brakeTemp[1], this.brakeTemp[2], this.brakeTemp[3]);
  }

  _updateTrackAndTiming(dt, fwdX, fwdZ) {
    if (!this.track) {
      this.y = 0;
      this.barrierScrapeIntensity = 0;
      this.drsAvailable = this.freePracticeDRS;
      return;
    }

    this.prevTrackS = this.trackS;
    const p = this.track.projectPoint(this.x, this.z, this.trackS, this._proj);

    // Smooth impulse-based sliding barrier collision along inward boundary normal
    const minDLat = -(p.boundaryLeft - CAR_HALF_WIDTH_COLLISION);
    const maxDLat = p.boundaryRight - CAR_HALF_WIDTH_COLLISION;
    let scrape = 0;

    if (p.dLat < minDLat || p.dLat > maxDLat) {
      const hitRight = p.dLat > maxDLat;
      const clampedDLat = hitRight ? maxDLat : minDLat;

      // Project position strictly inside barrier (zero tunneling)
      const rHorizLen = Math.hypot(p.rx, p.rz) || 1;
      const rxH = p.rx / rHorizLen;
      const rzH = p.rz / rHorizLen;
      this.x = p.x + rxH * clampedDLat;
      this.z = p.z + rzH * clampedDLat;
      p.dLat = clampedDLat;

      // Inward barrier normal points back toward track centerline
      const nInX = hitRight ? -rxH : rxH;
      const nInZ = hitRight ? -rzH : rzH;
      const tHorizLen = Math.hypot(p.tx, p.tz) || 1;
      const txH = p.tx / tHorizLen;
      const tzH = p.tz / tHorizLen;

      const vN = this.vx * nInX + this.vz * nInZ; // negative = heading into wall
      const vT = this.vx * txH + this.vz * tzH;

      if (vN < 0) {
        // Restitution 0.22 with mild tangential slide friction so car glides along wall cleanly
        const vNNew = Math.min(3.2, -0.22 * vN);
        const slideDamp = 1.0 - 0.14 * clamp(-vN / 14.0, 0, 1);
        const vTNew = vT * slideDamp;

        this.vx = txH * vTNew + nInX * vNNew;
        this.vz = tzH * vTNew + nInZ * vNNew;
        this.yawRate *= 0.45;

        // Gently align nose along barrier tangent on glancing contact to prevent snagging
        const trackHeading = Math.atan2(-txH, -tzH);
        const hDiff = wrapAngle(trackHeading - this.heading);
        if (Math.abs(hDiff) < 1.1) {
          this.heading = wrapAngle(this.heading + hDiff * 0.14);
        }

        scrape = clamp((Math.abs(vT) * 0.03 + Math.abs(vN) * 0.12), 0.2, 1.0);
      } else {
        scrape = clamp(Math.abs(vT) * 0.015, 0, 0.5);
      }
    }

    this.barrierScrapeIntensity += (scrape - this.barrierScrapeIntensity) * Math.min(1, dt * (scrape > this.barrierScrapeIntensity ? 30 : 8));

    // Update road elevation & surface metadata
    this.trackS = p.s;
    this.dLat = p.dLat;
    this.y = this.track.getSurfaceElevation(p.s, p.dLat, p);
    this.drsZone = p.drsZone;
    this.drsAvailable = this.freePracticeDRS || this.drsZone !== 0;
    this.currentSurface = p.surface;

    // Wrong-way detection
    const headingDot = fwdX * p.tx + fwdZ * p.tz;
    if (headingDot < -0.35 && this.speedMs > 2.5) {
      this._wrongWayTimer += dt;
      this.isWrongWay = this._wrongWayTimer > 0.6;
    } else {
      this._wrongWayTimer = Math.max(0, this._wrongWayTimer - dt * 2.0);
      if (this._wrongWayTimer <= 0.1) this.isWrongWay = false;
    }

    // 3-Sector timing & lap counter
    if (!this.raceFinished) {
      this.currentLapTime += dt;
    }

    const L = this.track.length;
    const prevS = this.prevTrackS;
    const currS = this.trackS;
    const crossedForward = prevS > L * 0.80 && currS < L * 0.20;

    if (crossedForward) {
      if (!this._hasStartedLap) {
        // First pass across S/F line from starting grid behind s = 0
        this._hasStartedLap = true;
        this._maxSectorReached = 1;
        this.sector = 1;
      } else if (this._maxSectorReached === 3) {
        // Completed full valid lap!
        const s3Time = this.currentLapTime - this._sectorStartTime;
        this._recordSector(2, s3Time);

        const lapTime = this.currentLapTime;
        this.lastLapTime = lapTime;
        const isBest = lapTime < this.bestLapTime;
        if (isBest) this.bestLapTime = lapTime;

        const lapRecord = {
          lap: this.lap,
          time: lapTime,
          sectors: [this.sectorTimes[0], this.sectorTimes[1], this.sectorTimes[2]],
          isBest,
        };
        this.completedLaps.push(lapRecord);
        this.completedLapCount++;

        if (this.onLapComplete) this.onLapComplete(lapRecord);

        if (this.completedLapCount >= this.totalLaps) {
          this.raceFinished = true;
          if (this.onRaceFinish) this.onRaceFinish(this.getTelemetry());
        } else {
          this.lap++;
          this.currentLapTime = 0;
          this._sectorStartTime = 0;
          this._maxSectorReached = 1;
          this.sector = 1;
        }
      }
    } else if (this._hasStartedLap && !this.raceFinished) {
      const [s1Split, s2Split] = this.track.sectorSplits;
      if (this._maxSectorReached === 1 && prevS < s1Split && currS >= s1Split) {
        this._recordSector(0, this.currentLapTime - this._sectorStartTime);
        this._sectorStartTime = this.currentLapTime;
        this._maxSectorReached = 2;
        this.sector = 2;
      } else if (this._maxSectorReached === 2 && prevS < s2Split && currS >= s2Split) {
        this._recordSector(1, this.currentLapTime - this._sectorStartTime);
        this._sectorStartTime = this.currentLapTime;
        this._maxSectorReached = 3;
        this.sector = 3;
      }
    }

    // Continuous unwrapped race distance for live position standings
    if (!this._hasStartedLap) {
      this.totalRaceDistance = currS > L * 0.5 ? currS - L : currS;
    } else {
      this.totalRaceDistance = this.completedLapCount * L + currS;
    }
  }

  _recordSector(idx, timeS) {
    this.sectorTimes[idx] = timeS;
    if (timeS < this.bestSectors[idx]) {
      this.bestSectors[idx] = timeS;
      this.sectorStatus[idx] = 'purple';
    } else if (timeS <= this.bestSectors[idx] * 1.015) {
      this.sectorStatus[idx] = 'green';
    } else {
      this.sectorStatus[idx] = 'yellow';
    }
  }

  /**
   * Zero-allocation live telemetry snapshot for HUD, cameras, audio, FX, and Inspector.
   */
  getTelemetry(out = this._telemetry) {
    out.x = this.x;
    out.y = this.y;
    out.z = this.z;
    out.heading = this.heading;
    out.speedMs = this.speedMs;
    out.speedKmh = this.speedKmh;
    out.vLong = this.vLong;
    out.vLat = this.vLat;
    out.yawRate = this.yawRate;
    out.longG = this.longG;
    out.latG = this.latG;
    out.maxG = this.maxG;
    out.topSpeedKmh = this.topSpeedKmh;
    out.throttle = this.throttle;
    out.brake = this.brake;
    out.steerAngle = this.steerAngle;
    out.steeringWheelAngle = this.steeringWheelAngle;
    out.gear = this.gear;
    out.gearLabel = this.gearLabel;
    out.rpm = this.rpm;
    out.rpmNorm = this.rpmNorm;
    out.drsOpen = this.drsOpen;
    out.drsAvailable = this.drsAvailable;
    out.drsFlapAngle = this.drsFlapAngle;
    out.drsZone = this.drsZone;
    out.downforceN = this.downforceN;
    out.frontDownforceN = this.frontDownforceN;
    out.rearDownforceN = this.rearDownforceN;
    out.dragN = this.dragN;
    out.effectiveCl = this.effectiveCl;
    out.effectiveCd = this.effectiveCd;
    out.pitchRad = this.pitchRad;
    out.rollRad = this.rollRad;
    out.heaveM = this.heaveM;
    out.rideHeightM = this.rideHeightM;
    out.sparkIntensity = this.sparkIntensity;
    out.barrierScrapeIntensity = this.barrierScrapeIntensity;
    out.skidIntensity = this.skidIntensity;
    out.smokeIntensity = this.smokeIntensity;
    out.avgTireTemp = this.avgTireTemp;
    out.maxTireTemp = this.maxTireTemp;
    out.maxBrakeTemp = this.maxBrakeTemp;
    out.frontBrakeTemp = this.frontBrakeTemp;
    out.rearBrakeTemp = this.rearBrakeTemp;
    out.compound = this.compound;
    out.surface = this.currentSurface;
    out.onKerb = this.onKerb;
    out.onGrass = this.onGrass;
    out.onGravel = this.onGravel;
    out.tcActive = this.tcActive;
    out.absActive = this.absActive;
    out.trackS = this.trackS;
    out.dLat = this.dLat;
    out.sector = this.sector;
    out.lap = this.lap;
    out.totalLaps = this.totalLaps;
    out.currentLapTime = this.currentLapTime;
    out.lastLapTime = this.lastLapTime;
    out.bestLapTime = this.bestLapTime;
    out.totalRaceDistance = this.totalRaceDistance;
    out.raceFinished = this.raceFinished;
    out.isWrongWay = this.isWrongWay;
    return out;
  }
}

/**
 * Multi-Livery AI Formula 1 Competitor Manager (3 AI rivals ahead on grid: P1, P2, P3).
 * Uses curvature-aware pure-pursuit spline driving, dynamic overtaking/avoidance,
 * smooth suspension/brake/DRS animation, and zero-allocation live race standings.
 */
const AI_ROSTER = [
  {
    id: 'rival_1',
    name: 'K. Sato',
    shortName: 'SAT',
    number: 14,
    team: 'Cobalt Works GP',
    liveryKey: 'car_livery_rival_a',
    accentColor: '#2563eb',
    compound: 'soft',
    gridS: -6.0,
    gridDLat: -2.2,
    basePace: 0.935,
    laneBias: -0.35,
  },
  {
    id: 'rival_2',
    name: 'L. Vance',
    shortName: 'VAN',
    number: 44,
    team: 'Papaya Aero Racing',
    liveryKey: 'car_livery_rival_b',
    accentColor: '#f97316',
    compound: 'medium',
    gridS: -12.0,
    gridDLat: 2.2,
    basePace: 0.905,
    laneBias: 0.45,
  },
  {
    id: 'rival_3',
    name: 'M. Lindqvist',
    shortName: 'LIN',
    number: 77,
    team: 'Nordic Silver GP',
    liveryKey: 'car_livery_rival_a',
    accentColor: '#0ea5e9',
    compound: 'soft',
    gridS: -18.0,
    gridDLat: -2.2,
    basePace: 0.875,
    laneBias: -0.15,
  },
];

export class AIRivalManager {
  constructor(track, options = {}) {
    this.track = track;
    this.enabled = options.enabled !== false;
    this._sampleA = track.createSampleBuffer();
    this._sampleB = track.createSampleBuffer();

    this.rivals = AI_ROSTER.map((cfg) => ({
      ...cfg,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      trackS: 0,
      dLat: cfg.gridDLat,
      targetDLat: cfg.gridDLat,
      avoidOffset: 0,
      speedMs: 0,
      speedKmh: 0,
      accelMs2: 0,
      steerAngle: 0,
      wheelSpin: 0,
      wheelOmega: 0,
      drsOpen: false,
      drsFlapAngle: 0,
      brakeTemp: 220,
      pitchRad: 0,
      rollRad: 0,
      rpm: PHYSICS_CFG.IDLE_RPM,
      gear: 1,
      lap: 1,
      completedLaps: 0,
      hasStartedLap: false,
      totalDistance: cfg.gridS,
      launchDelay: 0.08 + Math.abs(cfg.gridS) * 0.008,
      launchTimer: 0,
    }));

    // Preallocated standings array (player + 3 AI rivals = 4 entries, zero GC)
    this._standings = [
      { id: 'player', name: 'YOU', shortName: 'YOU', number: 26, isPlayer: true, position: 4, lap: 1, totalDistance: -24, gapMeters: 0, gapSeconds: 0, speedKmh: 0, color: '#dc2626' },
      ...this.rivals.map((r, idx) => ({
        id: r.id,
        name: r.name,
        shortName: r.shortName,
        number: r.number,
        isPlayer: false,
        position: idx + 1,
        lap: 1,
        totalDistance: r.gridS,
        gapMeters: 0,
        gapSeconds: 0,
        speedKmh: 0,
        color: r.accentColor,
      })),
    ];

    this.resetToGrid();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  resetToGrid() {
    for (let i = 0; i < this.rivals.length; i++) {
      const r = this.rivals[i];
      const sWrap = this.track.wrapS(r.gridS);
      this.track.sampleAtS(sWrap, this._sampleA);

      r.trackS = sWrap;
      r.dLat = r.gridDLat;
      r.targetDLat = r.gridDLat;
      r.avoidOffset = 0;
      r.x = this._sampleA.x + this._sampleA.rx * r.dLat;
      r.z = this._sampleA.z + this._sampleA.rz * r.dLat;
      r.y = this.track.getSurfaceElevation(sWrap, r.dLat, this._sampleA);
      r.heading = Math.atan2(-this._sampleA.tx, -this._sampleA.tz);
      r.speedMs = 0;
      r.speedKmh = 0;
      r.accelMs2 = 0;
      r.steerAngle = 0;
      r.wheelSpin = 0;
      r.wheelOmega = 0;
      r.drsOpen = false;
      r.drsFlapAngle = 0;
      r.brakeTemp = 220;
      r.pitchRad = 0;
      r.rollRad = 0;
      r.rpm = PHYSICS_CFG.IDLE_RPM;
      r.gear = 1;
      r.lap = 1;
      r.completedLaps = 0;
      r.hasStartedLap = false;
      r.totalDistance = r.gridS;
      r.launchTimer = 0;
    }
  }

  /**
   * Step all 3 AI rivals smoothly (can be called at 240 Hz or per render frame with dt).
   * Strictly zero heap allocations.
   */
  step(dt, playerPhysics = null) {
    if (!this.enabled) return;

    const L = this.track.length;
    const sampleCur = this._sampleA;
    const sampleLook = this._sampleB;

    for (let i = 0; i < this.rivals.length; i++) {
      const r = this.rivals[i];

      // Brief authentic driver reaction time off lights out
      if (r.launchTimer < r.launchDelay) {
        r.launchTimer += dt;
        r.rpm = 9200;
        continue;
      }

      // Compute subtle competitive rubber-banding (+/-5%) relative to player
      let paceMult = r.basePace;
      if (playerPhysics) {
        const distGap = r.totalDistance - playerPhysics.totalRaceDistance;
        if (distGap > 180) {
          paceMult *= clamp(1.0 - (distGap - 180) * 0.00025, 0.90, 1.0);
        } else if (distGap < -140) {
          paceMult *= clamp(1.0 + (-distGap - 140) * 0.00025, 1.0, 1.06);
        }
      }

      // Sample current & look-ahead spline targets
      this.track.sampleAtS(r.trackS, sampleCur);
      const lookDist = clamp(16 + r.speedMs * 0.45, 16, 48);
      this.track.sampleAtS(r.trackS + lookDist, sampleLook);

      // Desired target speed from precomputed curvature-aware braking envelope
      const envelopeSpeed = Math.min(
        this.track.getTargetSpeedAtS(r.trackS),
        this.track.getTargetSpeedAtS(r.trackS + 18)
      );
      const inDrs = sampleCur.drsZone !== 0;
      const drsBonus = inDrs && Math.abs(sampleCur.curvature) < 0.002 ? 1.055 : 1.0;
      let targetSpeed = envelopeSpeed * paceMult * drsBonus;

      // Lateral overtaking & collision avoidance around other AI cars and the player (zero allocation)
      let desiredAvoid = 0;
      const totalCars = this.rivals.length + (playerPhysics && !playerPhysics.isWrongWay ? 1 : 0);
      for (let j = 0; j < totalCars; j++) {
        if (j === i) continue;
        const isPlayerEntry = j === this.rivals.length;
        const otherS = isPlayerEntry ? playerPhysics.trackS : this.rivals[j].trackS;
        const otherDLat = isPlayerEntry ? playerPhysics.dLat : this.rivals[j].dLat;
        const otherSpeed = isPlayerEntry ? playerPhysics.speedMs : this.rivals[j].speedMs;

        let dsOther = otherS - r.trackS;
        if (dsOther > L * 0.5) dsOther -= L;
        if (dsOther < -L * 0.5) dsOther += L;

        if (dsOther > -4.5 && dsOther < 28.0) {
          const latGap = r.dLat - otherDLat;
          if (Math.abs(latGap) < 3.4) {
            const preferSide = Math.abs(latGap) > 0.35
              ? Math.sign(latGap)
              : (otherDLat > 0 ? -1 : 1);
            const urgency = clamp(1.0 - Math.abs(dsOther) / 28.0, 0, 1);
            desiredAvoid += preferSide * 3.1 * urgency;

            if (dsOther > 0 && dsOther < 9.5 && Math.abs(latGap) < 2.1) {
              targetSpeed = Math.min(targetSpeed, Math.max(10, otherSpeed * 0.96));
            }
          }
        }
      }

      r.avoidOffset += (clamp(desiredAvoid, -3.8, 3.8) - r.avoidOffset) * Math.min(1, dt * 3.5);

      // Blend from starting grid slot smoothly onto racing line + avoidance lane
      const gridBlend = clamp(r.totalDistance / 90, 0, 1);
      const idealLine = sampleLook.racingLineOffset + r.laneBias;
      const targetLat = clamp(
        r.gridDLat * (1 - gridBlend) + (idealLine + r.avoidOffset) * gridBlend,
        -(this.track.halfWidth - 1.35),
        this.track.halfWidth - 1.35
      );
      r.targetDLat = targetLat;

      // Longitudinal acceleration / braking dynamics
      const speedErr = targetSpeed - r.speedMs;
      let accel;
      if (speedErr >= 0) {
        const maxAccel = Math.max(2.2, 13.8 - 0.115 * r.speedMs);
        accel = Math.min(maxAccel, speedErr * 2.2);
      } else {
        const maxDecel = 26.0 + 0.0045 * r.speedMs * r.speedMs;
        accel = -Math.min(maxDecel, -speedErr * 3.4);
      }

      r.accelMs2 = accel;
      r.speedMs = Math.max(0, r.speedMs + accel * dt);
      r.speedKmh = r.speedMs * 3.6;

      // Advance arc-length position & wrap lap counters
      const prevS = r.trackS;
      const ds = r.speedMs * dt;
      r.trackS = this.track.wrapS(r.trackS + ds);
      r.totalDistance += ds;

      if (prevS > L * 0.8 && r.trackS < L * 0.2) {
        if (!r.hasStartedLap) {
          r.hasStartedLap = true;
        } else {
          r.completedLaps++;
          r.lap = r.completedLaps + 1;
        }
      }

      // Smooth lateral pure-pursuit tracking
      const latErr = r.targetDLat - r.dLat;
      const maxLatRate = clamp(r.speedMs * 0.16, 0.5, 5.5);
      const dLatRate = clamp(latErr * 2.6, -maxLatRate, maxLatRate);
      r.dLat += dLatRate * dt;

      // Re-sample exact world pose & heading with slight lateral slip alignment
      this.track.sampleAtS(r.trackS, sampleCur);
      r.x = sampleCur.x + sampleCur.rx * r.dLat;
      r.z = sampleCur.z + sampleCur.rz * r.dLat;
      r.y = this.track.getSurfaceElevation(r.trackS, r.dLat, sampleCur);

      const trackHeading = Math.atan2(-sampleCur.tx, -sampleCur.tz);
      const lateralHeadingOffset = r.speedMs > 2.0 ? -Math.atan2(dLatRate, r.speedMs) : 0;
      const desiredHeading = wrapAngle(trackHeading + clamp(lateralHeadingOffset, -0.28, 0.28));
      const hDiff = wrapAngle(desiredHeading - r.heading);
      r.heading = wrapAngle(r.heading + hDiff * Math.min(1, dt * 12));

      // Visual steering deflection, wheel rotation, DRS flap, brake glow, and chassis attitude
      const curvSteer = clamp(sampleLook.curvature * CAR_DIMS.WHEELBASE * 1.45 - latErr * 0.025, -0.34, 0.34);
      r.steerAngle += (curvSteer - r.steerAngle) * Math.min(1, dt * 10);

      r.wheelOmega = r.speedMs / CAR_DIMS.TIRE_RADIUS;
      r.wheelSpin += r.wheelOmega * dt;

      r.drsOpen = inDrs && accel >= -1.0 && Math.abs(sampleCur.curvature) < 0.0024 && r.speedKmh > 170;
      r.drsFlapAngle += ((r.drsOpen ? DRS_FLAP_MAX_RAD : 0) - r.drsFlapAngle) * Math.min(1, dt * 14);

      // Authentic brake glow under heavy deceleration into corners
      const brakeHeat = accel < -6.0 ? Math.abs(accel) * r.speedMs * 0.42 : 0;
      const brakeCool = (0.0002 * Math.pow(r.speedMs, 1.6) + 0.03) * (r.brakeTemp - 220);
      r.brakeTemp = clamp(r.brakeTemp + (brakeHeat - brakeCool) * dt, 220, 960);

      const latG = (r.speedMs * r.speedMs * sampleCur.curvature) / GRAVITY;
      r.pitchRad += (clamp((accel / GRAVITY) * 0.005, -0.024, 0.024) - r.pitchRad) * Math.min(1, dt * 12);
      r.rollRad += (clamp(-latG * 0.004, -0.020, 0.020) - r.rollRad) * Math.min(1, dt * 12);

      // Synthetic gear & RPM readout for audio/minimap/telemetry
      const spdKmh = r.speedKmh;
      r.gear = spdKmh < 95 ? 1 : spdKmh < 122 ? 2 : spdKmh < 150 ? 3 : spdKmh < 185 ? 4 : spdKmh < 222 ? 5 : spdKmh < 262 ? 6 : spdKmh < 302 ? 7 : 8;
      const gRatio = PHYSICS_CFG.GEAR_RATIOS[r.gear + 1] * PHYSICS_CFG.FINAL_DRIVE * PRIMARY_REDUCTION;
      r.rpm = clamp(r.wheelOmega * gRatio * (60 / (2 * Math.PI)), PHYSICS_CFG.IDLE_RPM, PHYSICS_CFG.MAX_RPM);

      // Gentle car-to-car physical pushback with player to prevent visual overlap
      if (playerPhysics) {
        const dx = playerPhysics.x - r.x;
        const dz = playerPhysics.z - r.z;
        const distSq = dx * dx + dz * dz;
        const minSep = 2.35;
        if (distSq > 0.001 && distSq < minSep * minSep) {
          const dist = Math.sqrt(distSq);
          const overlap = (minSep - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          playerPhysics.x += nx * overlap;
          playerPhysics.z += nz * overlap;
          r.x -= nx * overlap;
          r.z -= nz * overlap;
          // Exchange mild elastic lateral velocity bump
          const relVx = playerPhysics.vx - (-Math.sin(r.heading) * r.speedMs);
          const relVz = playerPhysics.vz - (-Math.cos(r.heading) * r.speedMs);
          const vn = relVx * nx + relVz * nz;
          if (vn < 0) {
            playerPhysics.vx -= nx * vn * 0.65;
            playerPhysics.vz -= nz * vn * 0.65;
            playerPhysics.barrierScrapeIntensity = Math.max(playerPhysics.barrierScrapeIntensity, 0.45);
          }
        }
      }
    }
  }

  /**
   * Returns live sorted race standings (P1..P4) using a preallocated buffer (zero GC).
   */
  getRaceOrder(playerPhysics) {
    const list = this._standings;

    // Update entries in-place
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (entry.isPlayer) {
        entry.lap = playerPhysics ? playerPhysics.lap : 1;
        entry.totalDistance = playerPhysics ? playerPhysics.totalRaceDistance : -24;
        entry.speedKmh = playerPhysics ? playerPhysics.speedKmh : 0;
      } else {
        for (let j = 0; j < this.rivals.length; j++) {
          if (this.rivals[j].id === entry.id) {
            entry.lap = this.rivals[j].lap;
            entry.totalDistance = this.rivals[j].totalDistance;
            entry.speedKmh = this.rivals[j].speedKmh;
            break;
          }
        }
      }
    }

    // Insertion sort (4 elements, zero allocations)
    for (let i = 1; i < list.length; i++) {
      const key = list[i];
      let j = i - 1;
      while (j >= 0 && list[j].totalDistance < key.totalDistance) {
        list[j + 1] = list[j];
        j--;
      }
      list[j + 1] = key;
    }

    const leaderDist = list[0].totalDistance;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      e.position = i + 1;
      e.gapMeters = Math.max(0, leaderDist - e.totalDistance);
      const refSpeed = Math.max(25, e.speedKmh / 3.6);
      e.gapSeconds = e.gapMeters / refSpeed;
    }

    return list;
  }

  getPlayerPosition(playerPhysics) {
    if (!this.enabled) return 1;
    const order = this.getRaceOrder(playerPhysics);
    for (let i = 0; i < order.length; i++) {
      if (order[i].isPlayer) return order[i].position;
    }
    return 1;
  }
}

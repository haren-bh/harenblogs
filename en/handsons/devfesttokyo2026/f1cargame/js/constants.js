/**
 * Shared simulation constants, vehicle metrics, tire compounds,
 * surface definitions, and PBR compliance bounds for the Tokyo GP F1 Sim.
 */

export const FSM_STATES = Object.freeze({
  SHOWROOM_GRID: 'SHOWROOM_GRID',
  LIGHTS_COUNTDOWN: 'LIGHTS_COUNTDOWN',
  ACTIVE_RACING: 'ACTIVE_RACING',
  PAUSED: 'PAUSED',
  SESSION_SUMMARY: 'SESSION_SUMMARY',
});

export const CAMERA_MODES = Object.freeze({
  SHOWROOM_ORBIT: 'SHOWROOM_ORBIT',
  CHASE: 'CHASE',
  COCKPIT: 'COCKPIT',
  TV_POD: 'TV_POD',
});

export const CAMERA_LABELS = Object.freeze({
  SHOWROOM_ORBIT: 'Showroom Orbit',
  CHASE: 'Chase Cam',
  COCKPIT: 'Cockpit Halo',
  TV_POD: 'TV Broadcast Pod',
});

/**
 * Authoritative right-handed Y-up chassis geometry in meters.
 * Origin (0, 0, 0) lies on the ground directly beneath the CoG.
 * Forward = -Z, Rearward = +Z, Driver Right = +X.
 */
export const CAR_DIMS = Object.freeze({
  LENGTH: 5.52,
  WIDTH: 2.00,
  HEIGHT: 0.97,
  WHEELBASE: 3.60,
  FRONT_AXLE_Z: -1.962,
  REAR_AXLE_Z: 1.638,
  FRONT_TRACK: 1.60,
  REAR_TRACK: 1.55,
  COG_HEIGHT: 0.310,
  TIRE_RADIUS: 0.360,
  FRONT_TIRE_WIDTH: 0.305,
  REAR_TIRE_WIDTH: 0.405,
});

/**
 * 240 Hz vehicle dynamics, hybrid powertrain, and aerodynamic configuration.
 */
export const PHYSICS_CFG = Object.freeze({
  DT: 1 / 240,
  MASS: 798.0,
  FRONT_WEIGHT_RATIO: 0.455,
  REAR_WEIGHT_RATIO: 0.545,
  IZZ: 1150.0,
  RHO: 1.225,
  FRONTAL_AREA: 1.65,
  CL_BASE: 3.20,
  CD_BASE: 0.95,
  DRS_REAR_CL_REDUCTION: 0.22,
  DRS_CD_REDUCTION: 0.30,
  AERO_FRONT_RATIO: 0.42,
  AERO_REAR_RATIO: 0.58,
  V_EPS: 1.5,
  ARB_FRONT: 450000,
  ARB_REAR: 220000,
  // Index 0 = Reverse, 1 = Neutral, 2..9 = Gears 1..8
  GEAR_RATIOS: Object.freeze([-2.85, 0, 3.10, 2.48, 2.02, 1.66, 1.38, 1.18, 1.02, 0.89]),
  FINAL_DRIVE: 3.42,
  IDLE_RPM: 4000,
  MAX_RPM: 13500,
  UPSHIFT_RPM: 12200,
  DOWNSHIFT_RPM: 7800,
  SHIFT_CUT_S: 0.04,
  PEAK_POWER_W: 745000,
  DRIVETRAIN_EFF: 0.92,
});

export const TIRE_COMPOUNDS = Object.freeze({
  soft: Object.freeze({
    id: 'soft',
    label: 'Soft (C5)',
    shortLabel: 'SOFT',
    badgeColor: '#dc2626',
    muY: 1.82,
    muX: 1.86,
    optTempMin: 90,
    optTempMax: 108,
    sidewallTex: 'tire_sidewall_soft.png',
  }),
  medium: Object.freeze({
    id: 'medium',
    label: 'Medium (C3)',
    shortLabel: 'MED',
    badgeColor: '#eab308',
    muY: 1.74,
    muX: 1.78,
    optTempMin: 95,
    optTempMax: 112,
    sidewallTex: 'tire_sidewall_medium.png',
  }),
  hard: Object.freeze({
    id: 'hard',
    label: 'Hard (C1)',
    shortLabel: 'HARD',
    badgeColor: '#e5e7eb',
    muY: 1.66,
    muX: 1.70,
    optTempMin: 100,
    optTempMax: 118,
    sidewallTex: 'tire_sidewall_hard.png',
  }),
});

export const SURFACE_TYPES = Object.freeze({
  RUBBER_LINE: Object.freeze({ id: 'RUBBER_LINE', grip: 1.05, drag: 1.00 }),
  ASPHALT: Object.freeze({ id: 'ASPHALT', grip: 1.00, drag: 1.00 }),
  KERB: Object.freeze({ id: 'KERB', grip: 0.88, drag: 1.08 }),
  GRASS: Object.freeze({ id: 'GRASS', grip: 0.48, drag: 2.60 }),
  GRAVEL: Object.freeze({ id: 'GRAVEL', grip: 0.36, drag: 4.80 }),
  BARRIER: Object.freeze({ id: 'BARRIER', grip: 0.60, drag: 1.80 }),
});

export const PBR_BOUNDS = Object.freeze({
  DIELECTRIC_MIN_SRGB: 30,
  DIELECTRIC_MAX_SRGB: 240,
  CONDUCTIVE_MIN_SRGB: 180,
  CONDUCTIVE_MAX_SRGB: 255,
});

export const TOTAL_LAPS = 3;

/**
 * Core physical, optical, biomechanical, and PBR validation constants
 * derived directly from specs/golfswing.md.
 */

export const GAME_STATES = Object.freeze({
  TEE_ADDRESS: 'STATE_TEE_ADDRESS',
  SWING_EXECUTION: 'STATE_SWING_EXECUTION',
  BALL_FLIGHT: 'STATE_BALL_FLIGHT',
  LANDING_ROLLOUT: 'STATE_LANDING_ROLLOUT',
  RELOAD_RESET: 'STATE_RELOAD_RESET',
});

export const STATE_METADATA = Object.freeze({
  [GAME_STATES.TEE_ADDRESS]: {
    label: 'Tee Address',
    shortLabel: 'ADDRESS',
    camera: 'Camera_Address_Tee',
    description: 'Golfer aligned at address; wind and idle muscular tone active.',
  },
  [GAME_STATES.SWING_EXECUTION]: {
    label: 'Kinetic Swing',
    shortLabel: 'SWING',
    camera: 'Camera_Address_Tee',
    description: 'Double-pendulum kinematic chain, RBF PSD, FEM muscle contraction, and impact.',
  },
  [GAME_STATES.BALL_FLIGHT]: {
    label: 'Aerodynamic Flight',
    shortLabel: 'FLIGHT',
    camera: 'Camera_Flight_Chase',
    description: 'RK4 240Hz integration of gravity, Reynolds drag, and Magnus lift.',
  },
  [GAME_STATES.LANDING_ROLLOUT]: {
    label: 'Landing & Rollout',
    shortLabel: 'LANDING',
    camera: 'Camera_Landing_Downrange',
    description: 'Turf restitution, kinetic friction, and rolling deceleration.',
  },
  [GAME_STATES.RELOAD_RESET]: {
    label: 'Reload & Reset',
    shortLabel: 'RELOAD',
    camera: 'Camera_Address_Tee',
    description: 'Non-destructive USD stage cache flush back to Tee Address.',
  },
});

export const PHYSICS = Object.freeze({
  GRAVITY: 9.80665,              // m/s^2
  AIR_DENSITY: 1.225,            // kg/m^3 at sea level
  AIR_VISCOSITY: 1.81e-5,        // Pa·s dynamic viscosity
  BALL_MASS: 0.0459,             // kg (regulation golf ball)
  BALL_RADIUS: 0.021335,         // m (42.67 mm diameter)
  BALL_DIAMETER: 0.04267,        // m
  BALL_AREA: Math.PI * 0.021335 * 0.021335, // ~0.001430 m^2
  CLUB_MASS: 0.200,              // kg (driver clubhead)
  COR_DRIVER: 0.78,              // coefficient of restitution
  SPIN_DECAY_BETA: 0.015,        // s^-1 viscous air spin decay
  RK4_DT: 1 / 240,               // 240 Hz fixed aerodynamic integration step
  TURF_RESTITUTION: 0.42,        // e_turf for regulation bentgrass fairway
  TURF_FRICTION_KINETIC: 0.35,   // mu_k tangential kinetic friction
  TURF_ROLLING_RESIST: 0.08,     // mu_r short-cut fairway rolling resistance
  ROUGH_RESTITUTION: 0.24,
  ROUGH_ROLLING_RESIST: 0.24,
  BUNKER_RESTITUTION: 0.12,
  BUNKER_ROLLING_RESIST: 0.58,
  GREEN_RESTITUTION: 0.46,
  GREEN_ROLLING_RESIST: 0.055,
  STOP_VELOCITY_THRESHOLD: 0.05, // m/s linear velocity rest threshold
  TEE_HEIGHT: 0.055,             // m regulation driver tee elevation above tee box surface
});

export const DEFAULT_LAUNCH = Object.freeze({
  clubSpeedMs: 50.0,             // m/s (~112 mph)
  launchElevationDeg: 11.5,      // degrees
  launchAzimuthDeg: 0.0,         // degrees (+ right, - left)
  backspinRpm: 2600,             // rpm (~272.3 rad/s)
  sidespinRpm: 0,                // rpm (+ fade/slice right, - draw/hook left)
  windSpeedMs: 2.2,              // m/s light natural breeze
  windDirectionDeg: 35,          // degrees clockwise from downrange
  sunElevationDeg: 34,           // golden late-morning championship sunlight
});

export const CAMERA_SPECS = Object.freeze({
  Camera_Address_Tee: {
    id: 'Camera_Address_Tee',
    focalLengthMm: 50.0,
    aperture: 'f/2.8',
    sensorHeightMm: 24.0,
    sensorWidthMm: 36.0,
    impactShakeAmplitudeM: 0.02,
    focusMode: 'Fixed focus on ball (0.0, 0.055, 0.0) m',
  },
  Camera_Flight_Chase: {
    id: 'Camera_Flight_Chase',
    focalLengthMm: 85.0,
    aperture: 'f/4.0',
    sensorHeightMm: 24.0,
    sensorWidthMm: 36.0,
    trailDistanceM: 3.5,
    elevationOffsetM: 0.8,
    focusMode: 'Dynamic distance auto-focus tracking ball center',
  },
  Camera_Landing_Downrange: {
    id: 'Camera_Landing_Downrange',
    focalLengthMm: 135.0,
    aperture: 'f/2.0',
    sensorHeightMm: 24.0,
    sensorWidthMm: 36.0,
    focusMode: 'Continuous predictive focus on turf contact plane',
  },
  Camera_FACS_Closeup: {
    id: 'Camera_FACS_Closeup',
    focalLengthMm: 85.0,
    aperture: 'f/2.0',
    sensorHeightMm: 24.0,
    sensorWidthMm: 36.0,
    focusMode: 'Hero golfer facial AU1–AU26 & ARKit blendshape inspection',
  },
  Camera_Face_On: {
    id: 'Camera_Face_On',
    focalLengthMm: 38.0,
    aperture: 'f/2.8',
    sensorHeightMm: 24.0,
    sensorWidthMm: 36.0,
    focusMode: 'Biomechanical Face-On view matching the 25-frame Nano Banana sequence',
  },
  Camera_Down_The_Line: {
    id: 'Camera_Down_The_Line',
    focalLengthMm: 40.0,
    aperture: 'f/2.8',
    sensorHeightMm: 24.0,
    sensorWidthMm: 36.0,
    focusMode: 'Biomechanical Down-The-Line swing plane inspection view',
  },
});

export const PBR_BOUNDS = Object.freeze({
  DIELECTRIC_MIN_SRGB: 30,
  DIELECTRIC_MAX_SRGB: 240,
  CONDUCTIVE_MIN_SRGB: 180,
  CONDUCTIVE_MAX_SRGB: 255,
  DIELECTRIC_F0: 0.04,
  TITANIUM_SRGB: [205, 200, 194],
  CROWN_CLEARCOAT_ROUGHNESS: 0.032, // alpha_coat = r^2 ~ 0.001
  BALL_ROUGHNESS: 0.12,
  SKIN_SSS_SCALE: 0.015,
});

export const SWING_TIMING = Object.freeze({
  ADDRESS_HOLD_S: 0.06,
  BACKSWING_END_S: 0.86,
  TRANSITION_END_S: 0.96,
  IMPACT_S: 1.14,
  FOLLOW_THROUGH_END_S: 2.15,
  POST_IMPACT_CUT_DELAY_S: 0.14,
  RELOAD_DWELL_S: 2.4,
});

// Complete 52 Apple ARKit-compatible facial blendshape identifiers (Section 2)
export const ARKIT_52_BLENDSHAPES = Object.freeze([
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight', 'tongueOut',
]);

export const SKELETON_BONE_NAMES = Object.freeze([
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3',
  'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3',
  'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3',
  'LeftHandRing1', 'LeftHandRing2', 'LeftHandRing3',
  'LeftHandPinky1', 'LeftHandPinky2', 'LeftHandPinky3',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'RightHandThumb1', 'RightHandThumb2', 'RightHandThumb3',
  'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3',
  'RightHandMiddle1', 'RightHandMiddle2', 'RightHandMiddle3',
  'RightHandRing1', 'RightHandRing2', 'RightHandRing3',
  'RightHandPinky1', 'RightHandPinky2', 'RightHandPinky3',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
  'SOCKET_Driver_Grip',
  'Shaft_Node_0', 'Shaft_Node_1', 'Shaft_Node_2', 'Shaft_Node_3',
]);

export const METERS_TO_YARDS = 1.0936133;
export const MS_TO_MPH = 2.2369363;
export const RPM_TO_RADS = (2 * Math.PI) / 60;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function focalLengthToVerticalFov(focalLengthMm, sensorHeightMm = 24.0) {
  return 2 * Math.atan(sensorHeightMm / (2 * focalLengthMm)) * RAD_TO_DEG;
}

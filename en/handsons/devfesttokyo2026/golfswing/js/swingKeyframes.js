/**
 * 25-Frame Dual-Angle (Nano Banana Face-On + YouTube Shorts V9bs9sVlHZ4 Dual-Angle 3D Mocap)
 * Biomechanical Golf Swing Keyframe Dataset & Spherical/Hermite Spline Solver.
 *
 * Uses direct 3D model-space trajectories (`gripPos`, `shaftDir`, `hipsPos`) with spherical
 * interpolation on the 3D shaft unit vector (`slerpUnit3`) and overshoot-clamped Hermite
 * interpolation on scalars/positions so every single phase matches the real sequence 1-to-1:
 *   1. Address (Frame 01) — wide athletic 48cm stance & 40° forward hip hinge
 *   2. Initial Backswing (Frames 02–04) — BOTH arms straight, low takeaway -> P2 dead-horizontal shaft
 *   3. Wrist Hinge (Frames 05–07) — straight lead arm horizontal, crisp 90° L-position (P3)
 *   4. Top of Backswing (Frames 08–11) — 96° shoulder turn, straight lead arm, shaft parallel behind head
 *   5. Transition (Frames 12–14) — weight shifts to lead foot FIRST, hands drop & club shallows
 *   6. Swing the Club (Frames 15–17) — hips clear open, P6 dead-horizontal delivery shaft -> whip release
 *   7. Strike Position (Frames 18–19) — P7 square impact, posted straight lead leg, right knee driving in
 *   8. Extend Follow-Through (Frames 20–21) — BOTH arms dead straight pointing downrange, club rising +24° -> +56°
 *   9. Club Goes Toward Back (Frames 22–24) — vertical fold -> tips over left shoulder -> drops behind back
 *  10. Finish Position (Frame 25) — tall proud PGA Tour P10 hold on lead leg, trail shoe vertical on toe tip
 */

export const SWING_25_KEYFRAMES = [
  {
    "frame": 1,
    "phaseNum": 1,
    "phase": "Address",
    "label": "01 \u00b7 Address Setup",
    "image": "references/swing_sequence/frame_01.jpg",
    "u": 0.0,
    "pose": {
      "hipsPos": [
        0.0,
        0.872,
        -0.045
      ],
      "pelvisYaw": 0.0,
      "pelvicTiltFwd": 0.26,
      "thoraxYaw": 0.0,
      "spinePitch": 0.28,
      "lateralSideBend": 0.04,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        0.02,
        0.885,
        0.425
      ],
      "shaftDir": [
        0.0,
        -0.8291,
        0.5591
      ],
      "clubFaceRoll": 0.0,
      "shaftLagFlex": 0.0,
      "leadArmMinReach": 0.535,
      "bothArmsStraight": 1.0,
      "leftPole": [
        0.42,
        0.72,
        -0.25
      ],
      "rightPole": [
        -0.44,
        0.68,
        -0.26
      ]
    }
  },
  {
    "frame": 2,
    "phaseNum": 2,
    "phase": "Initial Backswing",
    "label": "02 \u00b7 Early Takeaway (Straight Arms)",
    "image": "references/swing_sequence/frame_02.jpg",
    "u": 0.105,
    "pose": {
      "hipsPos": [
        -0.01,
        0.87,
        -0.045
      ],
      "pelvisYaw": -0.1,
      "pelvicTiltFwd": 0.27,
      "thoraxYaw": -0.24,
      "spinePitch": 0.29,
      "lateralSideBend": 0.02,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.13,
        0.885,
        0.4
      ],
      "shaftDir": [
        -0.4813,
        -0.7119,
        0.5114
      ],
      "clubFaceRoll": -0.04,
      "shaftLagFlex": -0.006,
      "leadArmMinReach": 0.538,
      "bothArmsStraight": 1.0,
      "leftPole": [
        0.42,
        0.76,
        -0.08
      ],
      "rightPole": [
        -0.52,
        0.68,
        -0.18
      ]
    }
  },
  {
    "frame": 3,
    "phaseNum": 2,
    "phase": "Initial Backswing",
    "label": "03 \u00b7 Mid Takeaway (Straight Arms)",
    "image": "references/swing_sequence/frame_03.jpg",
    "u": 0.215,
    "pose": {
      "hipsPos": [
        -0.02,
        0.866,
        -0.046
      ],
      "pelvisYaw": -0.2,
      "pelvicTiltFwd": 0.28,
      "thoraxYaw": -0.48,
      "spinePitch": 0.3,
      "lateralSideBend": -0.01,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.275,
        0.9,
        0.35
      ],
      "shaftDir": [
        -0.8026,
        -0.4013,
        0.4414
      ],
      "clubFaceRoll": -0.08,
      "shaftLagFlex": -0.012,
      "leadArmMinReach": 0.538,
      "bothArmsStraight": 1.0,
      "leftPole": [
        0.36,
        0.82,
        0.12
      ],
      "rightPole": [
        -0.58,
        0.7,
        -0.12
      ]
    }
  },
  {
    "frame": 4,
    "phaseNum": 2,
    "phase": "Initial Backswing",
    "label": "04 \u00b7 P2 Horizontal (Straight Arms)",
    "image": "references/swing_sequence/frame_04.jpg",
    "u": 0.33,
    "pose": {
      "hipsPos": [
        -0.03,
        0.862,
        -0.048
      ],
      "pelvisYaw": -0.3,
      "pelvicTiltFwd": 0.29,
      "thoraxYaw": -0.72,
      "spinePitch": 0.31,
      "lateralSideBend": -0.03,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.395,
        0.935,
        0.285
      ],
      "shaftDir": [
        -0.9833,
        0.0201,
        0.1806
      ],
      "clubFaceRoll": -0.12,
      "shaftLagFlex": -0.018,
      "leadArmMinReach": 0.538,
      "bothArmsStraight": 1.0,
      "leftPole": [
        0.28,
        0.88,
        0.28
      ],
      "rightPole": [
        -0.62,
        0.72,
        -0.06
      ]
    }
  },
  {
    "frame": 5,
    "phaseNum": 3,
    "phase": "Wrist Hinge",
    "label": "05 \u00b7 Wrist Hinge Begins",
    "image": "references/swing_sequence/frame_05.jpg",
    "u": 0.44,
    "pose": {
      "hipsPos": [
        -0.036,
        0.842,
        -0.052
      ],
      "pelvisYaw": -0.4,
      "pelvicTiltFwd": 0.32,
      "thoraxYaw": -0.92,
      "spinePitch": 0.34,
      "lateralSideBend": -0.05,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.465,
        1.045,
        0.215
      ],
      "shaftDir": [
        -0.8223,
        0.5515,
        -0.1404
      ],
      "clubFaceRoll": -0.15,
      "shaftLagFlex": -0.02,
      "leadArmMinReach": 0.534,
      "bothArmsStraight": 0.45,
      "leftPole": [
        0.18,
        0.94,
        0.42
      ],
      "rightPole": [
        -0.62,
        0.72,
        0.02
      ]
    }
  },
  {
    "frame": 6,
    "phaseNum": 3,
    "phase": "Wrist Hinge",
    "label": "06 \u00b7 Mid Wrist Hinge (P3)",
    "image": "references/swing_sequence/frame_06.jpg",
    "u": 0.55,
    "pose": {
      "hipsPos": [
        -0.042,
        0.842,
        -0.05
      ],
      "pelvisYaw": -0.5,
      "pelvicTiltFwd": 0.32,
      "thoraxYaw": -1.1,
      "spinePitch": 0.34,
      "lateralSideBend": -0.06,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.505,
        1.185,
        0.145
      ],
      "shaftDir": [
        -0.4212,
        0.8624,
        -0.2808
      ],
      "clubFaceRoll": -0.18,
      "shaftLagFlex": -0.022,
      "leadArmMinReach": 0.534,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.08,
        0.98,
        0.54
      ],
      "rightPole": [
        -0.6,
        0.72,
        0.06
      ]
    }
  },
  {
    "frame": 7,
    "phaseNum": 3,
    "phase": "Wrist Hinge",
    "label": "07 \u00b7 Full 90\u00b0 L-Position",
    "image": "references/swing_sequence/frame_07.jpg",
    "u": 0.655,
    "pose": {
      "hipsPos": [
        -0.045,
        0.843,
        -0.048
      ],
      "pelvisYaw": -0.58,
      "pelvicTiltFwd": 0.32,
      "thoraxYaw": -1.26,
      "spinePitch": 0.34,
      "lateralSideBend": -0.07,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.51,
        1.32,
        0.085
      ],
      "shaftDir": [
        -0.0602,
        0.9226,
        -0.3811
      ],
      "clubFaceRoll": -0.2,
      "shaftLagFlex": -0.02,
      "leadArmMinReach": 0.534,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.0,
        1.02,
        0.62
      ],
      "rightPole": [
        -0.58,
        0.7,
        0.08
      ]
    }
  },
  {
    "frame": 8,
    "phaseNum": 4,
    "phase": "Top of Backswing",
    "label": "08 \u00b7 Climbing to Shoulder Height",
    "image": "references/swing_sequence/frame_08.jpg",
    "u": 0.76,
    "pose": {
      "hipsPos": [
        -0.046,
        0.845,
        -0.046
      ],
      "pelvisYaw": -0.66,
      "pelvicTiltFwd": 0.31,
      "thoraxYaw": -1.42,
      "spinePitch": 0.34,
      "lateralSideBend": -0.075,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.485,
        1.435,
        0.04
      ],
      "shaftDir": [
        0.4198,
        0.8196,
        -0.3898
      ],
      "clubFaceRoll": -0.21,
      "shaftLagFlex": -0.015,
      "leadArmMinReach": 0.532,
      "bothArmsStraight": 0.0,
      "leftPole": [
        -0.06,
        1.06,
        0.68
      ],
      "rightPole": [
        -0.56,
        0.68,
        0.08
      ]
    }
  },
  {
    "frame": 9,
    "phaseNum": 4,
    "phase": "Top of Backswing",
    "label": "09 \u00b7 Near Top of Backswing",
    "image": "references/swing_sequence/frame_09.jpg",
    "u": 0.855,
    "pose": {
      "hipsPos": [
        -0.046,
        0.847,
        -0.045
      ],
      "pelvisYaw": -0.72,
      "pelvicTiltFwd": 0.31,
      "thoraxYaw": -1.54,
      "spinePitch": 0.34,
      "lateralSideBend": -0.075,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.45,
        1.515,
        0.01
      ],
      "shaftDir": [
        0.7791,
        0.5394,
        -0.3196
      ],
      "clubFaceRoll": -0.22,
      "shaftLagFlex": -0.008,
      "leadArmMinReach": 0.53,
      "bothArmsStraight": 0.0,
      "leftPole": [
        -0.1,
        1.08,
        0.72
      ],
      "rightPole": [
        -0.55,
        0.68,
        0.08
      ]
    }
  },
  {
    "frame": 10,
    "phaseNum": 4,
    "phase": "Top of Backswing",
    "label": "10 \u00b7 Full Top of Backswing (P4)",
    "image": "references/swing_sequence/frame_10.jpg",
    "u": 0.94,
    "pose": {
      "hipsPos": [
        -0.044,
        0.848,
        -0.045
      ],
      "pelvisYaw": -0.76,
      "pelvicTiltFwd": 0.3,
      "thoraxYaw": -1.64,
      "spinePitch": 0.34,
      "lateralSideBend": -0.07,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.42,
        1.555,
        -0.01
      ],
      "shaftDir": [
        0.95,
        0.24,
        -0.2
      ],
      "clubFaceRoll": -0.22,
      "shaftLagFlex": 0.0,
      "leadArmMinReach": 0.528,
      "bothArmsStraight": 0.0,
      "leftPole": [
        -0.12,
        1.1,
        0.74
      ],
      "rightPole": [
        -0.55,
        0.68,
        0.08
      ]
    }
  },
  {
    "frame": 11,
    "phaseNum": 4,
    "phase": "Top of Backswing",
    "label": "11 \u00b7 Peak Coil & Ground Load",
    "image": "references/swing_sequence/frame_11.jpg",
    "u": 1.0,
    "pose": {
      "hipsPos": [
        -0.035,
        0.846,
        -0.045
      ],
      "pelvisYaw": -0.78,
      "pelvicTiltFwd": 0.3,
      "thoraxYaw": -1.68,
      "spinePitch": 0.34,
      "lateralSideBend": -0.065,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.405,
        1.565,
        -0.015
      ],
      "shaftDir": [
        0.9796,
        0.09,
        -0.1799
      ],
      "clubFaceRoll": -0.22,
      "shaftLagFlex": 0.012,
      "leadArmMinReach": 0.528,
      "bothArmsStraight": 0.0,
      "leftPole": [
        -0.12,
        1.1,
        0.74
      ],
      "rightPole": [
        -0.55,
        0.68,
        0.08
      ]
    }
  },
  {
    "frame": 12,
    "phaseNum": 5,
    "phase": "Transition",
    "label": "12 \u00b7 Weight Shifts Lead, Club Falls",
    "image": "references/swing_sequence/frame_12.jpg",
    "u": 1.14,
    "pose": {
      "hipsPos": [
        0.015,
        0.826,
        -0.04
      ],
      "pelvisYaw": -0.52,
      "pelvicTiltFwd": 0.31,
      "thoraxYaw": -1.56,
      "spinePitch": 0.34,
      "lateralSideBend": -0.02,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.425,
        1.43,
        0.025
      ],
      "shaftDir": [
        0.8794,
        0.2998,
        -0.3698
      ],
      "clubFaceRoll": -0.2,
      "shaftLagFlex": 0.055,
      "leadArmMinReach": 0.528,
      "bothArmsStraight": 0.0,
      "leftPole": [
        -0.06,
        1.04,
        0.68
      ],
      "rightPole": [
        -0.54,
        0.66,
        0.12
      ]
    }
  },
  {
    "frame": 13,
    "phaseNum": 5,
    "phase": "Transition",
    "label": "13 \u00b7 Club Slowly Shallows",
    "image": "references/swing_sequence/frame_13.jpg",
    "u": 1.28,
    "pose": {
      "hipsPos": [
        0.052,
        0.818,
        -0.032
      ],
      "pelvisYaw": -0.22,
      "pelvicTiltFwd": 0.32,
      "thoraxYaw": -1.3,
      "spinePitch": 0.34,
      "lateralSideBend": 0.03,
      "trailFootPivot": 0.0,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.445,
        1.285,
        0.085
      ],
      "shaftDir": [
        0.4591,
        0.6986,
        -0.5489
      ],
      "clubFaceRoll": -0.18,
      "shaftLagFlex": 0.085,
      "leadArmMinReach": 0.53,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.04,
        0.96,
        0.56
      ],
      "rightPole": [
        -0.54,
        0.64,
        0.14
      ]
    }
  },
  {
    "frame": 14,
    "phaseNum": 5,
    "phase": "Transition",
    "label": "14 \u00b7 Dropped Into the Slot",
    "image": "references/swing_sequence/frame_14.jpg",
    "u": 1.42,
    "pose": {
      "hipsPos": [
        0.075,
        0.818,
        -0.024
      ],
      "pelvisYaw": 0.08,
      "pelvicTiltFwd": 0.32,
      "thoraxYaw": -0.96,
      "spinePitch": 0.34,
      "lateralSideBend": 0.08,
      "trailFootPivot": 0.04,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.42,
        1.135,
        0.165
      ],
      "shaftDir": [
        -0.3795,
        0.7789,
        -0.4993
      ],
      "clubFaceRoll": -0.14,
      "shaftLagFlex": 0.105,
      "leadArmMinReach": 0.53,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.18,
        0.88,
        0.38
      ],
      "rightPole": [
        -0.56,
        0.62,
        0.1
      ]
    }
  },
  {
    "frame": 15,
    "phaseNum": 6,
    "phase": "Swing the Club",
    "label": "15 \u00b7 Downswing Lag Acceleration",
    "image": "references/swing_sequence/frame_15.jpg",
    "u": 1.56,
    "pose": {
      "hipsPos": [
        0.088,
        0.822,
        -0.018
      ],
      "pelvisYaw": 0.32,
      "pelvicTiltFwd": 0.31,
      "thoraxYaw": -0.58,
      "spinePitch": 0.33,
      "lateralSideBend": 0.12,
      "trailFootPivot": 0.09,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.325,
        0.995,
        0.255
      ],
      "shaftDir": [
        -0.842,
        0.441,
        -0.3107
      ],
      "clubFaceRoll": -0.1,
      "shaftLagFlex": 0.09,
      "leadArmMinReach": 0.532,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.36,
        0.8,
        0.14
      ],
      "rightPole": [
        -0.58,
        0.62,
        0.02
      ]
    }
  },
  {
    "frame": 16,
    "phaseNum": 6,
    "phase": "Swing the Club",
    "label": "16 \u00b7 P6 Delivery (Shaft Horizontal)",
    "image": "references/swing_sequence/frame_16.jpg",
    "u": 1.72,
    "pose": {
      "hipsPos": [
        0.096,
        0.83,
        -0.014
      ],
      "pelvisYaw": 0.52,
      "pelvicTiltFwd": 0.3,
      "thoraxYaw": -0.22,
      "spinePitch": 0.32,
      "lateralSideBend": 0.15,
      "trailFootPivot": 0.16,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.185,
        0.895,
        0.345
      ],
      "shaftDir": [
        -0.9828,
        -0.0401,
        0.1805
      ],
      "clubFaceRoll": -0.05,
      "shaftLagFlex": 0.05,
      "leadArmMinReach": 0.53,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.5,
        0.74,
        -0.08
      ],
      "rightPole": [
        -0.6,
        0.62,
        -0.1
      ]
    }
  },
  {
    "frame": 17,
    "phaseNum": 6,
    "phase": "Swing the Club",
    "label": "17 \u00b7 Pre-Impact Whip Release",
    "image": "references/swing_sequence/frame_17.jpg",
    "u": 1.865,
    "pose": {
      "hipsPos": [
        0.102,
        0.84,
        -0.012
      ],
      "pelvisYaw": 0.62,
      "pelvicTiltFwd": 0.28,
      "thoraxYaw": -0.02,
      "spinePitch": 0.3,
      "lateralSideBend": 0.17,
      "trailFootPivot": 0.24,
      "headLookTarget": 0.0,
      "gripPos": [
        -0.04,
        0.865,
        0.4
      ],
      "shaftDir": [
        -0.6606,
        -0.6006,
        0.4504
      ],
      "clubFaceRoll": -0.02,
      "shaftLagFlex": 0.005,
      "leadArmMinReach": 0.525,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.58,
        0.71,
        -0.18
      ],
      "rightPole": [
        -0.62,
        0.64,
        -0.18
      ]
    }
  },
  {
    "frame": 18,
    "phaseNum": 7,
    "phase": "Strike Position",
    "label": "18 \u00b7 Strike Position / Impact (P7)",
    "image": "references/swing_sequence/frame_18.jpg",
    "u": 2.0,
    "pose": {
      "hipsPos": [
        0.108,
        0.87,
        -0.01
      ],
      "pelvisYaw": 0.7,
      "pelvicTiltFwd": 0.22,
      "thoraxYaw": 0.18,
      "spinePitch": 0.24,
      "lateralSideBend": 0.16,
      "trailFootPivot": 0.32,
      "headLookTarget": 0.0,
      "gripPos": [
        0.075,
        0.885,
        0.42
      ],
      "shaftDir": [
        -0.02,
        -0.8289,
        0.559
      ],
      "clubFaceRoll": 0.0,
      "shaftLagFlex": -0.045,
      "leadArmMinReach": 0.535,
      "bothArmsStraight": 0.45,
      "leftPole": [
        0.42,
        0.72,
        -0.25
      ],
      "rightPole": [
        -0.54,
        0.66,
        -0.22
      ]
    }
  },
  {
    "frame": 19,
    "phaseNum": 7,
    "phase": "Strike Position",
    "label": "19 \u00b7 Post-Impact Separation",
    "image": "references/swing_sequence/frame_19.jpg",
    "u": 2.125,
    "pose": {
      "hipsPos": [
        0.114,
        0.858,
        -0.004
      ],
      "pelvisYaw": 0.88,
      "pelvicTiltFwd": 0.22,
      "thoraxYaw": 0.5,
      "spinePitch": 0.24,
      "lateralSideBend": 0.14,
      "trailFootPivot": 0.48,
      "headLookTarget": 0.12,
      "gripPos": [
        0.275,
        0.935,
        0.355
      ],
      "shaftDir": [
        0.6796,
        -0.5796,
        0.4497
      ],
      "clubFaceRoll": 0.18,
      "shaftLagFlex": -0.03,
      "leadArmMinReach": 0.532,
      "bothArmsStraight": 0.85,
      "leftPole": [
        0.62,
        0.72,
        -0.12
      ],
      "rightPole": [
        -0.48,
        0.72,
        -0.06
      ]
    }
  },
  {
    "frame": 20,
    "phaseNum": 8,
    "phase": "Extend Follow-Through",
    "label": "20 \u00b7 Extend Follow-Through (Both Straight)",
    "image": "references/swing_sequence/frame_20.jpg",
    "u": 2.26,
    "pose": {
      "hipsPos": [
        0.118,
        0.865,
        0.004
      ],
      "pelvisYaw": 1.08,
      "pelvicTiltFwd": 0.16,
      "thoraxYaw": 0.88,
      "spinePitch": 0.18,
      "lateralSideBend": 0.09,
      "trailFootPivot": 0.68,
      "headLookTarget": 0.45,
      "gripPos": [
        0.445,
        1.135,
        0.235
      ],
      "shaftDir": [
        0.901,
        0.4105,
        0.1402
      ],
      "clubFaceRoll": 0.38,
      "shaftLagFlex": -0.014,
      "leadArmMinReach": 0.536,
      "bothArmsStraight": 1.0,
      "leftPole": [
        0.6,
        0.78,
        0.02
      ],
      "rightPole": [
        -0.28,
        0.84,
        0.22
      ]
    }
  },
  {
    "frame": 21,
    "phaseNum": 8,
    "phase": "Extend Follow-Through",
    "label": "21 \u00b7 High Extension (Both Straight)",
    "image": "references/swing_sequence/frame_21.jpg",
    "u": 2.4,
    "pose": {
      "hipsPos": [
        0.122,
        0.872,
        0.01
      ],
      "pelvisYaw": 1.26,
      "pelvicTiltFwd": 0.11,
      "thoraxYaw": 1.2,
      "spinePitch": 0.1,
      "lateralSideBend": 0.05,
      "trailFootPivot": 0.82,
      "headLookTarget": 0.78,
      "gripPos": [
        0.46,
        1.355,
        0.095
      ],
      "shaftDir": [
        0.541,
        0.8215,
        -0.1803
      ],
      "clubFaceRoll": 0.5,
      "shaftLagFlex": -0.004,
      "leadArmMinReach": 0.536,
      "bothArmsStraight": 1.0,
      "leftPole": [
        0.56,
        0.86,
        0.16
      ],
      "rightPole": [
        -0.08,
        0.96,
        0.48
      ]
    }
  },
  {
    "frame": 22,
    "phaseNum": 9,
    "phase": "Club Toward Back",
    "label": "22 \u00b7 Club Rises Vertical",
    "image": "references/swing_sequence/frame_22.jpg",
    "u": 2.55,
    "pose": {
      "hipsPos": [
        0.124,
        0.875,
        0.015
      ],
      "pelvisYaw": 1.38,
      "pelvicTiltFwd": 0.07,
      "thoraxYaw": 1.44,
      "spinePitch": 0.04,
      "lateralSideBend": 0.02,
      "trailFootPivot": 0.9,
      "headLookTarget": 0.94,
      "gripPos": [
        0.425,
        1.515,
        -0.01
      ],
      "shaftDir": [
        0.0402,
        0.9644,
        -0.2612
      ],
      "clubFaceRoll": 0.56,
      "shaftLagFlex": 0.0,
      "leadArmMinReach": 0.45,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.54,
        0.94,
        0.24
      ],
      "rightPole": [
        0.08,
        1.04,
        0.64
      ]
    }
  },
  {
    "frame": 23,
    "phaseNum": 9,
    "phase": "Club Toward Back",
    "label": "23 \u00b7 Club Over Left Shoulder",
    "image": "references/swing_sequence/frame_23.jpg",
    "u": 2.71,
    "pose": {
      "hipsPos": [
        0.125,
        0.877,
        0.018
      ],
      "pelvisYaw": 1.46,
      "pelvicTiltFwd": 0.04,
      "thoraxYaw": 1.6,
      "spinePitch": -0.01,
      "lateralSideBend": 0.01,
      "trailFootPivot": 0.95,
      "headLookTarget": 0.98,
      "gripPos": [
        0.355,
        1.615,
        -0.045
      ],
      "shaftDir": [
        -0.8834,
        0.3413,
        -0.3212
      ],
      "clubFaceRoll": 0.58,
      "shaftLagFlex": 0.0,
      "leadArmMinReach": 0.38,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.52,
        0.96,
        0.28
      ],
      "rightPole": [
        0.18,
        1.08,
        0.72
      ]
    }
  },
  {
    "frame": 24,
    "phaseNum": 9,
    "phase": "Club Toward Back",
    "label": "24 \u00b7 Club Wraps Behind Back",
    "image": "references/swing_sequence/frame_24.jpg",
    "u": 2.86,
    "pose": {
      "hipsPos": [
        0.126,
        0.878,
        0.02
      ],
      "pelvisYaw": 1.51,
      "pelvicTiltFwd": 0.03,
      "thoraxYaw": 1.7,
      "spinePitch": -0.04,
      "lateralSideBend": 0.0,
      "trailFootPivot": 0.98,
      "headLookTarget": 1.0,
      "gripPos": [
        0.295,
        1.6,
        -0.06
      ],
      "shaftDir": [
        -0.8636,
        -0.3615,
        -0.3515
      ],
      "clubFaceRoll": 0.58,
      "shaftLagFlex": 0.0,
      "leadArmMinReach": 0.34,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.5,
        0.96,
        0.3
      ],
      "rightPole": [
        0.22,
        1.1,
        0.76
      ]
    }
  },
  {
    "frame": 25,
    "phaseNum": 10,
    "phase": "Finish Position",
    "label": "25 \u00b7 Balanced Tour Finish (P10)",
    "image": "references/swing_sequence/frame_25.jpg",
    "u": 3.0,
    "pose": {
      "hipsPos": [
        0.126,
        0.879,
        0.022
      ],
      "pelvisYaw": 1.54,
      "pelvicTiltFwd": 0.02,
      "thoraxYaw": 1.76,
      "spinePitch": -0.06,
      "lateralSideBend": 0.0,
      "trailFootPivot": 1.0,
      "headLookTarget": 1.0,
      "gripPos": [
        0.27,
        1.585,
        -0.068
      ],
      "shaftDir": [
        -0.8393,
        -0.4396,
        -0.3197
      ],
      "clubFaceRoll": 0.58,
      "shaftLagFlex": 0.0,
      "leadArmMinReach": 0.32,
      "bothArmsStraight": 0.0,
      "leftPole": [
        0.5,
        0.96,
        0.3
      ],
      "rightPole": [
        0.24,
        1.1,
        0.78
      ]
    }
  }
];

const SCALAR_KEYS = [
  'pelvisYaw',
  'pelvicTiltFwd',
  'thoraxYaw',
  'spinePitch',
  'lateralSideBend',
  'trailFootPivot',
  'headLookTarget',
  'clubFaceRoll',
  'shaftLagFlex',
  'leadArmMinReach',
  'bothArmsStraight',
];

const VEC3_KEYS = ['hipsPos', 'gripPos', 'leftPole', 'rightPole'];

function catmullRomClamped(p0, p1, p2, p3, t) {
  const d01 = p1 - p0;
  const d12 = p2 - p1;
  const d23 = p3 - p2;
  let m1 = 0.5 * (p2 - p0);
  let m2 = 0.5 * (p3 - p1);
  if (d01 * d12 <= 0) m1 = 0;
  if (d12 * d23 <= 0) m2 = 0;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p1 +
    (t3 - 2 * t2 + t) * m1 +
    (-2 * t3 + 3 * t2) * p2 +
    (t3 - t2) * m2
  );
}

/**
 * Great-circle spherical linear interpolation between two 3D unit vectors so the golf club
 * sweeps smoothly along a constant-length circular arc between every pair of keyframes.
 */
function slerpUnit3(a, b, t) {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  if (dot > 0.9995) {
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  }
  const theta = Math.acos(dot);
  const sinT = Math.sin(theta) || 1e-6;
  const w0 = Math.sin((1 - t) * theta) / sinT;
  const w1 = Math.sin(t * theta) / sinT;
  const x = w0 * a[0] + w1 * b[0];
  const y = w0 * a[1] + w1 * b[1];
  const z = w0 * a[2] + w1 * b[2];
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

export function evaluate25FrameSwingSpline(uRaw) {
  const frames = SWING_25_KEYFRAMES;
  const n = frames.length;
  const u = Math.max(0.0, Math.min(3.0, uRaw));

  let idx = 0;
  while (idx < n - 2 && u > frames[idx + 1].u) {
    idx++;
  }

  const f0 = frames[Math.max(0, idx - 1)];
  const f1 = frames[idx];
  const f2 = frames[Math.min(n - 1, idx + 1)];
  const f3 = frames[Math.min(n - 1, idx + 2)];

  const span = Math.max(1e-6, f2.u - f1.u);
  const t = Math.max(0, Math.min(1, (u - f1.u) / span));

  const out = {
    frameNumber: Math.round(f1.frame + (f2.frame - f1.frame) * t),
    phaseNum: t < 0.5 ? f1.phaseNum : f2.phaseNum,
    phase: t < 0.5 ? f1.phase : f2.phase,
    label: t < 0.5 ? f1.label : f2.label,
    shaftDir: slerpUnit3(f1.pose.shaftDir, f2.pose.shaftDir, t),
  };

  for (const key of SCALAR_KEYS) {
    out[key] = catmullRomClamped(f0.pose[key], f1.pose[key], f2.pose[key], f3.pose[key], t);
  }

  for (const key of VEC3_KEYS) {
    out[key] = [
      catmullRomClamped(f0.pose[key][0], f1.pose[key][0], f2.pose[key][0], f3.pose[key][0], t),
      catmullRomClamped(f0.pose[key][1], f1.pose[key][1], f2.pose[key][1], f3.pose[key][1], t),
      catmullRomClamped(f0.pose[key][2], f1.pose[key][2], f2.pose[key][2], f3.pose[key][2], t),
    ];
  }

  return out;
}

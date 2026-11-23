# Technical Architecture and System Specification: Photorealistic Golf Driving Simulator (`golfswing.md`)

> **Single-Shot Build Directive**: This specification is a complete, self-contained engineering blueprint for building **GolfSwing Studio** in one pass with zero geometric, coordinate, shading, or swing-mechanics defects. All coordinate conventions, `.glb` mesh tolerances, Nano Banana PBR asset rules, 25-frame Dual-Angle 3D mocap keyframes, IK constraints, camera rigs, modern HTML5/CSS UI primitives, and headless verification gates below are normative.

---

## 1. System Overview, Web Runtime Stack, and Core Game Loop Architecture

This technical specification establishes the architectural, mathematical, and algorithmic requirements for implementing a real-time, photorealistic golf driving simulation (**GolfSwing Studio**). Designed as a dedicated driving experience, the application restricts gameplay exclusively to tee shots, prioritizing extreme fidelity in visual rendering, biomechanical swing dynamics, and aerodynamic flight physics. The gameplay loop operates as an automated, deterministic finite-state machine that guarantees seamless transitions from player address to high-velocity kinetic swing execution, camera perspective switching, ball tracking across a photorealistic fairway, landing restitution, and an instantaneous reload sequence back to the tee box.

### 1.1 Target Web Runtime Stack

* **Web Server**: Minimal Python 3 **Flask** HTTP server (port `8080`, `host="0.0.0.0"`) serving the web entry point, ES modules, and static assets over HTTP, with an explicit `/favicon.ico` (`204 No Content`) route so ES modules load cleanly with zero CORS or 404 console errors.
* **3D Engine & Rendering**: Vanilla ES Modules **Three.js `0.170.0`** configured via an HTML `<script type="importmap">` mapping both core Three.js and its official addons (`GLTFLoader`). WebGL2 renderer configured with `THREE.ACESFilmicToneMapping`, `THREE.PCFSoftShadowMap`, `THREE.SRGBColorSpace` output, and physical directional solar + hemisphere + PMREM HDRI sky lighting.
* **Offline Asset Generation Tooling**: Python 3 (`numpy`, `scipy`, `trimesh`, `Pillow`) for parametric `.glb` character/driver mesh export and 25-frame spline generation, paired with **Nano Banana** image generation for seamless PBR textures and sequential swing reference art.
* **Project Organization**: The implementation may freely choose its own directory hierarchy, module boundaries, and filenames to cleanly separate server routing, UI markup/styles, simulation subsystems, 3D models, textures, and asset build scripts.

### 1.2 World & Character Coordinate Systems (Critical Single-Shot Convention)

Every geometric defect in 3D golf simulations stems from mismatched world vs. character axes. All modules MUST strictly obey these three coordinate spaces:

1. **World Space (`THREE.Scene`)**: Right-handed, meters, `+Y` up.
   * **Golf Ball on Wooden Tee**: `(0.0, 0.055, 0.0)` (`PHYSICS.TEE_HEIGHT = 0.055 m`).
   * **Downrange Target / Fairway Centerline**: `-Z` axis (`0` to `-420 m`).
   * **Right of Target (Fade/Slice side)**: `+X` axis.
   * **Golfer Root Placement**: `Character_Hero_Golfer` sits at `(-0.84, 0.0, +0.04)`.
2. **`.glb` Authoring Space (`golfer.glb`, `golf_club.glb`)**: Right-handed, meters, `+Y` up, character facing **`+Z`** (Three.js native glTF standard), shoe soles resting strictly at **`Y = 0.000 m`**, left side along `+X`, right side along `-X`.
3. **Golfer `stancePivot` Model Space**: `stancePivot` is mounted inside `Character_Hero_Golfer` with **`stancePivot.rotation.y = +π/2` (`+90°`)**. Therefore, inside `stancePivot`:
   * **`+Z_model`** → `+X_world` (forward toward the golf ball, located at `ballModel = (+0.04, 0.055, +0.84)`).
   * **`+X_model`** → `-Z_world` (**downrange target / lead left side**).
   * **`-X_model`** → `+Z_world` (**away from target / backswing / trail right side**).
   * **`+Y_model`** → `+Y_world` (vertical up).

### 1.3 Core 6-Phase Gameplay Loop & 5-State Deterministic FSM

The runtime state machine governs each phase of the interactive loop through six discrete operational phases mapped onto five canonical FSM states:

1. **Tee Address State**: The golfer asset is instantiated on the tee box in a balanced `47 cm` wide athletic address posture. The driver head is aligned millimeter-precise (`~3.42 cm`) behind the golf ball resting on a regulation wooden tee. Ambient environmental wind parameters and lighting are evaluated, and interactive pointer orbit/zoom is enabled for material and rig inspection.
2. **Swing Initiation State**: Upon user assertion of the `DRIVE` button or `Space` hotkey (1-click **Deterministic Pro** mode by default, or optional **Skill Timing Meter**), input processing initiates the kinetic swing sequence.
3. **Kinetic Execution and Impact State**: The character rig executes the 25-frame Dual-Angle biomechanical sequence (Address → Straight-Arm Takeaway → Wrist Hinge → Top of Backswing → Weight-Shift Shallowing Transition → P6 Delivery → P7 Impact → Straight-Arm Extension → Wrap → P10 Finish). At `SWING_TIMING.IMPACT_S = 1.14 s`, instantaneous momentum transfer calculates ball launch vectors, spin rates, and launch angles while triggering driver shaft vibration, wooden tee kick physics, impact audio, 4-sample temporal clubhead motion blur, camera impulse shake, and FACS facial exertion expressions.
4. **Ball Flight Tracking State**: Following a `0.14 s` post-impact dwell (`POST_IMPACT_CUT_DELAY_S`), the viewpoint transitions to the dynamic ball-tracking chase camera (`Camera_Flight_Chase`) while the ball travels through 3D airspace governed by gravity, Reynolds drag, Magnus lift, altitude-scaled wind, and exponential spin decay.
5. **Landing and Rollout State**: As the ball descends below `14.0 m` altitude (`flightTime > 1.6 s`, `vy < -2.5 m/s`), the camera switches to the downrange telephoto perspective (`Camera_Landing_Downrange`). The physics engine evaluates surface-classified ground restitution (Fairway, Rough, Bunker, Green), turf friction, turf/sand impact particles, and rolling deceleration until `‖v‖ < 0.05 m/s`.
6. **Reload and Tee Reset State**: Following a `2.4 s` post-landing dwell period (`RELOAD_DWELL_S`) displaying the shot summary banner, the scene executes a non-destructive OpenUSD stage reload back to `STATE_TEE_ADDRESS` without scene latency or memory reallocation.

| State Identifier | Entry Condition | Primary Operational Process | Exit Trigger Condition | Active Camera Delegate |
| :--- | :--- | :--- | :--- | :--- |
| **STATE_TEE_ADDRESS** | Scene load or reload signal | Input polling, wind evaluation, idle breathing, optional orbit & 25-Frame Ref pose scrub | Player activates `DRIVE` / `Space` | `Camera_Address_Tee` |
| **STATE_SWING_EXECUTION** | Swing trigger event | 25-frame Dual-Angle mocap spline, Leg/Arm IK, RBF PSD, FEM muscle telemetry, FACS AU1–AU26 | Clubface reaches `IMPACT_S` + `POST_IMPACT_CUT_DELAY_S` | `Camera_Address_Tee` (Dynamic Pull-In + `0.02 m` Shake) |
| **STATE_BALL_FLIGHT** | Impact calculation complete | 240Hz RK4 aerodynamic integration (Gravity, Reynolds Drag, Magnus Lift, Wind) | Ball altitude reaches terrain heightfield (`y <= y_turf`) | `Camera_Flight_Chase` → `Camera_Landing_Downrange` on descent |
| **STATE_LANDING_ROLLOUT** | Turf contact detected | Surface-classified impulse restitution, tangential kinetic friction, rolling deceleration | Linear velocity `‖v‖ < 0.05 m/s` | `Camera_Landing_Downrange` |
| **STATE_RELOAD_RESET** | Ball kinetic rest confirmed | Result banner dwell (`2.4 s`), transform cache flush, USD layer reload counter increment | Dwell complete or manual `Reset Tee` | Instantaneous Cut to `Camera_Address_Tee` |

---

## 2. Biomechanical Golfer Architecture, `.glb` Asset Pipeline & 25-Frame Dual-Angle Swing Dynamics

### 2.1 Kinematic Chain & Standardized Armature Hierarchy

The hero golfer conforms to a 57-bone standardized skeletal registry (`SKELETON_BONE_NAMES` in `js/constants.js`): `Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `LeftShoulder`/`RightShoulder`, `LeftArm`/`RightArm`, `LeftForeArm`/`RightForeArm`, `LeftHand`/`RightHand` with complete three-bone chains for all five digits, `LeftUpLeg`/`RightUpLeg`, `LeftLeg`/`RightLeg`, `LeftFoot`/`RightFoot`, `LeftToeBase`/`RightToeBase`, `SOCKET_Driver_Grip`, and four articulated shaft nodes (`Shaft_Node_0`–`Shaft_Node_3`).

### 2.2 4-Step Hero Character (`golfer.glb`) & Driver (`golf_club.glb`) Modeling Pipeline

To guarantee clean organic silhouettes with zero detached neck gaps, zero stacked torso/hip primitive seams, proper human facial realism, and authentic grip alignment in a single shot, build the character and club strictly via this 4-step pipeline:

#### Step 1 — Nano Banana Reference & Seamless PBR Texture Generation
Generate square `1024×1024` `.png` albedo maps saved to `textures/` using **Nano Banana** with the mandatory prompting rule: **`"flat, top-down, evenly lit, seamless texture, no shadows"`** (so textures wrap cleanly without baked-in lighting or seam banding):
* `polo_albedo.png` — breathable white pique knit golf polo fabric.
* `slacks_albedo.png` — charcoal chino/twill woven trouser fabric.
* `glove_albedo.png` — perforated white Cabretta leather tour glove texture.
* `cap_logo.png` — custom crossed-clubs golf emblem centered on dark charcoal twill.
* `head_albedo.png` (and `golfer_face_uv.jpg` / `golfer_face_normal.jpg`) — seamless 360° cylindrical human head/face unwrap (eyes, eyebrows, nose, mouth, ears, short hair) color-matched to `skin_albedo.png`.
* `skin_albedo.png` — smooth color-matched forearm/hand skin epidermis.

#### Step 2 — Python `trimesh` + `scipy` PCHIP `.glb` Mesh Builder (`scripts/build_golfer_glb.py`)
Construct watertight, smoothly lofted anatomical meshes using `scipy.interpolate.PchipInterpolator` (`build_lofted_tube`), duplicating the cylindrical UV seam column (`cols = n_seg + 1`) so UVs wrap cleanly without seam stretching, and repairing winding via `trimesh.repair.fix_normals`. Bind all textures via `trimesh.visual.TextureVisuals` + `PBRMaterial`.

* **`models/golfer.glb` Requirements & Exact Bone Dimensions**:
  * **Pose & Scale**: Symmetrical A-Pose (`36°` outward arm abduction), meters, `Y-up`, facing `+Z`.
  * **Hard Build Assertions**: Total height strictly **`1.75 m ≤ height ≤ 1.80 m`** (target `1.7828 m`), shoe soles strictly at **`Y = 0.000 m`** (`|minY| < 1e-4`), total triangle count strictly **`15,000 ≤ tris ≤ 35,000`** (target `~28,962` tris).
  * **Hierarchical Node Graph & Exact Segment Lengths** (required for exact IK alignment):
    * `hips` at `(0, 0.900, 0)` → children: `legs_slacks`, `belt_leather`, `spine`, `left_hip`, `right_hip`.
    * `left_hip` / `right_hip` at `(±0.095, -0.035, 0)` → `thigh_slacks`, child `*_knee` at `(0, -0.390, 0)` → `shin_slacks`, child `*_ankle` at `(0, -0.395, 0)` → `shoes` / `right_shoe` + `*_shoe_sole` (sole bottom reaches exact `Y = 0.000 m`).
    * `spine` at `(0, +0.105, 0)` relative to `hips` (`Y = 1.005 m`) → unified `torso_polo` with folded 3D polo collar & closed interior neck seal (zero collar-to-neck gap!), children `neck`, `left_shoulder`, `right_shoulder`.
    * `neck` at `(0, +0.485, +0.004)` relative to `spine` (`Y = 1.490 m`) → unified sculpted Loomis anatomical `head`+neck bust (`head_albedo.png`) + snug tour golf `cap` with curved visor & front `cap_logo.png`.
    * `left_shoulder` / `right_shoulder` at `(±0.172, +0.418, +0.004)` relative to `spine`, rotated `±36°` around `Z` → `*_sleeve_polo`, `*_upper_arm`, child `*_elbow` at `(0, -0.285, 0)` → `*_forearm`, child `*_wrist` at `(0, -0.265, 0)` → `left_glove` (gloved hand) / `right_hand` (bare skin hand) sculpted around a **24° diagonal PGA Tour Vardon overlapping grip axis** (pinky at butt side, index at clubhead side, curled fingers + dorsal thumb).
    * `club_grip_socket` child of `left_wrist` at local **`(-0.014, -0.056, +0.012)`**.
  * **Mandatory Named Sub-Meshes**: Must include `head`, `torso_polo`, `legs_slacks`, `left_glove`, `right_hand`, `cap`, `shoes` (21 total sub-meshes).
* **`models/golf_club.glb` Requirements**:
  * **Origin `(0, 0, 0)` strictly at the grip center** (butt cap at `+0.062 m`, grip lower edge `-0.155 m` so only `~1 cm` of butt cap extends above the gloved heel pad).
  * **Tapered Graphite Shaft**: `y = -1.035 m` to `-0.155 m`.
  * **460cc Forged Titanium / Carbon-Crown Driver Head**: Positioned at shaft tip `(0, -1.035, 0)`, **counter-rotated `-34°` around `Z`** (`56°` regulation tour driver lie angle) so the soleplate sits dead-flat on the tee ground at address, with a flat `10.5°` lofted CNC-milled hitting face whose sweet spot sits at exact local coordinate **`DRIVER_FACE_LOCAL_IN_HEAD = (0.0464, -1.0663, -0.004)`**.

#### Step 3 — Three.js `GLTFLoader` Runtime Ingestion & Normal Smoothing (`js/golfer.js`)
* Load `models/golfer.glb` and `models/golf_club.glb` asynchronously via `GLTFLoader`.
* **CRITICAL Smooth-Normal Rule**: `trimesh` glTF export omits per-vertex `NORMAL` attributes, causing Three.js `GLTFLoader` to default to faceted `flatShading = true`. Every loaded mesh MUST run a position-welded smooth normal solver (`_computeSmoothNormalsByPosition`, averaging face normals across coincident vertices where `n0 · n > 0.05` to preserve crisp collar/brim creases while smoothing skin/fabric across UV seams) AND explicitly set `material.flatShading = false`.
* **Color Space & Shadow Enforcement**: Explicitly set `map.colorSpace = THREE.SRGBColorSpace` and `anisotropy = 8` on all albedo maps (`wrapT = THREE.ClampToEdgeWrapping` on `head` and `cap`, `THREE.RepeatWrapping` on tileable fabrics), enable `castShadow = true` and `receiveShadow = true` on all sub-meshes, upgrade `club_head_crown` and `club_head_titanium` to `THREE.MeshPhysicalMaterial` (clearcoat + forged titanium face maps), and attach `clubScene` directly as a child of `club_grip_socket`.
* **Runtime GLB Validation Log**: Measure the unmodified A-pose `THREE.Box3` immediately after load and log `[GLB Validation]` (height, sole `minY`, triangle counts, sub-mesh list, and `clubAttachedToHand: true`).

---

### 2.3 25-Frame Dual-Angle 3D Motion-Capture Swing Architecture

#### Critical Anti-Patterns to AVOID (Learned Engineering Guardrails)
1. **NEVER drive the golf swing from a single-plane polar angle (`hub + armAngle`)**: Single-plane polar swings produce downward-pointing clubs on P2 takeaway and P8 follow-through, collapse the lead elbow during transition, and leave the driver sticking upward at Finish instead of draped downward behind the back.
2. **NEVER compute the backswing direction via `planeNormal × planeDown`**: In `stancePivot` coordinates, that cross product points toward `+X_model` (`-Z_world` downrange) and causes the golfer to backswing forward toward the target! Backswing away from target is strictly **`-X_model`** (`+Z_world`).
3. **NEVER construct the clubface basis via `yClub × (-1, 0, 0)`**: That vector becomes collinear whenever the shaft passes horizontal (P2 takeaway, P4 top, P6 delivery, P8 follow-through), causing violent 180° clubhead and wrist gimbal flips.
4. **NEVER animate the legs with raw Euler angles**: Without foot-pinned 2-bone Leg IK, the stance collapses to the narrow `19 cm` A-pose hip width and feet slide/float during hip turn and weight shift.

#### Reference Sources & 25-Frame Keyframe Generator (`scripts/build_swing_sequence.py` → `js/swingKeyframes.js`)
Generate 25 sequential Face-On studio photographs (`references/swing_sequence/frame_01.jpg`–`frame_25.jpg`, `600×800`, plus labeled 5×5 contact sheet `swing_sequence_25_sheet.png`) using Nano Banana featuring the exact remodeled golfer character across all **10 biomechanical phases**, and cross-calibrate every 3D coordinate against Dual-Angle (Face-On + Down-The-Line) 3D motion-capture mechanics (reference benchmark: synchronized split-screen 3D motion swing `https://www.youtube.com/shorts/V9bs9sVlHZ4`).

Each keyframe `i ∈ [1..25]` is parameterized along normalized swing progress **`u ∈ [0.0, 3.0]`** (`0.0 = Address`, `1.0 = Top of Backswing (P4)`, `2.0 = Strike/Impact (P7)`, `3.0 = Balanced Finish (P10)`) and stores direct 3D model-space targets in `stancePivot`:
* `hipsPos: [x, y, z]` — 3D pelvis translation (lateral weight shift `+X` onto lead foot, athletic transition squat drop, upward extension into finish).
* `pelvisYaw`, `pelvicTiltFwd`, `thoraxYaw`, `spinePitch`, `lateralSideBend` — pelvis/thorax X-factor coil and spine inclination.
* `trailFootPivot` (`0.0` = planted flat, `1.0` = vertical toe-tip pivot at P10 finish) and `headLookTarget` (`0.0` = locked on ball, `1.0` = watching drive downrange).
* `gripPos: [x, y, z]` — direct 3D hands path in `stancePivot`.
* `shaftDir: [sx, sy, sz]` — unit vector pointing from grip toward clubhead, interpolated exclusively via **great-circle spherical linear interpolation (`slerpUnit3`)** so the club sweeps smoothly along a constant-length circular arc between every pair of frames.
* `clubFaceRoll`, `shaftLagFlex`, `leadArmMinReach`, `bothArmsStraight`, and anatomical elbow IK poles `leftPole: [x, y, z]`, `rightPole: [x, y, z]`.
* Scalar and position channels use **overshoot-clamped Catmull-Rom Hermite interpolation** (`catmullRomClamped`, zeroing tangents at local extrema so frames never oscillate or overshoot).

#### Exact Swing Timing Schedule (`SWING_TIMING` in `js/constants.js`)

| Constant | Value (s) | Mapped Progress `u` | Phase Role |
| :--- | :---: | :---: | :--- |
| `ADDRESS_HOLD_S` | `0.06` | `0.00` | Settled address pause prior to takeaway |
| `BACKSWING_END_S` | `0.86` | `0.00 → 1.00` | Smooth one-piece straight-arm takeaway → 90° hinge → P4 peak coil |
| `TRANSITION_END_S` | `0.96` | `1.00 → 1.38` | Dedicated kinematic transition: lead-foot weight shift while club slowly shallows/drops |
| `IMPACT_S` | `1.14` | `1.38 → 2.00` | Accelerating downswing lag delivery through P6 horizontal to P7 square impact |
| `FOLLOW_THROUGH_END_S` | `2.15` | `2.00 → 3.00` | Straight-arm P8 extension → vertical rise → wrap behind back → P10 hold |
| `POST_IMPACT_CUT_DELAY_S` | `0.14` | — | Delay before cutting from `Camera_Address_Tee` to `Camera_Flight_Chase` |
| `RELOAD_DWELL_S` | `2.40` | — | Post-landing summary dwell before non-destructive tee reset |

#### 10-Phase Dual-Angle Reference Checkpoint Matrix (Verified Model & World Coordinates)

| Phase & Frame | `u` | `hipsPos` (model) | `pelvisYaw` / `thoraxYaw` | `gripPos` (model) | `shaftDir` (unit) | `bothArmsStraight` | Verified World Clubhead `[x, y, z]` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. F01 Address** | `0.000` | `[0.000, 0.872, -0.045]` | `0.00 / 0.00` | `[0.020, 0.885, 0.425]` | `[0.000, -0.829, +0.559]` | `1.00` | `[-0.000, 0.043, +0.032]` (`3.42 cm` from ball) |
| **2. F04 P2 Straight Takeaway** | `0.330` | `[-0.030, 0.862, -0.048]` | `-0.30 / -0.72` | `[-0.395, 0.935, 0.285]` | `[-0.983, +0.020, +0.181]` | `1.00` | `[-0.317, 0.938, +1.511]` (dead horizontal) |
| **3. F07 90° Wrist Hinge (P3)** | `0.655` | `[-0.045, 0.843, -0.048]` | `-0.58 / -1.26` | `[-0.510, 1.320, 0.085]` | `[-0.060, +0.923, -0.381]` | `0.00` | `[-1.208, 2.358, +0.746]` (crisp L-position) |
| **4. F11 Top of Backswing (P4)** | `1.000` | `[-0.035, 0.846, -0.045]` | `-0.78 / -1.68` | `[-0.405, 1.565, -0.015]` | `[+0.980, +0.090, -0.180]` | `0.00` | `[-1.062, 1.759, -0.580]` (parallel downrange) |
| **5. F13 Transition Shallowing** | `1.280` | `[+0.052, 0.818, -0.032]` | `-0.22 / -1.30` | `[-0.445, 1.285, 0.085]` | `[+0.459, +0.699, -0.549]` | `0.00` | `[-1.347, 2.056, +0.050]` (drops into slot) |
| **6. F16 P6 Horizontal Delivery** | `1.720` | `[+0.096, 0.830, -0.014]` | `+0.52 / -0.22` | `[-0.185, 0.895, 0.345]` | `[-0.983, -0.040, +0.181]` | `0.00` | `[-0.275, 0.898, +1.263]` (shaft horizontal) |
| **7. F18 Strike / Impact (P7)** | `2.000` | `[+0.108, 0.870, -0.010]` | `+0.70 / +0.18` | `[+0.075, 0.885, 0.420]` | `[-0.020, -0.829, +0.559]` | `0.45` | `[-0.000, 0.043, +0.032]` (square strike) |
| **8. F20 P8 Straight Extension** | `2.260` | `[+0.118, 0.865, +0.004]` | `+1.08 / +0.88` | `[+0.445, 1.135, 0.235]` | `[+0.901, +0.410, +0.140]` | `1.00` | `[-0.295, 1.477, -1.405]` (both arms straight) |
| **9. F22 Vertical Wrap-Up** | `2.550` | `[+0.124, 0.875, +0.015]` | `+1.38 / +1.44` | `[+0.425, 1.515, -0.010]` | `[+0.040, +0.964, -0.261]` | `0.00` | `[-1.093, 2.554, -0.399]` (vertical rise) |
| **10. F25 Balanced Finish (P10)** | `3.000` | `[+0.126, 0.879, +0.022]` | `+1.54 / +1.76` | `[+0.270, 1.585, -0.068]` | `[-0.840, -0.440, -0.320]` | `0.00` | `[-1.205, 1.107, +0.677]` (draped behind back) |

#### Four Mandatory Runtime Biomechanical Solver Constraints (`js/golfer.js`)

1. **Analytical 2-Bone Foot-Pinned Leg IK (`_solveLegQuaternionIK`, `L1 = 0.390 m`, `L2 = 0.395 m`)**:
   * **Wide `47 cm` Athletic Stance**: Lead left ankle pinned strictly flat at `(+0.235, 0.080, 0.000)` with `0.22 rad` (`~13°`) outward athletic flare and knee pole `(0.25, 0.44, 0.56)` — zero foot sliding across all 25 frames.
   * **Trail Foot Toe-Tip Pivot**: Right foot remains flat at `(-0.235, 0.080, 0.000)` through backswing and transition, then pivots strictly around its planted toe tip `rightToePinModel = (-0.235, 0.000, +0.165)` via `toePitch = trailFootPivot * 1.16`, `footYawIn = -0.08 + trailFootPivot * 0.72`, `footRollIn = -trailFootPivot * 0.16`, computing `rightAnkleModel = rightToePinModel - R(rightFootQuat) * (0, -0.080, +0.165)` while driving the trail knee pole inward `(-0.22 + trailFootPivot * 0.36, 0.44, 0.56 - trailFootPivot * 0.18)`.
2. **Physiological Straight-Arm Reach Enforcement**:
   * Compute rotated `left_shoulder` and `right_shoulder` world positions transformed back into `stancePivot` model space.
   * Enforce `targetMinL = min(0.558, leadArmMinReach + 0.024)` and `maxArmReach = 0.568 m` on `gripModel` relative to `shLeftModel` so the lead left arm stays taut from Address through Impact without over-stretching.
   * Whenever `bothArmsStraight > 0.5` (Frames `01–04` and `19–21`), push `gripModel` outward along `normalize(gripModel - shMid)` whenever `‖gripModel - shRightModel‖ < 0.528 m`, then re-clamp against `maxArmReach` so both arms lock authentically straight at P2 Takeaway and P8 Follow-Through Extension.
3. **Singularity-Free Club & 24° Vardon Wrist Basis**:
   * Define `planeDown = (0, -cos(34°), sin(34°))`, `planeTarget = (1, 0, 0)`, and **`planeNormal = planeDown × planeTarget = (0, +0.559, +0.829)`**. Because `|planeNormal · yClub| ≤ 0.52` across all 25 frames, projecting `xClubBase = normalize(planeNormal - (planeNormal · yClub) * yClub)` and applying `clubFaceRoll` around `yClub = -shaftDownDir` is guaranteed 100% gimbal-singularity-free.
   * Within `|u| < 0.09` (Address) and `|u - 2.0| < 0.09` (Impact), smoothly blend `gripModel` toward the exact inverse-mapped sweet-spot target `ballModel + (-0.032, -0.012, 0) - R_club * DRIVER_FACE_LOCAL_IN_HEAD` for millimeter-accurate `3.42 cm` clubface-to-ball alignment.
   * Rotate the wrist quaternion by the **24° diagonal grip basis** matching `build_hand_submesh`, place the right hand `0.048 m` further down `shaftDownDir`, solve both arms via analytical 2-bone quaternion IK (`L1 = 0.285 m`, `L2 = 0.265 m`), and counter-rotate `clubScene.quaternion` inside `club_grip_socket` to match `qClubWorld` exactly.
4. **Vestibular World-Level Head Stabilization**:
   * Compute `desiredHeadQuatModel = Euler(lerp(0.32, -0.05, headLookTarget), headLookTarget * 1.48, 0, 'YXZ')` and assign `nodes.neck.quaternion = qSpineWorld⁻¹ * (qStanceWorld * desiredHeadQuatModel)`. This completely cancels thoracic pitch/roll during the `96°` shoulder coil so the golfer's head stays horizontal and locked steadily onto the golf ball until post-impact follow-through.

### 2.4 Pose Space Deformation (PSD), Volumetric Muscle Telemetry & FACS AU1–AU26

To prevent visual and analytical volume collapse across shoulder, elbow, and forearm pronation, the rig evaluates an $\mathbb{SO}(3)$ Radial Basis Function network:

$$W_k(q) = \exp\left( -\frac{\|q - q_k\|^2}{2\sigma^2} \right)$$

with $\sigma = 0.72$ across `leftDeltoid`, `rightDeltoid`, `leftForearmPronation`, `rightElbowFlexion`, and `thoracicTorque`, coupled with a damped spring-mass soft-tissue fascia jiggle oscillator (`k = 140`, `c = 11.5`) and five physiological muscle stress channels (`latissimusDorsi`, `pectoralisMajor`, `bicepsBrachii`, `triceps`, `forearmExtensors`).

Facial micro-expressions map deterministically to Ekman's Facial Action Coding System and all **52 Apple ARKit blendshapes** (`ARKIT_52_BLENDSHAPES`):

| Action Unit Identifier | Anatomical Muscle Group | Mechanical Swing Function |
| :--- | :--- | :--- |
| **AU1 (Inner Brow Raiser)** | *Depressor Supercilii* / *Frontalis* | Pre-swing focus and target alignment during address posture (`u < 0.25`) |
| **AU4 (Brow Lowerer)** | *Corrugator Supercilii* | Concentrated tension during downswing acceleration (`0.6 < u < 2.3`) |
| **AU9 (Nose Wrinkler)** | *Levator Labii Superioris Alaeque Nasi* | Peak exertion contraction approaching clubface impact (`1.3 < u < 2.25`) |
| **AU12 (Lip Corner Puller)** | *Zygomaticus Major* | Asymmetric exertion grimace through follow-through rotation (`u > 1.85`) |
| **AU26 (Jaw Drop)** | *Masseter* relaxation / *Digastric* | Explosive respiratory release immediately following ball launch (`u > 1.94`) |

---

## 3. Physically Based Rendering (PBR) and Microfacet Shading

### Thermodynamic Principles and the Cook-Torrance BRDF
Photorealism across all assets enforces strict energy conservation via the Cook-Torrance microfacet BRDF:

$$f_r(\omega_i, \omega_o) = k_d \frac{c}{\pi} + k_s \frac{D(h) \, F(\omega_o, h) \, G(\omega_i, \omega_o, h)}{4 \, |n \cdot \omega_i| \, |n \cdot \omega_o|}$$

where $k_d = (1 - k_s)(1 - \text{metallic})$, $D_{\text{GGX}}(h, \alpha) = \frac{\alpha^2}{\pi((n \cdot h)^2(\alpha^2 - 1) + 1)^2}$ ($\alpha = \text{Roughness}^2$), height-correlated Smith-GGX shadowing $G(\omega_i, \omega_o, h)$, and Schlick Fresnel $F(\omega_o, h) = F_0 + (1 - F_0)(1 - (\omega_o \cdot h))^5$ ($F_0 = 0.04$ for dielectrics, $F_0 = \text{BaseColor}$ for conductive metals).

### Specialized Real-Time Material Characterization (`js/materials.js`, `js/golfer.js`)
* **Hero Golfer Epidermis**: Matte dermal albedo (`head_albedo.png` / `skin_albedo.png`) with subtle lipid clearcoat roughness (`0.08–0.15`), soft micro-normal intensity (`0.12`), and Random Walk SSS radius target (`0.015`).
* **Driver Clubhead**: Dual-material `THREE.MeshPhysicalMaterial` assembly — forged titanium hitting face & hosel (`metalness = 1.0`, `roughness = 0.22`, CNC-milled face scoreline normal/roughness maps, `TITANIUM_SRGB = [205, 200, 194]`) paired with a 3K woven carbon crown (`clearcoat = 1.0`, `clearcoatRoughness = 0.032` yielding $\alpha_{\text{coat}} \approx 0.001$).
* **Golf Ball Exterior**: Regulation `42.67 mm` diameter urethane cover (`metalness = 0.0`, `roughness = 0.12`, `F0 = 0.04`) with a procedural **336-dimple Fibonacci-sphere** normal, roughness, and albedo texture set.

---

## 4. Photorealistic Fairway and Environmental Architecture (`js/environment.js`)

* **Championship Heightfield Terrain (`420 m` downrange)**: Stratified bentgrass fairway, first-cut rough, raked greenside/fairway bunkers, and putting green at `-310 m` with height-blended transitions:

  $$\text{Mask}_{\text{blend}} = \text{saturate}\left( \frac{\text{Height}_A - \text{Height}_B + \text{BlendFactor}}{\text{TransitionSharpness}} \right)$$

* **Anti-Tiling & Distance Roughness Compensation**: Multi-angle stochastic UV rotation/offset blending (`fairway_turf.jpg` + `fairway_turf_normal.jpg`), fairway mower-striping macro variation, and view-distance roughness compensation preventing oblique glossy washout during high-altitude chase flight.
* **GPU-Instanced Foliage & Championship Props**:
  * **11,000 GPU-instanced wind-swaying grass blades** with two-sided backlit solar transmission shading around the tee box and fairway landing corridors.
  * Multi-tiered organic pine conifers (`pine_foliage.jpg`) and clustered oak deciduous trees (`oak_leaves.jpg`, `tree_bark.jpg`) framing both sides of the fairway corridor.
  * Championship tee markers, wooden tee with post-impact rigid-body kick/tumble physics, yardage markers (`150 / 200 / 250 / 300 yds`), wind-animated green flagstick, dynamic ball-locked broadcast flight tracer ribbon (toggleable), and turf/sand bounce impact particle pool.
* **Physical Atmospheric Sky & PMREM HDRI**: Dynamic Rayleigh/Mie sky dome synchronized to the Launch Lab's `Solar Elevation (HDRI)` slider (`12°–68°`, default `34°`) regenerating the scene PMREM environment reflection cube.

---

## 5. Color Management, PBR Validation, and Nano Banana Texturing Pipeline

### ACES Filmic Linear Pipeline & Strict sRGB Reflectance Bounds
* **Color Textures (`Utility - sRGB - Texture`)**: All albedo maps MUST explicitly assign `THREE.SRGBColorSpace`.
* **Non-Color Data Textures (`Utility - Raw`)**: All normal, roughness, metalness, and AO maps MUST remain in linear (`NoColorSpace`) space.
* **Strict PBR Range Audit (`createValidatedPBRColor` / `PBR_BOUNDS`)**:
  * Dielectric albedo strictly clamped within **`[30, 240]` sRGB** (no pure `0` black or `255` white blowout).
  * Conductive metal reflectance strictly within **`[180, 255]` sRGB**.
  * Binary metallicity (`0.0` dielectric / `1.0` metal).
  * Every registered material exports a compliance row to the Inspector's PBR Reflectance Audit table.

### Authoritative Nano Banana Asset & Reference Texture Manifest
All bespoke hero apparel/face textures, environment surface pairs, and the 25-frame swing reference atlas are generated cleanly via **Nano Banana** (`generate_image`) under the rule **"flat, top-down, evenly lit, seamless texture, no shadows"**, post-processed in Python (`Pillow` + `numpy`) for exact resolution, Sobel tangent-space normal generation, and PBR reflectance clamping:

| Asset Group | Files in `textures/` & `references/` | Resolution & Format | Pipeline Role |
| :--- | :--- | :---: | :--- |
| **Hero Character `.glb` Albedos** | `polo_albedo.png`, `slacks_albedo.png`, `glove_albedo.png`, `cap_logo.png`, `head_albedo.png`, `skin_albedo.png` | `1024×1024` `.png` | Embedded directly in `models/golfer.glb` via `trimesh.visual.TextureVisuals` |
| **Environment & Driver PBR Pairs** | `fairway_turf`, `bunker_sand`, `driver_carbon`, `pine_foliage`, `oak_leaves`, `tree_bark` (+ `*_normal.jpg`) | `512×512` `.jpg` | Loaded by `js/materials.js` & `js/environment.js` (`sRGB` albedo + linear Sobel normal) |
| **25-Frame Swing Reference Atlas** | `references/swing_sequence/frame_01.jpg`–`frame_25.jpg`, `swing_sequence_25_sheet.png` | `600×800` `.jpg` | Interactive 25-Frame Reference popover + Face-On biomechanical ground truth |

---

## 6. Aerodynamic Ball Trajectory and Collision Mechanics (`js/physics.js`)

### Launch Kinematics & 240Hz RK4 Flight Integration
With $v_{\text{club}} = 50.0\,\text{m/s}$ ($\approx 112\,\text{mph}$), $m_{\text{club}} = 0.200\,\text{kg}$, $m_{\text{ball}} = 0.0459\,\text{kg}$, $r_{\text{ball}} = 0.021335\,\text{m}$, and $e = 0.78$:

$$v_{\text{launch}} = v_{\text{club}} \left( \frac{1 + e}{1 + \frac{m_{\text{ball}}}{m_{\text{club}}}} \right) \approx 72.3\,\text{m/s} \quad (\approx 162\,\text{mph})$$

Airborne trajectory integrates at fixed timestep $\Delta t = 1/240\,\text{s}$ via fourth-order Runge-Kutta (RK4) over relative air velocity $v_{\text{rel}} = v - v_{\text{wind}}(y)$:

$$m_{\text{ball}} \frac{d^2 r}{dt^2} = -m_{\text{ball}} g \hat{j} - \frac{1}{2} \rho A C_d(Re) \|v_{\text{rel}}\| v_{\text{rel}} + \frac{1}{2} \rho A C_L(S) \|v_{\text{rel}}\| \left( \frac{\omega \times v_{\text{rel}}}{\|\omega\|} \right)$$

with Reynolds-dependent dimpled drag $C_d(Re) \approx 0.24 - 0.28$, spin-ratio Magnus lift $C_L(S)$ ($S = r_{\text{ball}}\|\omega\| / \|v_{\text{rel}}\|$), and exponential spin decay $\omega(t) = \omega_0 e^{-0.015 t}$.

### Surface-Classified Restitution & Rollout Parameters

| Surface Class | Restitution $e_{\text{surf}}$ | Kinetic Friction $\mu_k$ | Rolling Resistance $\mu_r$ |
| :--- | :---: | :---: | :---: |
| **Bentgrass Fairway** | `0.42` | `0.35` | `0.080` |
| **Rough** | `0.24` | `0.45` | `0.240` |
| **Bunker Sand** | `0.12` | `0.72` | `0.580` |
| **Putting Green** | `0.46` | `0.28` | `0.055` |

### Built-In Launch Lab Shot Presets & Reference Benchmark
Provide 5 one-click presets (`spec_reference`, `tour_bomber`, `power_draw`, `stinger_fade`, `crosswind`). Under **`spec_reference`** (`50.0 m/s`, `11.5°` launch, `2600 rpm` backspin, `0` sidespin, `0 m/s` wind), the RK4 solver MUST produce:
* **Ball Speed**: `162 mph`
* **Carry Distance**: `~259 yds` (`255–265 yds`)
* **Total Distance**: `~280 yds` (`275–286 yds`)
* **Apex Height**: `~103 ft` (`98–110 ft`)

---

## 7. Cinematic & Biomechanical Camera Choreography (6-Rig Director — `js/camera.js`)

The unified `CameraDirector` orchestrates **6 full-frame (`36 × 24 mm`) optical camera rigs** selectable manually via `#select-camera` or driven automatically in `AUTO` Director mode:

| Camera Prim Identifier | Focal Length / Aperture | Position & Look-At Specification | Role & Special Behavior |
| :--- | :---: | :--- | :--- |
| **`Camera_Address_Tee`** | `50mm f/2.8` | `(-2.55, 1.54, 5.45)` → `(-0.22, 0.72, -1.80)` | 45° rear-quarter address framing; pointer drag/wheel orbit inspect; subtle `11%` downswing pull-in; `0.02 m` damped impact impulse shake (disabled under `prefers-reduced-motion`). |
| **`Camera_Face_On`** | `38mm f/2.8` | Default `(3.25, 1.15, 0.04)` → `(-0.82, 1.05, 0.04)`; Popover split-screen `(4.15, 1.15, -0.78)` → `(-0.82, 1.05, -0.78)` | True biomechanical Face-On view matching the 25-frame Nano Banana studio sequence. Automatically engaged with split-screen horizontal shift (`setFaceOnSplitOffset(true)`) whenever `#swing-ref-popover` opens so the entire driver arc stays cleanly visible beside the right-docked panel; restores previous camera on close. |
| **`Camera_Down_The_Line`** | `40mm f/2.8` | `(-0.45, 1.18, 3.85)` → `(-0.45, 1.04, 0.00)` | Classic Down-The-Line swing plane & transition shallowing inspection rig matching the lower panel of Dual-Angle mocap references. |
| **`Camera_Flight_Chase`** | `85mm f/4.0` | `-3.5 m` trailing along velocity vector, `+0.8 m` elevation | Smooth aerodynamic over-the-shoulder chase tracking the ball across the fairway. |
| **`Camera_Landing_Downrange`** | `135mm f/2.0` | Reverse telephoto positioned `32 m` ahead & `17.5 m` laterally offset from predicted landing corridor | Captures steep descent, turf/sand divot bounce particles, and final rollout. |
| **`Camera_FACS_Closeup`** | `85mm f/2.0` | `headPos + (0.88, -0.24, 0.22)` → `headPos + (0, -0.02, 0)` | Angled slightly below eye level under the golf cap visor to inspect sculpted human facial geometry and live AU1–AU26 exertion. |

Shutter angle is fixed to `180°` with a **4-sample temporal clubhead motion-blur sweep** active during peak downswing/impact velocity (`TRANSITION_END_S` to `IMPACT_S + 0.26 s`).

---

## 8. OpenUSD Scene Graph, Procedural Web Audio & Modern Gray-and-White UI Architecture

### 8.1 OpenUSD LIVRPS Layered Stage Graph (`js/usdStage.js`)
Maintain an explicit runtime OpenUSD composition graph (`shot_teedrive_01.usda` composing `lighting_rig.usda`, `animation_shot.usda`, `character_hero.usda`, `environment_fairway.usda`, and `assets_props.usda`) tracking delta opinion overrides (solar elevation, wind, launch parameters) and non-destructive tee reload counts, inspectable live inside `#inspector-dialog`.

### 8.2 Modern Gray-and-White Broadcast Studio UI (`index.html`, `css/styles.css`, `js/main.js`)
* **Visual Theme**: Crisp **gray-and-white studio aesthetic** (translucent frosted white/light-gray cards, charcoal typography `#111315`, subtle hairline borders, zero neon clutter), CSS Cascade Layers (`@layer`), `100dvh`/`100dvw` viewport locking, and full `prefers-reduced-motion` support.
* **Top Broadcast Bar**: Title, live FSM state badge, active optical camera pill, live rotating wind-vector chip, `Sound On/Off` toggle, `Pause/Resume`, **`25-Frame Ref`**, **`Launch Lab`**, and **`Inspector`**.
* **Bottom Control & Telemetry Dock**: Single-row TrackMan-style telemetry strip (`Ball Speed`, `Launch`, `Backspin`, `Carry`, `Total`, `Apex`), primary **`DRIVE`** CTA (`Space` hotkey, supporting 1-click **Deterministic Pro** and optional **Skill Timing Meter**), `Reset Tee`, `Best` & `Drives` counters, and 6-rig `#select-camera` selector.
* **Declarative Popovers & Modal Dialog (Zero Custom Backdrop/ESC Plumbing)**:
  * Feature-detect native Invoker Commands (`commandForElement`) and Popover API (`popover`), dynamically loading `invokers-polyfill` and `@oddbird/popover-polyfill` ONLY when missing.
  * **`#tuning-popover`** (`popover="auto"`, `popovertarget="tuning-popover"`): Swing control mode radio, 7 range sliders (`clubSpeed`, `launchAngle`, `backspin`, `sidespin`, `windSpeed`, `windDir`, `sunElevation`), broadcast tracer toggle, and 5 shot preset buttons.
  * **`#swing-ref-popover`** (`popover="auto"`, `commandfor="swing-ref-popover" command="toggle-popover"`): 25-frame Nano Banana thumbnail strip (`loading="lazy" fetchpriority="low"` on all hidden reference images so LCP is never delayed), active frame preview + phase pill, `Frame 01–25` slider, `Prev` / `Next` / `Step Sweep` / `Exit Pose` controls synced 1-to-1 to `golfer.setPreviewFrame(n)`, and automatic split-screen `Camera_Face_On` activation/restoration on toggle.
  * **`#inspector-dialog`** (`<dialog closedby="any">`, `commandfor="inspector-dialog" command="show-modal"`): Exclusive `<details name="spec-tabs">` accordions displaying Skeleton/GLB validation, live RBF/Muscle/FACS AU telemetry, PBR sRGB reflectance compliance audit, OpenUSD LIVRPS stage graph, and session shot history.

### 8.3 Gesture-Gated Procedural Web Audio (`js/audio.js`)
Synthesize all audio procedurally via the Web Audio API with zero external audio files: driver swing aerodynamic whoosh, metallic forged-titanium impact crack, velocity-scaled turf/sand bounce thuds, and subtle ambient fairway breeze — cleanly unlocking `AudioContext` on the first user gesture and honoring the `Sound On/Off` mute toggle.

---

## 9. Single-Shot Acceptance Criteria & Automated Headless Verification Protocol

Every single-shot build MUST pass all four engineering categories AND complete an automated headless Chrome WebGL2 verification script over the live Flask server before being considered done:

### 9.1 Character, `.glb` & Biomechanical Swing Acceptance Gates
* `golfer.glb` A-Pose height strictly `1.75–1.80 m`, shoe soles at `Y = 0.000 m`, `15,000–35,000` triangles, all 7 required sub-meshes present, `golf_club.glb` attached under `club_grip_socket`, `flatShading = false` with smooth position-welded normals, and `THREE.SRGBColorSpace` on all albedo textures.
* Address & Impact clubface-to-ball distance strictly `<= 4.0 cm` (`3.42 cm` target) with the 460cc driver soleplate dead-flat behind the ball (`56°` lie angle).
* All 10 Dual-Angle checkpoints (`F01`, `F04`, `F07`, `F11`, `F13`, `F16`, `F18`, `F20`, `F22`, `F25`) visually verified in BOTH Face-On and Down-The-Line views:
  * Straight arms at Address (`F01`), P2 horizontal takeaway (`F04`), Impact (`F18`), and P8 upward follow-through extension (`F20`).
  * Horizontal, ball-locked head through the `96°` shoulder coil at Top (`F11`).
  * Lead-foot weight shift & visible rearward club shallowing at Transition (`F13`) into horizontal P6 delivery (`F16`).
  * Wide `47 cm` foot-pinned athletic stance with zero foot slip, vertical right toe-tip finish pivot, and driver draped downward behind the upper back at P10 Finish (`F25`).

### 9.2 PBR Rendering, Environment & Color Acceptance Gates
* WebGL2 `ACESFilmicToneMapping` + `PCFSoftShadowMap` active; all 21 golfer sub-meshes and club meshes cast and receive shadows cleanly.
* Every material passes `PBR_BOUNDS` (`30–240` sRGB dielectric, `180–255` sRGB metal, binary metallicity), with `Utility - sRGB - Texture` vs. linear data separation strictly enforced.
* Fairway terrain renders with stochastic anti-tiling, distance roughness compensation, 11,000 wind-animated grass blades, pine/oak trees, wooden tee kick physics, and dynamic sky HDRI.

### 9.3 Physics, Camera & UI Acceptance Gates
* `spec_reference` preset drive completes the full 5-state FSM (`ADDRESS` → `SWING` → `FLIGHT` → `LANDING` → automatic `RELOAD_RESET`) achieving `162 mph` ball speed, `~259 yds` carry, `~280 yds` total, and `~103 ft` apex.
* Opening **`25-Frame Ref`** automatically frames the live 3D golfer in split-screen `Camera_Face_On` with the full clubhead visible beside the popover, and closing restores the prior camera cleanly.
* **`Launch Lab`** popover, **`Inspector`** modal dialog, and all 6 camera presets function smoothly with gray-and-white studio styling and `prefers-reduced-motion` compliance.

### 9.4 Mandatory Automated Headless Chrome WebGL2 Verification Gate
Run an automated Node.js CDP script against `http://127.0.0.1:8087/` (live Flask `app.py`) using headless Chrome with Metal/ANGLE WebGL enabled:
1. Assert `window.__golfSimApp.golfer.getSkeletonVerification().allCompliant === true` and `clubBallDistCm <= 4.0`.
2. Capture and visually inspect a stitched **10-Phase Dual-Angle (Face-On + Down-The-Line) contact sheet** (`F01, F04, F07, F11, F13, F16, F18, F20, F22, F25`).
3. Capture and visually inspect `#swing-ref-popover` live synced to `Frame 20` verifying auto split-screen `Camera_Face_On` framing.
4. Trigger `spec_reference` + `DRIVE`, verify `Camera_Flight_Chase` mid-flight, `Camera_Landing_Downrange` rollout, and clean automatic tee reload (`reloadCount >= 1`), plus screenshots of `#tuning-popover` and `#inspector-dialog`.
5. **Hard Failure Gate**: Browser console MUST report **ZERO uncaught exceptions, ZERO 404 resource errors, and ZERO WebGL/Three.js shader warnings**.

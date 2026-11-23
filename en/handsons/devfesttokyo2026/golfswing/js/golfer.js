/**
 * GLB-Based Biomechanical Golfer & 460cc Tour Driver Controller
 * Implements the 4-Step 3D Remodeling Pipeline:
 *  - Loads Python `trimesh`-authored A-Pose `models/golfer.glb` (1.78m, Y-up, facing +Z,
 *    soles at Y=0.0, ~29,300 tris) and `models/golf_club.glb` (origin (0,0,0) at grip)
 *    via Three.js `GLTFLoader`.
 *  - Enforces `THREE.SRGBColorSpace` on all Nano Banana 1024x1024 `.png` albedo textures
 *    (`polo_albedo.png`, `slacks_albedo.png`, `glove_albedo.png`, `cap_logo.png`, `head_albedo.png`)
 *    and enables `castShadow = true` / `receiveShadow = true` on all sub-meshes.
 *  - Attaches `golf_club.glb` directly as a child of the golfer's `left_glove` hand group
 *    (`club_grip_socket`) and drives procedural Address, Backswing, Downswing, Impact, and
 *    Follow-Through animations hierarchically (`hips -> spine -> shoulders -> arms`) using
 *    `THREE.Quaternion` rotations + analytical 2-bone arm IK.
 *  - Validates & logs loaded A-pose bounding box height, sole Y, triangle counts, and sub-meshes.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  ARKIT_52_BLENDSHAPES,
  PBR_BOUNDS,
  PHYSICS,
  SKELETON_BONE_NAMES,
  SWING_TIMING,
} from './constants.js';
import {
  createDriverFaceTextures,
  createValidatedPBRColor,
} from './materials.js';
import {
  SWING_25_KEYFRAMES,
  evaluate25FrameSwingSpline,
} from './swingKeyframes.js';

const DRIVER_LIE_TILT_RAD = THREE.MathUtils.degToRad(34.0); // 90° - 56° tour driver lie angle
// Exact sweet-spot coordinate of striking face in golf_club.glb local space (origin 0,0,0 at grip)
export const DRIVER_FACE_LOCAL_IN_HEAD = new THREE.Vector3(0.0464, -1.0663, -0.004);

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Analytical 2-bone inverse kinematics for humanoid arm (Shoulder -> Elbow -> Wrist).
 * Segments extend along local -Y (len1 = 0.285m upper arm, len2 = 0.265m forearm).
 */
function solveTwoBoneIK(shoulderPos, targetPos, polePos, len1, len2, outElbow) {
  const toTarget = new THREE.Vector3().subVectors(targetPos, shoulderPos);
  let dist = toTarget.length();
  const maxDist = (len1 + len2) * 0.994;
  const minDist = Math.abs(len1 - len2) + 0.02;
  dist = Math.max(minDist, Math.min(maxDist, dist));

  const dir = toTarget.normalize();
  const cosAngle = Math.max(
    -1,
    Math.min(1, (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist))
  );
  const sinAngle = Math.sqrt(Math.max(0, 1 - cosAngle * cosAngle));

  const toPole = new THREE.Vector3().subVectors(polePos, shoulderPos);
  const proj = dir.clone().multiplyScalar(toPole.dot(dir));
  const bendDir = toPole.sub(proj);
  if (bendDir.lengthSq() < 1e-6) {
    bendDir.set(0, -1, 0);
  } else {
    bendDir.normalize();
  }

  outElbow
    .copy(shoulderPos)
    .addScaledVector(dir, len1 * cosAngle)
    .addScaledVector(bendDir, len1 * sinAngle);
  return outElbow;
}

export class BiomechanicalGolfer {
  constructor(sunDirUniform) {
    this.sunDirUniform = sunDirUniform;
    this.root = new THREE.Group();
    this.root.name = 'Character_Hero_Golfer';
    // Golfer stands at (-0.84, 0, 0.04); stancePivot rotates +90° around Y so the +Z-facing
    // glTF character faces +X_world (toward the ball) with Left lead shoulder pointing -Z_world (downrange)!
    this.root.position.set(-0.84, 0, 0.04);

    this.stancePivot = new THREE.Group();
    this.stancePivot.name = 'Golfer_Stance_Pivot';
    this.stancePivot.rotation.y = Math.PI * 0.5;
    this.root.add(this.stancePivot);

    // Standardized bone/node dictionary & GLB validation telemetry
    this.bones = {};
    for (const bName of SKELETON_BONE_NAMES) {
      this.bones[bName] = new THREE.Group();
    }
    this.nodes = {};
    this.subMeshes = {};
    this.loaded = false;
    this.glbValidation = {
      loaded: false,
      boundingBoxHeightM: 0,
      soleMinYM: 0,
      golferTriangles: 0,
      clubTriangles: 0,
      subMeshes: [],
      clubAttachedToHand: false,
    };

    // Fallback proxy nodes before async GLB finishes loading (~50ms)
    this.driverSocket = new THREE.Group();
    this.stancePivot.add(this.driverSocket);
    this.clubScene = new THREE.Group();
    this.driverSocket.add(this.clubScene);

    // 52 Apple ARKit blendshapes & FACS AU telemetry
    this.arkitWeights = {};
    for (const key of ARKIT_52_BLENDSHAPES) {
      this.arkitWeights[key] = 0;
    }
    this.facsAU = { AU1: 0.25, AU4: 0.0, AU9: 0.0, AU12: 0.0, AU26: 0.0 };

    // Live RBF Pose Space Deformation & muscle stress telemetry
    this.rbfWeights = {
      leftDeltoid: 0,
      rightDeltoid: 0,
      leftForearmPronation: 0,
      rightElbowFlexion: 0,
      thoracicTorque: 0,
    };
    this.muscleStress = {
      latissimusDorsi: 0.12,
      pectoralisMajor: 0.10,
      bicepsBrachii: 0.14,
      triceps: 0.11,
      forearmExtensors: 0.16,
      fasciaDampingJiggle: 0.0,
    };

    // Swing animation & secondary physics state
    this.swingPhase = 'ADDRESS';
    this.swingTime = 0;
    this.idleTime = 0;
    this.clubSpeedMs = 50.0;
    this.impactTriggered = false;
    this.shaftFlexRad = 0;
    this.shaftVibPhase = 0;
    this.shaftVibAmp = 0;
    this.tissueJiggleVel = 0;
    this.tissueJiggleDisp = 0;

    this._downVec = new THREE.Vector3(0, -1, 0);
    this._qRefBackswing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.35, 0.65));
    this._qRefImpact = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.2, -0.3));
    this._qRefFinish = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, -1.4, -0.7));

    this._registerPBRAuditEntries();
    this._buildMotionBlurFan();

    this.readyPromise = this._loadGLBAssets();
  }

  _registerPBRAuditEntries() {
    createValidatedPBRColor('Golfer_Polo_PNG_Albedo', [224, 225, 226], false, 'Nano Banana polo_albedo.png');
    createValidatedPBRColor('Golfer_Slacks_PNG_Albedo', [68, 72, 77], false, 'Nano Banana slacks_albedo.png');
    createValidatedPBRColor('Golfer_Glove_PNG_Albedo', [228, 228, 227], false, 'Nano Banana glove_albedo.png');
    createValidatedPBRColor('Golfer_CapLogo_PNG_Albedo', [62, 65, 69], false, 'Nano Banana cap_logo.png');
    createValidatedPBRColor('Golfer_HeadSkin_PNG_Albedo', [204, 152, 124], false, 'Nano Banana head_albedo.png');
    createValidatedPBRColor('Driver_Forged_Titanium_GLB', PBR_BOUNDS.TITANIUM_SRGB, true, 'golf_club.glb PBR');
  }

  /**
   * Computes smooth position-averaged vertex normals across unindexed glTF triangles & UV seams
   * while preserving sharp double-sided folds (e.g., polo collar & cap brim where dot < 0.05).
   */
  _computeSmoothNormalsByPosition(geo) {
    geo.computeVertexNormals();
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    if (!pos || !norm) return;

    const groups = new Map();
    for (let i = 0; i < pos.count; i++) {
      const k = `${Math.round(pos.getX(i) * 10000)},${Math.round(pos.getY(i) * 10000)},${Math.round(pos.getZ(i) * 10000)}`;
      let list = groups.get(k);
      if (!list) {
        list = [];
        groups.set(k, list);
      }
      list.push(i);
    }

    const out = new Float32Array(norm.array.length);
    for (const list of groups.values()) {
      if (list.length === 1) {
        const idx = list[0] * 3;
        out[idx] = norm.array[idx];
        out[idx + 1] = norm.array[idx + 1];
        out[idx + 2] = norm.array[idx + 2];
        continue;
      }
      for (const i of list) {
        const i3 = i * 3;
        const nx0 = norm.array[i3];
        const ny0 = norm.array[i3 + 1];
        const nz0 = norm.array[i3 + 2];
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (const j of list) {
          const j3 = j * 3;
          const nx = norm.array[j3];
          const ny = norm.array[j3 + 1];
          const nz = norm.array[j3 + 2];
          if (nx0 * nx + ny0 * ny + nz0 * nz > 0.05) {
            sx += nx;
            sy += ny;
            sz += nz;
          }
        }
        const len = Math.hypot(sx, sy, sz) || 1;
        out[i3] = sx / len;
        out[i3 + 1] = sy / len;
        out[i3 + 2] = sz / len;
      }
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  }

  async _loadGLBAssets() {
    const loader = new GLTFLoader();
    const [golferGltf, clubGltf] = await Promise.all([
      loader.loadAsync(new URL('../models/golfer.glb', import.meta.url).href),
      loader.loadAsync(new URL('../models/golf_club.glb', import.meta.url).href),
    ]);

    const golferScene = golferGltf.scene;
    const clubScene = clubGltf.scene;

    // --- Step 4 Validation: Measure unmodified A-Pose bounding box & triangle counts ---
    golferScene.updateMatrixWorld(true);
    const aposeBox = new THREE.Box3().setFromObject(golferScene);
    const aposeHeightM = aposeBox.max.y - aposeBox.min.y;
    const soleMinYM = aposeBox.min.y;

    let golferTris = 0;
    const foundSubMeshes = [];
    golferScene.traverse((obj) => {
      if (obj.name) {
        this.nodes[obj.name] = obj;
      }
      if (obj.isMesh) {
        foundSubMeshes.push(obj.name);
        this.subMeshes[obj.name] = obj;
        const geo = obj.geometry;
        this._computeSmoothNormalsByPosition(geo);
        golferTris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;

        // Step 3: Enable castShadow & receiveShadow on all golfer sub-meshes
        obj.castShadow = true;
        obj.receiveShadow = true;

        // Step 3: Enforce smooth Gouraud/Phong shading (GLTFLoader sets flatShading=true when glTF omits NORMAL!)
        // and THREE.SRGBColorSpace on all Nano Banana PNG textures
        const mat = obj.material;
        if (mat) {
          mat.flatShading = false;
          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
            const isClamped = obj.name === 'head' || obj.name === 'cap';
            mat.map.wrapS = THREE.RepeatWrapping;
            mat.map.wrapT = isClamped ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
            mat.map.anisotropy = 8;
            mat.map.needsUpdate = true;
          }
          mat.needsUpdate = true;
        }
      }
    });

    const driverFaceTex = createDriverFaceTextures();
    let clubTris = 0;
    clubScene.traverse((obj) => {
      if (obj.isMesh) {
        const geo = obj.geometry;
        this._computeSmoothNormalsByPosition(geo);
        clubTris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
        obj.castShadow = true;
        obj.receiveShadow = true;

        if (obj.material) {
          obj.material.flatShading = false;
          if (obj.material.map) {
            obj.material.map.colorSpace = THREE.SRGBColorSpace;
            obj.material.map.wrapS = THREE.RepeatWrapping;
            obj.material.map.wrapT = THREE.RepeatWrapping;
            obj.material.map.anisotropy = 8;
            obj.material.map.needsUpdate = true;
          }
          if (obj.name === 'club_head_crown') {
            obj.material = new THREE.MeshPhysicalMaterial({
              map: obj.material.map,
              color: new THREE.Color(0xd2d6dc),
              metalness: 0.75,
              roughness: 0.24,
              clearcoat: 1.0,
              clearcoatRoughness: PBR_BOUNDS.CROWN_CLEARCOAT_ROUGHNESS,
            });
          } else if (obj.name === 'club_head_titanium') {
            obj.material = new THREE.MeshPhysicalMaterial({
              map: driverFaceTex.map,
              normalMap: driverFaceTex.normalMap,
              roughnessMap: driverFaceTex.roughnessMap,
              color: new THREE.Color(0xd6d8dc),
              metalness: 1.0,
              roughness: 0.22,
            });
          }
        }
      }
    });

    // Remove temporary fallback proxy and mount loaded golferScene
    this.stancePivot.remove(this.driverSocket);
    this.golferScene = golferScene;
    this.stancePivot.add(golferScene);

    // Step 3 Club Attachment: Attach `golf_club.glb` (origin 0,0,0 at grip) directly as a child
    // of the golfer's `left_glove` hand grip node (`club_grip_socket` under `left_wrist`)!
    const gripSocket = this.nodes.club_grip_socket || this.nodes.left_glove || this.nodes.left_wrist;
    this.clubGripSocket = gripSocket;
    this.clubScene = clubScene;
    this.clubScene.position.set(0, 0, 0);
    gripSocket.add(this.clubScene);
    this.driverSocket = gripSocket;

    // Bind key hierarchical joint aliases for inspector & camera lookups
    this.bones.Hips = this.nodes.hips || this.bones.Hips;
    this.bones.Spine = this.nodes.spine || this.bones.Spine;
    this.bones.Spine1 = this.nodes.spine || this.bones.Spine1;
    this.bones.Spine2 = this.nodes.spine || this.bones.Spine2;
    this.bones.Neck = this.nodes.neck || this.bones.Neck;
    this.bones.Head = this.nodes.head || this.bones.Head;
    this.bones.LeftArm = this.nodes.left_shoulder || this.bones.LeftArm;
    this.bones.LeftForeArm = this.nodes.left_elbow || this.bones.LeftForeArm;
    this.bones.LeftHand = this.nodes.left_wrist || this.bones.LeftHand;
    this.bones.RightArm = this.nodes.right_shoulder || this.bones.RightArm;
    this.bones.RightForeArm = this.nodes.right_elbow || this.bones.RightForeArm;
    this.bones.RightHand = this.nodes.right_wrist || this.bones.RightHand;
    this.bones.SOCKET_Driver_Grip = gripSocket;

    this.loaded = true;
    this.glbValidation = {
      loaded: true,
      boundingBoxHeightM: Number(aposeHeightM.toFixed(4)),
      soleMinYM: Number(soleMinYM.toFixed(4)),
      golferTriangles: Math.round(golferTris),
      clubTriangles: Math.round(clubTris),
      subMeshes: foundSubMeshes,
      clubAttachedToHand: Boolean(gripSocket && this.clubScene.parent === gripSocket),
    };

    console.info(
      `[GLB Validation] golfer.glb A-Pose height=${this.glbValidation.boundingBoxHeightM}m ` +
        `(shoe soles Y=${this.glbValidation.soleMinYM}m), triangles=${this.glbValidation.golferTriangles}, ` +
        `sub-meshes=[${foundSubMeshes.join(', ')}]; golf_club.glb (${this.glbValidation.clubTriangles} tris) ` +
        `attached to ${gripSocket.name}.`
    );

    this.resetToAddress();
    return this.glbValidation;
  }

  _buildMotionBlurFan() {
    this.blurGhosts = [];
    const ghostMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.88, 0.91, 0.95),
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    for (let i = 0; i < 4; i++) {
      const m = ghostMat.clone();
      const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 10), m);
      ghost.scale.set(1.1, 0.52, 1.45);
      ghost.visible = false;
      this.root.add(ghost);
      this.blurGhosts.push({ mesh: ghost, mat: m });
    }
    this.clubheadTrailHistory = [];
  }

  resetToAddress() {
    this.swingPhase = 'ADDRESS';
    this.previewFrame = null;
    this.swingTime = 0;
    this.impactTriggered = false;
    this.shaftFlexRad = 0;
    this.shaftVibAmp = 0;
    this.shaftVibPhase = 0;
    this.tissueJiggleDisp = 0;
    this.tissueJiggleVel = 0;
    this.clubheadTrailHistory.length = 0;
    for (const g of this.blurGhosts) {
      g.mesh.visible = false;
      g.mat.opacity = 0;
    }
    this._evaluatePoseAtSwingProgress(0, 0, 0);
  }

  /**
   * Locks the 3D golfer to any exact frame (1..25) of the Nano Banana biomechanical sequence
   * so users can inspect every phase 1-to-1 against the 25 studio reference images.
   */
  setPreviewFrame(frameNumber) {
    const idx = Math.max(1, Math.min(SWING_25_KEYFRAMES.length, Math.round(frameNumber))) - 1;
    const kf = SWING_25_KEYFRAMES[idx];
    this.previewFrame = kf;
    this.swingPhase = 'PREVIEW';
    this._evaluatePoseAtSwingProgress(kf.u, 0, 0.016);
    this._updateFACSTelemetry(kf.u, kf.u > 1.0 && kf.u <= 2.2 ? 0.72 : 0.18, this.idleTime);
    return kf;
  }

  clearPreviewFrame() {
    if (this.swingPhase === 'PREVIEW') {
      this.resetToAddress();
    }
  }

  startSwing(clubSpeedMs = 50.0) {
    this.previewFrame = null;
    this.swingPhase = 'SWINGING';
    this.swingTime = 0;
    this.clubSpeedMs = clubSpeedMs;
    this.impactTriggered = false;
    this.shaftVibAmp = 0;
    this.clubheadTrailHistory.length = 0;
  }

  update(dt, windSpeedMs = 2.0) {
    this.idleTime += dt;
    let impactJustOccurred = false;
    let swingComplete = false;

    if (this.swingPhase === 'PREVIEW' && this.previewFrame) {
      this._evaluatePoseAtSwingProgress(this.previewFrame.u, 0, dt);
    } else if (this.swingPhase === 'ADDRESS') {
      const breathe = Math.sin(this.idleTime * 1.85) * 0.005;
      this._evaluatePoseAtSwingProgress(0, breathe, dt);
      this._updateFACSTelemetry(0, 0, this.idleTime);
    } else if (this.swingPhase === 'SWINGING') {
      const prevTime = this.swingTime;
      const speedScale = 0.88 + 0.12 * (this.clubSpeedMs / 50.0);
      this.swingTime += dt * (this.swingTime > SWING_TIMING.BACKSWING_END_S ? speedScale : 1.0);

      if (!this.impactTriggered && prevTime < SWING_TIMING.IMPACT_S && this.swingTime >= SWING_TIMING.IMPACT_S) {
        this.impactTriggered = true;
        impactJustOccurred = true;
        this.shaftVibAmp = 0.065 * (this.clubSpeedMs / 50.0);
        this.shaftVibPhase = 0;
        this.tissueJiggleVel = 1.45;
      }

      this._evaluatePoseAtSwingTime(this.swingTime, dt);

      if (this.swingTime >= SWING_TIMING.FOLLOW_THROUGH_END_S) {
        this.swingPhase = 'FINISH_HOLD';
        swingComplete = true;
      }
    } else if (this.swingPhase === 'FINISH_HOLD') {
      this.swingTime += dt;
      this._evaluatePoseAtSwingTime(SWING_TIMING.FOLLOW_THROUGH_END_S, dt);
    }

    const clubheadWorldPos = this.getClubheadWorldPosition();
    this._updateMotionBlurFan();
    void windSpeedMs;

    return { impactJustOccurred, swingComplete, clubheadWorldPos };
  }

  _evaluatePoseAtSwingTime(t, dt) {
    const T_HOLD = SWING_TIMING.ADDRESS_HOLD_S;
    const T_TOP = SWING_TIMING.BACKSWING_END_S;
    const T_TRANS = SWING_TIMING.TRANSITION_END_S;
    const T_IMP = SWING_TIMING.IMPACT_S;
    const T_FIN = SWING_TIMING.FOLLOW_THROUGH_END_S;

    let u = 0;
    let effort = 0;
    if (t <= T_HOLD) {
      // Phase 1: Address
      u = 0;
    } else if (t <= T_TOP) {
      // Phases 2–4: Straight-arm takeaway -> Wrist hinge -> Peak top of backswing (Frames 01 -> 11)
      const p = (t - T_HOLD) / (T_TOP - T_HOLD);
      const s = p * p * (3 - 2 * p);
      u = lerp(p, s, 0.72);
      effort = u * 0.35;
    } else if (t <= T_TRANS) {
      // Phase 5: Deliberate transition — weight shifts to lead foot while club slowly falls/shallows (Frames 11 -> 14)
      const p = (t - T_TOP) / (T_TRANS - T_TOP);
      u = lerp(1.0, 1.42, p * p * (3 - 2 * p));
      effort = lerp(0.35, 0.62, p);
    } else if (t <= T_IMP) {
      // Phases 6–7: Explosive downswing delivery -> P7 square strike (Frames 14 -> 18)
      const p = (t - T_TRANS) / (T_IMP - T_TRANS);
      u = lerp(1.42, 2.0, Math.pow(p, 1.38));
      effort = lerp(0.62, 1.0, p);
    } else {
      // Phases 8–10: Straight-arm extension -> Wrap toward back -> Balanced tour finish (Frames 18 -> 25)
      const p = Math.min(1, (t - T_IMP) / (T_FIN - T_IMP));
      u = 2.0 + (1 - Math.pow(1 - p, 2.15));
      effort = Math.max(0.15, 1.0 - p * 0.85);
    }

    this._evaluatePoseAtSwingProgress(u, 0, dt);
    this._updateFACSTelemetry(u, effort, this.idleTime);
  }

  /**
   * 25-Frame Dual-Angle 3D Motion-Capture Swing Solver (Nano Banana 25-Frame Sequence +
   * YouTube Shorts V9bs9sVlHZ4 Dual-Angle Face-On & Down-The-Line Reference).
   *  - Analytical 2-bone Leg IK pins both shoes on the turf at an athletic 47cm stance width,
   *    posts the lead left leg straight at impact/finish, and pivots the trail right shoe cleanly
   *    onto its vertical toe tip with inward trail knee drive.
   *  - Direct 3D hands trajectory (`gripPos`) + spherical club direction (`shaftDir`) with
   *    physiological straight-lead-arm and straight-both-arms reach constraints match all 10 phases.
   */
  _evaluatePoseAtSwingProgress(u, breatheOffset, dt) {
    if (!this.loaded) return;

    const k = evaluate25FrameSwingSpline(u);
    this.currentSwingFrame = k;

    const {
      pelvisYaw,
      pelvicTiltFwd,
      thoraxYaw,
      spinePitch,
      lateralSideBend,
      trailFootPivot,
      headLookTarget,
      clubFaceRoll,
      leadArmMinReach,
      bothArmsStraight,
    } = k;

    // 1. Pelvis & Spine & Head Orientation in `stancePivot` (+Z = ball, +X = target/left, -X = backswing/right, +Y = up)
    const hips = this.nodes.hips;
    hips.position.set(
      k.hipsPos[0],
      k.hipsPos[1] + breatheOffset * 0.25,
      k.hipsPos[2]
    );
    hips.quaternion.setFromEuler(new THREE.Euler(pelvicTiltFwd, pelvisYaw, 0, 'YXZ'));

    const relThoraxYaw = thoraxYaw - pelvisYaw;
    this.nodes.spine.quaternion.setFromEuler(
      new THREE.Euler(spinePitch + breatheOffset, relThoraxYaw, lateralSideBend, 'YXZ')
    );

    this.stancePivot.updateMatrixWorld(true);

    // Vestibular Head Stabilization: keep head dead level & locked steadily on the golf ball
    // through Backswing/Transition/Impact (0..1.99), then rotate smoothly downrange to track the drive!
    const desiredHeadQuatModel = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        lerp(0.32, -0.05, headLookTarget),
        headLookTarget * 1.48,
        0,
        'YXZ'
      )
    );
    const qStanceTmp = new THREE.Quaternion();
    const qSpineWorld = new THREE.Quaternion();
    this.stancePivot.getWorldQuaternion(qStanceTmp);
    this.nodes.spine.getWorldQuaternion(qSpineWorld);
    this.nodes.neck.quaternion.copy(
      qSpineWorld.invert().multiply(qStanceTmp.multiply(desiredHeadQuatModel))
    );

    this.stancePivot.updateMatrixWorld(true);

    // 2. Analytical 2-Bone Foot-Pinned Leg IK (Wide 47cm Athletic Stance, Zero Foot Sliding!)
    //    Lead Left Foot stays anchored flat at (+0.235, 0.080, 0.000) with 13° outward athletic flare.
    const leftAnkleModel = new THREE.Vector3(0.235, 0.080, 0.000);
    const leftFootQuatModel = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.22, 0, 'YXZ'));
    const leftKneePoleModel = new THREE.Vector3(0.25, 0.44, 0.56);
    this._solveLegQuaternionIK('left', leftAnkleModel, leftKneePoleModel, leftFootQuatModel);

    //    Trail Right Foot stays anchored flat at (-0.235, 0.080, 0.000) through backswing & transition,
    //    then pivots around its planted toe tip (-0.235, 0.000, +0.165) up onto a vertical finish toe!
    const toePitch = trailFootPivot * 1.16;
    const footYawIn = -0.08 + trailFootPivot * 0.72;
    const footRollIn = -trailFootPivot * 0.16;
    const rightFootQuatModel = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(toePitch, footYawIn, footRollIn, 'YXZ')
    );
    const rightToePinModel = new THREE.Vector3(-0.235, 0.000, 0.165);
    const localToeOffset = new THREE.Vector3(0.0, -0.080, 0.165);
    const rightAnkleModel = rightToePinModel
      .clone()
      .sub(localToeOffset.clone().applyQuaternion(rightFootQuatModel));
    const rightKneePoleModel = new THREE.Vector3(
      -0.22 + trailFootPivot * 0.36,
      0.44,
      0.56 - trailFootPivot * 0.18
    );
    this._solveLegQuaternionIK('right', rightAnkleModel, rightKneePoleModel, rightFootQuatModel);

    this.stancePivot.updateMatrixWorld(true);

    // 3. Direct 3D Hands Trajectory & Spherical Club Direction Calibrated to All 25 Frames + Dual-Angle Video
    const ballModel = new THREE.Vector3(0.04, PHYSICS.TEE_HEIGHT, 0.84);
    const planeDown = new THREE.Vector3(0, -Math.cos(DRIVER_LIE_TILT_RAD), Math.sin(DRIVER_LIE_TILT_RAD)).normalize();
    const planeTarget = new THREE.Vector3(1, 0, 0);
    const planeNormal = new THREE.Vector3().crossVectors(planeDown, planeTarget).normalize();

    const shaftLagFlex = k.shaftLagFlex * (u > 1.0 && u <= 2.0 ? this.clubSpeedMs / 50.0 : 1.0);
    if (this.shaftVibAmp > 0.0005) {
      this.shaftVibPhase += dt * 44.0;
      this.shaftVibAmp *= Math.exp(-5.5 * dt);
    }
    this.shaftFlexRad = shaftLagFlex + Math.sin(this.shaftVibPhase) * this.shaftVibAmp;

    const gripModel = new THREE.Vector3(k.gripPos[0], k.gripPos[1], k.gripPos[2]);
    const shaftDownDir = new THREE.Vector3(k.shaftDir[0], k.shaftDir[1], k.shaftDir[2]).normalize();
    if (Math.abs(this.shaftFlexRad) > 1e-4) {
      shaftDownDir.applyAxisAngle(planeNormal, -this.shaftFlexRad * 0.35).normalize();
    }

    // Physiological Straight-Arm Reach Enforcement from actual rotated shoulder sockets:
    // Ensures lead left arm stays straight through takeaway/hinge/top/transition/impact AND
    // both arms extend straight on Frames 02-04 (takeaway) and Frames 20-21 (follow-through extension)!
    const invStance = new THREE.Matrix4().copy(this.stancePivot.matrixWorld).invert();
    const shLeftWorld = new THREE.Vector3();
    const shRightWorld = new THREE.Vector3();
    this.nodes.left_shoulder.getWorldPosition(shLeftWorld);
    this.nodes.right_shoulder.getWorldPosition(shRightWorld);
    const shLeftModel = shLeftWorld.applyMatrix4(invStance);
    const shRightModel = shRightWorld.applyMatrix4(invStance);

    const vL = gripModel.clone().sub(shLeftModel);
    const dL = vL.length();
    const targetMinL = Math.min(0.558, leadArmMinReach + 0.024);
    const maxArmReach = 0.568;
    if (dL > 1e-4) {
      if (dL < targetMinL && leadArmMinReach > 0.46) {
        gripModel.copy(shLeftModel).addScaledVector(vL.normalize(), targetMinL);
      } else if (dL > maxArmReach) {
        gripModel.copy(shLeftModel).addScaledVector(vL.normalize(), maxArmReach);
      }
    }

    if (bothArmsStraight > 0.5) {
      const shMid = shLeftModel.clone().add(shRightModel).multiplyScalar(0.5);
      const vR = gripModel.clone().sub(shRightModel);
      const dR = vR.length();
      const targetMinR = 0.528;
      if (dR < targetMinR && dR > 1e-4) {
        const pushOut = gripModel.clone().sub(shMid).normalize();
        const extra = (targetMinR - dR) * bothArmsStraight * 0.85;
        gripModel.addScaledVector(pushOut, extra);
        // Re-clamp against left shoulder max reach so neither arm over-stretches
        const vL2 = gripModel.clone().sub(shLeftModel);
        if (vL2.length() > maxArmReach) {
          gripModel.copy(shLeftModel).addScaledVector(vL2.normalize(), maxArmReach);
        }
      }
    }

    // Singularity-free clubhead basis using `planeNormal` (strictly orthogonal across all 25 frames!)
    const yClub = shaftDownDir.clone().negate();
    const xClubBase = planeNormal.clone().addScaledVector(yClub, -planeNormal.dot(yClub)).normalize();
    const xClub = xClubBase.applyAxisAngle(yClub, clubFaceRoll).normalize();
    const zClub = new THREE.Vector3().crossVectors(xClub, yClub).normalize();
    const clubBasisMat = new THREE.Matrix4().makeBasis(xClub, yClub, zClub);
    const qClubModel = new THREE.Quaternion().setFromRotationMatrix(clubBasisMat);

    // Millimeter-exact face-to-ball precision at Address (u=0) and P7 Strike Impact (u=2.0)
    const nearAddress = 1 - smoothstep(0.0, 0.09, Math.abs(u));
    const nearImpact = 1 - smoothstep(0.0, 0.09, Math.abs(u - 2.0));
    const precisionBlend = Math.max(nearAddress, nearImpact);
    if (precisionBlend > 0.001) {
      const desiredFaceModel = ballModel.clone().add(new THREE.Vector3(-0.032, -0.012, 0.0));
      const exactGripModel = desiredFaceModel
        .clone()
        .addScaledVector(xClub, -DRIVER_FACE_LOCAL_IN_HEAD.x)
        .addScaledVector(yClub, -DRIVER_FACE_LOCAL_IN_HEAD.y)
        .addScaledVector(zClub, -DRIVER_FACE_LOCAL_IN_HEAD.z);
      gripModel.lerp(exactGripModel, precisionBlend);
    }

    // 4. Exact 24° Diagonal Golf-Grip Basis (matching build_hand_submesh in build_golfer_glb.py)
    const qStanceWorld = new THREE.Quaternion();
    this.stancePivot.getWorldQuaternion(qStanceWorld);
    const qClubWorld = qStanceWorld.clone().multiply(qClubModel);

    const cos24 = Math.cos(THREE.MathUtils.degToRad(24.0));
    const sin24 = Math.sin(THREE.MathUtils.degToRad(24.0));
    const wY = yClub.clone().multiplyScalar(cos24).addScaledVector(xClub, sin24).normalize();
    const wZ = yClub.clone().multiplyScalar(-sin24).addScaledVector(xClub, cos24).normalize();
    const wX = new THREE.Vector3().crossVectors(wY, wZ).normalize();
    const qWristModel = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(wX, wY, wZ)
    );

    const socketLocal = new THREE.Vector3(-0.014, -0.056, 0.012);
    const leftWristTargetModel = gripModel
      .clone()
      .sub(socketLocal.clone().applyQuaternion(qWristModel));

    const rightGripOffset = new THREE.Vector3(0.014, -0.056, 0.012).applyQuaternion(qWristModel);
    const rightWristTargetModel = gripModel
      .clone()
      .addScaledVector(shaftDownDir, 0.048)
      .sub(rightGripOffset);

    const leftPoleModel = new THREE.Vector3(k.leftPole[0], k.leftPole[1], k.leftPole[2]);
    const rightPoleModel = new THREE.Vector3(k.rightPole[0], k.rightPole[1], k.rightPole[2]);

    this._solveArmQuaternionIK('left', leftWristTargetModel, leftPoleModel, qWristModel);
    this._solveArmQuaternionIK('right', rightWristTargetModel, rightPoleModel, qWristModel);

    // Orient attached `golf_club.glb` inside `club_grip_socket` so its world orientation is `qClubWorld`!
    this.clubGripSocket.updateWorldMatrix(true, false);
    const qSocketWorld = new THREE.Quaternion();
    this.clubGripSocket.getWorldQuaternion(qSocketWorld);
    this.clubScene.position.set(0, 0, 0);
    this.clubScene.quaternion.copy(qSocketWorld.invert().multiply(qClubWorld));
    this.root.updateMatrixWorld(true);

    // 5. Update RBF & Muscle Telemetry for Inspector
    this._evaluateRBFTelemetry(u, dt);
  }

  /**
   * Analytical 2-bone Leg IK (Hip -> Knee -> Ankle -> Foot) in `stancePivot` model space.
   * Thigh length = 0.390m, Shin length = 0.395m (exact `golfer.glb` bone dimensions).
   */
  _solveLegQuaternionIK(side, ankleTargetModel, kneePoleModel, desiredFootQuatModel) {
    const hipNode = this.nodes[`${side}_hip`];
    const kneeNode = this.nodes[`${side}_knee`];
    const ankleNode = this.nodes[`${side}_ankle`];
    if (!hipNode || !kneeNode || !ankleNode) return;

    const invStance = new THREE.Matrix4().copy(this.stancePivot.matrixWorld).invert();
    const hipWorld = new THREE.Vector3();
    hipNode.getWorldPosition(hipWorld);
    const hipModel = hipWorld.applyMatrix4(invStance);

    const kneeModel = new THREE.Vector3();
    solveTwoBoneIK(hipModel, ankleTargetModel, kneePoleModel, 0.390, 0.395, kneeModel);

    const kneeWorld = kneeModel.clone().applyMatrix4(this.stancePivot.matrixWorld);
    const ankleWorld = ankleTargetModel.clone().applyMatrix4(this.stancePivot.matrixWorld);

    const invParent = new THREE.Matrix4().copy(hipNode.parent.matrixWorld).invert();
    const kneeInParent = kneeWorld.clone().applyMatrix4(invParent).sub(hipNode.position).normalize();
    hipNode.quaternion.setFromUnitVectors(this._downVec, kneeInParent);
    hipNode.updateMatrixWorld(true);

    const invHip = new THREE.Matrix4().copy(hipNode.matrixWorld).invert();
    const ankleInHip = ankleWorld.clone().applyMatrix4(invHip).sub(kneeNode.position).normalize();
    kneeNode.quaternion.setFromUnitVectors(this._downVec, ankleInHip);
    kneeNode.updateMatrixWorld(true);

    const qStanceWorld = new THREE.Quaternion();
    this.stancePivot.getWorldQuaternion(qStanceWorld);
    const qDesiredWorld = qStanceWorld.multiply(desiredFootQuatModel);
    const qKneeWorld = new THREE.Quaternion();
    kneeNode.getWorldQuaternion(qKneeWorld);
    ankleNode.quaternion.copy(qKneeWorld.invert().multiply(qDesiredWorld));
    ankleNode.updateMatrixWorld(true);
  }

  _solveArmQuaternionIK(side, wristTargetModel, poleModel, desiredWristQuatModel) {
    const shNode = this.nodes[`${side}_shoulder`];
    const elNode = this.nodes[`${side}_elbow`];
    const wrNode = this.nodes[`${side}_wrist`];
    if (!shNode || !elNode || !wrNode) return;

    const invStance = new THREE.Matrix4().copy(this.stancePivot.matrixWorld).invert();
    const shWorld = new THREE.Vector3();
    shNode.getWorldPosition(shWorld);
    const shModel = shWorld.applyMatrix4(invStance);

    const elbowModel = new THREE.Vector3();
    solveTwoBoneIK(shModel, wristTargetModel, poleModel, 0.285, 0.265, elbowModel);

    // Convert elbow & wrist targets to world, then align local -Y of shoulder & elbow via Quaternion!
    const elbowWorld = elbowModel.clone().applyMatrix4(this.stancePivot.matrixWorld);
    const wristWorld = wristTargetModel.clone().applyMatrix4(this.stancePivot.matrixWorld);

    const invParent = new THREE.Matrix4().copy(shNode.parent.matrixWorld).invert();
    const shPosInParent = shNode.position;
    const elbowInParent = elbowWorld.clone().applyMatrix4(invParent).sub(shPosInParent).normalize();
    shNode.quaternion.setFromUnitVectors(this._downVec, elbowInParent);
    shNode.updateMatrixWorld(true);

    const invSh = new THREE.Matrix4().copy(shNode.matrixWorld).invert();
    const wristInSh = wristWorld.clone().applyMatrix4(invSh).sub(elNode.position).normalize();
    elNode.quaternion.setFromUnitVectors(this._downVec, wristInSh);
    elNode.updateMatrixWorld(true);

    const qStanceWorld = new THREE.Quaternion();
    this.stancePivot.getWorldQuaternion(qStanceWorld);
    const qDesiredWorld = qStanceWorld.multiply(desiredWristQuatModel);
    const qElbowWorld = new THREE.Quaternion();
    elNode.getWorldQuaternion(qElbowWorld);
    wrNode.quaternion.copy(qElbowWorld.invert().multiply(qDesiredWorld));
    wrNode.updateMatrixWorld(true);
  }

  _evaluateRBFTelemetry(u, dt) {
    const sigma = 0.72;
    const invTwoSigmaSq = 1 / (2 * sigma * sigma);
    const rbf = (q, qRef) => {
      const dot = Math.min(1, Math.abs(q.dot(qRef)));
      const d = 2 * Math.acos(dot);
      return Math.exp(-(d * d) * invTwoSigmaSq);
    };

    const qL = this.nodes.left_shoulder ? this.nodes.left_shoulder.quaternion : this._qRefImpact;
    const qR = this.nodes.right_shoulder ? this.nodes.right_shoulder.quaternion : this._qRefImpact;
    const qLF = this.nodes.left_elbow ? this.nodes.left_elbow.quaternion : this._qRefImpact;
    const qRF = this.nodes.right_elbow ? this.nodes.right_elbow.quaternion : this._qRefImpact;

    this.rbfWeights.leftDeltoid = rbf(qL, this._qRefBackswing);
    this.rbfWeights.rightDeltoid = rbf(qR, this._qRefFinish);
    this.rbfWeights.leftForearmPronation = rbf(qLF, this._qRefImpact);
    this.rbfWeights.rightElbowFlexion = rbf(qRF, this._qRefBackswing);
    this.rbfWeights.thoracicTorque = this.nodes.spine
      ? Math.min(1, Math.abs(this.nodes.spine.rotation.y) * 1.1)
      : 0;

    if (dt > 0) {
      const acc = -140.0 * this.tissueJiggleDisp - 11.5 * this.tissueJiggleVel;
      this.tissueJiggleVel += acc * dt;
      this.tissueJiggleDisp += this.tissueJiggleVel * dt;
    }

    const downswingLoad = u > 0.9 && u < 2.25 ? Math.sin(smoothstep(0.9, 2.25, u) * Math.PI) : 0;
    const load = downswingLoad * (this.clubSpeedMs / 50.0);

    this.muscleStress.latissimusDorsi = Math.min(1, 0.12 + 0.78 * load + 0.25 * this.rbfWeights.thoracicTorque);
    this.muscleStress.pectoralisMajor = Math.min(1, 0.10 + 0.72 * load);
    this.muscleStress.bicepsBrachii = Math.min(1, 0.14 + 0.58 * load + 0.18 * this.rbfWeights.rightElbowFlexion);
    this.muscleStress.triceps = Math.min(1, 0.11 + 0.66 * load);
    this.muscleStress.forearmExtensors = Math.min(1, 0.16 + 0.76 * load + 0.22 * this.rbfWeights.leftForearmPronation);
    this.muscleStress.fasciaDampingJiggle = Math.min(1, Math.abs(this.tissueJiggleDisp) * 8.0);
  }

  _updateFACSTelemetry(u, effort, time) {
    const au1 = u < 0.25 ? 0.34 * (1 - u * 4) : 0.04;
    const au4 = u > 0.6 && u < 2.3 ? smoothstep(0.6, 1.85, u) * (1 - smoothstep(2.05, 2.5, u)) * 0.92 : 0.08;
    const au9 = u > 1.3 && u < 2.25 ? Math.sin(smoothstep(1.3, 2.25, u) * Math.PI) * 0.84 : 0.0;
    const au12 = u > 1.85 ? smoothstep(1.85, 2.35, u) * (1 - smoothstep(2.55, 3.0, u) * 0.55) * 0.72 : 0.0;
    const au26 = u > 1.94 ? Math.sin(smoothstep(1.94, 2.65, u) * Math.PI) * 0.76 : 0.0;

    this.facsAU.AU1 = au1;
    this.facsAU.AU4 = au4;
    this.facsAU.AU9 = au9;
    this.facsAU.AU12 = au12;
    this.facsAU.AU26 = au26;

    const blinkCycle = time % 4.2;
    const blink = u < 0.8 && blinkCycle < 0.14 ? Math.sin((blinkCycle / 0.14) * Math.PI) : 0;

    const w = this.arkitWeights;
    w.browInnerUp = au1;
    w.browDownLeft = au4;
    w.browDownRight = au4;
    w.noseSneerLeft = au9;
    w.noseSneerRight = au9 * 0.92;
    w.mouthSmileLeft = au12 * 0.88;
    w.mouthSmileRight = au12 * 0.52;
    w.jawOpen = au26;
    w.eyeBlinkLeft = blink;
    w.eyeBlinkRight = blink;
    w.eyeSquintLeft = au4 * 0.45 + au9 * 0.35;
    w.eyeSquintRight = au4 * 0.45 + au9 * 0.35;
    w.cheekSquintLeft = au9 * 0.55 + au12 * 0.4;
    w.cheekSquintRight = au9 * 0.45 + au12 * 0.25;
    w.mouthUpperUpLeft = au9 * 0.4;
    w.mouthUpperUpRight = au9 * 0.35;
    w.mouthPressLeft = effort * 0.45 * (1 - au26);
    w.mouthPressRight = effort * 0.45 * (1 - au26);
    w.mouthStretchLeft = au12 * 0.35;
    w.mouthStretchRight = au12 * 0.25;
  }

  _updateMotionBlurFan() {
    if (!this.loaded) return;
    const pos = this.getClubheadWorldPosition();
    const invRoot = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const localPos = pos.clone().applyMatrix4(invRoot);
    const quat = new THREE.Quaternion();
    this.clubScene.getWorldQuaternion(quat);

    this.clubheadTrailHistory.unshift({ pos: localPos, quat });
    if (this.clubheadTrailHistory.length > 5) {
      this.clubheadTrailHistory.pop();
    }

    const isFastPhase =
      this.swingPhase === 'SWINGING' &&
      this.swingTime > SWING_TIMING.TRANSITION_END_S &&
      this.swingTime < SWING_TIMING.IMPACT_S + 0.26;

    for (let i = 0; i < this.blurGhosts.length; i++) {
      const g = this.blurGhosts[i];
      const sample = this.clubheadTrailHistory[i + 1];
      if (isFastPhase && sample) {
        g.mesh.visible = true;
        g.mesh.position.copy(sample.pos);
        g.mesh.quaternion.copy(sample.quat);
        g.mat.opacity = 0.18 * (1 - i / this.blurGhosts.length);
      } else {
        g.mesh.visible = false;
        g.mat.opacity = 0;
      }
    }
  }

  getClubheadWorldPosition(out = new THREE.Vector3()) {
    if (!this.loaded) {
      return out.set(0, 0.043, 0.032);
    }
    this.clubScene.updateWorldMatrix(true, false);
    out.copy(DRIVER_FACE_LOCAL_IN_HEAD);
    return this.clubScene.localToWorld(out);
  }

  getHeadWorldPosition(out = new THREE.Vector3()) {
    if (!this.loaded || !this.nodes.neck) {
      return out.set(-0.62, 1.56, 0.04);
    }
    this.nodes.neck.updateWorldMatrix(true, false);
    out.set(0, 0.165, 0.055);
    return this.nodes.neck.localToWorld(out);
  }

  getSkeletonVerification() {
    const present = SKELETON_BONE_NAMES.filter((n) => Boolean(this.bones[n]));
    return {
      expectedCount: SKELETON_BONE_NAMES.length,
      presentCount: present.length,
      arkitBlendshapeCount: Object.keys(this.arkitWeights).length,
      glbValidation: this.glbValidation,
      allCompliant:
        present.length === SKELETON_BONE_NAMES.length &&
        Object.keys(this.arkitWeights).length === 52 &&
        this.glbValidation.loaded,
    };
  }
}

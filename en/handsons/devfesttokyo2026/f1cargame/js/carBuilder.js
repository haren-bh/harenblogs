/**
 * Runtime F1 `.glb` Ingestion, Crease-Preserving Position-Welded Smooth Normals,
 * Nano Banana PBR Material Upgrade, Articulated Node Verification, and Rival Cloning.
 *
 * Coordinate Convention (Section 1.2 & scripts/build_f1_car_glb.py):
 *   - Right-handed, meters, +Y up, car facing -Z, starboard +X, port -X.
 *   - Origin (0, 0, 0) lies on ground plane directly beneath CoG; wheel hubs at Y = +0.360 m.
 *   - Left steer (+steerAngle) => +rotation.y on front knuckles (`wheel_fl/fr_steer`).
 *   - Forward spin (+wheelAngle) => -rotation.x on wheel spin nodes (`wheel_*_spin`).
 *   - Brake calipers & glowing brake rotors sit on non-spinning `upright_brake_*` nodes.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_DIMS } from './constants.js';

const MODEL_PATH = './models/f1_car.glb';
const CREASE_ANGLE_DEG = 42.0;

const REQUIRED_ARTICULATED_NODES = Object.freeze([
  'chassis_root',
  'drs_upper_flap',
  'steering_wheel',
  'wheel_fl_susp',
  'wheel_fr_susp',
  'wheel_rl_susp',
  'wheel_rr_susp',
  'wheel_fl_steer',
  'wheel_fr_steer',
  'wheel_fl_spin',
  'wheel_fr_spin',
  'wheel_rl_spin',
  'wheel_rr_spin',
  'upright_brake_fl',
  'upright_brake_fr',
  'upright_brake_rl',
  'upright_brake_rr',
]);

const LIVERY_MESH_NAMES = new Set([
  'monocoque_nose',
  'sidepods_engine_cover',
  'front_wing_endplates',
  'rear_wing_endplates',
  'side_mirrors',
]);

const CARBON_MESH_NAMES = new Set([
  'front_wing_assembly',
  'underfloor_venturi_diffuser',
  'rear_wing_mainplane',
  'drs_upper_flap',
  'halo_titanium',
  'cockpit_interior',
  't_cam_pod',
  'suspension_wishbones',
  'brake_duct_fl',
  'brake_duct_fr',
  'brake_duct_rl',
  'brake_duct_rr',
]);

/**
 * Recomputes crease-preserving smooth vertex normals by position-welding coincident
 * triangle corners (including across duplicated UV seams) and averaging all adjacent
 * face normals whose angle lies within `creaseAngleDeg` (`dot > cos(42 deg)`).
 *
 * Converts indexed geometries to non-indexed first so hard aerodynamic edges (> 42 deg)
 * retain crisp split normals while curved bodywork lofts shade glass-smooth.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} [creaseAngleDeg=42]
 * @returns {THREE.BufferGeometry}
 */
export function _computeCreasePreservingSmoothNormals(geometry, creaseAngleDeg = CREASE_ANGLE_DEG) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const posAttr = geo.getAttribute('position');
  if (!posAttr || posAttr.count < 3) {
    geo.computeVertexNormals();
    return geo;
  }

  const vertCount = posAttr.count;
  const triCount = (vertCount / 3) | 0;
  const posArr = posAttr.array;

  // 1. Precompute unit face normals and area weights for all triangles
  const faceNormals = new Float32Array(triCount * 3);
  const faceAreas = new Float32Array(triCount);

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 9;
    const ax = posArr[i0];
    const ay = posArr[i0 + 1];
    const az = posArr[i0 + 2];

    const e1x = posArr[i0 + 3] - ax;
    const e1y = posArr[i0 + 4] - ay;
    const e1z = posArr[i0 + 5] - az;

    const e2x = posArr[i0 + 6] - ax;
    const e2y = posArr[i0 + 7] - ay;
    const e2z = posArr[i0 + 8] - az;

    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(cx, cy, cz);

    const nBase = t * 3;
    if (len > 1e-12) {
      const invLen = 1.0 / len;
      faceNormals[nBase] = cx * invLen;
      faceNormals[nBase + 1] = cy * invLen;
      faceNormals[nBase + 2] = cz * invLen;
      faceAreas[t] = len; // 2x triangle area weight prevents cap slivers from skewing lofts
    } else {
      faceNormals[nBase] = 0.0;
      faceNormals[nBase + 1] = 1.0;
      faceNormals[nBase + 2] = 0.0;
      faceAreas[t] = 0.0;
    }
  }

  // 2. Bucket all triangle corners by quantized position (1e-4 m precision) using zero-GC linked list
  const buckets = new Map();
  const nextCorner = new Int32Array(vertCount);
  nextCorner.fill(-1);
  const cornerKeys = new Float64Array(vertCount);

  const SHIFT = 65536;
  const STRIDE = 131072; // 131072^3 = 2.25e15 < Number.MAX_SAFE_INTEGER (9.007e15)

  for (let c = 0; c < vertCount; c++) {
    const pIdx = c * 3;
    const qx = Math.round(posArr[pIdx] * 1e4);
    const qy = Math.round(posArr[pIdx + 1] * 1e4);
    const qz = Math.round(posArr[pIdx + 2] * 1e4);
    const key = ((qx + SHIFT) * STRIDE + (qy + SHIFT)) * STRIDE + (qz + SHIFT);

    cornerKeys[c] = key;
    const prevHead = buckets.get(key);
    if (prevHead !== undefined) {
      nextCorner[c] = prevHead;
    }
    buckets.set(key, c);
  }

  // 3. For each corner, average coincident face normals within crease angle threshold
  const cosThreshold = Math.cos(creaseAngleDeg * (Math.PI / 180.0));
  const outNormals = new Float32Array(vertCount * 3);

  for (let c = 0; c < vertCount; c++) {
    const tri = (c / 3) | 0;
    const nBase = tri * 3;
    const fnx = faceNormals[nBase];
    const fny = faceNormals[nBase + 1];
    const fnz = faceNormals[nBase + 2];

    let sx = 0.0;
    let sy = 0.0;
    let sz = 0.0;

    let cursor = buckets.get(cornerKeys[c]);
    while (cursor !== -1 && cursor !== undefined) {
      const otherTri = (cursor / 3) | 0;
      const oBase = otherTri * 3;
      const onx = faceNormals[oBase];
      const ony = faceNormals[oBase + 1];
      const onz = faceNormals[oBase + 2];

      const dot = fnx * onx + fny * ony + fnz * onz;
      if (dot > cosThreshold) {
        const w = faceAreas[otherTri] > 1e-12 ? faceAreas[otherTri] : 1e-6;
        sx += onx * w;
        sy += ony * w;
        sz += onz * w;
      }
      cursor = nextCorner[cursor];
    }

    const sLen = Math.hypot(sx, sy, sz);
    const oIdx = c * 3;
    if (sLen > 1e-12) {
      const invS = 1.0 / sLen;
      outNormals[oIdx] = sx * invS;
      outNormals[oIdx + 1] = sy * invS;
      outNormals[oIdx + 2] = sz * invS;
    } else {
      outNormals[oIdx] = fnx;
      outNormals[oIdx + 1] = fny;
      outNormals[oIdx + 2] = fnz;
    }
  }

  geo.setAttribute('normal', new THREE.BufferAttribute(outNormals, 3));
  return geo;
}

/**
 * Empirically checks the loaded steering wheel mesh's UV orientation to confirm
 * whether trimesh exported glTF top-left V (`flipY = false`, expected) or OpenGL bottom-left.
 */
function detectGlbUvFlipY(gltfScene) {
  const swObj = gltfScene.getObjectByName('steering_wheel');
  let swMesh = null;
  if (swObj) {
    if (swObj.isMesh) {
      swMesh = swObj;
    } else {
      swObj.traverse((child) => {
        if (!swMesh && child.isMesh) swMesh = child;
      });
    }
  }

  if (swMesh && swMesh.geometry) {
    const pos = swMesh.geometry.getAttribute('position');
    const uv = swMesh.geometry.getAttribute('uv');
    if (pos && uv && pos.count > 0) {
      let maxY = -Infinity;
      let topV = 0.04;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > maxY) {
          maxY = y;
          topV = uv.getY(i);
        }
      }
      // In build_f1_car_glb.py, top of steering wheel has trimesh_v = 0.96 -> glTF v = 0.04 (< 0.5 => flipY=false)
      return topV > 0.5;
    }
  }

  return false;
}

/**
 * Resolves the canonical Nano Banana PBR material for a named glTF sub-mesh.
 */
function resolveMeshMaterial(mesh, matSet) {
  const meshName = mesh.name || '';
  const parentName = mesh.parent ? (mesh.parent.name || '') : '';
  const origMatName =
    (mesh.userData && mesh.userData.origMaterialName) ||
    (mesh.material && mesh.material.name) ||
    '';

  const check = (name) => {
    if (!name) return null;
    if (LIVERY_MESH_NAMES.has(name)) return matSet.livery;
    if (CARBON_MESH_NAMES.has(name)) return matSet.carbon;
    if (name === 'steering_wheel') return matSet.steeringDash;
    if (name === 'driver_helmet') return matSet.helmet;
    if (name === 'rear_rain_light') return matSet.rainLight;
    if (name.startsWith('tire_tread_')) return matSet.tireTread;
    if (name.startsWith('tire_sidewall_')) return matSet.tireSidewall;
    if (name.startsWith('rim_')) return matSet.wheelRim;
    if (name === 'brake_rotor_fl' || name === 'brake_rotor_fr') return matSet.brakeRotorFront;
    if (name === 'brake_rotor_rl' || name === 'brake_rotor_rr') return matSet.brakeRotorRear;
    if (name.startsWith('brake_rotor_')) return matSet.brakeRotorFront;
    if (name.startsWith('brake_caliper_')) return matSet.brakeCaliper;
    if (name.startsWith('brake_duct_')) return matSet.carbon;
    return null;
  };

  let mat = check(meshName) || check(parentName);
  if (mat) return mat;

  // Fallback by original trimesh glTF material name
  if (origMatName === 'mat_livery') return matSet.livery;
  if (origMatName === 'mat_carbon') return matSet.carbon;
  if (origMatName === 'mat_tire_tread') return matSet.tireTread;
  if (origMatName === 'mat_tire_sidewall') return matSet.tireSidewall;
  if (origMatName === 'mat_wheel_rim') return matSet.wheelRim;
  if (origMatName === 'mat_brake_rotor') return matSet.brakeRotorFront;
  if (origMatName === 'mat_brake_caliper') return matSet.brakeCaliper;
  if (origMatName === 'mat_helmet') return matSet.helmet;
  if (origMatName === 'mat_steering_dash') return matSet.steeringDash;
  if (origMatName === 'mat_rain_light') return matSet.rainLight;

  return matSet.carbon;
}

/**
 * Applies upgraded Nano Banana PBR materials, shadow flags, and `flatShading = false`
 * across every mesh inside a loaded or cloned F1 car hierarchy.
 */
function bindCarMaterialsAndShadows(carScene, matSet, disposeOldMaterials = false) {
  let meshCount = 0;
  let allFlatShadingFalse = true;
  const oldMaterials = disposeOldMaterials ? new Set() : null;

  carScene.traverse((obj) => {
    if (!obj.isMesh) return;
    meshCount++;

    if (disposeOldMaterials && obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => oldMaterials.add(m));
      } else {
        oldMaterials.add(obj.material);
      }
    }

    const upgraded = resolveMeshMaterial(obj, matSet);
    upgraded.flatShading = false;
    obj.material = upgraded;
    obj.castShadow = true;
    obj.receiveShadow = true;

    if (obj.material.flatShading !== false) {
      allFlatShadingFalse = false;
    }
  });

  if (oldMaterials) {
    oldMaterials.forEach((m) => {
      if (m.map) m.map.dispose();
      if (typeof m.dispose === 'function') m.dispose();
    });
  }

  return { meshCount, allFlatShadingFalse };
}

/**
 * Extracts all named articulated scene graph nodes from a loaded/cloned F1 `.glb` scene
 * and constructs the zero-allocation `F1CarRig` runtime controller.
 */
function assembleCarRig(modelScene, materialSet, validation, rawGltfScene, liveryKey, compoundId) {
  const root = new THREE.Group();
  root.name = `f1_car_rig_${liveryKey}`;
  root.add(modelScene);

  const byName = (name) => modelScene.getObjectByName(name) || null;

  const chassisRoot = byName('chassis_root');
  const drsUpperFlap = byName('drs_upper_flap');
  const steeringWheel = byName('steering_wheel');

  const wheelFlSusp = byName('wheel_fl_susp');
  const wheelFrSusp = byName('wheel_fr_susp');
  const wheelRlSusp = byName('wheel_rl_susp');
  const wheelRrSusp = byName('wheel_rr_susp');

  const wheelFlSteer = byName('wheel_fl_steer');
  const wheelFrSteer = byName('wheel_fr_steer');

  const wheelFlSpin = byName('wheel_fl_spin');
  const wheelFrSpin = byName('wheel_fr_spin');
  const wheelRlSpin = byName('wheel_rl_spin');
  const wheelRrSpin = byName('wheel_rr_spin');

  const uprightBrakeFl = byName('upright_brake_fl');
  const uprightBrakeFr = byName('upright_brake_fr');
  const uprightBrakeRl = byName('upright_brake_rl');
  const uprightBrakeRr = byName('upright_brake_rr');

  const brakeRotorFl = byName('brake_rotor_fl');
  const brakeRotorFr = byName('brake_rotor_fr');
  const brakeRotorRl = byName('brake_rotor_rl');
  const brakeRotorRr = byName('brake_rotor_rr');
  const rearRainLight = byName('rear_rain_light');

  const wheelSusp = [wheelFlSusp, wheelFrSusp, wheelRlSusp, wheelRrSusp];
  const wheelSteer = [wheelFlSteer, wheelFrSteer];
  const wheelSpin = [wheelFlSpin, wheelFrSpin, wheelRlSpin, wheelRrSpin];
  const uprightBrake = [uprightBrakeFl, uprightBrakeFr, uprightBrakeRl, uprightBrakeRr];
  const brakeRotors = [brakeRotorFl, brakeRotorFr, brakeRotorRl, brakeRotorRr];

  // Record base unmodified suspension hub heights (exact 0.360 m from build_f1_car_glb.py)
  // and steering wheel column tilt (-18 deg around X) so animations remain millimeter-accurate.
  const baseSuspY = new Float64Array([
    wheelFlSusp ? wheelFlSusp.position.y : CAR_DIMS.TIRE_RADIUS,
    wheelFrSusp ? wheelFrSusp.position.y : CAR_DIMS.TIRE_RADIUS,
    wheelRlSusp ? wheelRlSusp.position.y : CAR_DIMS.TIRE_RADIUS,
    wheelRrSusp ? wheelRrSusp.position.y : CAR_DIMS.TIRE_RADIUS,
  ]);
  const baseSteeringTiltX = steeringWheel ? steeringWheel.rotation.x : (-18.0 * Math.PI) / 180.0;
  const baseChassisY = chassisRoot ? chassisRoot.position.y : 0.0;

  if (steeringWheel) {
    steeringWheel.rotation.order = 'XYZ';
  }

  const nodes = {
    chassis_root: chassisRoot,
    drs_upper_flap: drsUpperFlap,
    steering_wheel: steeringWheel,
    wheel_fl_susp: wheelFlSusp,
    wheel_fr_susp: wheelFrSusp,
    wheel_rl_susp: wheelRlSusp,
    wheel_rr_susp: wheelRrSusp,
    wheel_fl_steer: wheelFlSteer,
    wheel_fr_steer: wheelFrSteer,
    wheel_fl_spin: wheelFlSpin,
    wheel_fr_spin: wheelFrSpin,
    wheel_rl_spin: wheelRlSpin,
    wheel_rr_spin: wheelRrSpin,
    upright_brake_fl: uprightBrakeFl,
    upright_brake_fr: uprightBrakeFr,
    upright_brake_rl: uprightBrakeRl,
    upright_brake_rr: uprightBrakeRr,
    brake_rotor_fl: brakeRotorFl,
    brake_rotor_fr: brakeRotorFr,
    brake_rotor_rl: brakeRotorRl,
    brake_rotor_rr: brakeRotorRr,
    rear_rain_light: rearRainLight,
    wheelSusp,
    wheelSteer,
    wheelSpin,
    uprightBrake,
    brakeRotors,
  };

  // Preallocated scratch state passed to materialSet.updateDynamicState (zero per-frame GC)
  const dynState = {
    avgTireTemp: 76.0,
    frontBrakeTemp: 220.0,
    rearBrakeTemp: 220.0,
    brake: 0.0,
    simTime: 0.0,
  };

  const rig = {
    root,
    modelScene,
    chassisRoot,
    nodes,
    materials: materialSet,
    validation,
    rawGltfScene,
    liveryKey,
    compoundId,

    /**
     * Live swaps all 4 Pirelli slick sidewall textures (`soft` / `medium` / `hard`).
     */
    setCompound(nextCompoundId) {
      const applied = materialSet.setCompound(nextCompoundId);
      rig.compoundId = applied;
      return applied;
    },

    /**
     * Synchronizes hero car 3D hierarchy, articulated suspension/steering/DRS/wheels,
     * dynamic tire roughness, glowing front/rear brake discs, and rain light from `F1VehiclePhysics`.
     * Strictly zero heap allocations.
     */
    updateFromPhysics(phys, _dt = 0, simTime = 0) {
      if (!phys) return;

      // World pose & yaw (+heading turns CCW left from -Z forward)
      root.position.set(phys.x || 0, phys.y || 0, phys.z || 0);
      root.rotation.set(0, phys.heading || 0, 0);

      // Chassis aero heave, acceleration/braking pitch, and cornering roll
      if (chassisRoot) {
        chassisRoot.position.y = baseChassisY - (phys.heaveM || 0);
        chassisRoot.rotation.x = phys.pitchRad || 0;
        chassisRoot.rotation.z = phys.rollRad || 0;
      }

      // Rear wing DRS upper flap hinge (+rotation.x opens slot 0 -> +28 deg)
      if (drsUpperFlap) {
        drsUpperFlap.rotation.x = phys.drsFlapAngle || 0;
      }

      // Cockpit steering wheel rotation around tilted -18 deg column axis
      if (steeringWheel) {
        steeringWheel.rotation.x = baseSteeringTiltX;
        steeringWheel.rotation.y = 0;
        steeringWheel.rotation.z = phys.steeringWheelAngle || 0;
      }

      // Front steering knuckles (+rotation.y turns -Z nose toward -X left)
      const steer = phys.steerAngle || 0;
      if (wheelFlSteer) wheelFlSteer.rotation.y = steer;
      if (wheelFrSteer) wheelFrSteer.rotation.y = steer;

      // 4-wheel spin (-rotation.x rolls tire top forward toward -Z) & suspension compression
      const wheelAngleArr = phys.wheelAngle;
      const suspArr = phys.suspOffset || phys.wheelSuspComp || phys.suspCompression;

      for (let i = 0; i < 4; i++) {
        const spinNode = wheelSpin[i];
        if (spinNode && wheelAngleArr) {
          spinNode.rotation.x = -(wheelAngleArr[i] || 0);
        }
        const suspNode = wheelSusp[i];
        if (suspNode) {
          const offset = suspArr ? (suspArr[i] || 0) : 0;
          suspNode.position.y = baseSuspY[i] + offset;
        }
      }

      // Live thermal & FIA rain light material update
      dynState.avgTireTemp = Number.isFinite(phys.avgTireTemp) ? phys.avgTireTemp : 76.0;
      dynState.frontBrakeTemp = Number.isFinite(phys.frontBrakeTemp)
        ? phys.frontBrakeTemp
        : (phys.brakeTemp ? 0.5 * (phys.brakeTemp[0] + phys.brakeTemp[1]) : 220.0);
      dynState.rearBrakeTemp = Number.isFinite(phys.rearBrakeTemp)
        ? phys.rearBrakeTemp
        : (phys.brakeTemp ? 0.5 * (phys.brakeTemp[2] + phys.brakeTemp[3]) : 220.0);
      dynState.brake = phys.brake || 0;
      dynState.simTime = Number.isFinite(simTime) ? simTime : (phys.simTime || 0);

      materialSet.updateDynamicState(dynState);
    },

    /**
     * Synchronizes an AI competitor car rig from an `AIRivalManager` rival entry.
     * Strictly zero heap allocations.
     */
    updateFromAI(aiCar, _dt = 0, simTime = 0) {
      if (!aiCar) return;

      root.position.set(aiCar.x || 0, aiCar.y || 0, aiCar.z || 0);
      root.rotation.set(0, aiCar.heading || 0, 0);

      const speedMs = aiCar.speedMs || 0;
      if (chassisRoot) {
        // Subtle speed-proportional aerodynamic ride-height compression
        const aiHeave = Math.min(0.022, speedMs * speedMs * 0.0000024);
        chassisRoot.position.y = baseChassisY - aiHeave;
        chassisRoot.rotation.x = aiCar.pitchRad || 0;
        chassisRoot.rotation.z = aiCar.rollRad || 0;
      }

      if (drsUpperFlap) {
        drsUpperFlap.rotation.x = aiCar.drsFlapAngle || 0;
      }

      const steer = aiCar.steerAngle || 0;
      if (steeringWheel) {
        steeringWheel.rotation.x = baseSteeringTiltX;
        steeringWheel.rotation.y = 0;
        steeringWheel.rotation.z = steer * 6.5;
      }
      if (wheelFlSteer) wheelFlSteer.rotation.y = steer;
      if (wheelFrSteer) wheelFrSteer.rotation.y = steer;

      const spinX = -(aiCar.wheelSpin || 0);
      for (let i = 0; i < 4; i++) {
        if (wheelSpin[i]) wheelSpin[i].rotation.x = spinX;
        if (wheelSusp[i]) wheelSusp[i].position.y = baseSuspY[i];
      }

      const bTemp = Number.isFinite(aiCar.brakeTemp) ? aiCar.brakeTemp : 220.0;
      dynState.avgTireTemp = 92.0;
      dynState.frontBrakeTemp = bTemp;
      dynState.rearBrakeTemp = 220.0 + (bTemp - 220.0) * 0.82;
      dynState.brake = aiCar.accelMs2 < -5.0 ? 0.85 : 0.0;
      dynState.simTime = Number.isFinite(simTime) ? simTime : 0;

      materialSet.updateDynamicState(dynState);
    },
  };

  return rig;
}

/**
 * Loads `./models/f1_car.glb` via Three.js `GLTFLoader`, computes crease-preserving
 * position-welded smooth normals (`42 deg`), upgrades every sub-mesh to Nano Banana PBR
 * materials, validates bounding box / grounding / triangle budget / articulated nodes,
 * logs `[F1 GLB & PBR Validation]`, and returns the hero `F1CarRig`.
 *
 * @param {import('./materials.js').PBRMaterialLibrary} materialLib
 * @param {string} [liveryKey='car_livery_player']
 * @param {string} [compoundId='soft']
 * @returns {Promise<object>}
 */
export async function loadHeroF1Car(
  materialLib,
  liveryKey = 'car_livery_player',
  compoundId = 'soft'
) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(MODEL_PATH);
  const loadedScene = gltf.scene;
  loadedScene.name = 'f1_car_glb_scene';

  // Ensure exact world matrices before unmodified bounding-box & triangle validation
  loadedScene.updateMatrixWorld(true);

  // Empirically verify glTF UV orientation on steering_wheel before binding textures
  const detectedFlipY = detectGlbUvFlipY(loadedScene);

  // Measure unmodified bounding box & triangle count AND run crease-preserving smooth normals
  let triangleCount = 0;
  let smoothedMeshes = 0;

  loadedScene.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    if (obj.material && obj.material.name) {
      obj.userData.origMaterialName = obj.material.name;
    }
    const origGeo = obj.geometry;
    const triCount = origGeo.index
      ? origGeo.index.count / 3
      : (origGeo.getAttribute('position')?.count || 0) / 3;
    triangleCount += Math.round(triCount);

    const smoothedGeo = _computeCreasePreservingSmoothNormals(origGeo, CREASE_ANGLE_DEG);
    if (smoothedGeo !== origGeo) {
      obj.geometry = smoothedGeo;
      origGeo.dispose();
    }
    smoothedMeshes++;
  });

  // Measure unmodified world-space Box3 (car rests at origin with wheels at Y = 0.000 m)
  loadedScene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(loadedScene);
  const size = new THREE.Vector3();
  box.getSize(size);

  const widthM = size.x;
  const heightM = size.y;
  const lengthM = size.z;
  const minY = box.min.y;
  const maxY = box.max.y;

  // Verify every required articulated node exists
  const verifiedNodes = [];
  const missingNodes = [];
  for (let i = 0; i < REQUIRED_ARTICULATED_NODES.length; i++) {
    const nodeName = REQUIRED_ARTICULATED_NODES[i];
    if (loadedScene.getObjectByName(nodeName)) {
      verifiedNodes.push(nodeName);
    } else {
      missingNodes.push(nodeName);
    }
  }

  // Keep a pristine unmodified template clone (sharing smoothed GPU BufferGeometries) for AI rivals
  const rawGltfScene = loadedScene.clone(true);
  rawGltfScene.name = 'f1_car_glb_template';

  // Create Nano Banana PBR material suite & bind onto hero car (disposing raw glTF placeholder mats)
  const materialSet = materialLib.createCarMaterialSet(liveryKey, compoundId, {
    flipY: detectedFlipY,
  });
  const { meshCount, allFlatShadingFalse } = bindCarMaterialsAndShadows(
    loadedScene,
    materialSet,
    true
  );

  // Evaluate normative Section 2 Step 3 & Step 4 validation assertions
  const boundsPassed =
    lengthM >= 5.40 &&
    lengthM <= 5.65 &&
    widthM >= 1.95 &&
    widthM <= 2.02 &&
    heightM >= 0.94 &&
    heightM <= 1.12;
  const groundingPassed = Math.abs(minY) < 0.002;
  const trianglesPassed = triangleCount >= 25000 && triangleCount <= 65000;
  const nodesPassed = missingNodes.length === 0;
  const pbrSummary = materialLib.getAuditSummary();

  const validation = {
    modelPath: MODEL_PATH,
    lengthM: Number(lengthM.toFixed(4)),
    widthM: Number(widthM.toFixed(4)),
    heightM: Number(heightM.toFixed(4)),
    minY: Number(minY.toFixed(5)),
    maxY: Number(maxY.toFixed(4)),
    boundsMin: [
      Number(box.min.x.toFixed(4)),
      Number(box.min.y.toFixed(5)),
      Number(box.min.z.toFixed(4)),
    ],
    boundsMax: [
      Number(box.max.x.toFixed(4)),
      Number(box.max.y.toFixed(4)),
      Number(box.max.z.toFixed(4)),
    ],
    triangleCount,
    meshCount,
    smoothedMeshes,
    creaseAngleDeg: CREASE_ANGLE_DEG,
    flatShadingDisabledAll: allFlatShadingFalse,
    uvFlipY: detectedFlipY,
    uvOrientation: detectedFlipY
      ? 'OpenGL bottom-left (flipY=true)'
      : 'glTF top-left (flipY=false)',
    requiredNodesCount: REQUIRED_ARTICULATED_NODES.length,
    foundNodesCount: verifiedNodes.length,
    verifiedNodes,
    missingNodes,
    boundsPassed,
    groundingPassed,
    trianglesPassed,
    nodesPassed,
    colorSpaceAuditPassed: pbrSummary.colorSpaceAuditPassed,
    allPassed:
      boundsPassed &&
      groundingPassed &&
      trianglesPassed &&
      nodesPassed &&
      allFlatShadingFalse &&
      pbrSummary.colorSpaceAuditPassed,
  };

  console.info(
    `[F1 GLB & PBR Validation] L=${validation.lengthM.toFixed(3)}m W=${validation.widthM.toFixed(3)}m ` +
      `H=${validation.heightM.toFixed(3)}m minY=${validation.minY >= 0 ? '+' : ''}${validation.minY.toFixed(5)}m | ` +
      `tris=${triangleCount.toLocaleString()} meshes=${meshCount} smooth=${CREASE_ANGLE_DEG}deg flatShading=false | ` +
      `nodes=${verifiedNodes.length}/${REQUIRED_ARTICULATED_NODES.length} missing=[${missingNodes.join(',')}] | ` +
      `UV=${validation.uvOrientation} | PBR_colorSpace=${pbrSummary.colorSpaceAuditPassed ? 'PASS' : 'FAIL'} | ` +
      `STATUS=${validation.allPassed ? 'ALL PASS' : 'CHECK'}`
  );

  return assembleCarRig(
    loadedScene,
    materialSet,
    validation,
    rawGltfScene,
    liveryKey,
    compoundId
  );
}

/**
 * Clones the pre-smoothed hero F1 `.glb` template for an AI competitor car, reusing all
 * GPU vertex/normal/UV buffers cleanly in memory while swapping in a distinct Nano Banana
 * rival livery, compound sidewall, and independent front/rear glowing brake rotors.
 *
 * @param {object} heroTemplate - The `F1CarRig` returned by `loadHeroF1Car` (or its `rawGltfScene`)
 * @param {import('./materials.js').PBRMaterialLibrary} materialLib
 * @param {string} [liveryKey='car_livery_rival_a']
 * @param {string} [compoundId='soft']
 * @param {object} [options={}]
 * @returns {object} Rival `F1CarRig`
 */
export function cloneRivalF1Car(
  heroTemplate,
  materialLib,
  liveryKey = 'car_livery_rival_a',
  compoundId = 'soft',
  options = {}
) {
  const sourceTemplate = heroTemplate && heroTemplate.rawGltfScene
    ? heroTemplate.rawGltfScene
    : heroTemplate;

  if (!sourceTemplate || typeof sourceTemplate.clone !== 'function') {
    throw new Error('[carBuilder] cloneRivalF1Car requires a valid heroTemplate with rawGltfScene.');
  }

  // Deep-clone scene graph hierarchy while sharing smoothed BufferGeometry buffers in GPU memory
  const rivalScene = sourceTemplate.clone(true);
  rivalScene.name = `f1_rival_scene_${liveryKey}`;

  const detectedFlipY = heroTemplate && heroTemplate.validation
    ? Boolean(heroTemplate.validation.uvFlipY)
    : false;

  const rivalMaterialSet = materialLib.createCarMaterialSet(liveryKey, compoundId, {
    flipY: detectedFlipY,
    liveryTintHex: options.liveryTintHex,
  });

  // Do NOT dispose template placeholder materials when binding rival clones
  bindCarMaterialsAndShadows(rivalScene, rivalMaterialSet, false);

  return assembleCarRig(
    rivalScene,
    rivalMaterialSet,
    heroTemplate.validation || null,
    sourceTemplate,
    liveryKey,
    compoundId
  );
}

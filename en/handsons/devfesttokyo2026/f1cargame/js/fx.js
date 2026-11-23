/**
 * Zero-Allocation GPU-Instanced Motorsport FX System (`MotorsportFXSystem`)
 *
 * Manages three strictly preallocated typed-array + THREE.InstancedMesh FX pools
 * with ZERO per-frame JavaScript allocations:
 *   1. Underbody Titanium Spark Cascades (MAX_SPARKS = 2000):
 *      - Elongated HDR diamond streaks (AdditiveBlending, depthWrite=false, toneMapped=false)
 *      - Thermal color aging: white-hot (#fff5cc) -> golden-orange (#ff8822) -> deep ember (#cc3300)
 *      - Ballistic gravity (-9.81), aero drag, and asphalt bounce (restitution 0.42)
 *      - Flickering warm-orange rear diffuser PointLight (#ff7722, distance 7.5 m)
 *   2. Tire Lockup & Wheelspin Smoke (MAX_SMOKE = 500):
 *      - Camera-aligned soft radial alpha-gradient billboard sprites (#cfd4dc)
 *      - Smooth rise, expansion, spin, and per-instance alpha fade
 *   3. Dynamic Tire Skid-Mark Ribbons (MAX_SKIDS = 1200):
 *      - Ring-buffered dark rubber decals (#1c1e22, opacity 0.62, polygonOffset)
 *      - Projected 0.010 m above banked road surface aligned to wheel velocity vector
 */

import * as THREE from 'three';
import { CAR_DIMS, SURFACE_TYPES } from './constants.js';

const MAX_SPARKS = 2000;
const MAX_SMOKE = 500;
const MAX_SKIDS = 1200;

const GRAVITY = -9.81;
const SPARK_RESTITUTION = 0.42;
const SPARK_DRAG = 0.55;
const SKID_LIFT_M = 0.010;

// Local wheel offsets (0: FL, 1: FR, 2: RL, 3: RR) matching Section 1.2 & physics.js
const WHEEL_LOCAL_X = new Float32Array([
  -CAR_DIMS.FRONT_TRACK * 0.5,
  CAR_DIMS.FRONT_TRACK * 0.5,
  -CAR_DIMS.REAR_TRACK * 0.5,
  CAR_DIMS.REAR_TRACK * 0.5,
]);
const WHEEL_LOCAL_Z = new Float32Array([
  CAR_DIMS.FRONT_AXLE_Z,
  CAR_DIMS.FRONT_AXLE_Z,
  CAR_DIMS.REAR_AXLE_Z,
  CAR_DIMS.REAR_AXLE_Z,
]);
const WHEEL_WIDTH = new Float32Array([
  CAR_DIMS.FRONT_TIRE_WIDTH,
  CAR_DIMS.FRONT_TIRE_WIDTH,
  CAR_DIMS.REAR_TIRE_WIDTH,
  CAR_DIMS.REAR_TIRE_WIDTH,
]);

// Underfloor titanium skid block emission origin in local chassis coordinates
const SKID_BLOCK_LOCAL_X = 0.0;
const SKID_BLOCK_LOCAL_Y = 0.04;
const SKID_BLOCK_LOCAL_Z = 1.25;

// Diffuser flickering point-light local offset
const DIFFUSER_LIGHT_LOCAL_Y = 0.22;
const DIFFUSER_LIGHT_LOCAL_Z = 2.05;

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Build a lightweight 8-triangle elongated diamond streak oriented along local +Z
 * (unit length 1.0 from z = -0.5 tail to z = +0.5 leading tip).
 */
function createSparkStreakGeometry() {
  const r = 0.022;
  const zMid = 0.14;
  // 6 vertices: 0 = front tip (+Z), 1 = rear tail (-Z), 2..5 = diamond cross ring
  const positions = new Float32Array([
    0.0,  0.0,  0.50,
    0.0,  0.0, -0.50,
     r,   0.0,  zMid,
    0.0,   r,   zMid,
    -r,   0.0,  zMid,
    0.0,  -r,   zMid,
  ]);

  const indices = new Uint16Array([
    // Leading pyramid (front tip)
    0, 3, 2,
    0, 4, 3,
    0, 5, 4,
    0, 2, 5,
    // Trailing streak tail
    1, 2, 3,
    1, 3, 4,
    1, 4, 5,
    1, 5, 2,
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generate a soft organic radial alpha-gradient smoke puff sprite texture (SRGBColorSpace).
 */
function createSmokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);

  // Layered soft off-center radial clouds for wispy rubber smoke look
  const lobes = [
    [64, 64, 58, 0.58],
    [52, 58, 42, 0.34],
    [78, 60, 40, 0.32],
    [62, 76, 38, 0.28],
    [66, 50, 36, 0.26],
  ];
  for (let i = 0; i < lobes.length; i++) {
    const [cx, cy, rad, peak] = lobes[i];
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0.0, `rgba(232, 236, 242, ${peak})`);
    grad.addColorStop(0.42, `rgba(218, 222, 230, ${peak * 0.58})`);
    grad.addColorStop(0.76, `rgba(205, 210, 218, ${peak * 0.16})`);
    grad.addColorStop(1.0, 'rgba(205, 210, 218, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generate a longitudinally striated, edge-feathered tire rubber contact patch
 * alpha texture so consecutive ring-buffered skid quads meld into smooth ribbons.
 */
function createSkidDecalTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);

  // Cross-section contact pressure profile (strong shoulders + smooth outer feather)
  const horiz = ctx.createLinearGradient(0, 0, 64, 0);
  horiz.addColorStop(0.00, 'rgba(255, 255, 255, 0.0)');
  horiz.addColorStop(0.12, 'rgba(255, 255, 255, 0.92)');
  horiz.addColorStop(0.28, 'rgba(255, 255, 255, 1.0)');
  horiz.addColorStop(0.50, 'rgba(255, 255, 255, 0.84)');
  horiz.addColorStop(0.72, 'rgba(255, 255, 255, 1.0)');
  horiz.addColorStop(0.88, 'rgba(255, 255, 255, 0.92)');
  horiz.addColorStop(1.00, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = horiz;
  ctx.fillRect(0, 0, 64, 64);

  // Subtle longitudinal end feather so overlapping quad ends stay seamless
  ctx.globalCompositeOperation = 'destination-in';
  const vert = ctx.createLinearGradient(0, 0, 0, 64);
  vert.addColorStop(0.00, 'rgba(255, 255, 255, 0.0)');
  vert.addColorStop(0.14, 'rgba(255, 255, 255, 1.0)');
  vert.addColorStop(0.86, 'rgba(255, 255, 255, 1.0)');
  vert.addColorStop(1.00, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = vert;
  ctx.fillRect(0, 0, 64, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export class MotorsportFXSystem {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'motorsport_fx_system';
    this.scene.add(this.root);

    // Fast xorshift32 PRNG state (zero allocation, faster than Math.random)
    this._rngState = 0x9e3779b9;
    this._time = 0;

    // Lazily bound zero-allocation track sample buffer
    this._trackBuf = null;
    this._trailBufA = null;
    this._trailBufB = null;

    // -------------------------------------------------------------------------
    // 1. Underbody Titanium Spark Cascades (MAX_SPARKS = 2000)
    // -------------------------------------------------------------------------
    this.maxSparks = MAX_SPARKS;
    this.sparkCount = 0;
    this._sparkAccum = 0;
    this._scrapeAccum = 0;
    this._sparkOverwriteIdx = 0;

    // Preallocated Structure-of-Arrays (SoA) typed buffers
    this._spX = new Float32Array(MAX_SPARKS);
    this._spY = new Float32Array(MAX_SPARKS);
    this._spZ = new Float32Array(MAX_SPARKS);
    this._spVx = new Float32Array(MAX_SPARKS);
    this._spVy = new Float32Array(MAX_SPARKS);
    this._spVz = new Float32Array(MAX_SPARKS);
    this._spAge = new Float32Array(MAX_SPARKS);
    this._spLife = new Float32Array(MAX_SPARKS);
    this._spScale = new Float32Array(MAX_SPARKS);
    this._spGroundY = new Float32Array(MAX_SPARKS);

    const sparkGeo = createSparkStreakGeometry();
    this._sparkMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffbb44),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    this.sparkMesh = new THREE.InstancedMesh(sparkGeo, this._sparkMat, MAX_SPARKS);
    this.sparkMesh.name = 'fx_titanium_sparks';
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.renderOrder = 12;

    // Pre-initialize instanceColor buffer so WebGL never recompiles shader on first spark
    const initColor = new THREE.Color(0x000000);
    const identityMat = new THREE.Matrix4();
    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparkMesh.setMatrixAt(i, identityMat);
      this.sparkMesh.setColorAt(i, initColor);
    }
    this.sparkMesh.count = 0;
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    this.sparkMesh.instanceColor.needsUpdate = true;
    this.root.add(this.sparkMesh);

    // Precomputed linear thermal keyframe colors for zero-alloc per-instance HDR spark tinting
    // Multiplied against material color #ffbb44 -> white-hot #fff5cc -> gold #ff8822 -> ember #cc3300
    this._colHot = new THREE.Color(0xfff5cc);
    this._colMid = new THREE.Color(0xff8822);
    this._colEmber = new THREE.Color(0xcc3300);

    // Flickering warm-orange rear diffuser PointLight (#ff7722, distance 7.5 m)
    this.sparkLight = new THREE.PointLight(0xff7722, 0.0, 7.5, 1.8);
    this.sparkLight.name = 'fx_diffuser_spark_light';
    this.root.add(this.sparkLight);

    // -------------------------------------------------------------------------
    // 2. Tire Lockup & Wheelspin Smoke (MAX_SMOKE = 500)
    // -------------------------------------------------------------------------
    this.maxSmoke = MAX_SMOKE;
    this.smokeCount = 0;
    this._smokeAccum = new Float32Array(4);
    this._smokeOverwriteIdx = 0;

    this._smX = new Float32Array(MAX_SMOKE);
    this._smY = new Float32Array(MAX_SMOKE);
    this._smZ = new Float32Array(MAX_SMOKE);
    this._smVx = new Float32Array(MAX_SMOKE);
    this._smVy = new Float32Array(MAX_SMOKE);
    this._smVz = new Float32Array(MAX_SMOKE);
    this._smAge = new Float32Array(MAX_SMOKE);
    this._smLife = new Float32Array(MAX_SMOKE);
    this._smSize0 = new Float32Array(MAX_SMOKE);
    this._smSize1 = new Float32Array(MAX_SMOKE);
    this._smSpin = new Float32Array(MAX_SMOKE);
    this._smSpinVel = new Float32Array(MAX_SMOKE);
    this._smPeakAlpha = new Float32Array(MAX_SMOKE);

    // Per-instance vec3 attribute: [size, spinRad, alpha]
    this._smokeParams = new Float32Array(MAX_SMOKE * 3);
    this._smokeParamsAttr = new THREE.InstancedBufferAttribute(this._smokeParams, 3);
    this._smokeParamsAttr.setUsage(THREE.DynamicDrawUsage);

    const smokeGeo = new THREE.PlaneGeometry(1.0, 1.0);
    smokeGeo.setAttribute('aSmokeParams', this._smokeParamsAttr);

    const smokeTex = createSmokeTexture();
    this._smokeMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: smokeTex },
        uColor: { value: new THREE.Color(0xcfd4dc) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSmokeParams;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vUv = uv;
          vAlpha = aSmokeParams.z;
          vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float sz = aSmokeParams.x;
          float c = cos(aSmokeParams.y);
          float s = sin(aSmokeParams.y);
          vec2 rot = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * sz;
          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 worldPos = center + camRight * rot.x + camUp * rot.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, vUv);
          float alpha = tex.a * vAlpha;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uColor * tex.rgb, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
    });

    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, this._smokeMat, MAX_SMOKE);
    this.smokeMesh.name = 'fx_tire_smoke';
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 10;
    for (let i = 0; i < MAX_SMOKE; i++) {
      this.smokeMesh.setMatrixAt(i, identityMat);
    }
    this.smokeMesh.count = 0;
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.root.add(this.smokeMesh);

    // -------------------------------------------------------------------------
    // 3. Dynamic Tire Skid-Mark Ribbons (MAX_SKIDS = 1200)
    // -------------------------------------------------------------------------
    this.maxSkids = MAX_SKIDS;
    this._skidHead = 0;
    this._skidCount = 0;
    this._prevWheelX = new Float32Array(4);
    this._prevWheelZ = new Float32Array(4);
    this._prevWheelActive = new Uint8Array(4);

    const skidGeo = new THREE.PlaneGeometry(1.0, 1.0);
    skidGeo.rotateX(-Math.PI / 2); // horizontal quad in XZ with +Y normal

    const skidTex = createSkidDecalTexture();
    this._skidMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x1c1e22),
      map: skidTex,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.skidMesh = new THREE.InstancedMesh(skidGeo, this._skidMat, MAX_SKIDS);
    this.skidMesh.name = 'fx_tire_skid_marks';
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 4;
    for (let i = 0; i < MAX_SKIDS; i++) {
      this.skidMesh.setMatrixAt(i, identityMat);
    }
    this.skidMesh.count = 0;
    this.skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skidMesh.instanceMatrix.needsUpdate = true;
    this.root.add(this.skidMesh);
  }

  /**
   * Zero-allocation fast float PRNG in [0, 1).
   */
  _rand() {
    let x = this._rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._rngState = x >>> 0;
    return this._rngState / 4294967296;
  }

  _randSigned() {
    return this._rand() * 2.0 - 1.0;
  }

  _ensureCircuitBuffers(circuit) {
    if (!circuit || typeof circuit.createSampleBuffer !== 'function') return;
    if (!this._trackBuf) {
      this._trackBuf = circuit.createSampleBuffer();
      this._trailBufA = circuit.createSampleBuffer();
      this._trailBufB = circuit.createSampleBuffer();
    }
  }

  /**
   * Spawn a single ballistic titanium spark into the preallocated SoA pool.
   */
  _spawnSpark(px, py, pz, vx, vy, vz, life, scale, groundY, initialAge = 0.0) {
    let idx;
    if (this.sparkCount < MAX_SPARKS) {
      idx = this.sparkCount++;
    } else {
      idx = this._sparkOverwriteIdx;
      this._sparkOverwriteIdx = (this._sparkOverwriteIdx + 1) % MAX_SPARKS;
    }

    this._spX[idx] = px;
    this._spY[idx] = py;
    this._spZ[idx] = pz;
    this._spVx[idx] = vx;
    this._spVy[idx] = vy;
    this._spVz[idx] = vz;
    this._spAge[idx] = initialAge;
    this._spLife[idx] = life;
    this._spScale[idx] = scale;
    this._spGroundY[idx] = groundY;
  }

  /**
   * Spawn a single tire smoke puff into the preallocated SoA pool.
   */
  _spawnSmoke(px, py, pz, vx, vy, vz, life, size0, size1, peakAlpha) {
    let idx;
    if (this.smokeCount < MAX_SMOKE) {
      idx = this.smokeCount++;
    } else {
      idx = this._smokeOverwriteIdx;
      this._smokeOverwriteIdx = (this._smokeOverwriteIdx + 1) % MAX_SMOKE;
    }

    this._smX[idx] = px;
    this._smY[idx] = py;
    this._smZ[idx] = pz;
    this._smVx[idx] = vx;
    this._smVy[idx] = vy;
    this._smVz[idx] = vz;
    this._smAge[idx] = 0.0;
    this._smLife[idx] = life;
    this._smSize0[idx] = size0;
    this._smSize1[idx] = size1;
    this._smSpin[idx] = this._rand() * Math.PI * 2.0;
    this._smSpinVel[idx] = this._randSigned() * 1.4;
    this._smPeakAlpha[idx] = peakAlpha;
  }

  /**
   * Stamp one ring-buffered dark rubber skid-mark quad directly into the
   * skidMesh instanceMatrix Float32Array (zero allocations).
   */
  _stampSkidQuad(cx, cy, cz, dirX, dirZ, nx, ny, nz, widthM, lengthM) {
    const slot = this._skidHead;
    this._skidHead = (this._skidHead + 1) % MAX_SKIDS;
    if (this._skidCount < MAX_SKIDS) this._skidCount++;

    // Project horizontal direction onto road plane orthogonal to surface normal N
    const dotDN = dirX * nx + dirZ * nz;
    let fx = dirX - dotDN * nx;
    let fy = -dotDN * ny;
    let fz = dirZ - dotDN * nz;
    const fLen = Math.hypot(fx, fy, fz);
    if (fLen < 1e-5) {
      fx = 0; fy = 0; fz = -1;
    } else {
      const invF = 1.0 / fLen;
      fx *= invF; fy *= invF; fz *= invF;
    }

    // Right basis R = N x F (guarantees right-handed det([R, N, F]) = +1 so +Y quad faces +N)
    let rx = ny * fz - nz * fy;
    let ry = nz * fx - nx * fz;
    let rz = nx * fy - ny * fx;
    const rLen = Math.hypot(rx, ry, rz) || 1.0;
    const invR = 1.0 / rLen;
    rx *= invR; ry *= invR; rz *= invR;

    const arr = this.skidMesh.instanceMatrix.array;
    const o = slot * 16;
    // Column 0: X basis * widthM
    arr[o]     = rx * widthM;
    arr[o + 1] = ry * widthM;
    arr[o + 2] = rz * widthM;
    arr[o + 3] = 0;
    // Column 1: Y basis (surface normal)
    arr[o + 4] = nx;
    arr[o + 5] = ny;
    arr[o + 6] = nz;
    arr[o + 7] = 0;
    // Column 2: Z basis * lengthM
    arr[o + 8]  = fx * lengthM;
    arr[o + 9]  = fy * lengthM;
    arr[o + 10] = fz * lengthM;
    arr[o + 11] = 0;
    // Column 3: World position lifted SKID_LIFT_M above asphalt
    arr[o + 12] = cx + nx * SKID_LIFT_M;
    arr[o + 13] = cy + ny * SKID_LIFT_M;
    arr[o + 14] = cz + nz * SKID_LIFT_M;
    arr[o + 15] = 1;
  }

  /**
   * Write a single spark's elongated oriented matrix and HDR thermal color
   * directly into sparkMesh buffers (zero allocations).
   */
  _writeSparkInstance(i, px, py, pz, vx, vy, vz, ageFrac, scaleMult) {
    const spd = Math.hypot(vx, vy, vz);
    let zx, zy, zz;
    if (spd > 0.05) {
      const invS = 1.0 / spd;
      zx = vx * invS;
      zy = vy * invS;
      zz = vz * invS;
    } else {
      zx = 0; zy = -1; zz = 0;
    }

    // Build orthonormal basis (R, U, Z) aligned along spark velocity vector
    let rx, ry, rz;
    if (Math.abs(zy) < 0.94) {
      // worldUp (0,1,0) x Z = (zz, 0, -zx)
      const len = Math.hypot(zz, zx) || 1.0;
      rx = zz / len;
      ry = 0.0;
      rz = -zx / len;
    } else {
      // (1,0,0) x Z = (0, -zz, zy)
      const len = Math.hypot(zz, zy) || 1.0;
      rx = 0.0;
      ry = -zz / len;
      rz = zy / len;
    }
    // U = Z x R
    const ux = zy * rz - zz * ry;
    const uy = zz * rx - zx * rz;
    const uz = zx * ry - zy * rx;

    const fade = 1.0 - ageFrac;
    const thick = scaleMult * (0.55 + 0.65 * fade);
    const len = clamp(spd * 0.026, 0.20, 1.40) * (0.45 + 0.55 * fade) * scaleMult;

    const mArr = this.sparkMesh.instanceMatrix.array;
    const o = i * 16;
    mArr[o]     = rx * thick;
    mArr[o + 1] = ry * thick;
    mArr[o + 2] = rz * thick;
    mArr[o + 3] = 0;
    mArr[o + 4] = ux * thick;
    mArr[o + 5] = uy * thick;
    mArr[o + 6] = uz * thick;
    mArr[o + 7] = 0;
    mArr[o + 8]  = zx * len;
    mArr[o + 9]  = zy * len;
    mArr[o + 10] = zz * len;
    mArr[o + 11] = 0;
    mArr[o + 12] = px;
    mArr[o + 13] = py;
    mArr[o + 14] = pz;
    mArr[o + 15] = 1;

    // Thermal blackbody progression: white-hot #fff5cc -> golden-orange #ff8822 -> deep ember #cc3300
    // HDR multiplier drives selective bloom trails cleanly (material toneMapped = false)
    let cr, cg, cb;
    if (ageFrac < 0.35) {
      const t = ageFrac / 0.35;
      cr = this._colHot.r + (this._colMid.r - this._colHot.r) * t;
      cg = this._colHot.g + (this._colMid.g - this._colHot.g) * t;
      cb = this._colHot.b + (this._colMid.b - this._colHot.b) * t;
    } else {
      const t = (ageFrac - 0.35) / 0.65;
      cr = this._colMid.r + (this._colEmber.r - this._colMid.r) * t;
      cg = this._colMid.g + (this._colEmber.g - this._colMid.g) * t;
      cb = this._colMid.b + (this._colEmber.b - this._colMid.b) * t;
    }

    const hdrBoost = (2.8 * (1.0 - ageFrac * 0.68)) * clamp((1.0 - ageFrac) * 4.5, 0, 1);
    const cArr = this.sparkMesh.instanceColor.array;
    const cOff = i * 3;
    cArr[cOff]     = cr * hdrBoost;
    cArr[cOff + 1] = cg * hdrBoost;
    cArr[cOff + 2] = cb * hdrBoost;
  }

  /**
   * Main per-frame update (ZERO heap allocations).
   * @param {number} dt - frame delta in seconds
   * @param {object} phys - F1VehiclePhysics or telemetry snapshot
   * @param {import('./trackSpline.js').TokyoGPCircuit|null} circuit
   */
  update(dt, phys, circuit) {
    const safeDt = clamp(dt || 0, 0, 0.05);
    this._time += safeDt;
    if (circuit) this._ensureCircuitBuffers(circuit);

    // Derive car basis vectors in world XZ (heading = 0 faces -Z, +heading turns left)
    const hasPhys = Boolean(phys);
    const carX = hasPhys ? (phys.x || 0) : 0;
    const carY = hasPhys ? (phys.y || 0) : 0;
    const carZ = hasPhys ? (phys.z || 0) : 0;
    const heading = hasPhys ? (phys.heading || 0) : 0;
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    const fwdX = -sinH;
    const fwdZ = -cosH;
    const rightX = cosH;
    const rightZ = -sinH;
    const carVx = hasPhys ? (phys.vx || 0) : 0;
    const carVz = hasPhys ? (phys.vz || 0) : 0;
    const speedMs = hasPhys ? (phys.speedMs ?? Math.hypot(carVx, carVz)) : 0;

    // Sample local road plane once per frame for O(1) spark bounces & banked skid decals
    let refX = carX, refY = carY, refZ = carZ;
    let refTx = fwdX, refTy = 0, refTz = fwdZ;
    let refRxH = rightX, refRzH = rightZ;
    let refNx = 0, refNy = 1, refNz = 0;
    let refSinBank = 0;
    if (circuit && this._trackBuf && hasPhys) {
      const s = phys.trackS || 0;
      circuit.sampleAtS(s, this._trackBuf);
      const b = this._trackBuf;
      refX = b.x; refY = b.y; refZ = b.z;
      refTx = b.tx; refTy = b.ty; refTz = b.tz;
      const rLen = Math.hypot(b.rx, b.rz) || 1;
      refRxH = b.rx / rLen;
      refRzH = b.rz / rLen;
      refNx = b.nx; refNy = b.ny; refNz = b.nz;
      refSinBank = Math.sin(b.banking);
    }

    // -------------------------------------------------------------------------
    // A. Emit Underbody Titanium Sparks & Barrier Scrape Sparks
    // -------------------------------------------------------------------------
    if (hasPhys && safeDt > 0) {
      const sparkInt = phys.sparkIntensity || 0;
      const scrapeInt = phys.barrierScrapeIntensity || 0;
      const plankInt = Math.max(0, sparkInt - scrapeInt * 0.5);

      // Underfloor titanium skid block (0, 0.04, +1.25) in car local space
      if (sparkInt > 0.04 && (plankInt > 0.04 || scrapeInt <= 0.04)) {
        const rate = 220 + sparkInt * 980; // up to ~1200 sparks/sec at peak compression
        this._sparkAccum += rate * safeDt;
        const emitN = Math.min(48, Math.floor(this._sparkAccum));
        this._sparkAccum -= emitN;

        const baseX = carX + SKID_BLOCK_LOCAL_X * rightX - SKID_BLOCK_LOCAL_Z * fwdX;
        const baseY = carY + SKID_BLOCK_LOCAL_Y;
        const baseZ = carZ + SKID_BLOCK_LOCAL_X * rightZ - SKID_BLOCK_LOCAL_Z * fwdZ;

        for (let k = 0; k < emitN; k++) {
          const jitterLat = this._randSigned() * 0.24;
          const jitterLong = this._randSigned() * 0.35;
          const px = baseX + jitterLat * rightX - jitterLong * fwdX;
          const py = baseY + this._rand() * 0.04;
          const pz = baseZ + jitterLat * rightZ - jitterLong * fwdZ;

          // Detach moving slower than chassis -> shoots rearward relative to diffuser
          const keepFrac = 0.26 + this._rand() * 0.42;
          const fanLat = this._randSigned() * (1.8 + speedMs * 0.045);
          const vx = carVx * keepFrac + rightX * fanLat;
          const vz = carVz * keepFrac + rightZ * fanLat;
          const vy = 0.65 + this._rand() * (2.4 + sparkInt * 1.4);

          const life = 0.22 + this._rand() * 0.36;
          const sc = 0.78 + this._rand() * 0.58;
          this._spawnSpark(px, py, pz, vx, vy, vz, life, sc, carY);
        }
      } else {
        this._sparkAccum = 0;
      }

      // Scraping car flank against Tecpro / Armco barrier
      if (scrapeInt > 0.04) {
        const scrapeRate = 180 + scrapeInt * 720;
        this._scrapeAccum += scrapeRate * safeDt;
        const emitS = Math.min(36, Math.floor(this._scrapeAccum));
        this._scrapeAccum -= emitS;

        const sideSign = (phys.dLat || 0) >= 0 ? 1 : -1;
        for (let k = 0; k < emitS; k++) {
          const lx = sideSign * 0.98;
          const ly = 0.20 + this._rand() * 0.34;
          const lz = -0.85 + this._rand() * 2.35;

          const px = carX + lx * rightX - lz * fwdX;
          const py = carY + ly;
          const pz = carZ + lx * rightZ - lz * fwdZ;

          const keepFrac = 0.22 + this._rand() * 0.38;
          const inward = -sideSign * (1.5 + this._rand() * 3.8);
          const vx = carVx * keepFrac + rightX * inward;
          const vz = carVz * keepFrac + rightZ * inward;
          const vy = 0.8 + this._rand() * 3.4;

          const life = 0.24 + this._rand() * 0.36;
          const sc = 0.85 + this._rand() * 0.6;
          this._spawnSpark(px, py, pz, vx, vy, vz, life, sc, carY);
        }
      } else {
        this._scrapeAccum = 0;
      }

      // -----------------------------------------------------------------------
      // B. Emit Per-Wheel Tire Smoke & Dynamic Skid-Mark Ribbons
      // -----------------------------------------------------------------------
      const slipRatios = phys.wheelSlipRatio;
      const slipAngles = phys.wheelSlipAngle;
      const wheelGroundY = phys.wheelGroundY;
      const wheelSurfaces = phys.wheelSurface;
      const globalSkid = phys.skidIntensity || 0;
      const globalSmoke = phys.smokeIntensity || 0;
      const yawRate = phys.yawRate || 0;

      for (let w = 0; w < 4; w++) {
        let wSkid = globalSkid;
        let wSmoke = globalSmoke;
        if (slipRatios && slipAngles) {
          const absK = Math.abs(slipRatios[w]);
          const absA = Math.abs(slipAngles[w]);
          if (speedMs > 3.5) {
            wSkid = Math.max(
              clamp((absK - 0.18) / 0.30, 0, 1),
              clamp((absA - 0.18) / 0.22, 0, 1)
            );
            wSmoke = Math.max(
              clamp((absK - 0.22) / 0.35, 0, 1),
              clamp((absA - 0.24) / 0.25, 0, 1)
            );
          } else {
            wSkid = 0;
            wSmoke = 0;
          }
          // Honor direct global override if telemetry boost is set higher
          if (globalSmoke > wSmoke && w >= 2) wSmoke = Math.max(wSmoke, globalSmoke * 0.85);
        }

        const lx = WHEEL_LOCAL_X[w];
        const lz = WHEEL_LOCAL_Z[w];
        const wx = carX + lx * rightX - lz * fwdX;
        const wz = carZ + lx * rightZ - lz * fwdZ;
        const wy = wheelGroundY ? wheelGroundY[w] : carY;

        // World velocity at wheel contact patch (v_cg + omega x r)
        const vLocalLong = (phys.vLong ?? speedMs) - yawRate * lx;
        const vLocalRight = (phys.vLat ?? 0) - yawRate * lz;
        const wVx = vLocalLong * fwdX + vLocalRight * rightX;
        const wVz = vLocalLong * fwdZ + vLocalRight * rightZ;
        const wSpd = Math.hypot(wVx, wVz);

        // Tire lockup & wheelspin smoke behind any wheel with skid or smoke > 0.25
        const smokeTrigger = Math.max(wSkid, wSmoke);
        if (smokeTrigger > 0.25 && speedMs > 3.5) {
          const emitRate = 12 + smokeTrigger * 34;
          this._smokeAccum[w] += emitRate * safeDt;
          const spawnCount = Math.min(4, Math.floor(this._smokeAccum[w]));
          this._smokeAccum[w] -= spawnCount;

          for (let s = 0; s < spawnCount; s++) {
            const sx = wx - fwdX * (0.28 + this._rand() * 0.22) + rightX * this._randSigned() * 0.14;
            const sy = wy + 0.16 + this._rand() * 0.12;
            const sz = wz - fwdZ * (0.28 + this._rand() * 0.22) + rightZ * this._randSigned() * 0.14;

            const svx = carVx * 0.16 + rightX * this._randSigned() * 0.85;
            const svy = 0.65 + this._rand() * 0.85;
            const svz = carVz * 0.16 + rightZ * this._randSigned() * 0.85;

            const life = 0.65 + this._rand() * 0.55;
            const size0 = 0.42 + this._rand() * 0.18;
            const size1 = 1.65 + this._rand() * 0.85;
            const peakA = (0.24 + 0.26 * smokeTrigger);
            this._spawnSmoke(sx, sy, sz, svx, svy, svz, life, size0, size1, peakA);
          }
        } else {
          this._smokeAccum[w] = 0;
        }

        // Dynamic dark rubber skid-mark ribbons on hard paved surfaces when wheelSkid > 0.28
        const surf = wheelSurfaces ? wheelSurfaces[w] : SURFACE_TYPES.ASPHALT;
        const onPaved = surf !== SURFACE_TYPES.GRASS && surf !== SURFACE_TYPES.GRAVEL;
        if (wSkid > 0.28 && wSpd > 3.0 && onPaved) {
          if (this._prevWheelActive[w]) {
            const dx = wx - this._prevWheelX[w];
            const dz = wz - this._prevWheelZ[w];
            const dist = Math.hypot(dx, dz);
            if (dist >= 0.52) {
              const segLen = clamp(dist * 1.15, 0.68, 2.2);
              const midX = 0.5 * (wx + this._prevWheelX[w]);
              const midZ = 0.5 * (wz + this._prevWheelZ[w]);
              const dirX = dx / dist;
              const dirZ = dz / dist;
              const widthM = WHEEL_WIDTH[w] * (0.86 + 0.16 * wSkid);

              this._stampSkidQuad(midX, wy, midZ, dirX, dirZ, refNx, refNy, refNz, widthM, segLen);
              this._prevWheelX[w] = wx;
              this._prevWheelZ[w] = wz;
            }
          } else {
            this._prevWheelX[w] = wx;
            this._prevWheelZ[w] = wz;
            this._prevWheelActive[w] = 1;
          }
        } else {
          this._prevWheelActive[w] = 0;
        }
      }
    }

    // -------------------------------------------------------------------------
    // C. Integrate Active Titanium Sparks (Ballistic Gravity, Drag & Bounce)
    // -------------------------------------------------------------------------
    const dragFactor = Math.max(0, 1.0 - SPARK_DRAG * safeDt);
    let i = 0;
    while (i < this.sparkCount) {
      const age = this._spAge[i] + safeDt;
      const life = this._spLife[i];
      if (age >= life) {
        // O(1) swap-remove with last active spark
        const last = this.sparkCount - 1;
        if (i !== last) {
          this._spX[i] = this._spX[last];
          this._spY[i] = this._spY[last];
          this._spZ[i] = this._spZ[last];
          this._spVx[i] = this._spVx[last];
          this._spVy[i] = this._spVy[last];
          this._spVz[i] = this._spVz[last];
          this._spAge[i] = this._spAge[last];
          this._spLife[i] = this._spLife[last];
          this._spScale[i] = this._spScale[last];
          this._spGroundY[i] = this._spGroundY[last];
        }
        this.sparkCount--;
        continue;
      }

      let px = this._spX[i];
      let py = this._spY[i];
      let pz = this._spZ[i];
      let vx = this._spVx[i] * dragFactor;
      let vy = (this._spVy[i] + GRAVITY * safeDt) * dragFactor;
      let vz = this._spVz[i] * dragFactor;

      px += vx * safeDt;
      py += vy * safeDt;
      pz += vz * safeDt;

      // O(1) banked local road-plane ground height estimate for crisp asphalt bounces
      const dsApprox = (px - refX) * refTx + (pz - refZ) * refTz;
      const dLatApprox = (px - refX) * refRxH + (pz - refZ) * refRzH;
      const localGroundY = Math.abs(dsApprox) < 42.0
        ? (refY + dsApprox * refTy + dLatApprox * refSinBank)
        : this._spGroundY[i];

      if (py < localGroundY + 0.015) {
        py = localGroundY + 0.015;
        if (vy < 0) {
          vy = -vy * SPARK_RESTITUTION;
          // Slight realistic scatter & friction deflection across basalt aggregate
          const scatter = (0.8 + Math.abs(vy) * 0.45);
          vx = vx * 0.86 + this._randSigned() * scatter;
          vz = vz * 0.86 + this._randSigned() * scatter;
        }
      }

      this._spX[i] = px;
      this._spY[i] = py;
      this._spZ[i] = pz;
      this._spVx[i] = vx;
      this._spVy[i] = vy;
      this._spVz[i] = vz;
      this._spAge[i] = age;

      this._writeSparkInstance(i, px, py, pz, vx, vy, vz, age / life, this._spScale[i]);
      i++;
    }

    this.sparkMesh.count = this.sparkCount;
    if (this.sparkCount > 0) {
      this.sparkMesh.instanceMatrix.needsUpdate = true;
      this.sparkMesh.instanceColor.needsUpdate = true;
    }

    // Update flickering warm-orange PointLight under rear diffuser
    if (hasPhys) {
      const lx = carX - DIFFUSER_LIGHT_LOCAL_Z * fwdX;
      const ly = carY + DIFFUSER_LIGHT_LOCAL_Y;
      const lz = carZ - DIFFUSER_LIGHT_LOCAL_Z * fwdZ;
      this.sparkLight.position.set(lx, ly, lz);
    }
    if (this.sparkCount > 0) {
      const density = clamp(this.sparkCount / 140, 0, 1);
      const flicker = 0.76 + 0.24 * Math.sin(this._time * 61.0) * Math.cos(this._time * 37.0 + 0.7);
      this.sparkLight.intensity = density * 7.2 * flicker;
    } else {
      this.sparkLight.intensity = 0.0;
    }

    // -------------------------------------------------------------------------
    // D. Integrate Active Tire Smoke Billboards
    // -------------------------------------------------------------------------
    const smokeDrag = Math.max(0, 1.0 - 2.1 * safeDt);
    const smMatArr = this.smokeMesh.instanceMatrix.array;
    const smParams = this._smokeParams;

    let sIdx = 0;
    while (sIdx < this.smokeCount) {
      const age = this._smAge[sIdx] + safeDt;
      const life = this._smLife[sIdx];
      if (age >= life) {
        const last = this.smokeCount - 1;
        if (sIdx !== last) {
          this._smX[sIdx] = this._smX[last];
          this._smY[sIdx] = this._smY[last];
          this._smZ[sIdx] = this._smZ[last];
          this._smVx[sIdx] = this._smVx[last];
          this._smVy[sIdx] = this._smVy[last];
          this._smVz[sIdx] = this._smVz[last];
          this._smAge[sIdx] = this._smAge[last];
          this._smLife[sIdx] = this._smLife[last];
          this._smSize0[sIdx] = this._smSize0[last];
          this._smSize1[sIdx] = this._smSize1[last];
          this._smSpin[sIdx] = this._smSpin[last];
          this._smSpinVel[sIdx] = this._smSpinVel[last];
          this._smPeakAlpha[sIdx] = this._smPeakAlpha[last];
        }
        this.smokeCount--;
        continue;
      }

      let vx = this._smVx[sIdx] * smokeDrag;
      let vy = this._smVy[sIdx] * Math.max(0, 1.0 - 0.65 * safeDt) + 0.35 * safeDt;
      let vz = this._smVz[sIdx] * smokeDrag;
      const px = this._smX[sIdx] + vx * safeDt;
      const py = this._smY[sIdx] + vy * safeDt;
      const pz = this._smZ[sIdx] + vz * safeDt;
      const spin = this._smSpin[sIdx] + this._smSpinVel[sIdx] * safeDt;

      this._smX[sIdx] = px;
      this._smY[sIdx] = py;
      this._smZ[sIdx] = pz;
      this._smVx[sIdx] = vx;
      this._smVy[sIdx] = vy;
      this._smVz[sIdx] = vz;
      this._smAge[sIdx] = age;
      this._smSpin[sIdx] = spin;

      const t = age / life;
      // Smooth expansion (ease-out) and bell-shaped alpha fade-in / fade-out
      const expand = 1.0 - (1.0 - t) * (1.0 - t);
      const size = this._smSize0[sIdx] + (this._smSize1[sIdx] - this._smSize0[sIdx]) * expand;
      const fadeIn = clamp(t / 0.14, 0, 1);
      const fadeOut = clamp((1.0 - t) / 0.86, 0, 1);
      const alpha = this._smPeakAlpha[sIdx] * fadeIn * fadeOut * fadeOut;

      const mo = sIdx * 16;
      smMatArr[mo] = 1; smMatArr[mo + 1] = 0; smMatArr[mo + 2] = 0; smMatArr[mo + 3] = 0;
      smMatArr[mo + 4] = 0; smMatArr[mo + 5] = 1; smMatArr[mo + 6] = 0; smMatArr[mo + 7] = 0;
      smMatArr[mo + 8] = 0; smMatArr[mo + 9] = 0; smMatArr[mo + 10] = 1; smMatArr[mo + 11] = 0;
      smMatArr[mo + 12] = px;
      smMatArr[mo + 13] = py;
      smMatArr[mo + 14] = pz;
      smMatArr[mo + 15] = 1;

      const po = sIdx * 3;
      smParams[po] = size;
      smParams[po + 1] = spin;
      smParams[po + 2] = alpha;

      sIdx++;
    }

    this.smokeMesh.count = this.smokeCount;
    if (this.smokeCount > 0) {
      this.smokeMesh.instanceMatrix.needsUpdate = true;
      this._smokeParamsAttr.needsUpdate = true;
    }

    // -------------------------------------------------------------------------
    // E. Commit Ring-Buffered Skid Marks
    // -------------------------------------------------------------------------
    this.skidMesh.count = this._skidCount;
    if (this._skidCount > 0) {
      this.skidMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Spawn a full pre-aged ballistic molten titanium spark cascade streaming behind
   * the underfloor skid block (ideal for Pose 6 threshold braking / bump capture!).
   * Immediately updates GPU instance buffers & diffuser point light on the same frame.
   */
  burstActionSparks(phys, count = 240) {
    if (!phys) return;
    const n = clamp(Math.floor(count), 1, MAX_SPARKS);

    const carX = phys.x || 0;
    const carY = phys.y || 0;
    const carZ = phys.z || 0;
    const heading = phys.heading || 0;
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    const fwdX = -sinH;
    const fwdZ = -cosH;
    const rightX = cosH;
    const rightZ = -sinH;

    // Ensure vigorous rearward plume even if captured right after rapid deceleration
    const flowSpeed = Math.max(phys.speedMs || 0, 62.0);
    const baseVx = fwdX * flowSpeed;
    const baseVz = fwdZ * flowSpeed;

    const originX = carX + SKID_BLOCK_LOCAL_X * rightX - SKID_BLOCK_LOCAL_Z * fwdX;
    const originY = carY + SKID_BLOCK_LOCAL_Y;
    const originZ = carZ + SKID_BLOCK_LOCAL_X * rightZ - SKID_BLOCK_LOCAL_Z * fwdZ;

    for (let k = 0; k < n; k++) {
      // Distribute ballistic age along 0 .. 0.34 s so sparks form a sweeping 14 m rooster-tail
      const frac = k / n;
      const tFlight = frac * 0.34 * (0.7 + 0.6 * this._rand());
      const life = 0.36 + this._rand() * 0.24;
      const age = Math.min(life * 0.92, tFlight);

      // Relative rearward spray velocity behind the moving diffuser
      const relBackSpeed = flowSpeed * (0.34 + 0.42 * this._rand());
      const latVel = this._randSigned() * (1.2 + 3.4 * Math.sqrt(frac + 0.05));
      const upVel0 = 0.55 + this._rand() * 3.1;

      // Position relative to current car location after tFlight of rearward drift & gravity bounce
      let px = originX - fwdX * (relBackSpeed * tFlight) + rightX * (latVel * tFlight + this._randSigned() * 0.16);
      let pz = originZ - fwdZ * (relBackSpeed * tFlight) + rightZ * (latVel * tFlight + this._randSigned() * 0.16);
      let py = originY + upVel0 * tFlight + 0.5 * GRAVITY * tFlight * tFlight;

      let vy = upVel0 + GRAVITY * tFlight;
      if (py < carY + 0.015) {
        // Reflect bounce height cleanly off asphalt with restitution 0.42
        const over = (carY + 0.015) - py;
        py = carY + 0.015 + over * SPARK_RESTITUTION;
        vy = Math.abs(vy) * SPARK_RESTITUTION;
        px += rightX * this._randSigned() * 0.35;
        pz += rightZ * this._randSigned() * 0.35;
      }

      // World velocity vector points along the glowing streak trajectory
      const vx = baseVx - fwdX * relBackSpeed + rightX * latVel;
      const vz = baseVz - fwdZ * relBackSpeed + rightZ * latVel;
      const scale = 0.95 + this._rand() * 0.65;

      this._spawnSpark(px, py, pz, vx, vy, vz, life, scale, carY, age);
      const writtenIdx = this.sparkCount - 1;
      // Write directly so even a zero-dt capture renders the full molten cascade immediately
      const targetIdx = writtenIdx >= 0 ? writtenIdx : 0;
      const ageFrac = clamp(age / life, 0, 0.98);
      this._writeSparkInstance(targetIdx, px, py, pz, vx, vy, vz, ageFrac, scale);
    }

    // Refresh entire active pool matrices & colors in case pool wrapped
    for (let i = 0; i < this.sparkCount; i++) {
      this._writeSparkInstance(
        i,
        this._spX[i], this._spY[i], this._spZ[i],
        this._spVx[i], this._spVy[i], this._spVz[i],
        clamp(this._spAge[i] / this._spLife[i], 0, 0.98),
        this._spScale[i]
      );
    }

    this.sparkMesh.count = this.sparkCount;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    this.sparkMesh.instanceColor.needsUpdate = true;

    // Illuminate rear diffuser & asphalt immediately with flickering warm-orange light
    this.sparkLight.position.set(
      carX - DIFFUSER_LIGHT_LOCAL_Z * fwdX,
      carY + DIFFUSER_LIGHT_LOCAL_Y,
      carZ - DIFFUSER_LIGHT_LOCAL_Z * fwdZ
    );
    this.sparkLight.intensity = 7.4;
  }

  /**
   * Stamp dark curved rubber skid-mark ribbons extending `lengthM` meters behind
   * all 4 tires along the circuit spline leading right into the car's contact patches
   * (used for Pose 5 cornering over kerbs verification & replays).
   */
  stampSkidTrail(phys, circuit, lengthM = 28) {
    if (!phys || !circuit) return;
    this._ensureCircuitBuffers(circuit);

    const carX = phys.x || 0;
    const carZ = phys.z || 0;
    const heading = phys.heading || 0;
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    const fwdX = -sinH;
    const fwdZ = -cosH;
    const rightX = cosH;
    const rightZ = -sinH;

    const stepM = 0.85;
    const steps = Math.max(4, Math.ceil(lengthM / stepM));
    const bufA = this._trailBufA;
    const bufB = this._trailBufB;

    // Project each of the 4 wheel contact patches onto the circuit spline and sweep backward
    for (let w = 0; w < 4; w++) {
      const wx = carX + WHEEL_LOCAL_X[w] * rightX - WHEEL_LOCAL_Z[w] * fwdX;
      const wz = carZ + WHEEL_LOCAL_X[w] * rightZ - WHEEL_LOCAL_Z[w] * fwdZ;
      circuit.projectPoint(wx, wz, phys.trackS || null, bufA);
      const endS = bufA.s;
      const endDLat = bufA.dLat;

      // Subtle corner-entry arc swing so skid ribbon curves realistically into apex/kerb
      const curvSign = bufA.curvature >= 0 ? 1 : -1;
      const widthM = WHEEL_WIDTH[w] * 0.96;

      for (let k = 0; k < steps; k++) {
        const f0 = k / steps;       // 0 = furthest back, 1 = under current tire
        const f1 = (k + 1) / steps;
        const s0 = circuit.wrapS(endS - (1.0 - f0) * lengthM);
        const s1 = circuit.wrapS(endS - (1.0 - f1) * lengthM);

        // Smooth quadratic blend from slightly wider entry arc into exact wheel contact patch
        const arc0 = (1.0 - f0) * (1.0 - f0) * curvSign * 0.85;
        const arc1 = (1.0 - f1) * (1.0 - f1) * curvSign * 0.85;
        const d0 = clamp(endDLat + arc0, -(circuit.halfWidth + circuit.kerbWidth), circuit.halfWidth + circuit.kerbWidth);
        const d1 = clamp(endDLat + arc1, -(circuit.halfWidth + circuit.kerbWidth), circuit.halfWidth + circuit.kerbWidth);

        circuit.sampleAtS(s0, bufA);
        circuit.sampleAtS(s1, bufB);

        const rLenA = Math.hypot(bufA.rx, bufA.rz) || 1;
        const rLenB = Math.hypot(bufB.rx, bufB.rz) || 1;
        const x0 = bufA.x + (bufA.rx / rLenA) * d0;
        const z0 = bufA.z + (bufA.rz / rLenA) * d0;
        const y0 = circuit.getSurfaceElevation(s0, d0, bufA);

        const x1 = bufB.x + (bufB.rx / rLenB) * d1;
        const z1 = bufB.z + (bufB.rz / rLenB) * d1;
        const y1 = circuit.getSurfaceElevation(s1, d1, bufB);

        const dx = x1 - x0;
        const dz = z1 - z0;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-3) continue;

        this._stampSkidQuad(
          0.5 * (x0 + x1),
          0.5 * (y0 + y1),
          0.5 * (z0 + z1),
          dx / dist,
          dz / dist,
          bufB.nx,
          bufB.ny,
          bufB.nz,
          widthM,
          dist * 1.18
        );
      }
    }

    this.skidMesh.count = this._skidCount;
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Cleanly reset all active spark, smoke, and skid-mark pools (e.g. on race restart).
   */
  clear() {
    this.sparkCount = 0;
    this._sparkAccum = 0;
    this._scrapeAccum = 0;
    this._sparkOverwriteIdx = 0;
    this.sparkMesh.count = 0;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    this.sparkMesh.instanceColor.needsUpdate = true;
    this.sparkLight.intensity = 0.0;

    this.smokeCount = 0;
    this._smokeAccum.fill(0);
    this._smokeOverwriteIdx = 0;
    this.smokeMesh.count = 0;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this._smokeParamsAttr.needsUpdate = true;

    this._skidHead = 0;
    this._skidCount = 0;
    this._prevWheelActive.fill(0);
    this.skidMesh.count = 0;
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }
}

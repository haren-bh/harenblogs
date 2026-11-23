/**
 * Tokyo Grand Prix Circuit 3D Environment Builder (`TokyoGPCircuitBuilder`)
 *
 * Constructs the complete FIA Grade 1 closed spline circuit, multi-frequency
 * banked asphalt ribbon with `aRacingLine` rubbering attribute, painted track
 * markings (limits, checkered S/F, staggered FIA grid, DRS zones), raised
 * chamfered rumble kerbs, smooth grass verge + gravel runoff traps, expansive
 * horizon parkland + distant mountain ring + snow-capped Mount Fuji, continuous
 * Tecpro/Armco sponsor barriers with metallic catchfence posts, 5-light FIA
 * Start/Finish gantry, modern gray-and-white Pit Building & Pit Wall, instanced
 * covered grandstands, 3 overhead sponsor bridges, 150m/100m/50m braking boards,
 * and ~260 instanced conifer/cypress trees.
 *
 * Enforces strict ACES Filmic PBR discipline:
 *   - All albedo/emissive canvas maps in THREE.SRGBColorSpace
 *   - Dielectric albedos within [30, 240] sRGB; conductive metals in [180, 255]
 *   - Binary metalness (0.0 dielectric or 1.0 conductor)
 *   - Crease-preserving smooth shading (flatShading = false)
 *   - Zero-allocation texel-snapped vehicle-locked directional shadow frustum
 */

import * as THREE from 'three';

const ASPHALT_SLICES = 720;
const ASPHALT_CROSS_VERTS = 9;
const VERGE_SLICES = 360;
const BARRIER_SLICES = 480;
const BARRIER_HEIGHT = 1.15;
const BARRIER_THICKNESS = 0.45;
const SHADOW_HALF_EXTENT = 38.0;
const SHADOW_SUN_DIST = 115.0;

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Deterministic PRNG (Mulberry32) so foliage and hillside micro-variation
 * reproduce identically across sessions and automated visual verification.
 */
function createSeededRng(seed = 20260718) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute normalized horizontal right vector (rxH, rzH) matching trackSpline.js
 * projectPoint() and physics.js barrier clamping to sub-millimeter precision.
 */
function getHorizRight(sample, out) {
  const len = Math.hypot(sample.rx, sample.rz) || 1;
  out.x = sample.rx / len;
  out.z = sample.rz / len;
  return out;
}

/**
 * Compute world surface point at (sample, dLat) matching getSurfaceElevation()
 * and projectPoint() exactly so tires never float or sink on banked corners.
 */
function trackPoint(sample, dLat, yOffset, out) {
  const rLen = Math.hypot(sample.rx, sample.rz) || 1;
  const rxH = sample.rx / rLen;
  const rzH = sample.rz / rLen;
  out.x = sample.x + rxH * dLat;
  out.y = sample.y + dLat * Math.sin(sample.banking) + yOffset;
  out.z = sample.z + rzH * dLat;
  return out;
}

/**
 * Ensure texture wrapping on track materials so tiled ribbons (asphalt, kerbs,
 * grass, gravel, sponsor barrier panels) never clamp at UV > 1.
 */
function ensureMaterialWrapping(mat, wrapS, wrapT) {
  if (!mat) return;
  const mapKeys = ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap', 'bumpMap'];
  for (let i = 0; i < mapKeys.length; i++) {
    const tex = mat[mapKeys[i]];
    if (tex && tex.isTexture) {
      tex.wrapS = wrapS;
      tex.wrapT = wrapT;
      tex.needsUpdate = true;
    }
  }
}

/**
 * Merge an array of compatible indexed/non-indexed BufferGeometries
 * (sharing position, normal, uv) into a single static BufferGeometry.
 */
function mergeSimpleGeometries(geometries) {
  let totalVerts = 0;
  let totalIndices = 0;
  for (let g = 0; g < geometries.length; g++) {
    const geo = geometries[g];
    const pos = geo.getAttribute('position');
    totalVerts += pos.count;
    totalIndices += geo.index ? geo.index.count : pos.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (let g = 0; g < geometries.length; g++) {
    const geo = geometries[g];
    const pos = geo.getAttribute('position');
    let norm = geo.getAttribute('normal');
    if (!norm) {
      geo.computeVertexNormals();
      norm = geo.getAttribute('normal');
    }
    const uv = geo.getAttribute('uv');
    const count = pos.count;

    for (let v = 0; v < count; v++) {
      const dst3 = (vOffset + v) * 3;
      const dst2 = (vOffset + v) * 2;
      positions[dst3] = pos.getX(v);
      positions[dst3 + 1] = pos.getY(v);
      positions[dst3 + 2] = pos.getZ(v);

      normals[dst3] = norm ? norm.getX(v) : 0;
      normals[dst3 + 1] = norm ? norm.getY(v) : 1;
      normals[dst3 + 2] = norm ? norm.getZ(v) : 0;

      uvs[dst2] = uv ? uv.getX(v) : 0;
      uvs[dst2 + 1] = uv ? uv.getY(v) : 0;
    }

    if (geo.index) {
      const srcIdx = geo.index;
      for (let k = 0; k < srcIdx.count; k++) {
        indices[iOffset + k] = srcIdx.getX(k) + vOffset;
      }
      iOffset += srcIdx.count;
    } else {
      for (let k = 0; k < count; k++) {
        indices[iOffset + k] = vOffset + k;
      }
      iOffset += count;
    }

    vOffset += count;
    geo.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const uvAttr = new THREE.BufferAttribute(uvs, 2);
  merged.setAttribute('uv', uvAttr);
  merged.setAttribute('uv1', uvAttr);
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Count triangles of a BufferGeometry or InstancedMesh (returns unique geometry tris).
 */
function countGeometryTris(geo) {
  if (!geo) return 0;
  if (geo.index) return Math.floor(geo.index.count / 3);
  const pos = geo.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}

/**
 * Create a crisp FIA Checkered Start/Finish canvas texture (SRGBColorSpace,
 * sRGB strictly inside [30, 240]).
 */
function createCheckeredTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Off-white dielectric base (#e6e8ec = 230..236 sRGB)
  ctx.fillStyle = '#e6e8ec';
  ctx.fillRect(0, 0, 512, 128);

  // Subtle lead & trail border bands
  const cols = 24;
  const rows = 3;
  const cellW = 512 / cols;
  const bandTop = 14;
  const bandH = 100;
  const cellH = bandH / rows;

  ctx.fillStyle = '#25282e'; // sRGB 37..46 (compliant dielectric dark)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 === 0) {
        ctx.fillRect(c * cellW, bandTop + r * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create a crisp FIA distance braking marker board canvas texture ('150', '100', '50')
 * or 'DRS' activation sign (SRGBColorSpace, [30, 240] sRGB).
 */
function createMarkerBoardTexture(label, isDRS = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  if (isDRS) {
    ctx.fillStyle = '#24292f';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#268a4c';
    ctx.fillRect(14, 14, 228, 228);
    ctx.strokeStyle = '#e6e8ec';
    ctx.lineWidth = 10;
    ctx.strokeRect(20, 20, 216, 216);
    ctx.fillStyle = '#e8eaee';
    ctx.font = '900 84px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DRS', 128, 134);
  } else {
    // Crisp FIA white board with bold black border & numerals
    ctx.fillStyle = '#e6e8ec';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#22252a';
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, 236, 236);

    // Subtle FIA distance stripe bars at bottom (3 bars = 150, 2 = 100, 1 = 50)
    const barCount = label === '150' ? 3 : (label === '100' ? 2 : 1);
    ctx.fillStyle = '#c42b2f';
    const barW = 46;
    const gap = 14;
    const totalW = barCount * barW + (barCount - 1) * gap;
    const startX = (256 - totalW) * 0.5;
    for (let i = 0; i < barCount; i++) {
      ctx.fillRect(startX + i * (barW + gap), 194, barW, 20);
    }

    ctx.fillStyle = '#202328';
    ctx.font = '900 106px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 114);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create a clean painted road stencil texture ("DRS") for asphalt activation zones.
 */
function createDRSRoadStencilTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 256);

  // White painted FIA road bar & bold stencil
  ctx.fillStyle = '#e4e6ea';
  ctx.fillRect(16, 18, 480, 28);
  ctx.font = '900 148px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DRS', 256, 152);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export class TokyoGPCircuitBuilder {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./trackSpline.js').TokyoGPCircuit} circuit
   * @param {object} materialLib - provides createTrackMaterials()
   */
  constructor(scene, circuit, materialLib) {
    this.scene = scene;
    this.circuit = circuit;
    this.materialLib = materialLib;

    this.trackMats = materialLib && typeof materialLib.createTrackMaterials === 'function'
      ? materialLib.createTrackMaterials()
      : {};

    this._ensureTrackMaterialFallbacks();

    this.root = new THREE.Group();
    this.root.name = 'tokyo_gp_circuit';
    this.scene.add(this.root);

    // 5 FIA Start/Finish red LED pod meshes & materials
    this.startLightMeshes = [];
    this._startLightMaterials = [];

    // Shared architectural & environmental materials (strict PBR bounds, flatShading=false)
    this._archMats = this._createArchitecturalMaterials();

    // Circuit stats for Inspector / validation telemetry
    this._stats = {
      circuitName: circuit.name || 'Tokyo Grand Prix Circuit',
      lengthM: Math.round(circuit.length),
      triangles: 0,
      instancedTriangles: 0,
      meshCount: 0,
      asphaltSlices: ASPHALT_SLICES,
      kerbCount: circuit.kerbSegments ? circuit.kerbSegments.length : 0,
      gravelCount: circuit.gravelSegments ? circuit.gravelSegments.length : 0,
      barrierCount: 2,
      catchfencePostCount: 0,
      bridgeCount: 0,
      brakingBoardCount: 0,
      grandstandBayCount: 0,
      treeCount: 0,
      startLightCount: 5,
    };

    // Preallocated scratch vectors for zero-allocation shadow camera texel snapping
    this._shadowLightDir = new THREE.Vector3(0.45, 0.55, 0.7).normalize();
    this._shadowRight = new THREE.Vector3();
    this._shadowUp = new THREE.Vector3();
    this._shadowWorldUp = new THREE.Vector3(0, 1, 0);
    this._shadowAltUp = new THREE.Vector3(0, 0, 1);
    this._shadowTarget = new THREE.Vector3();
    this._shadowSnapped = new THREE.Vector3();
    this._shadowInitialized = false;

    // Build all circuit layers cleanly
    this._buildAsphaltRibbon();
    this._buildPaintedTrackMarkings();
    this._buildChamferedKerbs();
    this._buildGrassVergeAndEmbankment();
    this._buildGravelTraps();
    this._buildHorizonParklandAndMountains();
    this._buildOuterBarriersAndCatchfences();
    this._buildStartFinishGantry();
    this._buildPitBuildingAndPitWall();
    this._buildGrandstands();
    this._buildOverheadSponsorBridges();
    this._buildBrakingMarkerBoards();
    this._buildTracksideTrees();

    this.setStartLights(0);
  }

  _ensureTrackMaterialFallbacks() {
    if (!this.trackMats.asphalt) {
      this.trackMats.asphalt = new THREE.MeshStandardMaterial({
        color: 0x3b3e44,
        roughness: 0.78,
        metalness: 0.0,
        flatShading: false,
      });
    }
    if (!this.trackMats.kerb) {
      this.trackMats.kerb = new THREE.MeshStandardMaterial({
        color: 0xc8322e,
        roughness: 0.65,
        metalness: 0.0,
        flatShading: false,
      });
    }
    if (!this.trackMats.grass) {
      this.trackMats.grass = new THREE.MeshStandardMaterial({
        color: 0x486535,
        roughness: 0.88,
        metalness: 0.0,
        flatShading: false,
      });
    }
    if (!this.trackMats.gravel) {
      this.trackMats.gravel = new THREE.MeshStandardMaterial({
        color: 0x9b9282,
        roughness: 0.92,
        metalness: 0.0,
        flatShading: false,
      });
    }
    if (!this.trackMats.barrier) {
      this.trackMats.barrier = new THREE.MeshStandardMaterial({
        color: 0xd4d8de,
        roughness: 0.45,
        metalness: 0.0,
        flatShading: false,
      });
    }

    ensureMaterialWrapping(this.trackMats.asphalt, THREE.RepeatWrapping, THREE.RepeatWrapping);
    ensureMaterialWrapping(this.trackMats.kerb, THREE.RepeatWrapping, THREE.RepeatWrapping);
    ensureMaterialWrapping(this.trackMats.grass, THREE.RepeatWrapping, THREE.RepeatWrapping);
    ensureMaterialWrapping(this.trackMats.gravel, THREE.RepeatWrapping, THREE.RepeatWrapping);
    ensureMaterialWrapping(this.trackMats.barrier, THREE.RepeatWrapping, THREE.ClampToEdgeWrapping);
  }

  _createArchitecturalMaterials() {
    return {
      // Crisp white painted FIA thermoplastic track markings (#e4e6ea = 228..234 sRGB)
      roadPaint: new THREE.MeshStandardMaterial({
        color: 0xe4e6ea,
        roughness: 0.56,
        metalness: 0.0,
        flatShading: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      // Architectural white painted steel (gantry, pit building, grandstand roofs)
      archWhite: new THREE.MeshStandardMaterial({
        color: 0xe2e5ea,
        roughness: 0.36,
        metalness: 0.0,
        flatShading: false,
      }),
      // Clean light architectural concrete gray (pit lane apron, grandstand decks, barrier caps)
      archLightGray: new THREE.MeshStandardMaterial({
        color: 0xbcc2ca,
        roughness: 0.62,
        metalness: 0.0,
        flatShading: false,
      }),
      // Pit lane paved concrete-asphalt apron
      pitApron: new THREE.MeshStandardMaterial({
        color: 0x50555d,
        roughness: 0.72,
        metalness: 0.0,
        flatShading: false,
      }),
      // Sleek charcoal structural steel / truss bracing / garage recesses
      archCharcoal: new THREE.MeshStandardMaterial({
        color: 0x30353d,
        roughness: 0.48,
        metalness: 0.0,
        flatShading: false,
      }),
      // Deep matte light housing (gantry start pods, dark garage interiors)
      archDark: new THREE.MeshStandardMaterial({
        color: 0x22252b,
        roughness: 0.55,
        metalness: 0.0,
        flatShading: false,
      }),
      // Championship crimson accent stripe (pit fascia, grandstand accents)
      archCrimson: new THREE.MeshStandardMaterial({
        color: 0xb82428,
        roughness: 0.34,
        metalness: 0.0,
        flatShading: false,
      }),
      // Tinted architectural curtain-wall glass (pit club & race control)
      archGlass: new THREE.MeshPhysicalMaterial({
        color: 0x263445,
        roughness: 0.08,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        ior: 1.52,
        reflectivity: 0.9,
        flatShading: false,
      }),
      // Conductive galvanized/brushed aluminum steel (catchfence posts, marker poles)
      // Strict conductive PBR: sRGB [180, 255] (#c8ced6 = 200..214), metalness = 1.0
      galvanizedMetal: new THREE.MeshStandardMaterial({
        color: 0xc8ced6,
        roughness: 0.30,
        metalness: 1.0,
        flatShading: false,
      }),
      // Grandstand stadium seating tiers (per-instance color modulated)
      seatTier: new THREE.MeshStandardMaterial({
        color: 0xd8dce2,
        roughness: 0.58,
        metalness: 0.0,
        flatShading: false,
      }),
      // Tree trunk bark
      treeTrunk: new THREE.MeshStandardMaterial({
        color: 0x4d3c2e,
        roughness: 0.92,
        metalness: 0.0,
        flatShading: false,
      }),
      // Conifer/cypress foliage (per-instance color modulated)
      treeFoliage: new THREE.MeshStandardMaterial({
        color: 0xd8e0d4,
        roughness: 0.86,
        metalness: 0.0,
        flatShading: false,
      }),
    };
  }

  _registerMesh(mesh, isInstanced = false, instanceCount = 1) {
    this.root.add(mesh);
    const tris = countGeometryTris(mesh.geometry);
    this._stats.meshCount += 1;
    if (isInstanced) {
      this._stats.instancedTriangles += tris * instanceCount;
    } else {
      this._stats.triangles += tris;
    }
    return mesh;
  }

  /**
   * 1. Continuous Banked FIA Asphalt Ribbon (N = 720 longitudinal slices,
   *    9 cross-sectional vertices per slice with smooth `aRacingLine` attribute).
   */
  _buildAsphaltRibbon() {
    const circuit = this.circuit;
    const N = ASPHALT_SLICES;
    const cols = ASPHALT_CROSS_VERTS;
    const halfW = circuit.halfWidth; // 7.0 m
    const fullW = halfW * 2.0;       // 14.0 m
    const L = circuit.length;

    const vertCount = (N + 1) * cols;
    const quadCount = N * (cols - 1);

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const racingLine = new Float32Array(vertCount);
    const indices = new Uint32Array(quadCount * 6);

    const sample = circuit.createSampleBuffer();
    const pt = { x: 0, y: 0, z: 0 };

    let vIdx = 0;
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * L;
      circuit.sampleAtS(s, sample);
      const rLineOffset = sample.racingLineOffset;
      const vCoord = s / 4.0;

      for (let j = 0; j < cols; j++) {
        const frac = j / (cols - 1);
        const dLat = -halfW + frac * fullW;
        trackPoint(sample, dLat, 0.0, pt);

        const p3 = vIdx * 3;
        positions[p3] = pt.x;
        positions[p3 + 1] = pt.y;
        positions[p3 + 2] = pt.z;

        normals[p3] = sample.nx;
        normals[p3 + 1] = sample.ny;
        normals[p3 + 2] = sample.nz;

        const p2 = vIdx * 2;
        uvs[p2] = ((dLat + halfW) / 14.0) * 3.5;
        uvs[p2 + 1] = vCoord;

        // Smooth Gaussian darkened rubbered racing line around optimal apex path
        const delta = (dLat - rLineOffset) / 2.1;
        racingLine[vIdx] = Math.exp(-(delta * delta));
        vIdx++;
      }
    }

    let iIdx = 0;
    for (let i = 0; i < N; i++) {
      const rowA = i * cols;
      const rowB = (i + 1) * cols;
      for (let j = 0; j < cols - 1; j++) {
        const a = rowA + j;
        const b = rowA + j + 1;
        const c = rowB + j;
        const d = rowB + j + 1;
        // CCW upward-facing winding (+Y)
        indices[iIdx++] = a;
        indices[iIdx++] = b;
        indices[iIdx++] = c;
        indices[iIdx++] = b;
        indices[iIdx++] = d;
        indices[iIdx++] = c;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const uvAttr = new THREE.BufferAttribute(uvs, 2);
    geo.setAttribute('uv', uvAttr);
    geo.setAttribute('uv1', uvAttr);
    geo.setAttribute('aRacingLine', new THREE.Float32BufferAttribute(racingLine, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.trackMats.asphalt);
    mesh.name = 'track_asphalt_ribbon';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this._registerMesh(mesh);
  }

  /**
   * Helper: build a flat track-hugging ribbon strip between [sStart, sEnd] and
   * [dLatLeft, dLatRight] elevated by `yLift` above the banked asphalt.
   */
  _createTrackStripGeometry(sStart, sEnd, steps, dLatLeft, dLatRight, yLift, uScale = 1, vScale = 1) {
    const circuit = this.circuit;
    const vertCount = (steps + 1) * 2;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = new Uint32Array(steps * 6);

    const sample = circuit.createSampleBuffer();
    const pt = { x: 0, y: 0, z: 0 };

    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const s = sStart + (sEnd - sStart) * frac;
      circuit.sampleAtS(s, sample);

      for (let side = 0; side < 2; side++) {
        const dLat = side === 0 ? dLatLeft : dLatRight;
        trackPoint(sample, dLat, yLift, pt);
        const idx = i * 2 + side;
        positions[idx * 3] = pt.x;
        positions[idx * 3 + 1] = pt.y;
        positions[idx * 3 + 2] = pt.z;

        normals[idx * 3] = sample.nx;
        normals[idx * 3 + 1] = sample.ny;
        normals[idx * 3 + 2] = sample.nz;

        uvs[idx * 2] = side * uScale;
        uvs[idx * 2 + 1] = frac * vScale;
      }
    }

    let k = 0;
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const uvAttr = new THREE.BufferAttribute(uvs, 2);
    geo.setAttribute('uv', uvAttr);
    geo.setAttribute('uv1', uvAttr);
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  /**
   * 2. Painted Track Markings:
   *    - Continuous white track-limit lines at dLat = +/-6.78 m (width 0.16 m)
   *    - Checkered Start/Finish line at s = 0 (z = 0)
   *    - Staggered FIA Starting Grid boxes at s = -6, -12, -18, -24 m
   *    - Painted white DRS activation line markers + road stencils at drsZone.startS
   */
  _buildPaintedTrackMarkings() {
    const circuit = this.circuit;
    const L = circuit.length;
    const paintGeos = [];
    const yMark = 0.012;

    // A. Continuous left & right white track-limit boundary lines (dLat = +/-6.78 m, width 0.16 m)
    const lineHalfW = 0.08;
    paintGeos.push(this._createTrackStripGeometry(0, L, ASPHALT_SLICES, -6.78 - lineHalfW, -6.78 + lineHalfW, yMark));
    paintGeos.push(this._createTrackStripGeometry(0, L, ASPHALT_SLICES, 6.78 - lineHalfW, 6.78 + lineHalfW, yMark));

    // B. Staggered FIA Starting Grid Boxes (s = -6, -12, -18, -24 m; dLat = -2.2, +2.2, -2.2, +2.2 m)
    const gridSlots = [
      { s: -6, dLat: -2.2 },
      { s: -12, dLat: 2.2 },
      { s: -18, dLat: -2.2 },
      { s: -24, dLat: 2.2 },
    ];
    const boxHalfW = 1.24;
    const barThick = 0.16;
    for (let i = 0; i < gridSlots.length; i++) {
      const slot = gridSlots[i];
      // Front stop line positioned cleanly under front axle (+2.15 m forward of CoG slot)
      const sFront = slot.s + 2.15;
      const sRear = slot.s - 1.25;
      // Front transverse bar
      paintGeos.push(this._createTrackStripGeometry(
        sFront - barThick * 0.5,
        sFront + barThick * 0.5,
        1,
        slot.dLat - boxHalfW,
        slot.dLat + boxHalfW,
        yMark
      ));
      // Left & right longitudinal side rails
      paintGeos.push(this._createTrackStripGeometry(
        sRear,
        sFront,
        2,
        slot.dLat - boxHalfW,
        slot.dLat - boxHalfW + barThick,
        yMark
      ));
      paintGeos.push(this._createTrackStripGeometry(
        sRear,
        sFront,
        2,
        slot.dLat + boxHalfW - barThick,
        slot.dLat + boxHalfW,
        yMark
      ));
      // Subtle transverse yellow/white front tire alignment guide bar
      paintGeos.push(this._createTrackStripGeometry(
        sFront - 0.55,
        sFront - 0.43,
        1,
        slot.dLat - 0.92,
        slot.dLat + 0.92,
        yMark
      ));
    }

    // C. Painted white DRS Activation & Detection Line Markers
    const drsStencilTex = createDRSRoadStencilTexture();
    const drsStencilMat = new THREE.MeshStandardMaterial({
      map: drsStencilTex,
      transparent: true,
      roughness: 0.58,
      metalness: 0.0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      flatShading: false,
    });

    const drsZones = circuit.drsZones || [];
    for (let z = 0; z < drsZones.length; z++) {
      const dz = drsZones[z];
      // Crisp full-width white activation line across asphalt
      paintGeos.push(this._createTrackStripGeometry(
        dz.startS - 0.18,
        dz.startS + 0.18,
        1,
        -6.70,
        6.70,
        yMark
      ));
      // Subtle dashed detection line
      for (let seg = -5.5; seg <= 4.5; seg += 2.2) {
        paintGeos.push(this._createTrackStripGeometry(
          dz.detectionS - 0.10,
          dz.detectionS + 0.10,
          1,
          seg,
          seg + 1.1,
          yMark
        ));
      }

      // Road stencil reading "DRS" directly past the activation line
      const stencilGeo = this._createTrackStripGeometry(
        dz.startS + 1.2,
        dz.startS + 4.4,
        2,
        -2.8,
        2.8,
        yMark + 0.003,
        1,
        1
      );
      const stencilMesh = new THREE.Mesh(stencilGeo, drsStencilMat);
      stencilMesh.name = `drs_road_stencil_${dz.id}`;
      stencilMesh.receiveShadow = true;
      this._registerMesh(stencilMesh);
    }

    const mergedPaintGeo = mergeSimpleGeometries(paintGeos);
    const paintMesh = new THREE.Mesh(mergedPaintGeo, this._archMats.roadPaint);
    paintMesh.name = 'track_painted_markings';
    paintMesh.receiveShadow = true;
    this._registerMesh(paintMesh);

    // D. Checkered Start/Finish Line at s = 0 (z = 0)
    const checkerTex = createCheckeredTexture();
    const checkerMat = new THREE.MeshStandardMaterial({
      map: checkerTex,
      roughness: 0.55,
      metalness: 0.0,
      flatShading: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const sfGeo = this._createTrackStripGeometry(-0.92, 0.92, 2, -6.70, 6.70, yMark + 0.002, 1, 1);
    const sfMesh = new THREE.Mesh(sfGeo, checkerMat);
    sfMesh.name = 'start_finish_checkered_line';
    sfMesh.receiveShadow = true;
    this._registerMesh(sfMesh);
  }

  /**
   * 3. Raised Chamfered FIA Rumble Kerbs along every circuit.kerbSegments
   *    (7.0 m -> 8.35 m, 0.055 m chamfered beveled profile, mapped to trackMats.kerb).
   */
  _buildChamferedKerbs() {
    const circuit = this.circuit;
    const segments = circuit.kerbSegments || [];
    if (segments.length === 0) return;

    const L = circuit.length;
    const halfW = circuit.halfWidth; // 7.0 m
    const sample = circuit.createSampleBuffer();
    const pt = { x: 0, y: 0, z: 0 };

    // 5-vertex chamfered cross-section profile from inner edge to outer skirt
    // [offsetFromHalfWidth, heightM, uCoord]
    // NOTE: track_kerb_fia.png has red/white stripes alternating along V!
    // So U spans across kerb width (0..1) and V advances along arc-length s.
    const profileRight = [
      [0.00, -0.008, 0.00],
      [0.14,  0.055, 0.14],
      [1.14,  0.055, 0.84],
      [1.35,  0.012, 0.96],
      [1.42, -0.032, 1.00],
    ];
    // For left kerbs (side = -1), reverse point order so dLat still increases
    // monotonically across columns (guaranteeing consistent CCW upward winding!)
    const profileLeft = [
      [1.42, -0.032, 1.00],
      [1.35,  0.012, 0.96],
      [1.14,  0.055, 0.84],
      [0.14,  0.055, 0.14],
      [0.00, -0.008, 0.00],
    ];

    const kerbGeos = [];
    const cols = 5;

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx];
      const span = seg.endS >= seg.startS ? (seg.endS - seg.startS) : (L - seg.startS) + seg.endS;
      if (span < 2.0) continue;

      const steps = Math.max(8, Math.ceil(span / 1.35));
      const prof = seg.side === 1 ? profileRight : profileLeft;

      const vertCount = (steps + 1) * cols;
      const positions = new Float32Array(vertCount * 3);
      const uvs = new Float32Array(vertCount * 2);
      const indices = new Uint32Array(steps * (cols - 1) * 6);

      let vPtr = 0;
      for (let i = 0; i <= steps; i++) {
        const dist = (i / steps) * span;
        const s = seg.startS + dist;
        circuit.sampleAtS(s, sample);

        // Smooth FIA longitudinal nose/tail ramp over first/last 2.0 m
        const rampIn = clamp(dist / 2.0, 0, 1);
        const rampOut = clamp((span - dist) / 2.0, 0, 1);
        const ramp = Math.min(rampIn, rampOut);
        const rampSmooth = ramp * ramp * (3 - 2 * ramp);

        // 4 stripes (2 red, 2 white) per V = 1.0 => 4.4 m per full repeat = 1.1 m per block
        const vCoord = s / 4.4;

        for (let j = 0; j < cols; j++) {
          const dAbs = halfW + prof[j][0];
          const dLat = seg.side * dAbs;
          const hBase = prof[j][1];
          const h = hBase > 0 ? hBase * rampSmooth : hBase;
          trackPoint(sample, dLat, h, pt);

          positions[vPtr * 3] = pt.x;
          positions[vPtr * 3 + 1] = pt.y;
          positions[vPtr * 3 + 2] = pt.z;

          uvs[vPtr * 2] = prof[j][2];
          uvs[vPtr * 2 + 1] = vCoord;
          vPtr++;
        }
      }

      let iPtr = 0;
      for (let i = 0; i < steps; i++) {
        const rowA = i * cols;
        const rowB = (i + 1) * cols;
        for (let j = 0; j < cols - 1; j++) {
          const a = rowA + j;
          const b = rowA + j + 1;
          const c = rowB + j;
          const d = rowB + j + 1;
          indices[iPtr++] = a;
          indices[iPtr++] = b;
          indices[iPtr++] = c;
          indices[iPtr++] = b;
          indices[iPtr++] = d;
          indices[iPtr++] = c;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      kerbGeos.push(geo);
    }

    if (kerbGeos.length > 0) {
      const merged = mergeSimpleGeometries(kerbGeos);
      const kerbMesh = new THREE.Mesh(merged, this.trackMats.kerb);
      kerbMesh.name = 'track_fia_kerbs';
      kerbMesh.receiveShadow = true;
      kerbMesh.castShadow = true;
      this._registerMesh(kerbMesh);
    }
  }

  /**
   * 4a. Continuous Smooth Grass Verge & Curvature-Safe Outer Embankment Ribbon
   *     extending from track outer edge (+/-7.0 m) out to barrier walls and +65 m
   *     beyond barriers, gracefully sloping into the surrounding parkland without
   *     ever folding or poking through adjacent track sections.
   */
  _buildGrassVergeAndEmbankment() {
    const circuit = this.circuit;
    const N = VERGE_SLICES;
    const L = circuit.length;
    const halfW = circuit.halfWidth;
    const parklandY = circuit.bounds.minY - 1.65;

    const sample = circuit.createSampleBuffer();
    const projBuf = circuit.createSampleBuffer();
    const rH = { x: 1, z: 0 };

    // 6 lateral stations per side:
    // [0] tucked under asphalt edge, [1] verge mid, [2] barrier foot,
    // [3] outer berm shoulder, [4] outer slope mid, [5] outer skirt (+65 m)
    const cols = 6;
    const vergeGeos = [];

    for (const side of [-1, 1]) {
      const vertCount = (N + 1) * cols;
      const positions = new Float32Array(vertCount * 3);
      const uvs = new Float32Array(vertCount * 2);
      const indices = new Uint32Array(N * (cols - 1) * 6);

      for (let i = 0; i <= N; i++) {
        const s = (i / N) * L;
        circuit.sampleAtS(s, sample);
        getHorizRight(sample, rH);

        const boundary = side === -1 ? sample.boundaryLeft : sample.boundaryRight;
        const sinBank = Math.sin(sample.banking);
        const edgeY = sample.y + side * halfW * sinBank - 0.025;
        const wallY = sample.y + side * Math.min(halfW + 1.5, boundary) * sinBank - 0.03;

        // Prevent radial self-folding on the inside of sharp corners (hairpin / chicane)
        const isInsideCorner = side * sample.curvature < -0.0005;
        let maxOuterExtra = 65.0;
        if (isInsideCorner) {
          const radius = 1.0 / Math.max(0.001, Math.abs(sample.curvature));
          maxOuterExtra = clamp(radius * 0.68 - boundary, 4.5, 65.0);
        }

        // Distances from centerline along `side`
        const dList = [
          halfW - 0.14,
          halfW + (boundary - halfW) * 0.5,
          boundary + 0.55,
          boundary + Math.min(8.0, maxOuterExtra * 0.22),
          boundary + Math.min(28.0, maxOuterExtra * 0.58),
          boundary + maxOuterExtra,
        ];

        // Target elevations smoothly descending from elevated track crests into parkland
        const yList = [
          edgeY,
          edgeY * 0.5 + wallY * 0.5,
          wallY,
          Math.max(parklandY, wallY - 0.25),
          parklandY + (wallY - parklandY) * 0.35,
          parklandY - 0.15,
        ];

        for (let k = 0; k < cols; k++) {
          // Order columns so dLat increases monotonically for CCW upward normals
          const srcK = side === 1 ? k : (cols - 1 - k);
          const dAbs = dList[srcK];
          const dLat = side * dAbs;
          const vx = sample.x + rH.x * dLat;
          const vz = sample.z + rH.z * dLat;
          let vy = yList[srcK];

          // Safety guard for outer skirt vertices (srcK >= 3): never poke above another track section
          if (srcK >= 3) {
            circuit.projectPoint(vx, vz, null, projBuf);
            const nearBound = projBuf.dLat < 0 ? projBuf.boundaryLeft : projBuf.boundaryRight;
            if (Math.abs(projBuf.dLat) < nearBound + 4.0) {
              const safeY = projBuf.y - 0.95;
              if (vy > safeY) vy = safeY;
            }
          }

          const vIdx = i * cols + k;
          positions[vIdx * 3] = vx;
          positions[vIdx * 3 + 1] = vy;
          positions[vIdx * 3 + 2] = vz;

          // World-planar UVs avoid stretching/pinching around tight corners
          uvs[vIdx * 2] = vx / 11.0;
          uvs[vIdx * 2 + 1] = vz / 11.0;
        }
      }

      let iPtr = 0;
      for (let i = 0; i < N; i++) {
        const rowA = i * cols;
        const rowB = (i + 1) * cols;
        for (let j = 0; j < cols - 1; j++) {
          const a = rowA + j;
          const b = rowA + j + 1;
          const c = rowB + j;
          const d = rowB + j + 1;
          indices[iPtr++] = a;
          indices[iPtr++] = b;
          indices[iPtr++] = c;
          indices[iPtr++] = b;
          indices[iPtr++] = d;
          indices[iPtr++] = c;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      vergeGeos.push(geo);
    }

    const mergedVerge = mergeSimpleGeometries(vergeGeos);
    const vergeMesh = new THREE.Mesh(mergedVerge, this.trackMats.grass);
    vergeMesh.name = 'track_grass_verge_embankment';
    vergeMesh.receiveShadow = true;
    this._registerMesh(vergeMesh);
  }

  /**
   * 4b. Raised Raked Pebble Gravel Runoff Traps along every circuit.gravelSegments
   *     (y + 0.015 m, mapped cleanly to trackMats.gravel).
   */
  _buildGravelTraps() {
    const circuit = this.circuit;
    const segments = circuit.gravelSegments || [];
    if (segments.length === 0) return;

    const L = circuit.length;
    const halfW = circuit.halfWidth;
    const sample = circuit.createSampleBuffer();
    const rH = { x: 1, z: 0 };
    const cols = 5;
    const gravelGeos = [];

    for (let g = 0; g < segments.length; g++) {
      const seg = segments[g];
      const span = seg.endS >= seg.startS ? (seg.endS - seg.startS) : (L - seg.startS) + seg.endS;
      const steps = Math.max(16, Math.ceil(span / 3.2));

      const vertCount = (steps + 1) * cols;
      const positions = new Float32Array(vertCount * 3);
      const uvs = new Float32Array(vertCount * 2);
      const indices = new Uint32Array(steps * (cols - 1) * 6);

      for (let i = 0; i <= steps; i++) {
        const fracS = i / steps;
        const s = seg.startS + fracS * span;
        circuit.sampleAtS(s, sample);
        getHorizRight(sample, rH);

        const boundary = seg.side === -1 ? sample.boundaryLeft : sample.boundaryRight;
        const innerD = halfW + 1.35;
        const outerD = Math.max(innerD + 2.0, boundary - 0.12);
        const sinBank = Math.sin(sample.banking);
        const baseY = sample.y + seg.side * halfW * sinBank;

        // Taper gravel trap gently at entry/exit ends so edges tuck into grass
        const endFade = Math.min(clamp(fracS / 0.08, 0, 1), clamp((1 - fracS) / 0.08, 0, 1));
        const endSmooth = endFade * endFade * (3 - 2 * endFade);

        for (let k = 0; k < cols; k++) {
          const srcK = seg.side === 1 ? k : (cols - 1 - k);
          const fracW = srcK / (cols - 1);
          const dAbs = innerD + fracW * (outerD - innerD);
          const dLat = seg.side * dAbs;

          // Subtle raked gravel crown (+0.015 m inside, tucked -0.025 m at perimeter)
          const edgeMask = (srcK === 0 || srcK === cols - 1) ? 0.0 : 1.0;
          const h = -0.025 + (0.040 * edgeMask * endSmooth);

          const vIdx = i * cols + k;
          positions[vIdx * 3] = sample.x + rH.x * dLat;
          positions[vIdx * 3 + 1] = baseY + h;
          positions[vIdx * 3 + 2] = sample.z + rH.z * dLat;

          // Align parallel rake grooves cleanly along circuit tangent (U = s, V = lateral)
          uvs[vIdx * 2] = (fracS * span) / 5.5;
          uvs[vIdx * 2 + 1] = dAbs / 5.5;
        }
      }

      let iPtr = 0;
      for (let i = 0; i < steps; i++) {
        const rowA = i * cols;
        const rowB = (i + 1) * cols;
        for (let j = 0; j < cols - 1; j++) {
          const a = rowA + j;
          const b = rowA + j + 1;
          const c = rowB + j;
          const d = rowB + j + 1;
          indices[iPtr++] = a;
          indices[iPtr++] = b;
          indices[iPtr++] = c;
          indices[iPtr++] = b;
          indices[iPtr++] = d;
          indices[iPtr++] = c;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      gravelGeos.push(geo);
    }

    if (gravelGeos.length > 0) {
      const merged = mergeSimpleGeometries(gravelGeos);
      const mesh = new THREE.Mesh(merged, this.trackMats.gravel);
      mesh.name = 'track_gravel_runoffs';
      mesh.receiveShadow = true;
      this._registerMesh(mesh);
    }
  }

  /**
   * 4c. Expansive Surrounding Parkland (3400 m x 3400 m), Distant Sculpted
   *     Mountain Ring, and Iconic Subtle Snow-Capped Mount Fuji on the NW Horizon.
   */
  _buildHorizonParklandAndMountains() {
    const circuit = this.circuit;
    const b = circuit.bounds;
    const cx = (b.minX + b.maxX) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;
    const baseParkY = b.minY - 1.65;
    const projBuf = circuit.createSampleBuffer();

    // A. 3400 m x 3400 m undulating surrounding parkland plane (ZERO void edges!)
    const size = 3400;
    const segs = 48;
    const parkGeo = new THREE.PlaneGeometry(size, size, segs, segs);
    parkGeo.rotateX(-Math.PI / 2);

    const pos = parkGeo.getAttribute('position');
    const uv = parkGeo.getAttribute('uv');
    const colors = new Float32Array(pos.count * 3);
    const tmpCol = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + cx;
      const wz = pos.getZ(i) + cz;

      // Distance from circuit bounding envelope (plus precise projection near track)
      let distClear = Math.max(
        0,
        b.minX - wx,
        wx - b.maxX,
        b.minZ - wz,
        wz - b.maxZ
      );
      if (distClear < 130) {
        circuit.projectPoint(wx, wz, null, projBuf);
        const bound = Math.max(projBuf.boundaryLeft, projBuf.boundaryRight);
        distClear = Math.max(0, Math.abs(projBuf.dLat) - bound);
      }

      // Gently roll distant parkland into scenic foothills far outside the circuit
      const hillMask = clamp((distClear - 95) / 260, 0, 1);
      const smoothMask = hillMask * hillMask * (3 - 2 * hillMask);
      const ridge =
        Math.sin(wx * 0.0042 + 0.7) * Math.cos(wz * 0.0038 - 0.5) * 26.0 +
        Math.sin(wx * 0.0095 - wz * 0.0082) * 12.0 +
        Math.cos(wx * 0.0021 + wz * 0.0026) * 18.0;
      const elev = baseParkY + smoothMask * Math.max(0, ridge + 18.0);

      pos.setXYZ(i, wx, elev, wz);
      uv.setXY(i, wx / 26.0, wz / 26.0);

      // Harmonious natural Japanese parkland turf tint (matches env_grass_verge.png)
      const hBlend = clamp((elev - baseParkY) / 45.0, 0, 1);
      tmpCol.setRGB(
        0.24 - 0.04 * hBlend,
        0.34 - 0.05 * hBlend,
        0.18 + 0.03 * hBlend
      );
      colors[i * 3] = tmpCol.r;
      colors[i * 3 + 1] = tmpCol.g;
      colors[i * 3 + 2] = tmpCol.b;
    }

    parkGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parkGeo.setAttribute('uv1', uv);
    parkGeo.computeVertexNormals();

    const parkMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: this.trackMats.grass ? this.trackMats.grass.map : null,
      roughness: 0.92,
      metalness: 0.0,
      flatShading: false,
    });
    // Slightly brighten base vertex color when multiplied with grass albedo map
    if (parkMat.map) {
      for (let i = 0; i < pos.count; i++) {
        const wy = pos.getY(i);
        const hBlend = clamp((wy - baseParkY) / 45.0, 0, 1);
        colors[i * 3] = 0.88 - 0.14 * hBlend;
        colors[i * 3 + 1] = 0.92 - 0.12 * hBlend;
        colors[i * 3 + 2] = 0.84 + 0.04 * hBlend;
      }
      parkGeo.getAttribute('color').needsUpdate = true;
    }

    const parkMesh = new THREE.Mesh(parkGeo, parkMat);
    parkMesh.name = 'horizon_parkland_terrain';
    parkMesh.receiveShadow = true;
    this._registerMesh(parkMesh);

    // B. Distant Sculpted 360-Degree Mountain Ring (radius 1380..1760 m around circuit)
    const ringSegs = 96;
    const ringRows = 5;
    const mVerts = (ringSegs + 1) * ringRows;
    const mPos = new Float32Array(mVerts * 3);
    const mCol = new Float32Array(mVerts * 3);
    const mIdx = new Uint32Array(ringSegs * (ringRows - 1) * 6);

    const lowCol = new THREE.Color(0x3a4f3a);
    const midCol = new THREE.Color(0x4f6172);
    const peakCol = new THREE.Color(0x73869c);

    for (let i = 0; i <= ringSegs; i++) {
      const ang = (i / ringSegs) * Math.PI * 2;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);

      // Multi-harmonic natural Japanese mountain ridge profile
      const ridgeH =
        85.0 +
        48.0 * Math.sin(ang * 3.0 + 0.6) +
        34.0 * Math.cos(ang * 7.0 - 1.1) +
        20.0 * Math.sin(ang * 13.0 + 2.3) +
        11.0 * Math.cos(ang * 21.0);

      // Gently lower the ridge right in front of NW Mount Fuji so Fuji commands the skyline
      const fujiAngle = Math.atan2(-1520 - cz, -620 - cx);
      let dAng = Math.abs(ang - fujiAngle);
      if (dAng > Math.PI) dAng = Math.PI * 2 - dAng;
      const fujiClear = clamp(dAng / 0.38, 0.38, 1.0);
      const peakH = Math.max(48.0, ridgeH * fujiClear);

      const radii = [1260, 1420, 1580, 1740, 1900];
      const heights = [-8.0, peakH * 0.42, peakH, peakH * 0.55, -12.0];

      for (let r = 0; r < ringRows; r++) {
        const idx = i * ringRows + r;
        mPos[idx * 3] = cx + cosA * radii[r];
        mPos[idx * 3 + 1] = heights[r];
        mPos[idx * 3 + 2] = cz + sinA * radii[r];

        const hNorm = clamp(heights[r] / 170.0, 0, 1);
        if (hNorm < 0.5) {
          tmpCol.copy(lowCol).lerp(midCol, hNorm * 2.0);
        } else {
          tmpCol.copy(midCol).lerp(peakCol, (hNorm - 0.5) * 2.0);
        }
        mCol[idx * 3] = tmpCol.r;
        mCol[idx * 3 + 1] = tmpCol.g;
        mCol[idx * 3 + 2] = tmpCol.b;
      }
    }

    let mk = 0;
    for (let i = 0; i < ringSegs; i++) {
      const rA = i * ringRows;
      const rB = (i + 1) * ringRows;
      for (let r = 0; r < ringRows - 1; r++) {
        const a = rA + r;
        const b = rA + r + 1;
        const c = rB + r;
        const d = rB + r + 1;
        mIdx[mk++] = a;
        mIdx[mk++] = c;
        mIdx[mk++] = b;
        mIdx[mk++] = b;
        mIdx[mk++] = c;
        mIdx[mk++] = d;
      }
    }

    const mountainGeo = new THREE.BufferGeometry();
    mountainGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
    mountainGeo.setAttribute('color', new THREE.BufferAttribute(mCol, 3));
    mountainGeo.setIndex(new THREE.BufferAttribute(mIdx, 1));
    mountainGeo.computeVertexNormals();

    const mountainMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false,
      side: THREE.DoubleSide,
    });
    const mountainMesh = new THREE.Mesh(mountainGeo, mountainMat);
    mountainMesh.name = 'distant_mountain_ring';
    this._registerMesh(mountainMesh);

    // C. Iconic Snow-Capped Mount Fuji Silhouette on the Northwest Horizon (~1640 m away)
    this._buildMountFuji(-620, -6.0, -1520);
  }

  _buildMountFuji(fx, fy, fz) {
    const radSegs = 48;
    const hSegs = 14;
    const baseRadius = 560.0;
    const craterRadius = 40.0;
    const peakHeight = 355.0;

    const vertCount = (radSegs + 1) * (hSegs + 1);
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const indices = new Uint32Array(radSegs * hSegs * 6);

    const baseCol = new THREE.Color(0x3f4f63);
    const slopeCol = new THREE.Color(0x52657d);
    const snowCol = new THREE.Color(0xdce3ec); // sRGB ~220..236 (strictly <= 240)
    const tmpCol = new THREE.Color();

    for (let j = 0; j <= hSegs; j++) {
      const t = j / hSegs; // 0 = base, 1 = summit rim
      // Authentic graceful concave catenary stratovolcano silhouette
      const radius = craterRadius + (baseRadius - craterRadius) * Math.pow(1.0 - t, 1.48);
      const y = fy + peakHeight * Math.pow(t, 0.92);

      for (let i = 0; i <= radSegs; i++) {
        const ang = (i / radSegs) * Math.PI * 2;
        const flute = 1.0 + 0.025 * Math.sin(ang * 9.0 + t * 1.4) * (1.0 - t * 0.5);
        const r = radius * flute;
        const idx = j * (radSegs + 1) + i;

        positions[idx * 3] = fx + Math.cos(ang) * r;
        positions[idx * 3 + 1] = y + (j === hSegs ? 2.5 * Math.sin(ang * 3.0) : 0);
        positions[idx * 3 + 2] = fz + Math.sin(ang) * r;

        // Irregular organic snowline fingers descending from summit down to ~62% height
        const snowLine = 0.62 + 0.08 * Math.sin(ang * 7.0) + 0.05 * Math.cos(ang * 13.0 + 0.8);
        const snowMask = clamp((t - snowLine) / 0.11, 0, 1);
        const snowSmooth = snowMask * snowMask * (3 - 2 * snowMask);

        tmpCol.copy(baseCol).lerp(slopeCol, clamp(t * 1.4, 0, 1));
        tmpCol.lerp(snowCol, snowSmooth);

        colors[idx * 3] = tmpCol.r;
        colors[idx * 3 + 1] = tmpCol.g;
        colors[idx * 3 + 2] = tmpCol.b;
      }
    }

    let k = 0;
    for (let j = 0; j < hSegs; j++) {
      const rowA = j * (radSegs + 1);
      const rowB = (j + 1) * (radSegs + 1);
      for (let i = 0; i < radSegs; i++) {
        const a = rowA + i;
        const b = rowA + i + 1;
        const c = rowB + i;
        const d = rowB + i + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }

    const fujiGeo = new THREE.BufferGeometry();
    fujiGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    fujiGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    fujiGeo.setIndex(new THREE.BufferAttribute(indices, 1));
    fujiGeo.computeVertexNormals();

    const fujiMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.90,
      metalness: 0.0,
      flatShading: false,
    });
    const fujiMesh = new THREE.Mesh(fujiGeo, fujiMat);
    fujiMesh.name = 'landmark_mount_fuji';
    this._registerMesh(fujiMesh);
  }

  /**
   * 5. Continuous Outer Tecpro / Armco Barriers & Tokyo GP Sponsor Panels
   *    (height 1.15 m, thickness 0.45 m, strictly aligned with boundaryLeft/Right)
   *    + Instanced silver metallic catchfence posts & top tension rail.
   */
  _buildOuterBarriersAndCatchfences() {
    const circuit = this.circuit;
    const N = BARRIER_SLICES;
    const L = circuit.length;
    const h = BARRIER_HEIGHT;
    const thick = BARRIER_THICKNESS;
    const baseSink = -0.14;
    const panelLen = 3.6; // crisp aspect for 1024x512 TOKYO GP 2026 / DEVFEST MOTORSPORT

    const sample = circuit.createSampleBuffer();
    const rH = { x: 1, z: 0 };

    const sponsorGeos = [];
    const capBackGeos = [];

    for (const side of [-1, 1]) {
      // Inner track-facing sponsor panel face (at exact dLat = side * boundary)
      const innerVerts = (N + 1) * 2;
      const inPos = new Float32Array(innerVerts * 3);
      const inNorm = new Float32Array(innerVerts * 3);
      const inUv = new Float32Array(innerVerts * 2);
      const inIdx = new Uint32Array(N * 6);

      // Top cap + Outer back face (4 verts per slice = 2 separate faces with crisp normals)
      const capVerts = (N + 1) * 4;
      const capPos = new Float32Array(capVerts * 3);
      const capNorm = new Float32Array(capVerts * 3);
      const capUv = new Float32Array(capVerts * 2);
      const capIdx = new Uint32Array(N * 12);

      for (let i = 0; i <= N; i++) {
        const s = (i / N) * L;
        circuit.sampleAtS(s, sample);
        getHorizRight(sample, rH);

        const boundary = side === -1 ? sample.boundaryLeft : sample.boundaryRight;
        const dIn = side * boundary;
        const dOut = side * (boundary + thick);

        const yBase = sample.y + side * circuit.halfWidth * Math.sin(sample.banking) + baseSink;
        const yTop = yBase - baseSink + h;

        const ix = sample.x + rH.x * dIn;
        const iz = sample.z + rH.z * dIn;
        const ox = sample.x + rH.x * dOut;
        const oz = sample.z + rH.z * dOut;

        // Track-facing normal points INWARD toward centerline (-side * rH)
        const nxIn = -side * rH.x;
        const nzIn = -side * rH.z;

        // Correct non-mirrored U coordinate when viewed from the track:
        // Left barrier (side=-1): u increases with +s; Right barrier (side=+1): u increases with -s
        const uSponsor = side === -1 ? (s / panelLen) : ((L - s) / panelLen);

        // Inner face: 0 = bottom, 1 = top
        const b0 = i * 2;
        inPos[b0 * 3] = ix;
        inPos[b0 * 3 + 1] = yBase;
        inPos[b0 * 3 + 2] = iz;
        inNorm[b0 * 3] = nxIn;
        inNorm[b0 * 3 + 1] = 0;
        inNorm[b0 * 3 + 2] = nzIn;
        inUv[b0 * 2] = uSponsor;
        inUv[b0 * 2 + 1] = 0.0;

        const b1 = b0 + 1;
        inPos[b1 * 3] = ix;
        inPos[b1 * 3 + 1] = yTop;
        inPos[b1 * 3 + 2] = iz;
        inNorm[b1 * 3] = nxIn;
        inNorm[b1 * 3 + 1] = 0;
        inNorm[b1 * 3 + 2] = nzIn;
        inUv[b1 * 2] = uSponsor;
        inUv[b1 * 2 + 1] = 1.0;

        // Top cap (verts 0=innerTop, 1=outerTop) + Outer back (verts 2=outerTop, 3=outerBase)
        const c0 = i * 4;
        // Top inner
        capPos[c0 * 3] = ix; capPos[c0 * 3 + 1] = yTop; capPos[c0 * 3 + 2] = iz;
        capNorm[c0 * 3] = 0; capNorm[c0 * 3 + 1] = 1; capNorm[c0 * 3 + 2] = 0;
        capUv[c0 * 2] = s / 4.0; capUv[c0 * 2 + 1] = 0;
        // Top outer
        capPos[(c0 + 1) * 3] = ox; capPos[(c0 + 1) * 3 + 1] = yTop; capPos[(c0 + 1) * 3 + 2] = oz;
        capNorm[(c0 + 1) * 3] = 0; capNorm[(c0 + 1) * 3 + 1] = 1; capNorm[(c0 + 1) * 3 + 2] = 0;
        capUv[(c0 + 1) * 2] = s / 4.0; capUv[(c0 + 1) * 2 + 1] = 1;
        // Outer back top
        capPos[(c0 + 2) * 3] = ox; capPos[(c0 + 2) * 3 + 1] = yTop; capPos[(c0 + 2) * 3 + 2] = oz;
        capNorm[(c0 + 2) * 3] = -nxIn; capNorm[(c0 + 2) * 3 + 1] = 0; capNorm[(c0 + 2) * 3 + 2] = -nzIn;
        capUv[(c0 + 2) * 2] = s / 4.0; capUv[(c0 + 2) * 2 + 1] = 1;
        // Outer back base
        capPos[(c0 + 3) * 3] = ox; capPos[(c0 + 3) * 3 + 1] = yBase; capPos[(c0 + 3) * 3 + 2] = oz;
        capNorm[(c0 + 3) * 3] = -nxIn; capNorm[(c0 + 3) * 3 + 1] = 0; capNorm[(c0 + 3) * 3 + 2] = -nzIn;
        capUv[(c0 + 3) * 2] = s / 4.0; capUv[(c0 + 3) * 2 + 1] = 0;
      }

      let iPtr = 0;
      let cPtr = 0;
      for (let i = 0; i < N; i++) {
        // Inner face winding: verify outward matches nxIn
        // Left side (side=-1): inner normal = +right; +s is forward (+T); up is +Y.
        // (+T) x (+Y) = +right! So (bot_i, bot_next, top_i) faces +right!
        const a0 = i * 2;
        const a1 = a0 + 1;
        const b0 = a0 + 2;
        const b1 = a0 + 3;
        if (side === -1) {
          inIdx[iPtr++] = a0; inIdx[iPtr++] = b0; inIdx[iPtr++] = a1;
          inIdx[iPtr++] = b0; inIdx[iPtr++] = b1; inIdx[iPtr++] = a1;
        } else {
          inIdx[iPtr++] = a0; inIdx[iPtr++] = a1; inIdx[iPtr++] = b0;
          inIdx[iPtr++] = b0; inIdx[iPtr++] = a1; inIdx[iPtr++] = b1;
        }

        const ca = i * 4;
        const cb = ca + 4;
        if (side === 1) {
          // Top cap: inner -> outer is +right => (in_i, out_i, in_next) faces +Y
          capIdx[cPtr++] = ca;     capIdx[cPtr++] = ca + 1; capIdx[cPtr++] = cb;
          capIdx[cPtr++] = ca + 1; capIdx[cPtr++] = cb + 1; capIdx[cPtr++] = cb;
          // Outer back faces +right => (top_i, base_i, top_next)
          capIdx[cPtr++] = ca + 2; capIdx[cPtr++] = ca + 3; capIdx[cPtr++] = cb + 2;
          capIdx[cPtr++] = cb + 2; capIdx[cPtr++] = ca + 3; capIdx[cPtr++] = cb + 3;
        } else {
          // Left side: inner -> outer is -right => reverse top winding to face +Y
          capIdx[cPtr++] = ca;     capIdx[cPtr++] = cb;     capIdx[cPtr++] = ca + 1;
          capIdx[cPtr++] = ca + 1; capIdx[cPtr++] = cb;     capIdx[cPtr++] = cb + 1;
          // Outer back faces -right
          capIdx[cPtr++] = ca + 2; capIdx[cPtr++] = cb + 2; capIdx[cPtr++] = ca + 3;
          capIdx[cPtr++] = cb + 2; capIdx[cPtr++] = cb + 3; capIdx[cPtr++] = ca + 3;
        }
      }

      const spGeo = new THREE.BufferGeometry();
      spGeo.setAttribute('position', new THREE.BufferAttribute(inPos, 3));
      spGeo.setAttribute('normal', new THREE.BufferAttribute(inNorm, 3));
      const spUv = new THREE.BufferAttribute(inUv, 2);
      spGeo.setAttribute('uv', spUv);
      spGeo.setAttribute('uv1', spUv);
      spGeo.setIndex(new THREE.BufferAttribute(inIdx, 1));
      sponsorGeos.push(spGeo);

      const cpGeo = new THREE.BufferGeometry();
      cpGeo.setAttribute('position', new THREE.BufferAttribute(capPos, 3));
      cpGeo.setAttribute('normal', new THREE.BufferAttribute(capNorm, 3));
      const cpUv = new THREE.BufferAttribute(capUv, 2);
      cpGeo.setAttribute('uv', cpUv);
      cpGeo.setAttribute('uv1', cpUv);
      cpGeo.setIndex(new THREE.BufferAttribute(capIdx, 1));
      capBackGeos.push(cpGeo);
    }

    const sponsorMesh = new THREE.Mesh(mergeSimpleGeometries(sponsorGeos), this.trackMats.barrier);
    sponsorMesh.name = 'track_barrier_sponsor_panels';
    sponsorMesh.castShadow = true;
    sponsorMesh.receiveShadow = true;
    this._registerMesh(sponsorMesh);

    const capMesh = new THREE.Mesh(mergeSimpleGeometries(capBackGeos), this._archMats.archLightGray);
    capMesh.name = 'track_barrier_structure';
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    this._registerMesh(capMesh);

    // Silver metallic FIA catchfence posts above the barriers (InstancedMesh)
    const postSpacing = 16.0;
    const postsPerSide = Math.floor(L / postSpacing);
    const postTransforms = [];
    const dummy = new THREE.Object3D();

    // Build sleek FIA catchfence post geometry: vertical galvanized mast + inward-angled top arm
    const mastGeo = new THREE.BoxGeometry(0.085, 2.35, 0.085);
    mastGeo.translate(0, 1.175, 0);
    const armGeo = new THREE.BoxGeometry(0.075, 0.72, 0.075);
    armGeo.rotateZ(0.46);
    armGeo.translate(-0.14, 2.62, 0);
    const postGeo = mergeSimpleGeometries([mastGeo, armGeo]);

    for (const side of [-1, 1]) {
      for (let i = 0; i < postsPerSide; i++) {
        const s = i * postSpacing;
        // Leave clean gap on right side directly in front of Pit Wall signaling area
        if (side === 1 && (s < 215 || s > L - 80)) continue;

        circuit.sampleAtS(s, sample);
        getHorizRight(sample, rH);
        const boundary = side === -1 ? sample.boundaryLeft : sample.boundaryRight;
        const dPost = side * (boundary + thick * 0.55);
        const yBase = sample.y + side * circuit.halfWidth * Math.sin(sample.banking) + h - 0.05;

        dummy.position.set(sample.x + rH.x * dPost, yBase, sample.z + rH.z * dPost);
        // Orient local -X arm inward toward track centerline
        const yaw = Math.atan2(-sample.tx, -sample.tz) + (side === -1 ? Math.PI : 0);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        postTransforms.push(dummy.matrix.clone());
      }
    }

    const postInst = new THREE.InstancedMesh(
      postGeo,
      this._archMats.galvanizedMetal,
      postTransforms.length
    );
    postInst.name = 'track_catchfence_posts';
    for (let i = 0; i < postTransforms.length; i++) {
      postInst.setMatrixAt(i, postTransforms[i]);
    }
    postInst.instanceMatrix.needsUpdate = true;
    postInst.castShadow = true;
    this._stats.catchfencePostCount = postTransforms.length;
    this._registerMesh(postInst, true, postTransforms.length);
  }

  /**
   * 6a. 5-Light FIA Start/Finish Gantry at s = 0 (z = 0, height 6.6 m)
   *     with architectural gray/white steel truss, sponsor header panel,
   *     and 5 distinct dark housings with circular emissive red LED light pods.
   */
  _buildStartFinishGantry() {
    const sample = this.circuit.createSampleBuffer();
    this.circuit.sampleAtS(0, sample);

    const gantry = new THREE.Group();
    gantry.name = 'fia_start_finish_gantry';
    gantry.position.set(sample.x, sample.y, sample.z);
    const yaw = Math.atan2(-sample.tx, -sample.tz);
    gantry.rotation.y = yaw;

    const spanHalf = 13.4; // strictly outside +/-12.5 m barriers
    const clearH = 6.6;
    const beamH = 1.65;
    const beamDepth = 1.15;

    // White architectural steel A-frame support towers (left & right)
    const whiteParts = [];
    const darkParts = [];
    const crimsonParts = [];

    for (const side of [-1, 1]) {
      const tx = side * spanHalf;
      // Main twin inclined tower legs
      const legFront = new THREE.BoxGeometry(0.68, clearH + beamH + 1.0, 0.52);
      legFront.translate(tx, (clearH + beamH) * 0.5 - 0.5, 0.65);
      whiteParts.push(legFront);

      const legRear = new THREE.BoxGeometry(0.68, clearH + beamH + 1.0, 0.52);
      legRear.translate(tx, (clearH + beamH) * 0.5 - 0.5, -0.65);
      whiteParts.push(legRear);

      // Concrete/steel base plinth
      const plinth = new THREE.BoxGeometry(1.45, 1.4, 2.3);
      plinth.translate(tx, 0.4, 0);
      darkParts.push(plinth);

      // Horizontal steel cross-bracing struts
      for (const hy of [2.4, 4.4, 6.2]) {
        const strut = new THREE.BoxGeometry(0.36, 0.24, 1.3);
        strut.translate(tx, hy, 0);
        darkParts.push(strut);
      }
    }

    // Main horizontal architectural white steel bridge box & upper fascia
    const bridgeCore = new THREE.BoxGeometry(spanHalf * 2 + 1.4, beamH, beamDepth);
    bridgeCore.translate(0, clearH + beamH * 0.5, 0);
    whiteParts.push(bridgeCore);

    // Top sleek dark-charcoal roof cornice & lower crimson motorsport accent lip
    const topTrim = new THREE.BoxGeometry(spanHalf * 2 + 1.7, 0.22, beamDepth + 0.25);
    topTrim.translate(0, clearH + beamH + 0.11, 0);
    darkParts.push(topTrim);

    const lowerAccent = new THREE.BoxGeometry(spanHalf * 2 + 1.5, 0.16, beamDepth + 0.18);
    lowerAccent.translate(0, clearH - 0.02, 0);
    crimsonParts.push(lowerAccent);

    // Suspended horizontal carbon mounting bar for the 5 FIA start light housings
    const lightBar = new THREE.BoxGeometry(7.2, 0.24, 0.28);
    lightBar.translate(0, clearH - 0.52, 0.35);
    darkParts.push(lightBar);

    for (const sx of [-2.8, 0, 2.8]) {
      const hanger = new THREE.BoxGeometry(0.14, 0.58, 0.16);
      hanger.translate(sx, clearH - 0.25, 0.35);
      darkParts.push(hanger);
    }

    const whiteMesh = new THREE.Mesh(mergeSimpleGeometries(whiteParts), this._archMats.archWhite);
    whiteMesh.castShadow = true;
    whiteMesh.receiveShadow = true;
    gantry.add(whiteMesh);
    this._stats.triangles += countGeometryTris(whiteMesh.geometry);
    this._stats.meshCount += 1;

    const darkMesh = new THREE.Mesh(mergeSimpleGeometries(darkParts), this._archMats.archCharcoal);
    darkMesh.castShadow = true;
    darkMesh.receiveShadow = true;
    gantry.add(darkMesh);
    this._stats.triangles += countGeometryTris(darkMesh.geometry);
    this._stats.meshCount += 1;

    const crimsonMesh = new THREE.Mesh(mergeSimpleGeometries(crimsonParts), this._archMats.archCrimson);
    gantry.add(crimsonMesh);
    this._stats.triangles += countGeometryTris(crimsonMesh.geometry);
    this._stats.meshCount += 1;

    // Front (+Z facing starting grid) & Rear (-Z) TOKYO GP 2026 sponsor header panels
    const panelW = 24.0;
    const panelH = 1.38;
    const sponsorMat = this.trackMats.barrier.clone();
    const frontPanelGeo = new THREE.PlaneGeometry(panelW, panelH);
    const uvF = frontPanelGeo.getAttribute('uv');
    for (let i = 0; i < uvF.count; i++) {
      uvF.setX(i, uvF.getX(i) * 3.0);
    }
    frontPanelGeo.setAttribute('uv1', uvF);

    const frontPanel = new THREE.Mesh(frontPanelGeo, sponsorMat);
    frontPanel.position.set(0, clearH + beamH * 0.5, beamDepth * 0.5 + 0.03);
    gantry.add(frontPanel);
    this._stats.triangles += countGeometryTris(frontPanelGeo);
    this._stats.meshCount += 1;

    const rearPanel = new THREE.Mesh(frontPanelGeo, sponsorMat);
    rearPanel.position.set(0, clearH + beamH * 0.5, -(beamDepth * 0.5 + 0.03));
    rearPanel.rotation.y = Math.PI;
    gantry.add(rearPanel);
    this._stats.meshCount += 1;

    // 5 distinct dark FIA light housings with circular emissive red LED pods
    const podSpacing = 1.25;
    const podY = clearH - 0.96;
    const podZ = 0.42;

    const housingGeo = new THREE.BoxGeometry(0.64, 0.88, 0.34);
    const visorGeo = new THREE.BoxGeometry(0.66, 0.06, 0.24);
    const bezelGeo = new THREE.TorusGeometry(0.185, 0.025, 10, 22);
    const lensGeo = new THREE.CircleGeometry(0.175, 22);

    this.startLightMeshes = [];
    this._startLightMaterials = [];

    for (let i = 0; i < 5; i++) {
      const px = (i - 2) * podSpacing;

      const podGroup = new THREE.Group();
      podGroup.name = `fia_start_light_pod_${i}`;
      podGroup.position.set(px, podY, podZ);

      const housing = new THREE.Mesh(housingGeo, this._archMats.archDark);
      housing.castShadow = true;
      podGroup.add(housing);

      // Glare hood visor above pod
      const visor = new THREE.Mesh(visorGeo, this._archMats.archDark);
      visor.position.set(0, 0.44, 0.22);
      podGroup.add(visor);

      // Dedicated emissive red LED material per pod (0..4)
      const ledMat = new THREE.MeshStandardMaterial({
        color: 0x3b0d0d,
        emissive: new THREE.Color(0xff1818),
        emissiveIntensity: 0.05,
        roughness: 0.18,
        metalness: 0.0,
        flatShading: false,
      });
      this._startLightMaterials.push(ledMat);

      // Upper circular LED lens (primary exposed mesh in startLightMeshes[0..4])
      const upperLens = new THREE.Mesh(lensGeo, ledMat);
      upperLens.name = `start_light_led_${i}`;
      upperLens.position.set(0, 0.18, 0.178);
      podGroup.add(upperLens);
      this.startLightMeshes.push(upperLens);

      // Lower paired circular LED lens (authentic FIA twin-lamp housing, shares ledMat)
      const lowerLens = new THREE.Mesh(lensGeo, ledMat);
      lowerLens.position.set(0, -0.20, 0.178);
      podGroup.add(lowerLens);

      // Metallic bezels around both lenses
      const bezelTop = new THREE.Mesh(bezelGeo, this._archMats.galvanizedMetal);
      bezelTop.position.set(0, 0.18, 0.175);
      podGroup.add(bezelTop);

      const bezelBot = new THREE.Mesh(bezelGeo, this._archMats.galvanizedMetal);
      bezelBot.position.set(0, -0.20, 0.175);
      podGroup.add(bezelBot);

      gantry.add(podGroup);
      this._stats.triangles += countGeometryTris(housingGeo) + countGeometryTris(visorGeo) +
        countGeometryTris(bezelGeo) * 2 + countGeometryTris(lensGeo) * 2;
      this._stats.meshCount += 6;
    }

    this.root.add(gantry);
  }

  /**
   * 6b. Modern Gray-and-White Pit Building & Pit Wall parallel to the main straight
   *     (x = +19 m right side, s = -80 m .. +220 m => z = +80 m .. -220 m).
   */
  _buildPitBuildingAndPitWall() {
    const pitGroup = new THREE.Group();
    pitGroup.name = 'tokyo_gp_pit_complex';

    // Span along world Z (main straight runs along x = 0 toward -Z, y = 0)
    const zStart = 80;    // s = -80 m
    const zEnd = -220;    // s = +220 m
    const len = zStart - zEnd; // 300 m
    const zCenter = (zStart + zEnd) * 0.5; // -70 m

    // 1. Paved Concrete/Asphalt Pit Lane Apron (x = +12.95 m .. +20.2 m)
    const apronGeo = new THREE.PlaneGeometry(7.6, len + 34);
    apronGeo.rotateX(-Math.PI / 2);
    const apronMesh = new THREE.Mesh(apronGeo, this._archMats.pitApron);
    apronMesh.position.set(16.6, 0.008, zCenter);
    apronMesh.receiveShadow = true;
    pitGroup.add(apronMesh);
    this._stats.triangles += countGeometryTris(apronGeo);
    this._stats.meshCount += 1;

    // Crisp white pit-lane guide stripe
    const pitStripeGeo = new THREE.PlaneGeometry(0.18, len + 26);
    pitStripeGeo.rotateX(-Math.PI / 2);
    const pitStripe = new THREE.Mesh(pitStripeGeo, this._archMats.roadPaint);
    pitStripe.position.set(15.2, 0.016, zCenter);
    pitGroup.add(pitStripe);
    this._stats.triangles += countGeometryTris(pitStripeGeo);
    this._stats.meshCount += 1;

    // 2. Modern 2-Story Gray-and-White Pit Building (front facade at x = +19.5 m)
    const whiteGeos = [];
    const grayGeos = [];
    const darkGeos = [];
    const glassGeos = [];
    const crimsonGeos = [];

    // Main core body (x = 19.8 .. 34.0, height = 10.2 m)
    const lowerBack = new THREE.BoxGeometry(13.2, 4.4, len);
    lowerBack.translate(27.4, 2.2, zCenter);
    darkGeos.push(lowerBack); // dark recessed garage interiors

    // Second-floor hospitality structural slab & upper spandrel
    const midSlab = new THREE.BoxGeometry(15.2, 0.85, len + 2.0);
    midSlab.translate(26.6, 4.75, zCenter);
    whiteGeos.push(midSlab);

    const upperBack = new THREE.BoxGeometry(13.6, 4.6, len - 2.0);
    upperBack.translate(27.2, 7.5, zCenter);
    grayGeos.push(upperBack);

    // Floor-to-ceiling tinted Paddock Club curtain-wall glass facade (x = 19.65 m)
    const paddockGlass = new THREE.BoxGeometry(0.32, 4.1, len - 4.0);
    paddockGlass.translate(19.65, 7.25, zCenter);
    glassGeos.push(paddockGlass);

    // Sleek Cantilevered White-Steel Paddock Roof overhanging pit apron (x = 17.0 .. 35.2 m)
    const roofDeck = new THREE.BoxGeometry(18.2, 0.72, len + 6.0);
    roofDeck.translate(26.1, 10.2, zCenter);
    whiteGeos.push(roofDeck);

    // Sculpted aerodynamic white roof fascia & crimson signature pinstripe
    const fascia = new THREE.BoxGeometry(0.42, 1.15, len + 6.0);
    fascia.translate(17.1, 10.35, zCenter);
    whiteGeos.push(fascia);

    const crimsonStripe = new THREE.BoxGeometry(0.46, 0.24, len + 6.2);
    crimsonStripe.translate(17.05, 9.95, zCenter);
    crimsonGeos.push(crimsonStripe);

    // 18 Garage Bay architectural columns & upper glass mullions along the 300 m facade
    const numBays = 18;
    const bayLen = len / numBays;
    for (let i = 0; i <= numBays; i++) {
      const bz = zStart - i * bayLen;
      const col = new THREE.BoxGeometry(1.15, 4.6, 0.72);
      col.translate(19.8, 2.3, bz);
      whiteGeos.push(col);

      // Upper curtain-wall vertical mullion
      const mullion = new THREE.BoxGeometry(0.38, 4.4, 0.22);
      mullion.translate(19.48, 7.3, bz);
      whiteGeos.push(mullion);

      // Garage door header beam between bays
      if (i < numBays) {
        const header = new THREE.BoxGeometry(0.6, 0.55, bayLen - 0.7);
        header.translate(19.95, 4.15, bz - bayLen * 0.5);
        grayGeos.push(header);
      }
    }

    // Iconic Race Control Tower positioned at the Start/Finish Line (z = 0, x = +20.5 m)
    const towerBase = new THREE.BoxGeometry(7.2, 6.4, 18.0);
    towerBase.translate(22.8, 13.4, 0);
    whiteGeos.push(towerBase);

    const towerGlass = new THREE.BoxGeometry(7.5, 3.2, 16.5);
    towerGlass.translate(22.6, 13.8, 0);
    glassGeos.push(towerGlass);

    const towerRoof = new THREE.BoxGeometry(9.2, 0.65, 20.5);
    towerRoof.translate(22.2, 16.85, 0);
    whiteGeos.push(towerRoof);

    // 3. Pit Wall & Team Command Gantries along x = +13.15 m (right outside right barrier)
    const pitWallCore = new THREE.BoxGeometry(0.38, 1.35, len - 24);
    pitWallCore.translate(13.18, 0.68, zCenter);
    grayGeos.push(pitWallCore);

    for (let b = 0; b < 6; b++) {
      const bz = 45 - b * 44;
      const canopyRoof = new THREE.BoxGeometry(1.6, 0.16, 11.5);
      canopyRoof.translate(13.85, 3.05, bz);
      whiteGeos.push(canopyRoof);

      const canopyBack = new THREE.BoxGeometry(0.12, 1.7, 11.2);
      canopyBack.translate(13.25, 2.15, bz);
      glassGeos.push(canopyBack);

      for (const dz of [-5.2, 5.2]) {
        const post = new THREE.BoxGeometry(0.14, 1.8, 0.14);
        post.translate(14.5, 2.15, bz + dz);
        darkGeos.push(post);
      }
    }

    const addPart = (geos, mat, name, castShadow = true) => {
      if (geos.length === 0) return;
      const geo = mergeSimpleGeometries(geos);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      pitGroup.add(mesh);
      this._stats.triangles += countGeometryTris(geo);
      this._stats.meshCount += 1;
    };

    addPart(whiteGeos, this._archMats.archWhite, 'pit_building_white_steel', true);
    addPart(grayGeos, this._archMats.archLightGray, 'pit_building_concrete', true);
    addPart(darkGeos, this._archMats.archDark, 'pit_building_garages', false);
    addPart(glassGeos, this._archMats.archGlass, 'pit_building_glass', false);
    addPart(crimsonGeos, this._archMats.archCrimson, 'pit_building_accent', false);

    this.root.add(pitGroup);
  }

  /**
   * 6c. Covered Main Grandstands along left side of main straight (x = -24 m)
   *     and Turn 1 outside using InstancedMesh architectural bays + tiered seating.
   */
  _buildGrandstands() {
    const bayWidth = 14.0;
    const bayDepth = 11.5;

    // Build reusable 1-bay architectural grandstand module (facing +X by default!)
    // Local origin: center of bay front apron at ground Y = 0; extends back toward -X.
    const structGeos = [];
    const roofGeos = [];
    const seatGeos = [];

    // Grounded foundation plinth (extends -3.2 m below ground so hillside Turn 1 never floats)
    const plinth = new THREE.BoxGeometry(bayDepth + 1.0, 3.6, bayWidth - 0.15);
    plinth.translate(-bayDepth * 0.5, -1.6, 0);
    structGeos.push(plinth);

    // Front concrete safety parapet wall
    const frontWall = new THREE.BoxGeometry(0.45, 1.45, bayWidth - 0.12);
    frontWall.translate(-0.22, 0.72, 0);
    structGeos.push(frontWall);

    // 7 stepped stadium seating tiers climbing upward toward -X
    const tiers = 7;
    const stepD = (bayDepth - 1.2) / tiers;
    const stepH = 0.78;
    for (let t = 0; t < tiers; t++) {
      const rx = -0.8 - t * stepD - stepD * 0.5;
      const ry = 0.8 + t * stepH;
      const deck = new THREE.BoxGeometry(stepD + 0.15, ry + 0.4, bayWidth - 0.16);
      deck.translate(rx, (ry + 0.4) * 0.5, 0);
      structGeos.push(deck);

      const seatBench = new THREE.BoxGeometry(stepD * 0.62, 0.34, bayWidth - 0.55);
      seatBench.translate(rx + 0.12, ry + 0.52, 0);
      seatGeos.push(seatBench);
    }

    // Rear windbreak wall & twin architectural steel roof pylons
    const rearWall = new THREE.BoxGeometry(0.55, 8.2, bayWidth - 0.15);
    rearWall.translate(-bayDepth + 0.28, 4.1, 0);
    structGeos.push(rearWall);

    for (const pz of [-bayWidth * 0.46, bayWidth * 0.46]) {
      const pylon = new THREE.BoxGeometry(0.55, 10.6, 0.55);
      pylon.translate(-bayDepth + 0.6, 5.3, pz);
      structGeos.push(pylon);
    }

    // Sweeping cantilevered white-steel grandstand canopy roof tilting upward toward track
    const roofPlate = new THREE.BoxGeometry(bayDepth + 2.8, 0.42, bayWidth - 0.1);
    roofPlate.rotateZ(-0.14);
    roofPlate.translate(-bayDepth * 0.44, 9.8, 0);
    roofGeos.push(roofPlate);

    // Roof underside truss ribs
    for (const rz of [-bayWidth * 0.44, 0, bayWidth * 0.44]) {
      const rib = new THREE.BoxGeometry(bayDepth + 2.2, 0.48, 0.28);
      rib.rotateZ(-0.14);
      rib.translate(-bayDepth * 0.44, 9.42, rz);
      roofGeos.push(rib);
    }

    const structGeo = mergeSimpleGeometries(structGeos);
    const roofGeo = mergeSimpleGeometries(roofGeos);
    const seatGeo = mergeSimpleGeometries(seatGeos);

    // Collect placement matrices:
    // 1. Main Straight Left Grandstand (18 bays along x = -18.5 m front => centered around x = -24 m)
    const bayMatrices = [];
    const baySeatColors = [];
    const dummy = new THREE.Object3D();
    const palette = [
      new THREE.Color(0xc83034), // championship red section
      new THREE.Color(0xd6dae0), // studio white-gray section
      new THREE.Color(0x47505c), // architectural slate section
    ];

    const mainBays = 18;
    for (let i = 0; i < mainBays; i++) {
      const bz = 74 - i * bayWidth;
      dummy.position.set(-18.4, 0.0, bz);
      dummy.rotation.set(0, 0, 0); // local +X faces directly toward main straight!
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bayMatrices.push(dummy.matrix.clone());
      baySeatColors.push(palette[Math.floor(i / 2) % palette.length]);
    }

    // 2. Turn 1 Outside Covered Grandstand (7 bays curving cleanly behind Turn 1 gravel trap)
    const sample = this.circuit.createSampleBuffer();
    const rH = { x: 1, z: 0 };
    const t1Zone = this.circuit.brakingZones && this.circuit.brakingZones[0];
    const t1CenterS = t1Zone ? t1Zone.cornerS : 795;
    const t1Bays = 7;

    for (let i = 0; i < t1Bays; i++) {
      const s = this.circuit.wrapS(t1CenterS - 45 + i * 16.5);
      this.circuit.sampleAtS(s, sample);
      getHorizRight(sample, rH);

      // Outside of Turn 1 (Right-hander) is left side (-1)
      const side = t1Zone ? t1Zone.side : -1;
      const boundary = side === -1 ? sample.boundaryLeft : sample.boundaryRight;
      const dFront = side * (boundary + 5.5);

      const gx = sample.x + rH.x * dFront;
      const gz = sample.z + rH.z * dFront;
      const gy = sample.y + side * this.circuit.halfWidth * Math.sin(sample.banking);

      // Orient local +X inward toward track centerline (-side * rH)
      const inX = -side * rH.x;
      const inZ = -side * rH.z;
      const yaw = Math.atan2(-inZ, inX);

      dummy.position.set(gx, gy, gz);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bayMatrices.push(dummy.matrix.clone());
      baySeatColors.push(palette[i % palette.length]);
    }

    const count = bayMatrices.length;
    const structInst = new THREE.InstancedMesh(structGeo, this._archMats.archLightGray, count);
    const roofInst = new THREE.InstancedMesh(roofGeo, this._archMats.archWhite, count);
    const seatInst = new THREE.InstancedMesh(seatGeo, this._archMats.seatTier, count);

    structInst.name = 'grandstands_structure';
    roofInst.name = 'grandstands_canopy_roofs';
    seatInst.name = 'grandstands_seating_tiers';

    for (let i = 0; i < count; i++) {
      structInst.setMatrixAt(i, bayMatrices[i]);
      roofInst.setMatrixAt(i, bayMatrices[i]);
      seatInst.setMatrixAt(i, bayMatrices[i]);
      seatInst.setColorAt(i, baySeatColors[i]);
    }
    structInst.instanceMatrix.needsUpdate = true;
    roofInst.instanceMatrix.needsUpdate = true;
    seatInst.instanceMatrix.needsUpdate = true;
    if (seatInst.instanceColor) seatInst.instanceColor.needsUpdate = true;

    structInst.castShadow = true;
    structInst.receiveShadow = true;
    roofInst.castShadow = true;
    roofInst.receiveShadow = true;
    seatInst.receiveShadow = true;

    this._stats.grandstandBayCount = count;
    this._registerMesh(structInst, true, count);
    this._registerMesh(roofInst, true, count);
    this._registerMesh(seatInst, true, count);
  }

  /**
   * 6d. 3 Overhead Sponsor Bridges spanning the S-curves and Back Straight
   *     textured with trackMats.barrier (TOKYO GP 2026 / DEVFEST MOTORSPORT).
   */
  _buildOverheadSponsorBridges() {
    const circuit = this.circuit;
    const L = circuit.length;
    const drs2 = circuit.drsZones && circuit.drsZones[1];

    const bridgeStations = [
      L * 0.23,                                                // High-speed S-Curves crest
      drs2 ? circuit.wrapS(drs2.startS + 140) : L * 0.72,      // Early Back Straight (DRS 2)
      drs2 ? circuit.wrapS(drs2.endS - 95) : L * 0.82,         // Late Back Straight approach
    ];

    const sample = circuit.createSampleBuffer();
    const sponsorMat = this.trackMats.barrier.clone();

    for (let b = 0; b < bridgeStations.length; b++) {
      circuit.sampleAtS(bridgeStations[b], sample);
      const halfSpan = Math.max(sample.boundaryLeft, sample.boundaryRight) + 1.3;
      const clearH = 6.35;
      const boxH = 1.95;
      const boxD = 1.65;

      const bridge = new THREE.Group();
      bridge.name = `overhead_sponsor_bridge_${b + 1}`;
      bridge.position.set(sample.x, sample.y, sample.z);
      bridge.rotation.y = Math.atan2(-sample.tx, -sample.tz);

      const whiteParts = [];
      const darkParts = [];

      // Left & right structural concrete/steel towers grounded deep (-4.5 m) into hills
      for (const side of [-1, 1]) {
        const tower = new THREE.BoxGeometry(1.5, clearH + boxH + 4.8, 2.2);
        tower.translate(side * (halfSpan + 0.5), (clearH + boxH - 4.8) * 0.5, 0);
        whiteParts.push(tower);

        const cap = new THREE.BoxGeometry(1.75, 0.35, 2.5);
        cap.translate(side * (halfSpan + 0.5), clearH + boxH + 0.18, 0);
        darkParts.push(cap);
      }

      // Main spanning pedestrian/sponsor bridge deck
      const spanBeam = new THREE.BoxGeometry(halfSpan * 2 + 1.0, boxH, boxD);
      spanBeam.translate(0, clearH + boxH * 0.5, 0);
      whiteParts.push(spanBeam);

      const roofTrim = new THREE.BoxGeometry(halfSpan * 2 + 1.4, 0.22, boxD + 0.25);
      roofTrim.translate(0, clearH + boxH + 0.11, 0);
      darkParts.push(roofTrim);

      const wMesh = new THREE.Mesh(mergeSimpleGeometries(whiteParts), this._archMats.archWhite);
      wMesh.castShadow = true;
      wMesh.receiveShadow = true;
      bridge.add(wMesh);

      const dMesh = new THREE.Mesh(mergeSimpleGeometries(darkParts), this._archMats.archCharcoal);
      dMesh.castShadow = true;
      bridge.add(dMesh);

      // Front (+Z facing oncoming cars) & Rear (-Z) TOKYO GP 2026 sponsor banners
      const bannerW = halfSpan * 2 - 0.8;
      const bannerGeo = new THREE.PlaneGeometry(bannerW, boxH - 0.22);
      const bUv = bannerGeo.getAttribute('uv');
      for (let i = 0; i < bUv.count; i++) {
        bUv.setX(i, bUv.getX(i) * 3.0);
      }
      bannerGeo.setAttribute('uv1', bUv);

      const frontBanner = new THREE.Mesh(bannerGeo, sponsorMat);
      frontBanner.position.set(0, clearH + boxH * 0.5, boxD * 0.5 + 0.03);
      bridge.add(frontBanner);

      const backBanner = new THREE.Mesh(bannerGeo, sponsorMat);
      backBanner.position.set(0, clearH + boxH * 0.5, -(boxD * 0.5 + 0.03));
      backBanner.rotation.y = Math.PI;
      bridge.add(backBanner);

      this.root.add(bridge);
      this._stats.triangles += countGeometryTris(wMesh.geometry) + countGeometryTris(dMesh.geometry) +
        countGeometryTris(bannerGeo) * 2;
      this._stats.meshCount += 4;
      this._stats.bridgeCount += 1;
    }
  }

  /**
   * 6e. 150m / 100m / 50m Distance Braking Marker Boards placed cleanly along
   *     the verge ahead of every circuit.brakingZones (plus DRS activation boards).
   */
  _buildBrakingMarkerBoards() {
    const circuit = this.circuit;
    const zones = circuit.brakingZones || [];
    const sample = circuit.createSampleBuffer();
    const rH = { x: 1, z: 0 };

    const mat150 = new THREE.MeshStandardMaterial({
      map: createMarkerBoardTexture('150', false),
      roughness: 0.42,
      metalness: 0.0,
      flatShading: false,
    });
    const mat100 = new THREE.MeshStandardMaterial({
      map: createMarkerBoardTexture('100', false),
      roughness: 0.42,
      metalness: 0.0,
      flatShading: false,
    });
    const mat50 = new THREE.MeshStandardMaterial({
      map: createMarkerBoardTexture('50', false),
      roughness: 0.42,
      metalness: 0.0,
      flatShading: false,
    });
    const matDRS = new THREE.MeshStandardMaterial({
      map: createMarkerBoardTexture('DRS', true),
      roughness: 0.42,
      metalness: 0.0,
      flatShading: false,
    });

    const boardGeo = new THREE.PlaneGeometry(1.15, 1.15);
    const backGeo = new THREE.BoxGeometry(1.18, 1.18, 0.08);
    const postGeo = new THREE.CylinderGeometry(0.038, 0.038, 1.85, 8);

    const placeBoard = (s, side, frontMat, name) => {
      circuit.sampleAtS(s, sample);
      getHorizRight(sample, rH);
      const boundary = side === -1 ? sample.boundaryLeft : sample.boundaryRight;
      // Place cleanly along outer verge just inside the barrier so clearly visible without blocking kerbs
      const dAbs = Math.min(boundary - 0.85, circuit.halfWidth + 4.35);
      const dLat = side * dAbs;
      const yBase = sample.y + side * circuit.halfWidth * Math.sin(sample.banking);

      const group = new THREE.Group();
      group.name = name;
      group.position.set(sample.x + rH.x * dLat, yBase, sample.z + rH.z * dLat);
      // Face +Z local back toward approaching cars (-tangent)
      group.rotation.y = Math.atan2(-sample.tx, -sample.tz);

      const back = new THREE.Mesh(backGeo, this._archMats.archCharcoal);
      back.position.set(0, 1.55, 0);
      back.castShadow = true;
      group.add(back);

      const face = new THREE.Mesh(boardGeo, frontMat);
      face.position.set(0, 1.55, 0.045);
      group.add(face);

      // Twin steel mounting posts grounded firmly into verge
      for (const px of [-0.36, 0.36]) {
        const post = new THREE.Mesh(postGeo, this._archMats.galvanizedMetal);
        post.position.set(px, 0.85, 0);
        post.castShadow = true;
        group.add(post);
      }

      this.root.add(group);
      this._stats.triangles += countGeometryTris(backGeo) + countGeometryTris(boardGeo) + countGeometryTris(postGeo) * 2;
      this._stats.meshCount += 4;
      this._stats.brakingBoardCount += 1;
    };

    for (let z = 0; z < zones.length; z++) {
      const bz = zones[z];
      placeBoard(bz.board150S, bz.side, mat150, `braking_board_${z}_150`);
      placeBoard(bz.board100S, bz.side, mat100, `braking_board_${z}_100`);
      placeBoard(bz.board50S, bz.side, mat50, `braking_board_${z}_50`);
    }

    // Trackside FIA DRS activation marker boards
    const drsZones = circuit.drsZones || [];
    for (let z = 0; z < drsZones.length; z++) {
      placeBoard(drsZones[z].startS, -1, matDRS, `drs_board_${drsZones[z].id}_L`);
      placeBoard(drsZones[z].startS, 1, matDRS, `drs_board_${drsZones[z].id}_R`);
    }
  }

  /**
   * 6f. Instanced Trackside Conifer/Cypress Trees (~260 trees via 2 InstancedMesh
   *     calls for trunks + multi-tier foliage crowns) well clear of track boundaries
   *     (>= boundary + 10 m) and buildings.
   */
  _buildTracksideTrees() {
    const circuit = this.circuit;
    const L = circuit.length;
    const parklandY = circuit.bounds.minY - 1.65;
    const rng = createSeededRng(20260718);

    // 1. Tapered trunk geometry (base sunk -0.9 m so sloped hills never expose floating roots)
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.30, 3.6, 12, 1);
    trunkGeo.translate(0, 0.9, 0);

    // 2. Sculpted 3-tier Japanese cedar/cypress foliage crown merged into 1 geometry
    const tier1 = new THREE.ConeGeometry(2.45, 4.4, 18, 1);
    tier1.translate(0, 4.2, 0);
    const tier2 = new THREE.ConeGeometry(1.95, 4.1, 18, 1);
    tier2.rotateY(0.35);
    tier2.translate(0, 6.4, 0);
    const tier3 = new THREE.ConeGeometry(1.32, 3.4, 18, 1);
    tier3.rotateY(0.7);
    tier3.translate(0, 8.5, 0);
    const crownGeo = mergeSimpleGeometries([tier1, tier2, tier3]);

    const targetTrees = 260;
    const placements = [];
    const sample = circuit.createSampleBuffer();
    const projBuf = circuit.createSampleBuffer();
    const rH = { x: 1, z: 0 };

    const foliagePalette = [
      new THREE.Color(0x2d4b2a),
      new THREE.Color(0x355630),
      new THREE.Color(0x3e5e36),
      new THREE.Color(0x274225),
      new THREE.Color(0x45633a),
    ];

    let attempts = 0;
    const maxAttempts = 2200;

    while (placements.length < targetTrees && attempts < maxAttempts) {
      attempts++;
      const s = rng() * L;
      const side = rng() < 0.5 ? -1 : 1;
      circuit.sampleAtS(s, sample);
      getHorizRight(sample, rH);

      const boundary = side === -1 ? sample.boundaryLeft : sample.boundaryRight;
      // Place 13 m .. 62 m clear outside the barrier wall
      const extra = 13.0 + Math.pow(rng(), 1.15) * 49.0;
      const dLat = side * (boundary + extra);

      const tx = sample.x + rH.x * dLat;
      const tz = sample.z + rH.z * dLat;

      // Reject if too close to Pit Building / Main Grandstand corridors along main straight
      if (tx > 11 && tx < 48 && tz > -245 && tz < 105) continue;
      if (tx < -11 && tx > -45 && tz > -205 && tz < 100) continue;

      // Global spline clearance check: STRICTLY >= boundary + 10.5 m from ALL track segments!
      circuit.projectPoint(tx, tz, null, projBuf);
      const nearBound = projBuf.dLat < 0 ? projBuf.boundaryLeft : projBuf.boundaryRight;
      const clearance = Math.abs(projBuf.dLat) - nearBound;
      if (clearance < 10.5) continue;

      // Reject Turn 1 Grandstand footprint
      const t1Zone = circuit.brakingZones && circuit.brakingZones[0];
      if (t1Zone && Math.abs(projBuf.s - t1Zone.cornerS) < 85 && projBuf.dLat < 0 && clearance < 24.0) {
        continue;
      }

      // Compute exact grounded embankment/parkland elevation at (tx, tz)
      const slopeFrac = clamp(clearance / 52.0, 0, 1);
      const ty = projBuf.y * (1.0 - slopeFrac * 0.72) + parklandY * (slopeFrac * 0.72) - 0.12;

      const scaleXZ = 0.78 + rng() * 0.62;
      const scaleY = 0.82 + rng() * 0.72;
      const rotY = rng() * Math.PI * 2;
      const col = foliagePalette[Math.floor(rng() * foliagePalette.length)];

      placements.push({ tx, ty, tz, scaleXZ, scaleY, rotY, col });
    }

    const count = placements.length;
    const trunkInst = new THREE.InstancedMesh(trunkGeo, this._archMats.treeTrunk, count);
    const crownInst = new THREE.InstancedMesh(crownGeo, this._archMats.treeFoliage, count);
    trunkInst.name = 'trackside_trees_trunks';
    crownInst.name = 'trackside_trees_crowns';

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const p = placements[i];
      dummy.position.set(p.tx, p.ty, p.tz);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
      crownInst.setMatrixAt(i, dummy.matrix);
      crownInst.setColorAt(i, p.col);
    }

    trunkInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;

    trunkInst.castShadow = true;
    crownInst.castShadow = true;
    crownInst.receiveShadow = true;

    this._stats.treeCount = count;
    this._registerMesh(trunkInst, true, count);
    this._registerMesh(crownInst, true, count);
  }

  /**
   * Control the 5 FIA Start/Finish gantry red countdown lights (0..5).
   * Sets emissiveIntensity = 5.5 for i < litCount and 0.05 otherwise.
   */
  setStartLights(litCount) {
    const count = clamp(Math.floor(litCount || 0), 0, this._startLightMaterials.length);
    for (let i = 0; i < this._startLightMaterials.length; i++) {
      this._startLightMaterials[i].emissiveIntensity = i < count ? 5.5 : 0.05;
    }
  }

  /**
   * Zero-allocation texel-snapped directional shadow frustum update (+/-38 m)
   * tightly locked around the hero vehicle so shadows remain razor-sharp at 340 km/h
   * with zero shadow swimming.
   */
  updateShadowCamera(sunLight, targetX, targetY, targetZ) {
    if (!sunLight || !sunLight.shadow || !sunLight.shadow.camera) return;

    const cam = sunLight.shadow.camera;
    if (!this._shadowInitialized || cam.right !== SHADOW_HALF_EXTENT) {
      cam.left = -SHADOW_HALF_EXTENT;
      cam.right = SHADOW_HALF_EXTENT;
      cam.top = SHADOW_HALF_EXTENT;
      cam.bottom = -SHADOW_HALF_EXTENT;
      cam.near = 10.0;
      cam.far = 260.0;
      cam.updateProjectionMatrix();
      this._shadowInitialized = true;
    }

    // Preserve dynamic solar direction (honors Solar Elevation UI slider)
    this._shadowLightDir.subVectors(sunLight.position, sunLight.target.position);
    if (this._shadowLightDir.lengthSq() < 1e-6) {
      this._shadowLightDir.set(0.45, 0.55, 0.7).normalize();
    } else {
      this._shadowLightDir.normalize();
    }

    // Orthonormal light-space basis for texel grid alignment
    const refUp = Math.abs(this._shadowLightDir.y) > 0.98
      ? this._shadowAltUp
      : this._shadowWorldUp;
    this._shadowRight.crossVectors(refUp, this._shadowLightDir).normalize();
    this._shadowUp.crossVectors(this._shadowLightDir, this._shadowRight).normalize();

    const mapSize = (sunLight.shadow.mapSize && sunLight.shadow.mapSize.x) || 2048;
    const texelSize = (SHADOW_HALF_EXTENT * 2.0) / mapSize;

    this._shadowTarget.set(targetX, targetY, targetZ);
    const u = this._shadowTarget.dot(this._shadowRight);
    const v = this._shadowTarget.dot(this._shadowUp);
    const w = this._shadowTarget.dot(this._shadowLightDir);

    const uSnap = Math.round(u / texelSize) * texelSize;
    const vSnap = Math.round(v / texelSize) * texelSize;

    this._shadowSnapped
      .set(0, 0, 0)
      .addScaledVector(this._shadowRight, uSnap)
      .addScaledVector(this._shadowUp, vSnap)
      .addScaledVector(this._shadowLightDir, w);

    sunLight.target.position.copy(this._shadowSnapped);
    sunLight.position
      .copy(this._shadowSnapped)
      .addScaledVector(this._shadowLightDir, SHADOW_SUN_DIST);
    sunLight.target.updateMatrixWorld();
    sunLight.updateMatrixWorld();
  }

  /**
   * Return circuit geometric & set-piece metrics for Telemetry & PBR Inspector.
   */
  getTrackStats() {
    return { ...this._stats };
  }
}

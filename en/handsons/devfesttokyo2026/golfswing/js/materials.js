/**
 * Physically Based Rendering (PBR) Materials, Nano Banana 2.1 Seamless PBR Texture Loader,
 * Atmospheric Sky / PMREM HDRI, and Strict Albedo/Metallicity Validation
 * Implements Sections 3, 4, and 5 of specs/golfswing.md.
 */

import * as THREE from 'three';
import { PBR_BOUNDS } from './constants.js';

export const pbrAuditRecords = [];

const textureLoader = new THREE.TextureLoader();

/**
 * Loads a Nano Banana generated seamless PBR texture pair (albedo + Sobel tangent-space normal)
 * with strict color-space enforcement:
 *  - Albedo map: Utility - sRGB - Texture (THREE.SRGBColorSpace)
 *  - Normal map: Utility - Raw (THREE.NoColorSpace)
 */
export function loadNanoBananaPBRPair(baseName, repeatX = 1, repeatY = 1, normalBaseName = `${baseName}_normal`) {
  const map = textureLoader.load(new URL(`../textures/${baseName}.jpg`, import.meta.url).href);
  map.colorSpace = THREE.SRGBColorSpace; // Utility - sRGB - Texture
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.anisotropy = 8;

  const normalMap = textureLoader.load(new URL(`../textures/${normalBaseName}.jpg`, import.meta.url).href);
  normalMap.colorSpace = THREE.NoColorSpace; // Utility - Raw
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(repeatX, repeatY);
  normalMap.anisotropy = 8;

  return { map, normalMap };
}

/**
 * Validates and clamps an sRGB triple [r, g, b] against strict PBR physical bounds:
 *  - Dielectric Albedo: [30, 240] sRGB (2% - 85% reflectance)
 *  - Conductive F0: [180, 255] sRGB
 *  - Metallicity: strictly binary 0.0 or 1.0
 */
export function createValidatedPBRColor(name, rgb, isMetal = false, source = 'Nano Banana 2.1 PBR') {
  const minBound = isMetal ? PBR_BOUNDS.CONDUCTIVE_MIN_SRGB : PBR_BOUNDS.DIELECTRIC_MIN_SRGB;
  const maxBound = isMetal ? PBR_BOUNDS.CONDUCTIVE_MAX_SRGB : PBR_BOUNDS.DIELECTRIC_MAX_SRGB;

  const clamped = rgb.map((c) => Math.max(minBound, Math.min(maxBound, Math.round(c))));
  const passed = rgb.every((c) => c >= minBound && c <= maxBound);

  pbrAuditRecords.push({
    name,
    type: isMetal ? 'Conductive (Metallic = 1.0)' : 'Dielectric (Metallic = 0.0)',
    srgb: clamped,
    source,
    colorSpace: 'Utility - sRGB - Texture -> Linear Working',
    dataMapsColorSpace: 'Utility - Raw',
    bounds: `[${minBound}, ${maxBound}] sRGB`,
    passed,
  });

  const color = new THREE.Color();
  color.setRGB(clamped[0] / 255, clamped[1] / 255, clamped[2] / 255, THREE.SRGBColorSpace);
  return color;
}

/**
 * Generates a high-density Fibonacci-sphere dimpled golf ball texture suite:
 *  - BaseColor (sRGB, clamped <= 238 sRGB with crisp alignment stamp so spin is visible)
 *  - Tangent-space Normal Map (Utility - Raw, pole-compensated equirectangular projection)
 *  - Roughness Map (Utility - Raw, base ~0.12 with subtle dimple cavity micro-roughness)
 */
export function createGolfBallTextures() {
  const width = 512;
  const height = 256;

  const numDimples = 336;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const dimples = new Float32Array(numDimples * 3);
  for (let i = 0; i < numDimples; i++) {
    const y = 1 - (i / (numDimples - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    dimples[i * 3] = Math.cos(theta) * r;
    dimples[i * 3 + 1] = y;
    dimples[i * 3 + 2] = Math.sin(theta) * r;
  }

  const normalData = new Uint8Array(width * height * 4);
  const roughData = new Uint8Array(width * height * 4);
  const dimpleAngularRadius = 0.104;

  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    const phi = v * Math.PI;
    const sinPhi = Math.max(0.015, Math.sin(phi));
    const cosPhi = Math.cos(phi);

    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      const theta = u * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const sx = -cosT * sinPhi;
      const sy = cosPhi;
      const sz = sinT * sinPhi;

      let bestDot = -2;
      let bx = 0;
      let by = 0;
      let bz = 0;
      for (let i = 0; i < numDimples; i++) {
        const dx = dimples[i * 3];
        const dy = dimples[i * 3 + 1];
        const dz = dimples[i * 3 + 2];
        const dot = sx * dx + sy * dy + sz * dz;
        if (dot > bestDot) {
          bestDot = dot;
          bx = dx;
          by = dy;
          bz = dz;
        }
      }

      const angle = Math.acos(Math.min(1, Math.max(-1, bestDot)));
      let nx = 0;
      let ny = 0;
      let nz = 1;
      let rough = 0.12;

      if (angle < dimpleAngularRadius) {
        const rx = sx - bx * bestDot;
        const ry = sy - by * bestDot;
        const rz = sz - bz * bestDot;
        const rLen = Math.hypot(rx, ry, rz) + 1e-6;

        const rn = angle / dimpleAngularRadius;
        const rimSoft = 1 - Math.pow(rn, 5);
        const slope = 0.52 * rn * rimSoft;

        const tx = sinT;
        const ty = 0;
        const tz = cosT;

        const bix = -cosT * cosPhi;
        const biy = -sinPhi;
        const biz = sinT * cosPhi;

        const dT = (rx * tx + ry * ty + rz * tz) / rLen;
        const dB = (rx * bix + ry * biy + rz * biz) / rLen;

        nx = -dT * slope;
        ny = dB * slope;
        nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
        rough = 0.12 + 0.055 * (1 - rn * rn);
      }

      const idx = (py * width + px) * 4;
      normalData[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;

      const rByte = Math.round(rough * 255);
      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;
    }
  }

  const normalMap = new THREE.DataTexture(normalData, width, height, THREE.RGBAFormat);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.ClampToEdgeWrapping;
  normalMap.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughData, width, height, THREE.RGBAFormat);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.ClampToEdgeWrapping;
  roughnessMap.needsUpdate = true;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(236, 236, 233)';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = 'rgb(52, 56, 62)';
  ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TOUR PRO 1', 256, 126);
  ctx.fillStyle = 'rgb(75, 82, 92)';
  ctx.fillRect(210, 134, 92, 3);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText('— 01 —', 256, 150);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  return { map, normalMap, roughnessMap };
}

/**
 * Generates CNC-milled scoreline normal, roughness, and laser-etched face albedo map
 * for the forged titanium 460cc driver striking face.
 */
export function createDriverFaceTextures() {
  const size = 512;
  const normalData = new Uint8Array(size * size * 4);
  const roughData = new Uint8Array(size * size * 4);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Forged satin titanium dark-silver face plate
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, 'rgb(198, 200, 204)');
  grad.addColorStop(0.5, 'rgb(214, 212, 208)');
  grad.addColorStop(1, 'rgb(190, 194, 198)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Subtle dark-anodized sweet-spot targeting oval
  ctx.strokeStyle = 'rgba(72, 78, 86, 0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(size * 0.5, size * 0.5, size * 0.14, size * 0.22, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Horizontal CNC-milled scoreline grooves
  ctx.strokeStyle = 'rgba(54, 58, 64, 0.85)';
  ctx.lineWidth = 3;
  for (let i = -5; i <= 5; i++) {
    const y = size * 0.5 + i * 24;
    const halfSpan = Math.abs(i) < 3 ? size * 0.34 : size * 0.26;
    ctx.beginPath();
    ctx.moveTo(size * 0.5 - halfSpan, y);
    ctx.lineTo(size * 0.5 + halfSpan, y);
    ctx.stroke();
  }

  // Center loft alignment dot
  ctx.fillStyle = 'rgb(235, 236, 238)';
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, 6, 0, Math.PI * 2);
  ctx.fill();

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;

      const inGrooveZone = Math.abs(u - 0.5) < 0.36 && Math.abs(v - 0.5) < 0.34;
      const grooveWave = Math.sin(v * Math.PI * 22);
      const isGroove = inGrooveZone && grooveWave > 0.78;

      const brush = Math.sin(y * 1.4 + u * 5.0) * 0.035;
      const ny = isGroove ? Math.cos(v * Math.PI * 22) * 0.55 : brush;
      const nx = brush * 0.4;
      const nz = Math.sqrt(Math.max(0.1, 1 - nx * nx - ny * ny));

      normalData[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;

      const rough = isGroove ? 0.46 : 0.20 + Math.abs(brush) * 0.5;
      const rb = Math.round(rough * 255);
      roughData[idx] = rb;
      roughData[idx + 1] = rb;
      roughData[idx + 2] = rb;
      roughData[idx + 3] = 255;
    }
  }

  const normalMap = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.needsUpdate = true;

  return { map, normalMap, roughnessMap };
}

/**
 * Hero Golfer Epidermis Material (Section 3 + Nano Banana skin_epidermis PBR pair):
 *  - Dual-lobe specular: base epidermal microfacet + lipid/sweat clearcoat (roughness 0.11)
 *  - Random Walk SSS-inspired volumetric wrap & translucent grazing backlight scattering
 */
export function createEpidermisMaterial(sunDirUniform, customTexPair = null, normalStrength = 0.12) {
  if (!customTexPair) {
    createValidatedPBRColor('Hero_Golfer_Epidermis', [214, 154, 121], false);
  }
  const skinTex = customTexPair || loadNanoBananaPBRPair('skin_epidermis', 1.5, 1.5);

  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xffffff),
    map: skinTex.map,
    normalMap: skinTex.normalMap,
    normalScale: new THREE.Vector2(normalStrength, normalStrength),
    metalness: 0.0,
    roughness: 0.46,
    ior: 1.42,
    clearcoat: 0.20,
    clearcoatRoughness: 0.12,
    sheen: 0.14,
    sheenRoughness: 0.65,
    sheenColor: new THREE.Color(0.95, 0.84, 0.76),
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = sunDirUniform;
    shader.uniforms.uSssScale = { value: PBR_BOUNDS.SKIN_SSS_SCALE };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vSkinWorldPos;
         varying vec3 vSkinWorldNormal;`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         vSkinWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vSkinWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uSunDir;
         uniform float uSssScale;
         varying vec3 vSkinWorldPos;
         varying vec3 vSkinWorldNormal;`
      )
      .replace(
        '#include <dithering_fragment>',
        `
         // Random Walk SSS approximation: albedo-scaled subsurface radius (0.015)
         vec3 Nw = normalize(vSkinWorldNormal);
         vec3 Vw = normalize(cameraPosition - vSkinWorldPos);
         vec3 Lw = normalize(uSunDir);
         float wrapDot = clamp((dot(Nw, Lw) + 0.45) / 1.45, 0.0, 1.0);
         float backTrans = pow(clamp(dot(Vw, -Lw + Nw * 0.42), 0.0, 1.0), 3.0);
         float grazingFresnel = pow(1.0 - max(dot(Nw, Vw), 0.0), 3.5);
         vec3 sssTint = diffuseColor.rgb * vec3(1.06, 0.84, 0.72);
         gl_FragColor.rgb += sssTint * (wrapDot * 0.09 + backTrans * 0.16 + grazingFresnel * 0.05) * (uSssScale * 66.0);
         #include <dithering_fragment>`
      );
  };

  return mat;
}

/**
 * Hero Golfer Photorealistic Human Face Material (Nano Banana 360° Cylindrical UV Unwrap + SSS).
 */
export function createHeadFaceMaterial(sunDirUniform) {
  createValidatedPBRColor('Hero_Golfer_Face_Unwrap', [214, 154, 121], false);
  const facePair = loadNanoBananaPBRPair('golfer_face_uv', 1, 1, 'golfer_face_normal');
  facePair.map.wrapT = THREE.ClampToEdgeWrapping;
  facePair.normalMap.wrapT = THREE.ClampToEdgeWrapping;
  return createEpidermisMaterial(sunDirUniform, facePair, 0.22);
}

/**
 * Stratified Fairway & Course Terrain Material powered by Nano Banana fairway_turf & bunker_sand:
 *  - Continuous multi-angle stochastic anti-tiling destroying grid repetition
 *  - Height-blended stratification (soil/thatch -> rough -> striped bentgrass -> raked silica bunker sand)
 *  - Distance-dependent roughness compensation eliminating oblique glossy plastic artifacts
 */
export function createFairwayMaterial(sunDirUniform) {
  createValidatedPBRColor('Fairway_Bentgrass_NanoBanana', [86, 134, 54], false);
  createValidatedPBRColor('Rough_Deep_Turf', [56, 86, 40], false);
  createValidatedPBRColor('Bunker_Silica_Sand_NanoBanana', [216, 198, 162], false);
  createValidatedPBRColor('Topsoil_Loam_Base', [76, 62, 46], false);

  const turfTex = loadNanoBananaPBRPair('fairway_turf', 1, 1);
  const sandTex = loadNanoBananaPBRPair('bunker_sand', 1, 1);

  turfTex.normalMap.repeat.set(95, 185);

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(1, 1, 1),
    vertexColors: true,
    metalness: 0.0,
    roughness: 0.85,
    normalMap: turfTex.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTurfTex = { value: turfTex.map };
    shader.uniforms.uSandTex = { value: sandTex.map };
    shader.uniforms.uSunDir = sunDirUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vTerrainWorldPos;
         varying float vTerrainViewDist;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 wpTerrain = modelMatrix * vec4(transformed, 1.0);
         vTerrainWorldPos = wpTerrain.xyz;
         vTerrainViewDist = length(cameraPosition - wpTerrain.xyz);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uTurfTex;
         uniform sampler2D uSandTex;
         uniform vec3 uSunDir;
         varying vec3 vTerrainWorldPos;
         varying float vTerrainViewDist;

         // Smooth continuous multi-angle stochastic anti-tiling sampler (Section 4)
         vec3 sampleStochasticTri(sampler2D tex, vec2 uv) {
           const mat2 rotA = mat2(0.7944, -0.6074, 0.6074, 0.7944);   // 37.4 deg
           const mat2 rotB = mat2(-0.4019, -0.9157, 0.9157, -0.4019); // 113.7 deg
           vec3 s0 = texture2D(tex, uv).rgb;
           vec3 s1 = texture2D(tex, rotA * (uv * 1.37) + vec2(0.37, 0.71)).rgb;
           vec3 s2 = texture2D(tex, rotB * (uv * 0.63) + vec2(0.83, 0.19)).rgb;
           float w1 = 0.5 + 0.5 * sin(uv.x * 0.85 + sin(uv.y * 0.67));
           float w2 = 0.5 + 0.5 * cos(uv.y * 0.93 - cos(uv.x * 0.58));
           vec3 blendA = mix(s0, s1, 0.35 + 0.30 * w1);
           return mix(blendA, s2, 0.25 + 0.25 * w2);
         }

         // Height-blend mask from Section 4:
         // Mask_blend = saturate((Height_A - Height_B + BlendFactor) / TransitionSharpness)
         float heightBlendMask(float heightA, float heightB, float blendFactor, float sharpness) {
           return clamp((heightA - heightB + (blendFactor * 2.0 - 1.0)) / max(sharpness, 0.02) * 0.5 + 0.5, 0.0, 1.0);
         }`
      )
      .replace(
        '#include <color_fragment>',
        `
         // Sample real Nano Banana bentgrass turf at micro & macro scales with stochastic rotation
         vec3 turfMicro = sampleStochasticTri(uTurfTex, vTerrainWorldPos.xz * 0.42);
         vec3 turfMacro = sampleStochasticTri(uTurfTex, vTerrainWorldPos.xz * 0.075);
         vec3 turfRaw = mix(turfMacro, turfMicro, 0.62);

         float turfHeight = dot(turfRaw, vec3(0.299, 0.587, 0.114));
         float soilHeight = 1.0 - turfHeight * 0.75;

         // Championship mower striping across fairway & tee box
         float stripeWave = sin(vTerrainWorldPos.z * 0.72 + sin(vTerrainWorldPos.x * 0.06) * 0.35);
         float crossStripe = sin((vTerrainWorldPos.x + vTerrainWorldPos.z * 0.22) * 0.95);
         float mowerLight = smoothstep(-0.35, 0.35, stripeWave) * 0.74 + smoothstep(-0.4, 0.4, crossStripe) * 0.26;
         float stripeGain = mix(0.84, 1.18, mowerLight);

         // Stratified biomes modulated on top of photographic Nano Banana bentgrass texture
         vec3 colSoil = vec3(0.072, 0.048, 0.028);
         vec3 colRough = turfRaw * vec3(0.72, 0.76, 0.68);
         vec3 colFairway = turfRaw * vec3(1.02, 1.06, 0.94) * stripeGain;
         vec3 colGreen = turfRaw * vec3(0.95, 1.14, 0.96) * (0.94 + 0.10 * mowerLight);

         vec3 turfBiome = mix(colRough, colFairway, vColor.r);
         turfBiome = mix(turfBiome, colGreen, vColor.b);

         // Height-blended emergence of grass canopy over consolidated soil depressions
         float grassEmergence = heightBlendMask(turfHeight + 0.25, soilHeight, 0.74 + vColor.r * 0.16, 0.24);
         vec3 surfaceCol = mix(colSoil, turfBiome, grassEmergence);

         // Height-blended Nano Banana raked silica bunker sand with crisp lip transition
         vec3 sandSample = texture2D(uSandTex, vTerrainWorldPos.xz * 0.28).rgb;
         float sandH = dot(sandSample, vec3(0.33, 0.34, 0.33));
         float sandMask = heightBlendMask(sandH * 0.55 + 0.38, turfHeight, vColor.g, 0.14);
         surfaceCol = mix(surfaceCol, sandSample * 1.05, sandMask);

         // Subtle mowed distance arcs at 150, 200, 250, 300 yards downrange
         float distM = length(vTerrainWorldPos.xz);
         float distYds = distM * 1.0936133;
         float ring = 0.0;
         ring += exp(-pow((distYds - 150.0) * 1.4, 2.0));
         ring += exp(-pow((distYds - 200.0) * 1.4, 2.0));
         ring += exp(-pow((distYds - 250.0) * 1.4, 2.0));
         ring += exp(-pow((distYds - 300.0) * 1.4, 2.0));
         surfaceCol = mix(surfaceCol, surfaceCol * 1.22 + vec3(0.018), clamp(ring, 0.0, 1.0) * vColor.r * 0.38);

         diffuseColor.rgb = surfaceCol;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `
         // Distance-dependent roughness compensation (Section 4)
         float baseTurfRough = mix(0.88, 0.76, vColor.r);
         baseTurfRough = mix(baseTurfRough, 0.93, vColor.g);
         float distComp = smoothstep(22.0, 240.0, vTerrainViewDist) * 0.20;
         float roughnessFactor = clamp(baseTurfRough + distComp, 0.70, 0.98);`
      );
  };

  return mat;
}

/**
 * Generates a physically inspired Rayleigh + Mie daylight sky dome mesh AND
 * bakes an HDR-like PMREM cube environment map for accurate PBR reflections.
 */
export function createSkyAndEnvironment(renderer, sunElevationDeg = 34) {
  const skyGeo = new THREE.SphereGeometry(780, 48, 32);
  const sunDir = new THREE.Vector3();

  const updateSunVector = (elevDeg) => {
    const elevRad = THREE.MathUtils.degToRad(elevDeg);
    const azimRad = THREE.MathUtils.degToRad(212);
    sunDir.set(
      Math.cos(elevRad) * Math.sin(azimRad),
      Math.sin(elevRad),
      Math.cos(elevRad) * Math.cos(azimRad)
    ).normalize();
  };
  updateSunVector(sunElevationDeg);

  const skyUniforms = {
    uSunDir: { value: sunDir.clone() },
    uTime: { value: 0 },
  };

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vWorldDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p *= 2.04;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float y = max(dir.y, 0.0);
        float sunCos = max(dot(dir, normalize(uSunDir)), 0.0);

        vec3 zenithCol = vec3(0.11, 0.29, 0.62);
        vec3 horizonCol = vec3(0.68, 0.79, 0.89);
        vec3 groundBounce = vec3(0.14, 0.19, 0.12);

        float horizonFactor = pow(1.0 - y, 3.2);
        vec3 sky = mix(zenithCol, horizonCol, horizonFactor);

        float mie = pow(sunCos, 9.0) * 0.32 + pow(sunCos, 64.0) * 0.55;
        vec3 sunWarmth = vec3(1.0, 0.91, 0.76);
        sky += sunWarmth * mie;

        float sunDisk = smoothstep(0.99935, 0.99978, sunCos);
        sky += vec3(5.5, 4.9, 3.9) * sunDisk;

        if (dir.y > 0.02) {
          vec2 cloudUv = dir.xz / (dir.y + 0.18) * 1.45 + vec2(uTime * 0.004, -uTime * 0.002);
          float c = fbm(cloudUv);
          float cloudMask = smoothstep(0.50, 0.78, c) * smoothstep(0.02, 0.22, dir.y);
          vec3 cloudLit = mix(vec3(0.84, 0.87, 0.91), vec3(1.12, 1.08, 1.02), pow(sunCos, 2.0) * 0.7 + 0.3);
          sky = mix(sky, cloudLit, cloudMask * 0.68);
        }

        if (dir.y < 0.0) {
          sky = mix(horizonCol * 0.8, groundBounce, smoothstep(0.0, -0.25, dir.y));
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.name = 'SkyDome_RayleighMie';

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const envSkyMesh = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 24), skyMat);
  envScene.add(envSkyMesh);

  let currentEnvRT = null;

  function bakeEnvironment(elevDeg) {
    updateSunVector(elevDeg);
    skyUniforms.uSunDir.value.copy(sunDir);
    if (currentEnvRT) currentEnvRT.dispose();
    currentEnvRT = pmremGenerator.fromScene(envScene, 0.02);
    return {
      envMap: currentEnvRT.texture,
      sunDir: sunDir.clone(),
    };
  }

  const initial = bakeEnvironment(sunElevationDeg);

  return {
    skyMesh,
    skyUniforms,
    sunDir,
    envMap: initial.envMap,
    bakeEnvironment,
    dispose() {
      if (currentEnvRT) currentEnvRT.dispose();
      pmremGenerator.dispose();
    },
  };
}

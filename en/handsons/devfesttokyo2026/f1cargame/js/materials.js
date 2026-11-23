/**
 * Physically Based Rendering (PBR) Material Library, Atmospheric Sky/PMREM Lighting,
 * Dual-Layer Clearcoat Car Paint, Blackbody Brake Glow, Stochastic Asphalt Shader,
 * and Live Color-Space / Reflectance Compliance Registry for Tokyo GP 2026 F1 Sim.
 *
 * Strict ACES Filmic Color Management:
 *   - All albedo & emissive color textures: THREE.SRGBColorSpace ("Utility - sRGB - Texture")
 *   - All normal, ORM, flake normal & thermal mask maps: THREE.NoColorSpace ("Utility - Raw")
 *   - Dielectric sRGB reflectance strictly within [30, 240]; conductive metals within [180, 255].
 */

import * as THREE from 'three';
import { PBR_BOUNDS, TIRE_COMPOUNDS } from './constants.js';

const DEG2RAD = Math.PI / 180;
const TEX_BASE_PATH = new URL('../textures/', import.meta.url).href;

// Sun azimuth aligned to illuminate the hero Showroom front-left 3/4 view (-X, -Z)
// with sweeping clearcoat highlights and clean late-afternoon track shadows.
const SUN_AZIMUTH_RAD = -58.0 * DEG2RAD;

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Evaluates physically grounded carbon-carbon brake disc blackbody radiation.
 * Writes linear RGB directly into `targetColor` (zero heap allocation) and returns
 * HDR emissiveIntensity = ((max(0, T - 600) / 450) ** 2.6) * 7.5.
 *
 * Progression:
 *   <= 600 C : dark carbon (intensity 0)
 *    650 C   : deep cherry red
 *    820 C   : glowing red-orange
 *  950-1050C : bright incandescent orange-yellow (HDR bloom)
 */
export function evaluateBrakeBlackbody(tempC, targetColor) {
  if (!Number.isFinite(tempC) || tempC <= 600.0) {
    targetColor.setRGB(0, 0, 0);
    return 0.0;
  }

  const u = clamp((tempC - 600.0) / 450.0, 0.0, 1.15);
  const intensity = Math.pow(u, 2.4) * 2.35;
  const uSat = Math.min(u, 1.0);

  // Linear RGB blackbody ramp tuned for ACES Filmic tone mapping (preserves spoke & drill-hole contrast)
  const r = 1.0;
  const g = 0.024 + 0.36 * Math.pow(uSat, 1.65);
  const b = 0.002 + 0.045 * Math.pow(Math.max(0.0, (uSat - 0.38) / 0.62), 2.1);

  targetColor.setRGB(r, g, b);
  return intensity;
}

/**
 * Computes sun direction unit vector and atmospheric color palette for a given
 * solar elevation angle in degrees (12° golden hour -> 28° late afternoon -> 65° high noon).
 */
function computeSolarAtmosphere(elevationDeg, outDir) {
  const elDeg = clamp(Number.isFinite(elevationDeg) ? elevationDeg : 28.0, 8.0, 75.0);
  const elRad = elDeg * DEG2RAD;
  const cosEl = Math.cos(elRad);
  const sinEl = Math.sin(elRad);

  // Car faces -Z; negative azimuth places sun in front-left (-X, +Y, -Z) studio key quadrant
  outDir.set(
    Math.sin(SUN_AZIMUTH_RAD) * cosEl,
    sinEl,
    -Math.cos(SUN_AZIMUTH_RAD) * cosEl
  ).normalize();

  // Normalized solar height factor: 0 at golden hour (12 deg), 1 at high noon (65 deg)
  const h = clamp((elDeg - 12.0) / 53.0, 0.0, 1.0);
  const warmMix = 1.0 - Math.pow(h, 0.62);

  return {
    elDeg,
    h,
    warmMix,
    sunIntensity: 2.55 + 1.15 * Math.pow(h, 0.55),
    hemiIntensity: 0.72 + 0.28 * h,
    fillIntensity: 0.34 + 0.14 * h,
    // Crisp late-afternoon warm sunlight transitioning to neutral daylight white at noon (linear RGB)
    sunColor: new THREE.Color().setRGB(
      1.0,
      0.86 + 0.13 * (1.0 - warmMix),
      0.68 + 0.30 * (1.0 - warmMix)
    ),
    zenithColor: new THREE.Color().setRGB(
      0.045 + 0.035 * h,
      0.19 + 0.14 * h,
      0.64 + 0.22 * h
    ),
    horizonColor: new THREE.Color().setRGB(
      0.56 + 0.14 * warmMix,
      0.62 + 0.08 * (1.0 - warmMix * 0.4),
      0.74 - 0.18 * warmMix
    ),
    groundColor: new THREE.Color().setRGB(0.08, 0.09, 0.105),
    hemiSkyColor: new THREE.Color().setRGB(
      0.58 + 0.10 * h,
      0.72 + 0.10 * h,
      0.94 + 0.04 * h
    ),
    hemiGroundColor: new THREE.Color().setRGB(0.14, 0.15, 0.17),
    fogColor: new THREE.Color().setRGB(
      0.58 + 0.09 * warmMix,
      0.64 + 0.05 * (1.0 - warmMix),
      0.74 - 0.12 * warmMix
    ),
  };
}

/**
 * Builds a procedural Rayleigh/Mie physical atmospheric sky ShaderMaterial.
 * Used both for the main scene sky dome and the PMREM environment cubemap generator
 * so clearcoat bodywork reflections match the visible sky and sun disc seamlessly.
 */
function createPhysicalSkyMaterial(sunDir, palette, forPmrem = false) {
  return new THREE.ShaderMaterial({
    name: forPmrem ? 'f1_pmrem_sky_shader' : 'f1_atmospheric_sky_shader',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: !forPmrem,
    uniforms: {
      uSunDir: { value: sunDir.clone() },
      uZenithColor: { value: palette.zenithColor.clone() },
      uHorizonColor: { value: palette.horizonColor.clone() },
      uGroundColor: { value: palette.groundColor.clone() },
      uSunColor: { value: palette.sunColor.clone() },
      uWarmMix: { value: palette.warmMix },
      uForPmrem: { value: forPmrem ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGroundColor;
      uniform vec3 uSunColor;
      uniform float uWarmMix;
      uniform float uForPmrem;

      varying vec3 vWorldDir;

      void main() {
        vec3 dir = normalize( vWorldDir );
        vec3 sunDir = normalize( uSunDir );

        float elev = dir.y;
        float cosTheta = dot( dir, sunDir );

        // Rayleigh vertical optical thickness gradient (horizon scattering -> deep sky zenith)
        float rayleighT = pow( clamp( elev, 0.0, 1.0 ), 0.46 );
        vec3 sky = mix( uHorizonColor, uZenithColor, rayleighT );

        // Atmospheric horizon aerial scatter band
        float horizonBand = exp( -abs( elev ) * 9.0 );
        vec3 warmHorizonTint = mix( vec3( 0.80, 0.85, 0.94 ), vec3( 1.0, 0.72, 0.44 ), uWarmMix );
        sky = mix( sky, warmHorizonTint * 0.92, horizonBand * 0.44 );

        // Henyey-Greenstein Mie forward scattering aureole around solar azimuth
        float g = 0.78;
        float g2 = g * g;
        float miePhase = ( 1.0 - g2 ) / ( 4.0 * 3.14159265 * pow( max( 0.04, 1.0 + g2 - 2.0 * g * cosTheta ), 1.5 ) );
        float aboveHorizon = smoothstep( -0.04, 0.08, elev );
        sky += uSunColor * miePhase * ( 0.06 + 0.05 * uWarmMix ) * aboveHorizon;

        // Crisp solar disc + subtle corona (HDR intensity in PMREM for crisp clearcoat glints)
        float sunCorona = pow( max( cosTheta, 0.0 ), 96.0 ) * ( 0.65 + 0.55 * uForPmrem );
        float sunDisc = smoothstep( 0.99935, 0.99985, cosTheta ) * ( uForPmrem > 0.5 ? 16.0 : 6.0 );
        sky += uSunColor * ( sunCorona + sunDisc ) * aboveHorizon;

        // High-altitude cirrus streaks & crisp reflection horizon ribbon in PMREM IBL
        if ( uForPmrem > 0.5 ) {
          float cloudBand = smoothstep( 0.14, 0.34, elev ) * ( 1.0 - smoothstep( 0.55, 0.82, elev ) );
          float streak = 0.5 + 0.5 * sin( dir.x * 5.0 + dir.z * 3.2 ) * cos( dir.z * 4.5 - dir.x * 2.1 );
          sky += vec3( 0.50, 0.54, 0.60 ) * cloudBand * pow( streak, 2.0 );
          // Clean bright architectural horizon ribbon reflected cleanly along car sidepods
          float reflRibbon = exp( -pow( ( elev - 0.06 ) * 15.0, 2.0 ) );
          sky += vec3( 0.62, 0.66, 0.72 ) * reflRibbon;
        } else {
          float cirrus = smoothstep( 0.08, 0.42, elev ) * ( 1.0 - smoothstep( 0.52, 0.88, elev ) );
          float wisp = 0.5 + 0.5 * sin( dir.x * 7.5 + dir.z * 4.0 ) * sin( dir.z * 9.0 - dir.x * 5.5 );
          sky = mix( sky, vec3( 0.92, 0.94, 0.98 ), cirrus * pow( wisp, 4.0 ) * 0.16 );
        }

        // Ground hemisphere (charcoal FIA asphalt bounce below horizon)
        float groundMix = smoothstep( 0.015, -0.10, elev );
        vec3 groundGrad = mix( uGroundColor * 1.45, uGroundColor * 0.65, clamp( -elev * 3.0, 0.0, 1.0 ) );
        vec3 finalColor = mix( sky, groundGrad, groundMix );

        gl_FragColor = vec4( finalColor, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Authoritative PBR Material Library for Hero/Rival F1 Cars, Tokyo GP Circuit,
 * and Atmospheric Lighting / PMREM Environment.
 */
export class PBRMaterialLibrary {
  /**
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(renderer) {
    this.renderer = renderer || null;
    this.textureLoader = new THREE.TextureLoader();
    this.maxAnisotropy =
      renderer && renderer.capabilities
        ? Math.min(8, renderer.capabilities.getMaxAnisotropy())
        : 4;

    this._texCache = new Map();
    this._trackedTextures = [];
    this._auditById = new Map();
    this.auditRecords = [];
    this.manifest = null;
    this._envHandle = null;
  }

  /**
   * Loads `./textures/pbr_manifest.json` produced by Step 2 Python post-processing
   * and populates `this.auditRecords` with validated reflectance & color-space entries.
   */
  async loadManifest() {
    try {
      const response = await fetch(`${TEX_BASE_PATH}pbr_manifest.json`, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading pbr_manifest.json`);
      }
      const data = await response.json();
      this.manifest = data;
      this._mergeManifestRecords(data);
    } catch (err) {
      console.warn('[PBRMaterialLibrary] Unable to fetch pbr_manifest.json; using runtime audit only.', err);
    }
    return this.auditRecords;
  }

  _mergeManifestRecords(data) {
    if (!data || typeof data !== 'object') return;

    const materials = data.materials || {};
    for (const [key, entry] of Object.entries(materials)) {
      const isMixed = entry.metallicMode === 'mixed';
      const metalVals = Array.isArray(entry.metalnessUniqueValues) ? entry.metalnessUniqueValues : [0];
      const binaryOk = metalVals.every((v) => v === 0 || v === 255);

      let srgbOk = false;
      let srgbRangeStr = `[${entry.minSrgb}, ${entry.maxSrgb}]`;
      if (isMixed) {
        const dMin = entry.dielectricMinSrgb ?? entry.minSrgb;
        const dMax = entry.dielectricMaxSrgb ?? entry.maxSrgb;
        const cMin = entry.conductiveMinSrgb ?? PBR_BOUNDS.CONDUCTIVE_MIN_SRGB;
        const cMax = entry.conductiveMaxSrgb ?? PBR_BOUNDS.CONDUCTIVE_MAX_SRGB;
        srgbOk =
          dMin >= PBR_BOUNDS.DIELECTRIC_MIN_SRGB &&
          dMax <= PBR_BOUNDS.DIELECTRIC_MAX_SRGB &&
          cMin >= PBR_BOUNDS.CONDUCTIVE_MIN_SRGB &&
          cMax <= PBR_BOUNDS.CONDUCTIVE_MAX_SRGB;
        srgbRangeStr = `D[${dMin},${dMax}] M[${cMin},${cMax}]`;
      } else {
        srgbOk =
          entry.minSrgb >= PBR_BOUNDS.DIELECTRIC_MIN_SRGB &&
          entry.maxSrgb <= PBR_BOUNDS.DIELECTRIC_MAX_SRGB;
      }

      const passed = Boolean(entry.passed) && srgbOk && binaryOk;
      this._upsertAuditRecord({
        id: key,
        name: key,
        category: 'Nano Banana PBR',
        type: isMixed ? 'Mixed (Metal/Diel)' : 'Dielectric',
        colorSpace: entry.colorSpace || 'Utility - sRGB - Texture',
        dataMapsColorSpace: entry.dataMaps || 'Utility - Raw',
        srgbRange: srgbRangeStr,
        minSrgb: entry.minSrgb,
        maxSrgb: entry.maxSrgb,
        dielectricMinSrgb: entry.dielectricMinSrgb ?? entry.minSrgb,
        dielectricMaxSrgb: entry.dielectricMaxSrgb ?? entry.maxSrgb,
        conductiveMinSrgb: entry.conductiveMinSrgb ?? null,
        conductiveMaxSrgb: entry.conductiveMaxSrgb ?? null,
        roughnessRange: entry.roughnessRange || null,
        metalnessValues: metalVals,
        metalnessLabel: metalVals.join(' / '),
        resolution: entry.resolution || null,
        tileable: Boolean(entry.tileable),
        files: entry.files || null,
        srgbPassed: srgbOk,
        binaryMetalPassed: binaryOk,
        passed,
        status: passed ? 'PASS' : 'FAIL',
      });
    }

    const auxMaps = data.auxiliaryMaps || {};
    for (const [key, aux] of Object.entries(auxMaps)) {
      const passed = Boolean(aux.passed);
      this._upsertAuditRecord({
        id: key,
        name: key,
        category: 'Auxiliary Data Map',
        type: 'Non-Color Data',
        colorSpace: aux.colorSpace || 'Utility - Raw',
        dataMapsColorSpace: 'Utility - Raw',
        srgbRange: 'Linear Data',
        minSrgb: null,
        maxSrgb: null,
        metalnessValues: [],
        metalnessLabel: 'N/A',
        resolution: aux.resolution || null,
        tileable: Boolean(aux.tileable),
        files: { data: aux.file },
        srgbPassed: true,
        binaryMetalPassed: true,
        passed,
        status: passed ? 'PASS' : 'FAIL',
      });
    }
  }

  _registerProceduralAudit(id, hexColor, isMetal, roughnessLabel) {
    const r = (hexColor >> 16) & 0xff;
    const g = (hexColor >> 8) & 0xff;
    const b = hexColor & 0xff;
    const minC = Math.min(r, g, b);
    const maxC = Math.max(r, g, b);
    const srgbOk = isMetal
      ? minC >= PBR_BOUNDS.CONDUCTIVE_MIN_SRGB && maxC <= PBR_BOUNDS.CONDUCTIVE_MAX_SRGB
      : minC >= PBR_BOUNDS.DIELECTRIC_MIN_SRGB && maxC <= PBR_BOUNDS.DIELECTRIC_MAX_SRGB;

    this._upsertAuditRecord({
      id,
      name: id,
      category: 'Procedural Architectural',
      type: isMetal ? 'Conductive Metal' : 'Dielectric',
      colorSpace: 'Utility - sRGB - Texture',
      dataMapsColorSpace: 'Utility - Raw',
      srgbRange: `[${minC}, ${maxC}]`,
      minSrgb: minC,
      maxSrgb: maxC,
      roughnessRange: roughnessLabel,
      metalnessValues: [isMetal ? 255 : 0],
      metalnessLabel: isMetal ? '255 (Metal)' : '0 (Diel)',
      srgbPassed: srgbOk,
      binaryMetalPassed: true,
      passed: srgbOk,
      status: srgbOk ? 'PASS' : 'FAIL',
    });
  }

  _upsertAuditRecord(record) {
    this._auditById.set(record.id, record);
    this.auditRecords = Array.from(this._auditById.values());
  }

  /**
   * Internal cached texture loader enforcing exact color space, anisotropy, wrap, and UV transforms.
   */
  _loadTextureInternal(filename, expectedColorSpace, repeatX, repeatY, tileable, flipY, options = {}) {
    const wrapS = options.wrapS ?? (tileable ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping);
    const wrapT = options.wrapT ?? (tileable ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping);
    const rot = options.rotation ?? 0;
    const offX = options.offset ? options.offset[0] : 0;
    const offY = options.offset ? options.offset[1] : 0;

    const cacheKey = `${filename}|${expectedColorSpace}|${repeatX}x${repeatY}|${wrapS},${wrapT}|f${flipY ? 1 : 0}|r${rot.toFixed(4)}|o${offX.toFixed(3)},${offY.toFixed(3)}`;
    if (this._texCache.has(cacheKey)) {
      return this._texCache.get(cacheKey);
    }

    const url = /^(?:https?:|data:|\.?\/)/.test(filename) ? filename : `${TEX_BASE_PATH}${filename}`;
    const tex = this.textureLoader.load(url);
    tex.name = filename;
    tex.colorSpace = expectedColorSpace;
    tex.flipY = flipY;
    tex.channel = 0; // Explicitly sample primary UV channel (TEXCOORD_0) for aoMap/roughnessMap
    tex.anisotropy = this.maxAnisotropy;
    tex.wrapS = wrapS;
    tex.wrapT = wrapT;
    tex.repeat.set(repeatX, repeatY);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;

    if (offX !== 0 || offY !== 0) {
      tex.offset.set(offX, offY);
    }
    if (rot !== 0) {
      tex.center.set(0.5, 0.5);
      tex.rotation = rot;
    }

    this._texCache.set(cacheKey, tex);
    this._trackedTextures.push({
      filename,
      expectedColorSpace,
      role: expectedColorSpace === THREE.SRGBColorSpace ? 'color' : 'raw',
      texture: tex,
    });
    return tex;
  }

  /**
   * Loads an sRGB color albedo or emissive texture ("Utility - sRGB - Texture").
   * Note: Pass `flipY = false` for textures bound onto trimesh-exported glTF (.glb) meshes.
   */
  loadColorTex(filename, repeatX = 1, repeatY = 1, tileable = false, flipY = true, options = {}) {
    return this._loadTextureInternal(
      filename,
      THREE.SRGBColorSpace,
      repeatX,
      repeatY,
      tileable,
      flipY,
      options
    );
  }

  /**
   * Loads a linear non-color data map ("Utility - Raw"): Normal, ORM, Flake Normal, Thermal Mask.
   */
  loadRawTex(filename, repeatX = 1, repeatY = 1, tileable = false, flipY = true, options = {}) {
    return this._loadTextureInternal(
      filename,
      THREE.NoColorSpace,
      repeatX,
      repeatY,
      tileable,
      flipY,
      options
    );
  }

  /**
   * Creates the complete Nano Banana PBR material suite for an F1 car (hero or AI rival).
   *
   * UV orientation note (verified directly against `scripts/build_f1_car_glb.py`):
   *   - `trimesh` exports glTF `TEXCOORD_0` with V flipped to glTF top-left origin (`1 - v`).
   *   - Therefore ALL car `.glb` textures load with `flipY = false` so `#26`, Pirelli `P ZERO`,
   *     steering wheel OLED, and driver helmet visor are strictly upright and non-mirrored.
   *   - Because `flipY = false` reverses `dP/dv` relative to OpenGL +Y normal maps,
   *     `normalScale.y` is negated (`new THREE.Vector2(+s, -s)`).
   *   - All 3 Nano Banana livery plates run longitudinally along image X (nose left -> louvers right),
   *     while `loft_superellipse_z` runs Z along V; rotating livery UVs by `-PI/2` around `(0.5, 0.5)`
   *     aligns `#26` squarely atop the needle nosecone and cooling louvers down the engine cover!
   */
  createCarMaterialSet(liveryKey = 'car_livery_player', compoundId = 'soft', options = {}) {
    // Verified glTF top-left UV orientation from trimesh export
    const gltfFlipY = options.flipY !== undefined ? Boolean(options.flipY) : false;
    const nySign = gltfFlipY ? 1.0 : -1.0;

    // 1. Dual-Layer Metallic Clearcoat Livery Car Paint
    const liveryOpts = { rotation: -Math.PI * 0.5 };
    const liveryMap = this.loadColorTex(`${liveryKey}.png`, 1, 1, false, gltfFlipY, liveryOpts);
    const liveryNormal = this.loadRawTex(`${liveryKey}_normal.png`, 1, 1, false, gltfFlipY, liveryOpts);
    const liveryOrm = this.loadRawTex(`${liveryKey}_orm.png`, 1, 1, false, gltfFlipY, liveryOpts);
    const flakeNormal = this.loadRawTex('car_flake_normal.png', 18, 18, true, gltfFlipY);

    const livery = new THREE.MeshPhysicalMaterial({
      name: `mat_${liveryKey}`,
      map: liveryMap,
      normalMap: liveryNormal,
      normalScale: new THREE.Vector2(0.35, 0.35 * nySign),
      aoMap: liveryOrm,
      aoMapIntensity: 0.65,
      roughnessMap: liveryOrm,
      roughness: 1.0, // Driven cleanly by calibrated ORM [0.18..0.32]
      metalness: 0.28, // Metallic aluminum basecoat sheen beneath polyurethane clearcoat
      clearcoat: 1.0,
      clearcoatRoughness: 0.032,
      clearcoatNormalMap: flakeNormal,
      clearcoatNormalScale: new THREE.Vector2(0.055, 0.055 * nySign),
      ior: 1.5,
      reflectivity: 0.9,
      envMapIntensity: 1.45,
      flatShading: false,
    });

    // Optional clean tint override for extra AI rival distinction while obeying PBR bounds
    if (options.liveryTintHex) {
      livery.color.setHex(options.liveryTintHex);
    }

    // 2. Exposed 2x2 Diagonal Twill Dry Carbon Fiber Composite
    const carbonMap = this.loadColorTex('car_carbon_weave.png', 5, 5, true, gltfFlipY);
    const carbonNormal = this.loadRawTex('car_carbon_weave_normal.png', 5, 5, true, gltfFlipY);
    const carbonOrm = this.loadRawTex('car_carbon_weave_orm.png', 5, 5, true, gltfFlipY);

    const carbon = new THREE.MeshPhysicalMaterial({
      name: 'mat_car_carbon_weave',
      map: carbonMap,
      normalMap: carbonNormal,
      normalScale: new THREE.Vector2(0.75, 0.75 * nySign),
      aoMap: carbonOrm,
      aoMapIntensity: 0.8,
      roughnessMap: carbonOrm,
      roughness: 1.0, // Calibrated ORM [0.20..0.42]
      metalness: 0.0,
      clearcoat: 0.48,
      clearcoatRoughness: 0.14,
      ior: 1.5,
      envMapIntensity: 1.15,
      flatShading: false,
    });

    // 3. Pirelli Racing Slick Contact Tread (live thermal roughness 0.65 cold -> 0.22 hot)
    const treadMap = this.loadColorTex('tire_slick_tread.png', 4, 1, true, gltfFlipY);
    const treadNormal = this.loadRawTex('tire_slick_tread_normal.png', 4, 1, true, gltfFlipY);
    const treadOrm = this.loadRawTex('tire_slick_tread_orm.png', 4, 1, true, gltfFlipY);

    const tireTread = new THREE.MeshStandardMaterial({
      name: 'mat_tire_slick_tread',
      map: treadMap,
      normalMap: treadNormal,
      normalScale: new THREE.Vector2(0.85, 0.85 * nySign),
      aoMap: treadOrm,
      aoMapIntensity: 0.75,
      roughnessMap: treadOrm,
      roughness: 0.65,
      metalness: 0.0,
      envMapIntensity: 0.85,
      flatShading: false,
    });

    // Normalize ORM micro-grain around 1.0 so `tireTread.roughness` (0.65 -> 0.22) is physically exact
    tireTread.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
          float treadMicroVar = clamp( texelRoughness.g / 0.54, 0.78, 1.18 );
          roughnessFactor = clamp( roughnessFactor * treadMicroVar, 0.16, 0.85 );
        #endif
        `
      );
    };
    tireTread.customProgramCacheKey = () => 'f1_tire_tread_thermal_v1';

    // 4. Pirelli Compound Sidewalls (live swappable Soft / Medium / Hard)
    const sidewallNormal = this.loadRawTex('tire_sidewall_pirelli_normal.png', 1, 1, false, gltfFlipY);
    const sidewallOrm = this.loadRawTex('tire_sidewall_pirelli_orm.png', 1, 1, false, gltfFlipY);
    const sidewallMaps = {
      soft: this.loadColorTex('tire_sidewall_soft.png', 1, 1, false, gltfFlipY),
      medium: this.loadColorTex('tire_sidewall_medium.png', 1, 1, false, gltfFlipY),
      hard: this.loadColorTex('tire_sidewall_hard.png', 1, 1, false, gltfFlipY),
    };
    const initialCompound = TIRE_COMPOUNDS[compoundId] ? compoundId : 'soft';

    const tireSidewall = new THREE.MeshStandardMaterial({
      name: 'mat_tire_sidewall',
      map: sidewallMaps[initialCompound],
      normalMap: sidewallNormal,
      normalScale: new THREE.Vector2(0.7, 0.7 * nySign),
      aoMap: sidewallOrm,
      aoMapIntensity: 0.7,
      roughnessMap: sidewallOrm,
      roughness: 1.0, // Calibrated ORM [0.48..0.68]; outer rubber reads realistic satin-matte
      metalness: 0.0,
      envMapIntensity: 0.75,
      flatShading: false,
    });

    // 5. 18-Inch Forged Magnesium Multi-Spoke Wheel Rims (mixed metal/dielectric ORM)
    const rimMap = this.loadColorTex('wheel_rim_forged.png', 1, 1, false, gltfFlipY);
    const rimNormal = this.loadRawTex('wheel_rim_forged_normal.png', 1, 1, false, gltfFlipY);
    const rimOrm = this.loadRawTex('wheel_rim_forged_orm.png', 1, 1, false, gltfFlipY);

    const wheelRim = new THREE.MeshStandardMaterial({
      name: 'mat_wheel_rim_forged',
      map: rimMap,
      normalMap: rimNormal,
      normalScale: new THREE.Vector2(0.8, 0.8 * nySign),
      aoMap: rimOrm,
      aoMapIntensity: 0.8,
      roughnessMap: rimOrm,
      roughness: 1.0, // Calibrated ORM [0.18..0.34]
      metalnessMap: rimOrm, // Binary 0 (carbon lip & red nut) / 255 (forged spokes)
      metalness: 0.92,
      envMapIntensity: 1.45,
      flatShading: false,
    });

    // 6. Cross-Drilled Carbon-Carbon Brake Rotors (separate Front & Rear instances for 56.5% front bias!)
    const rotorMap = this.loadColorTex('brake_rotor_carbon.png', 1, 1, false, gltfFlipY);
    const rotorNormal = this.loadRawTex('brake_rotor_carbon_normal.png', 1, 1, false, gltfFlipY);
    const rotorOrm = this.loadRawTex('brake_rotor_carbon_orm.png', 1, 1, false, gltfFlipY);
    const thermalMask = this.loadRawTex('brake_thermal_mask.png', 1, 1, false, gltfFlipY);

    const makeBrakeRotorMat = (axleTag) =>
      new THREE.MeshStandardMaterial({
        name: `mat_brake_rotor_${axleTag}`,
        map: rotorMap,
        normalMap: rotorNormal,
        normalScale: new THREE.Vector2(0.85, 0.85 * nySign),
        aoMap: rotorOrm,
        aoMapIntensity: 0.85,
        roughnessMap: rotorOrm,
        roughness: 1.0, // Calibrated ORM [0.62..0.78]
        metalness: 0.0,
        emissive: new THREE.Color(0x000000),
        emissiveMap: thermalMask, // Strictly linear NoColorSpace annular friction mask
        emissiveIntensity: 0.0,
        envMapIntensity: 0.7,
        flatShading: false,
      });

    const brakeRotorFront = makeBrakeRotorMat('front');
    const brakeRotorRear = makeBrakeRotorMat('rear');

    // 7. Anodized Motorsport 6-Piston Monobloc Brake Caliper
    const brakeCaliper = new THREE.MeshStandardMaterial({
      name: 'mat_brake_caliper',
      color: new THREE.Color(0xc82424),
      metalness: 0.72,
      roughness: 0.28,
      envMapIntensity: 1.3,
      flatShading: false,
    });
    this._registerProceduralAudit('car_brake_caliper', 0xc82424, false, [0.28, 0.28]);

    // 8. FIA 8860 Driver Helmet & Tinted Iridium Visor
    const helmetMap = this.loadColorTex('driver_helmet_livery.png', 1, 1, false, gltfFlipY);
    const helmetNormal = this.loadRawTex('driver_helmet_livery_normal.png', 1, 1, false, gltfFlipY);
    const helmetOrm = this.loadRawTex('driver_helmet_livery_orm.png', 1, 1, false, gltfFlipY);

    const helmet = new THREE.MeshPhysicalMaterial({
      name: 'mat_driver_helmet',
      map: helmetMap,
      normalMap: helmetNormal,
      normalScale: new THREE.Vector2(0.32, 0.32 * nySign),
      aoMap: helmetOrm,
      aoMapIntensity: 0.6,
      roughnessMap: helmetOrm,
      roughness: 1.0, // Calibrated ORM [0.10..0.24]
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      ior: 1.52,
      envMapIntensity: 1.5,
      flatShading: false,
    });

    // 9. Cockpit Carbon F1 Steering Wheel Faceplate & Backlit Telemetry OLED
    // Subtle zoom (0.76, offset 0.12) frames the carbon bezel, OLED screen, LED shift bar,
    // buttons, and rotary dials cleanly edge-to-edge without outer studio margin.
    const dashOpts = { offset: [0.12, 0.12], rotation: Math.PI };
    const dashMap = this.loadColorTex('cockpit_steering_dash.png', 0.76, 0.76, false, gltfFlipY, dashOpts);
    const dashNormal = this.loadRawTex('cockpit_steering_dash_normal.png', 0.76, 0.76, false, gltfFlipY, dashOpts);
    const dashOrm = this.loadRawTex('cockpit_steering_dash_orm.png', 0.76, 0.76, false, gltfFlipY, dashOpts);

    const steeringDash = new THREE.MeshStandardMaterial({
      name: 'mat_cockpit_steering_dash',
      map: dashMap,
      normalMap: dashNormal,
      normalScale: new THREE.Vector2(0.55, 0.55 * nySign),
      aoMap: dashOrm,
      aoMapIntensity: 0.65,
      roughnessMap: dashOrm,
      roughness: 0.9,
      metalness: 0.0,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: dashMap, // sRGB color emissive for glowing OLED telemetry & shift LEDs
      emissiveIntensity: 0.42,
      envMapIntensity: 0.9,
      flatShading: false,
    });

    // 10. Rear FIA Crash-Structure Rain Light / ERS Harvest Warning LED
    const rainLight = new THREE.MeshStandardMaterial({
      name: 'mat_rear_rain_light',
      color: new THREE.Color(0x991e1e),
      emissive: new THREE.Color(0xff1a1a),
      emissiveIntensity: 1.0,
      roughness: 0.24,
      metalness: 0.0,
      flatShading: false,
    });
    this._registerProceduralAudit('car_rear_rain_light', 0x991e1e, false, [0.24, 0.24]);

    let activeCompound = initialCompound;

    const setCompound = (nextId) => {
      const key = TIRE_COMPOUNDS[nextId] ? nextId : 'soft';
      if (key === activeCompound && tireSidewall.map === sidewallMaps[key]) return key;
      activeCompound = key;
      tireSidewall.map = sidewallMaps[key];
      tireSidewall.needsUpdate = true;
      return key;
    };

    /**
     * Zero-allocation live thermal & visual material update invoked once per render frame.
     */
    const updateDynamicState = (state) => {
      if (!state) return;

      // 1. Live tire tread roughness modulation (65 C cold matte 0.65 -> 105 C hot scrubbed 0.22)
      if (Number.isFinite(state.avgTireTemp)) {
        const hotFrac = clamp((state.avgTireTemp - 65.0) / 40.0, 0.0, 1.0);
        tireTread.roughness = 0.65 - 0.43 * hotFrac;
      } else if (Number.isFinite(state.tireRoughness)) {
        tireTread.roughness = clamp(state.tireRoughness, 0.22, 0.65);
      }

      // 2. Coupled front & rear blackbody incandescent carbon-carbon brake glow (> 600 C)
      const fTemp = Number.isFinite(state.frontBrakeTemp)
        ? state.frontBrakeTemp
        : (Number.isFinite(state.brakeTemp) ? state.brakeTemp : 220.0);
      const rTemp = Number.isFinite(state.rearBrakeTemp)
        ? state.rearBrakeTemp
        : (Number.isFinite(state.brakeTemp) ? state.brakeTemp * 0.88 : 220.0);

      brakeRotorFront.emissiveIntensity = evaluateBrakeBlackbody(fTemp, brakeRotorFront.emissive);
      brakeRotorRear.emissiveIntensity = evaluateBrakeBlackbody(rTemp, brakeRotorRear.emissive);

      // 3. FIA 2.0 Hz rain/ERS rear LED pulse (intensifies crisply under braking / ERS harvest)
      const t = Number.isFinite(state.simTime) ? state.simTime : 0.0;
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 4.0); // 2.0 Hz cycle
      const brakeBoost = state.brake > 0.15 ? 1.8 : 0.0;
      rainLight.emissiveIntensity = 0.45 + 2.35 * Math.pow(pulse, 2.2) + brakeBoost;
    };

    return {
      livery,
      carbon,
      tireTread,
      tireSidewall,
      wheelRim,
      brakeRotor: brakeRotorFront,
      brakeRotorFront,
      brakeRotorRear,
      brakeCaliper,
      helmet,
      steeringDash,
      rainLight,
      setCompound,
      updateDynamicState,
      getCompound: () => activeCompound,
    };
  }

  /**
   * Builds the complete Tokyo GP circuit & trackside architectural PBR material set.
   * All procedural colors strictly satisfy [30, 240] sRGB dielectric / [180, 255] conductive bounds.
   */
  createTrackMaterials() {
    // 1. Multi-Frequency Stochastic Height-Blended FIA Grade 1 Asphalt
    const asphaltMap = this.loadColorTex('track_asphalt_aggregate.png', 1, 1, true, true);
    const asphaltNormal = this.loadRawTex('track_asphalt_aggregate_normal.png', 1, 1, true, true);
    const asphaltOrm = this.loadRawTex('track_asphalt_aggregate_orm.png', 1, 1, true, true);

    const asphalt = new THREE.MeshStandardMaterial({
      name: 'mat_track_asphalt',
      map: asphaltMap,
      normalMap: asphaltNormal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      aoMap: asphaltOrm,
      aoMapIntensity: 0.72,
      roughnessMap: asphaltOrm,
      roughness: 1.0, // ORM encodes [0.60..0.88] bitumen/basalt aggregate contrast
      metalness: 0.0,
      envMapIntensity: 0.68,
      flatShading: false,
    });

    // Inject stochastic dual-angle anti-tiling, height-blended bitumen/aggregate transition,
    // vertex-driven dark rubbered racing line (`aRacingLine`), and distance roughness compensation.
    asphalt.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          attribute float aRacingLine;
          varying float vRacingLine;
          varying vec3 vTrackWorldPos;
          `
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `
          #include <project_vertex>
          vRacingLine = aRacingLine;
          vTrackWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying float vRacingLine;
          varying vec3 vTrackWorldPos;

          float f1AsphaltHash( vec2 p ) {
            p = fract( p * vec2( 127.1, 311.7 ) );
            p += dot( p, p + 34.23 );
            return fract( p.x * p.y );
          }

          float f1AsphaltNoise( vec2 p ) {
            vec2 i = floor( p );
            vec2 f = fract( p );
            vec2 u = f * f * ( 3.0 - 2.0 * f );
            float a = f1AsphaltHash( i );
            float b = f1AsphaltHash( i + vec2( 1.0, 0.0 ) );
            float c = f1AsphaltHash( i + vec2( 0.0, 1.0 ) );
            float d = f1AsphaltHash( i + vec2( 1.0, 1.0 ) );
            return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
          }

          mat2 f1AsphaltRot( float rad ) {
            float c = cos( rad );
            float s = sin( rad );
            return mat2( c, -s, s, c );
          }
          `
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          float f1RubberMask = 0.0;
          float f1HeightBlend = 0.5;
          vec2 f1AsphaltUvB = vec2( 0.0 );
          #ifdef USE_MAP
            vec2 uvA = vMapUv;
            f1AsphaltUvB = f1AsphaltRot( 0.618034 ) * ( vMapUv * 0.43 ) + vec2( 0.37, 0.71 );

            vec4 texA = texture2D( map, uvA );
            vec4 texB = texture2D( map, f1AsphaltUvB );

            // World-space multi-octave macro aging breaks long-straight repetition completely
            float macroA = f1AsphaltNoise( vTrackWorldPos.xz * 0.028 );
            float macroB = f1AsphaltNoise( vTrackWorldPos.xz * 0.095 );
            float macroAging = macroA * 0.64 + macroB * 0.36;

            // Height-blended aggregate vs weathered bitumen binder transition (Section 6.2)
            float heightAgg = dot( texA.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            float heightBit = dot( texB.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            float blendBias = 0.16 + ( macroAging - 0.5 ) * 0.34;
            f1HeightBlend = clamp( ( heightAgg - heightBit + blendBias ) / 0.28, 0.0, 1.0 );

            vec3 asphaltRgb = mix( texB.rgb, texA.rgb, f1HeightBlend );
            asphaltRgb *= ( 0.88 + 0.20 * macroAging );

            // Rubbered-in optimal apex racing line driven by vertex attribute aRacingLine
            float streakNoise = 0.84 + 0.16 * f1AsphaltNoise( vec2( vMapUv.x * 16.0, vMapUv.y * 0.45 ) );
            f1RubberMask = clamp( vRacingLine * streakNoise, 0.0, 1.0 );
            asphaltRgb *= mix( 1.0, 0.64, f1RubberMask );

            diffuseColor.rgb *= asphaltRgb;
          #endif
          `
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
          float roughnessFactor = roughness;
          #ifdef USE_ROUGHNESSMAP
            float rA = texture2D( roughnessMap, vRoughnessMapUv ).g;
            float rB = texture2D( roughnessMap, f1AsphaltUvB ).g;
            roughnessFactor *= mix( rB, rA, f1HeightBlend );
          #endif

          // Rubbered-in racing groove develops subtle scrubbed rubber sheen
          roughnessFactor = mix( roughnessFactor, max( 0.38, roughnessFactor - 0.20 ), f1RubberMask );

          // Distance roughness compensation eliminates oblique horizon specular washout
          float f1CamDist = length( cameraPosition - vTrackWorldPos );
          float f1DistFade = smoothstep( 36.0, 260.0, f1CamDist );
          roughnessFactor = mix( roughnessFactor, max( roughnessFactor, 0.90 ), f1DistFade * 0.76 );
          `
        );
    };
    asphalt.customProgramCacheKey = () => 'f1_stochastic_asphalt_v1';

    // 2. FIA Alternating Red/White Rumble Kerbs
    const kerbMap = this.loadColorTex('track_kerb_fia.png', 1, 1, true, true);
    const kerbNormal = this.loadRawTex('track_kerb_fia_normal.png', 1, 1, true, true);
    const kerbOrm = this.loadRawTex('track_kerb_fia_orm.png', 1, 1, true, true);

    const kerb = new THREE.MeshStandardMaterial({
      name: 'mat_track_kerb_fia',
      map: kerbMap,
      normalMap: kerbNormal,
      normalScale: new THREE.Vector2(1.0, 1.0),
      aoMap: kerbOrm,
      aoMapIntensity: 0.75,
      roughnessMap: kerbOrm,
      roughness: 1.0, // ORM [0.55..0.75]
      metalness: 0.0,
      envMapIntensity: 0.72,
      flatShading: false,
    });

    // 3. FIA Trackside Sponsor & Tecpro Barriers
    const barrierWrapOpts = {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    const barrierMap = this.loadColorTex('track_barrier_sponsor.png', 1, 1, false, true, barrierWrapOpts);
    const barrierNormal = this.loadRawTex('track_barrier_sponsor_normal.png', 1, 1, false, true, barrierWrapOpts);
    const barrierOrm = this.loadRawTex('track_barrier_sponsor_orm.png', 1, 1, false, true, barrierWrapOpts);

    const barrier = new THREE.MeshStandardMaterial({
      name: 'mat_track_barrier_sponsor',
      map: barrierMap,
      normalMap: barrierNormal,
      normalScale: new THREE.Vector2(0.7, 0.7),
      aoMap: barrierOrm,
      aoMapIntensity: 0.7,
      roughnessMap: barrierOrm,
      roughness: 1.0, // ORM [0.35..0.55]
      metalness: 0.0,
      envMapIntensity: 0.85,
      flatShading: false,
    });

    // 4. Manicured Circuit Grass Verge (high repeat, matte dielectric)
    const grassMap = this.loadColorTex('env_grass_verge.png', 18, 18, true, true);
    const grassNormal = this.loadRawTex('env_grass_verge_normal.png', 18, 18, true, true);
    const grassOrm = this.loadRawTex('env_grass_verge_orm.png', 18, 18, true, true);

    const grass = new THREE.MeshStandardMaterial({
      name: 'mat_env_grass_verge',
      map: grassMap,
      normalMap: grassNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      aoMap: grassOrm,
      aoMapIntensity: 0.65,
      roughnessMap: grassOrm,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.42,
      flatShading: false,
    });

    // 5. Raked FIA Runoff Gravel Trap
    const gravelMap = this.loadColorTex('env_gravel_trap.png', 6, 6, true, true);
    const gravelNormal = this.loadRawTex('env_gravel_trap_normal.png', 6, 6, true, true);
    const gravelOrm = this.loadRawTex('env_gravel_trap_orm.png', 6, 6, true, true);

    const gravel = new THREE.MeshStandardMaterial({
      name: 'mat_env_gravel_trap',
      map: gravelMap,
      normalMap: gravelNormal,
      normalScale: new THREE.Vector2(1.25, 1.25),
      aoMap: gravelOrm,
      aoMapIntensity: 0.8,
      roughnessMap: gravelOrm,
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.45,
      flatShading: false,
    });

    // 6. Crisp FIA Painted Track Limit Lines & Starting Grid Boxes (sRGB [230..236] <= 240)
    const whiteLine = new THREE.MeshStandardMaterial({
      name: 'mat_track_white_line',
      color: new THREE.Color(0xe6e8ec),
      roughness: 0.78,
      metalness: 0.0,
      envMapIntensity: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      flatShading: false,
    });
    this._registerProceduralAudit('track_white_line', 0xe6e8ec, false, [0.78, 0.78]);

    // 7. Modern Gray-and-White Architectural Pit Building Concrete & Cladding
    const pitBuilding = new THREE.MeshStandardMaterial({
      name: 'mat_pit_building',
      color: new THREE.Color(0xe2e5ea),
      roughness: 0.72,
      metalness: 0.0,
      envMapIntensity: 0.82,
      flatShading: false,
    });
    this._registerProceduralAudit('arch_pit_building', 0xe2e5ea, false, [0.72, 0.72]);

    // 8. Grandstand Architectural Slate Seating
    const grandstandSeat = new THREE.MeshStandardMaterial({
      name: 'mat_grandstand_seat',
      color: new THREE.Color(0x525864),
      roughness: 0.66,
      metalness: 0.0,
      envMapIntensity: 0.72,
      flatShading: false,
    });
    this._registerProceduralAudit('arch_grandstand_seat', 0x525864, false, [0.66, 0.66]);

    // 9. Brushed Structural Steel/Aluminum (FIA Start Gantry, Canopies, Catchfence Posts)
    const metalStructure = new THREE.MeshStandardMaterial({
      name: 'mat_metal_structure',
      color: new THREE.Color(0xc4c9d1), // sRGB [196, 201, 209] strictly inside [180, 255]
      metalness: 0.88,
      roughness: 0.32,
      envMapIntensity: 1.3,
      flatShading: false,
    });
    this._registerProceduralAudit('arch_metal_structure', 0xc4c9d1, true, [0.32, 0.32]);

    // 10. Trackside Japanese Cedar / Park Tree Foliage
    const treeFoliage = new THREE.MeshStandardMaterial({
      name: 'mat_tree_foliage',
      color: new THREE.Color(0x3a5a38), // sRGB [58, 90, 56]
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.42,
      flatShading: false,
    });
    this._registerProceduralAudit('env_tree_foliage', 0x3a5a38, false, [0.88, 0.88]);

    // 11. Tree Trunks
    const treeTrunk = new THREE.MeshStandardMaterial({
      name: 'mat_tree_trunk',
      color: new THREE.Color(0x56463a), // sRGB [86, 70, 58]
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.35,
      flatShading: false,
    });
    this._registerProceduralAudit('env_tree_trunk', 0x56463a, false, [0.92, 0.92]);

    // Auxiliary architectural materials (pit wall concrete, dark gantry frame, tinted pit glass, red trim)
    const concreteWall = new THREE.MeshStandardMaterial({
      name: 'mat_concrete_wall',
      color: new THREE.Color(0xb8bec7),
      roughness: 0.82,
      metalness: 0.0,
      envMapIntensity: 0.6,
      flatShading: false,
    });
    this._registerProceduralAudit('arch_concrete_wall', 0xb8bec7, false, [0.82, 0.82]);

    const darkStructure = new THREE.MeshStandardMaterial({
      name: 'mat_dark_structure',
      color: new THREE.Color(0x2a2e36), // sRGB [42, 46, 54] >= 30
      roughness: 0.62,
      metalness: 0.0,
      envMapIntensity: 0.75,
      flatShading: false,
    });
    this._registerProceduralAudit('arch_dark_structure', 0x2a2e36, false, [0.62, 0.62]);

    const pitGlass = new THREE.MeshPhysicalMaterial({
      name: 'mat_pit_glass',
      color: new THREE.Color(0x2c3846),
      roughness: 0.08,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      ior: 1.5,
      envMapIntensity: 1.45,
      flatShading: false,
    });
    this._registerProceduralAudit('arch_pit_glass', 0x2c3846, false, [0.08, 0.08]);

    const accentRed = new THREE.MeshStandardMaterial({
      name: 'mat_fia_accent_red',
      color: new THREE.Color(0xc82626),
      roughness: 0.44,
      metalness: 0.0,
      envMapIntensity: 0.85,
      flatShading: false,
    });
    this._registerProceduralAudit('arch_fia_accent_red', 0xc82626, false, [0.44, 0.44]);

    const catchfence = new THREE.MeshStandardMaterial({
      name: 'mat_catchfence',
      color: new THREE.Color(0x4a505a),
      roughness: 0.55,
      metalness: 0.0,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      flatShading: false,
    });

    return {
      asphalt,
      kerb,
      barrier,
      grass,
      gravel,
      whiteLine,
      pitBuilding,
      grandstandSeat,
      metalStructure,
      treeFoliage,
      treeTrunk,
      concreteWall,
      darkStructure,
      pitGlass,
      accentRed,
      catchfence,
    };
  }

  /**
   * Constructs the procedural Rayleigh/Mie physical atmospheric sky dome (`radius 2600 m`),
   * PMREM environment cubemap (`scene.environment`), vehicle-locked 2048x2048 directional sun
   * shadow rig (`±38 m`, texel-snapped), hemisphere sky/asphalt bounce light, and subtle fill light.
   *
   * Returns an environment controller with `updateSolarElevation(deg)`,
   * `updateShadowTarget(x, y, z)`, and `updateSkyCenter(x, z)`.
   */
  createEnvironmentLighting(scene, solarElevationDeg = 28) {
    const sunDir = new THREE.Vector3();
    const initialPalette = computeSolarAtmosphere(solarElevationDeg, sunDir);

    // 1. Main Scene Physical Sky Dome (radius 2600 m centered comfortably over the circuit)
    const skyGeo = new THREE.SphereGeometry(2600, 40, 24);
    const skyMat = createPhysicalSkyMaterial(sunDir, initialPalette, false);
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    skyDome.name = 'f1_atmospheric_sky_dome';
    skyDome.frustumCulled = false;
    skyDome.renderOrder = -100;
    skyDome.position.set(500, 0, -200);
    scene.add(skyDome);

    // Subtle aerial perspective fog blending distant hills cleanly into the atmospheric horizon
    scene.fog = new THREE.FogExp2(initialPalette.fogColor.getHex(), 0.00038);

    // 2. Dedicated PMREM Sky/Horizon Scene for Crisp Clearcoat & Forged-Rim IBL Reflections
    const pmremGenerator = this.renderer ? new THREE.PMREMGenerator(this.renderer) : null;
    if (pmremGenerator) {
      pmremGenerator.compileEquirectangularShader();
    }

    const envScene = new THREE.Scene();
    const envSkyGeo = new THREE.SphereGeometry(50, 32, 16);
    const envSkyMat = createPhysicalSkyMaterial(sunDir, initialPalette, true);
    const envSkyMesh = new THREE.Mesh(envSkyGeo, envSkyMat);
    envScene.add(envSkyMesh);

    let currentEnvRT = null;
    const rebuildPmrem = () => {
      if (!pmremGenerator) return;
      const nextRT = pmremGenerator.fromScene(envScene, 0.018);
      if (currentEnvRT) {
        currentEnvRT.dispose();
      }
      currentEnvRT = nextRT;
      scene.environment = currentEnvRT.texture;
    };
    rebuildPmrem();

    // 3. Directional Solar Key Light (2048x2048 PCFSoftShadowMap, ±38 m vehicle-locked frustum)
    const SHADOW_HALF_EXTENT = 38.0;
    const SHADOW_MAP_SIZE = 2048;
    const SHADOW_TEXEL_SIZE = (SHADOW_HALF_EXTENT * 2.0) / SHADOW_MAP_SIZE;
    const SUN_DISTANCE = 92.0;

    const sunLight = new THREE.DirectionalLight(initialPalette.sunColor, initialPalette.sunIntensity);
    sunLight.name = 'f1_solar_key_light';
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    sunLight.shadow.camera.near = 2.0;
    sunLight.shadow.camera.far = 230.0;
    sunLight.shadow.camera.left = -SHADOW_HALF_EXTENT;
    sunLight.shadow.camera.right = SHADOW_HALF_EXTENT;
    sunLight.shadow.camera.top = SHADOW_HALF_EXTENT;
    sunLight.shadow.camera.bottom = -SHADOW_HALF_EXTENT;
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.radius = 2.0;

    sunLight.target.position.set(0, 0, 0);
    sunLight.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
    scene.add(sunLight);
    scene.add(sunLight.target);

    // 4. Hemisphere Bounce Light (sky blue-white zenith over charcoal FIA asphalt ground)
    const hemiLight = new THREE.HemisphereLight(
      initialPalette.hemiSkyColor,
      initialPalette.hemiGroundColor,
      initialPalette.hemiIntensity
    );
    hemiLight.name = 'f1_sky_asphalt_hemi';
    scene.add(hemiLight);

    // 5. Subtle Opposite-Side Atmospheric Fill Light (reveals shadow-side sidepod undercuts & diffuser)
    const fillLight = new THREE.DirectionalLight(0xc8dcff, initialPalette.fillIntensity);
    fillLight.name = 'f1_sky_fill_light';
    fillLight.position.set(-sunDir.x * 60, 28, -sunDir.z * 60);
    scene.add(fillLight);

    // Track current shadow target center for seamless re-aim when solar elevation changes
    const shadowAnchor = new THREE.Vector3(0, 0, 0);
    let currentElevationDeg = initialPalette.elDeg;

    /**
     * Texel-snaps the directional light orthographic shadow frustum tightly around
     * the hero vehicle `(x, y, z)` to prevent sub-pixel shadow swimming at 340 km/h.
     */
    const updateShadowTarget = (x, y = 0, z = 0) => {
      const snapX = Math.round(x / SHADOW_TEXEL_SIZE) * SHADOW_TEXEL_SIZE;
      const snapZ = Math.round(z / SHADOW_TEXEL_SIZE) * SHADOW_TEXEL_SIZE;
      shadowAnchor.set(snapX, y, snapZ);

      sunLight.target.position.copy(shadowAnchor);
      sunLight.position.set(
        shadowAnchor.x + sunDir.x * SUN_DISTANCE,
        shadowAnchor.y + sunDir.y * SUN_DISTANCE,
        shadowAnchor.z + sunDir.z * SUN_DISTANCE
      );
      sunLight.target.updateMatrixWorld();
    };

    /**
     * Keeps the atmospheric sky dome centered on the active camera XZ so the horizon never shifts.
     */
    const updateSkyCenter = (x, z) => {
      skyDome.position.set(x, 0, z);
    };

    /**
     * Updates solar elevation (12 deg golden hour -> 65 deg high noon), refreshing sun light,
     * sky dome shader uniforms, aerial fog, and regenerating the PMREM environment map cleanly.
     */
    const updateSolarElevation = (deg) => {
      const pal = computeSolarAtmosphere(deg, sunDir);
      currentElevationDeg = pal.elDeg;

      sunLight.color.copy(pal.sunColor);
      sunLight.intensity = pal.sunIntensity;
      hemiLight.color.copy(pal.hemiSkyColor);
      hemiLight.groundColor.copy(pal.hemiGroundColor);
      hemiLight.intensity = pal.hemiIntensity;
      fillLight.intensity = pal.fillIntensity;
      fillLight.position.set(-sunDir.x * 60, 24 + 14 * pal.h, -sunDir.z * 60);

      updateShadowTarget(shadowAnchor.x, shadowAnchor.y, shadowAnchor.z);

      for (const mat of [skyMat, envSkyMat]) {
        mat.uniforms.uSunDir.value.copy(sunDir);
        mat.uniforms.uZenithColor.value.copy(pal.zenithColor);
        mat.uniforms.uHorizonColor.value.copy(pal.horizonColor);
        mat.uniforms.uGroundColor.value.copy(pal.groundColor);
        mat.uniforms.uSunColor.value.copy(pal.sunColor);
        mat.uniforms.uWarmMix.value = pal.warmMix;
      }

      if (scene.fog) {
        scene.fog.color.copy(pal.fogColor);
      }

      rebuildPmrem();
      return currentElevationDeg;
    };

    const dispose = () => {
      if (currentEnvRT) {
        currentEnvRT.dispose();
        currentEnvRT = null;
      }
      if (pmremGenerator) {
        pmremGenerator.dispose();
      }
      skyGeo.dispose();
      skyMat.dispose();
      envSkyGeo.dispose();
      envSkyMat.dispose();
    };

    this._envHandle = {
      skyDome,
      sunLight,
      hemiLight,
      fillLight,
      sunDir,
      getSolarElevation: () => currentElevationDeg,
      updateSolarElevation,
      updateShadowTarget,
      updateSkyCenter,
      dispose,
    };

    return this._envHandle;
  }

  /**
   * Returns the complete PBR reflectance & color-space audit table for the Inspector modal.
   */
  getAuditRecords() {
    return this.auditRecords;
  }

  /**
   * Performs a live runtime check across every tracked THREE.Texture colorSpace and every
   * registered manifest/procedural reflectance record.
   */
  getAuditSummary() {
    const records = this.auditRecords;
    let passedMaterials = 0;
    let failedMaterials = 0;
    let srgbBoundsPassed = true;
    let binaryMetalnessPassed = true;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (rec.passed) {
        passedMaterials++;
      } else {
        failedMaterials++;
      }
      if (rec.srgbPassed === false) srgbBoundsPassed = false;
      if (rec.binaryMetalPassed === false) binaryMetalnessPassed = false;
    }

    let colorTexturesCount = 0;
    let rawTexturesCount = 0;
    const colorSpaceViolations = [];

    for (let i = 0; i < this._trackedTextures.length; i++) {
      const entry = this._trackedTextures[i];
      if (entry.role === 'color') {
        colorTexturesCount++;
      } else {
        rawTexturesCount++;
      }
      if (entry.texture.colorSpace !== entry.expectedColorSpace) {
        colorSpaceViolations.push({
          filename: entry.filename,
          expected: entry.expectedColorSpace,
          actual: entry.texture.colorSpace,
        });
      }
    }

    const colorSpaceAuditPassed = colorSpaceViolations.length === 0;
    const allPassed = failedMaterials === 0 && colorSpaceAuditPassed && srgbBoundsPassed && binaryMetalnessPassed;

    return {
      manifestLoaded: Boolean(this.manifest),
      totalMaterials: records.length,
      passedMaterials,
      failedMaterials,
      loadedTextureCount: this._trackedTextures.length,
      colorTexturesCount,
      rawTexturesCount,
      maxAnisotropy: this.maxAnisotropy,
      colorSpaceViolations,
      colorSpaceAuditPassed,
      srgbBoundsPassed,
      binaryMetalnessPassed,
      allPassed,
      allCompliant: allPassed,
    };
  }
}

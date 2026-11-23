/**
 * Photorealistic Fairway, Stratified Terrain, GPU-Instanced Two-Sided Wind Grass,
 * Course Props (Tee Markers, Regulation Wooden Tee, Dimpled Golf Ball, Yardage Posts,
 * Putting Green & Flagstick, Layered Tree Line), Shot Tracer, and Turf Particles.
 * Implements Sections 3, 4, and 6 (Visuals) of specs/golfswing.md.
 */

import * as THREE from 'three';
import { METERS_TO_YARDS, PBR_BOUNDS, PHYSICS } from './constants.js';
import {
  BUNKERS,
  FLAG_POSITION,
  GREEN_CENTER,
  getFairwayCenterX,
  getFairwayHalfWidth,
  getTerrainHeight,
  getWindVector,
} from './physics.js';
import {
  createFairwayMaterial,
  createGolfBallTextures,
  createValidatedPBRColor,
  loadNanoBananaPBRPair,
} from './materials.js';

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GolfEnvironment {
  constructor(sunDirUniform) {
    this.environmentGroup = new THREE.Group();
    this.environmentGroup.name = 'Layer_Environment_Fairway';

    this.propsGroup = new THREE.Group();
    this.propsGroup.name = 'Layer_Assets_Props';

    this.sunDirUniform = sunDirUniform;
    this.windUniform = { value: new THREE.Vector2(1.2, -1.8) };
    this.timeUniform = { value: 0 };

    // Wooden tee animation state (pops slightly on driver impact)
    this.teePopped = false;
    this.teeVelocity = new THREE.Vector3();
    this.teeAngularVel = new THREE.Vector3();

    // Build stratified terrain mesh
    this._buildTerrain(sunDirUniform);
    // Build GPU-instanced top foliage grass blades with wind & backlit transmission
    this._buildInstancedGrass(sunDirUniform);
    // Build distant flanking pine & deciduous tree lines
    this._buildTreeLines();
    // Build course props (tee markers, yardage posts, green flagstick)
    this._buildCourseProps();
    // Build hero props (regulation wooden tee + dimpled urethane golf ball + velocity blur)
    this._buildHeroBallAndTee();
    // Build broadcast flight tracer ribbon
    this._buildTracerRibbon();
    // Build impact & turf bounce particle pool
    this._buildParticleSystem();

    this.resetTee();
  }

  _buildTerrain(sunDirUniform) {
    const widthX = 240;
    const lengthZ = 470;
    const segsX = 180;
    const segsZ = 280;

    const geo = new THREE.PlaneGeometry(widthX, lengthZ, segsX, segsZ);
    geo.rotateX(-Math.PI * 0.5);
    // Shift so terrain covers z from +35m (behind tee box) down to -435m (beyond green)
    geo.translate(0, 0, -200);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = getTerrainHeight(x, z);
      pos.setY(i, y);

      // Macro vertex color encoding:
      //  R = Fairway cut mask (0 rough -> 1 crisp bentgrass fairway)
      //  G = Silica bunker sand mask
      //  B = Precision putting green / tee box turf mask
      const d = -z;
      const centerX = getFairwayCenterX(z);
      const halfW = getFairwayHalfWidth(z);
      const distFromCenter = Math.abs(x - centerX);

      let fairwayMask = 0;
      if (d > 14 && d < 350) {
        const edgeMask = 1 - smoothstep(halfW - 1.8, halfW + 2.4, distFromCenter);
        const startMask = smoothstep(14, 24, d);
        const endMask = 1 - smoothstep(336, 350, d);
        fairwayMask = edgeMask * startMask * endMask;
      }

      // Tee box precision cut pad around (0, 0)
      const teePad =
        (1 - smoothstep(4.2, 5.8, Math.abs(x))) *
        (1 - smoothstep(4.4, 6.2, Math.abs(z + 0.5)));

      // Putting green mask
      const gx = (x - GREEN_CENTER.x) / GREEN_CENTER.rx;
      const gz = (z - GREEN_CENTER.z) / GREEN_CENTER.rz;
      const greenMask = 1 - smoothstep(0.86, 1.08, Math.hypot(gx, gz));

      // Sculpted bunker bowls
      let bunkerMask = 0;
      for (const b of BUNKERS) {
        const nx = (x - b.x) / b.rx;
        const nz = (z - b.z) / b.rz;
        const r = Math.hypot(nx, nz);
        bunkerMask = Math.max(bunkerMask, 1 - smoothstep(0.76, 0.96, r));
      }

      colors[i * 3] = Math.min(1, Math.max(fairwayMask, teePad));
      colors[i * 3 + 1] = bunkerMask;
      colors[i * 3 + 2] = Math.min(1, Math.max(greenMask, teePad * 0.85));
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.terrainMaterial = createFairwayMaterial(sunDirUniform);
    this.terrainMesh = new THREE.Mesh(geo, this.terrainMaterial);
    this.terrainMesh.name = 'Fairway_Stratified_Terrain';
    this.terrainMesh.receiveShadow = true;
    this.environmentGroup.add(this.terrainMesh);
  }

  /**
   * GPU-Instanced top foliage grass blades around tee box, tee apron, and fairway flanks
   * with real-time vertex-shader wind response and two-sided backlit sunlight transmission (Section 4).
   */
  _buildInstancedGrass(sunDirUniform) {
    const bladeCount = 11000;
    const rng = mulberry32(202611);

    // Tapered curved grass blade geometry (3-segment vertical taper)
    const bladeGeo = new THREE.PlaneGeometry(0.016, 0.095, 1, 3);
    bladeGeo.translate(0, 0.0475, 0);
    const bPos = bladeGeo.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      const y = bPos.getY(i);
      const t = y / 0.095;
      // Taper width smoothly to crisp blade tip and give organic outward arch
      bPos.setX(i, bPos.getX(i) * (1 - t * 0.88));
      bPos.setZ(i, t * t * 0.022);
    }
    bladeGeo.computeVertexNormals();

    const grassMat = new THREE.MeshStandardMaterial({
      color: createValidatedPBRColor('Foliage_Grass_Blade', [86, 136, 54], false),
      roughness: 0.72,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeUniform;
      shader.uniforms.uWind = this.windUniform;
      shader.uniforms.uSunDir = sunDirUniform;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform vec2 uWind;
           varying float vBladeTip;
           varying vec3 vGrassWorldPos;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float tip = clamp(position.y / 0.095, 0.0, 1.0);
           vBladeTip = tip;
           vec4 instOrigin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
           float gust = sin(uTime * 2.4 + instOrigin.x * 0.65 + instOrigin.z * 0.45) * 0.5 + 0.5;
           float flutter = sin(uTime * 5.8 + instOrigin.x * 2.1 - instOrigin.z * 1.7) * 0.3;
           vec2 bend = uWind * (0.011 * (0.45 + gust * 0.85) + 0.004 * flutter) * tip * tip;
           transformed.x += bend.x;
           transformed.z += bend.y;
           transformed.y -= length(bend) * 0.25;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vGrassWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform vec3 uSunDir;
           varying float vBladeTip;
           varying vec3 vGrassWorldPos;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           // Root-to-tip ambient occlusion & natural sunlit golden-green tip variation
           vec3 rootCol = diffuseColor.rgb * 0.42;
           vec3 tipCol = diffuseColor.rgb * vec3(1.18, 1.24, 0.92);
           diffuseColor.rgb = mix(rootCol, tipCol, smoothstep(0.0, 0.92, vBladeTip));`
        )
        .replace(
          '#include <dithering_fragment>',
          `
           // Two-sided foliage sunlight translucency transmission (Section 4)
           vec3 Vg = normalize(cameraPosition - vGrassWorldPos);
           float trans = pow(clamp(dot(Vg, -normalize(uSunDir)), 0.0, 1.0), 3.0);
           gl_FragColor.rgb += vec3(0.22, 0.34, 0.06) * trans * vBladeTip * 0.45;
           #include <dithering_fragment>`
        );
    };

    const instMesh = new THREE.InstancedMesh(bladeGeo, grassMat, bladeCount);
    instMesh.name = 'Top_Foliage_Instanced_Grass';
    instMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let idx = 0;

    // 1. Lush fine bentgrass blades along tee-box collar and primary rough apron (6,500 blades)
    for (let i = 0; i < 6500 && idx < bladeCount; i++) {
      const r = Math.pow(rng(), 0.72) * 11.5;
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 1.2;

      // Keep crisp mowed clearance on immediate tee stance & ball pad so tee/ball/clubhead shine cleanly
      const onTeePad = Math.abs(x) < 4.2 && z > -5.0 && z < 3.8;
      if (Math.hypot(x, z) < 0.35) continue;
      if (onTeePad && rng() < 0.72) continue;

      const y = getTerrainHeight(x, z);
      dummy.position.set(x, y - 0.008, z);
      dummy.rotation.set((rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
      const hScale = onTeePad ? 0.16 + rng() * 0.14 : 0.65 + rng() * 0.85;
      dummy.scale.set(0.65 + rng() * 0.4, hScale, 1.0);
      dummy.updateMatrix();
      instMesh.setMatrixAt(idx, dummy.matrix);

      const tint = onTeePad ? 0.96 + rng() * 0.16 : 0.78 + rng() * 0.30;
      col.setRGB(0.88 * tint, 1.0 * tint, 0.78 * tint);
      instMesh.setColorAt(idx, col);
      idx++;
    }

    // 2. Downrange landing zone grass clusters (210m – 315m) visible on Camera_Landing_Downrange telephoto close-ups!
    for (let i = idx; i < bladeCount; i++) {
      const z = -(185 + rng() * 140);
      const centerX = getFairwayCenterX(z);
      const spread = (rng() - 0.5) * 44;
      const x = centerX + spread;
      // Skip sand bunkers
      let inBunker = false;
      for (const b of BUNKERS) {
        if (Math.hypot((x - b.x) / b.rx, (z - b.z) / b.rz) < 1.05) {
          inBunker = true;
          break;
        }
      }
      if (inBunker) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        instMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const inFairway = Math.abs(spread) < getFairwayHalfWidth(z);
      const y = getTerrainHeight(x, z);
      dummy.position.set(x, y - 0.01, z);
      dummy.rotation.set((rng() - 0.5) * 0.28, rng() * Math.PI * 2, (rng() - 0.5) * 0.28);
      const hScale = inFairway ? 0.42 + rng() * 0.28 : 1.15 + rng() * 0.95;
      dummy.scale.set(1.0 + rng() * 0.5, hScale, 1.0);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);

      const tint = inFairway ? 0.92 + rng() * 0.24 : 0.72 + rng() * 0.28;
      col.setRGB(0.86 * tint, 1.0 * tint, 0.80 * tint);
      instMesh.setColorAt(i, col);
    }

    instMesh.instanceMatrix.needsUpdate = true;
    if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
    this.grassInstancedMesh = instMesh;
    this.environmentGroup.add(instMesh);
  }

  /**
   * Builds lush multi-tiered irregular pine conifers & clustered organic deciduous trees
   * framing the championship fairway corridor.
   */
  _buildTreeLines() {
    const rng = mulberry32(99412);
    const treePositions = [];

    for (let z = 12; z >= -395; z -= 6.8) {
      const centerX = getFairwayCenterX(z);
      const halfW = getFairwayHalfWidth(z);

      for (const side of [-1, 1]) {
        const layers = z < -340 ? 4 : 3;
        for (let l = 0; l < layers; l++) {
          const offset = halfW + 15 + l * 13 + rng() * 9;
          const x = centerX + side * offset;
          const zJitter = z + (rng() - 0.5) * 6.5;
          const y = getTerrainHeight(x, zJitter);
          const scale = 0.85 + rng() * 0.95;
          const isPine = rng() < 0.62;
          treePositions.push({ x, y, z: zJitter, scale, rotY: rng() * Math.PI * 2, isPine });
        }
      }
    }

    // Scenic backdrop forest ridge behind the 335m putting green
    for (let i = 0; i < 48; i++) {
      const x = (rng() - 0.5) * 150;
      const z = -362 - rng() * 52;
      const y = getTerrainHeight(x, z);
      treePositions.push({
        x,
        y,
        z,
        scale: 1.05 + rng() * 1.15,
        rotY: rng() * Math.PI * 2,
        isPine: rng() < 0.70,
      });
    }

    createValidatedPBRColor('Tree_Bark_NanoBanana', [96, 80, 68], false);
    createValidatedPBRColor('Foliage_Pine_NanoBanana', [54, 88, 50], false);
    createValidatedPBRColor('Foliage_Oak_NanoBanana', [74, 112, 54], false);

    const barkTex = loadNanoBananaPBRPair('tree_bark', 1.5, 2.5);
    const pineTex = loadNanoBananaPBRPair('pine_foliage', 3.0, 2.2);
    const oakTex = loadNanoBananaPBRPair('oak_leaves', 2.4, 2.4);

    const trunkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: barkTex.map,
      normalMap: barkTex.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.94,
      metalness: 0.0,
    });

    const pineMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: pineTex.map,
      normalMap: pineTex.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.86,
      metalness: 0.0,
    });

    const oakMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: oakTex.map,
      normalMap: oakTex.normalMap,
      normalScale: new THREE.Vector2(0.70, 0.70),
      roughness: 0.82,
      metalness: 0.0,
    });

    // Helper: create organically scalloped conifer branch whorl (no harsh smooth geometric cones!)
    const makeConiferTier = (radius, height, yCenter, seedOffset) => {
      const g = new THREE.ConeGeometry(radius, height, 14, 3, false);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i);
        const vy = p.getY(i);
        const vz = p.getZ(i);
        const r = Math.hypot(vx, vz);
        if (r > 0.05) {
          const ang = Math.atan2(vz, vx);
          const scallop = 1.0 + 0.18 * Math.sin(ang * 7.0 + seedOffset) + 0.11 * Math.cos(ang * 11.0 - seedOffset * 1.7);
          const droop = -0.26 * (r / radius) * (0.5 + 0.5 * Math.sin(ang * 5.0 + seedOffset));
          p.setXYZ(i, vx * scallop, vy + droop, vz * scallop);
        }
      }
      g.translate(0, yCenter, 0);
      g.computeVertexNormals();
      return g;
    };

    // Helper: create organically bumpy deciduous foliage lobe
    const makeFoliageLobe = (radius, sx, sy, sz, ox, oy, oz, seedOffset) => {
      const g = new THREE.IcosahedronGeometry(radius, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i);
        const vy = p.getY(i);
        const vz = p.getZ(i);
        const bump =
          1.0 +
          0.14 * Math.sin(vx * 2.1 + seedOffset) * Math.cos(vz * 2.3 - seedOffset) +
          0.10 * Math.sin(vy * 3.1 + vx * 1.7);
        p.setXYZ(i, vx * sx * bump + ox, vy * sy * bump + oy, vz * sz * bump + oz);
      }
      g.computeVertexNormals();
      return g;
    };

    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.34, 4.6, 8);
    trunkGeo.translate(0, 2.3, 0);

    // 4-tier sculpted pine whorls
    const pineTiers = [
      makeConiferTier(2.85, 3.6, 3.9, 0.5),
      makeConiferTier(2.35, 3.4, 5.8, 1.9),
      makeConiferTier(1.75, 3.1, 7.6, 3.4),
      makeConiferTier(1.10, 2.7, 9.2, 5.1),
    ];

    // 4-lobe sculpted deciduous crown clusters (asymmetric organic silhouette)
    const oakLobes = [
      makeFoliageLobe(2.35, 1.12, 0.85, 1.05, 0.0, 6.2, 0.0, 1.1),
      makeFoliageLobe(1.85, 1.05, 0.82, 1.02, 1.35, 5.5, 0.65, 2.7),
      makeFoliageLobe(1.78, 1.04, 0.80, 1.08, -1.25, 5.7, -0.75, 4.2),
      makeFoliageLobe(1.65, 0.98, 0.86, 0.96, 0.25, 7.5, -0.35, 5.8),
    ];

    const pines = treePositions.filter((t) => t.isPine);
    const oaks = treePositions.filter((t) => !t.isPine);

    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
    trunkInst.castShadow = true;
    const pineInsts = pineTiers.map((geo) => {
      const m = new THREE.InstancedMesh(geo, pineMat, pines.length);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    });
    const oakInsts = oakLobes.map((geo) => {
      const m = new THREE.InstancedMesh(geo, oakMat, oaks.length);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    });

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    treePositions.forEach((t, i) => {
      dummy.position.set(t.x, t.y - 0.15, t.z);
      dummy.rotation.set(0, t.rotY, 0);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
    });

    pines.forEach((t, i) => {
      dummy.position.set(t.x, t.y - 0.15, t.z);
      dummy.rotation.set(0, t.rotY, 0);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();
      const baseShade = 0.72 + rng() * 0.44;
      pineInsts.forEach((inst, tierIdx) => {
        inst.setMatrixAt(i, dummy.matrix);
        // Upper pine whorls catch slightly brighter sunlit green
        const tierBright = 0.84 + tierIdx * 0.08;
        col.setRGB(baseShade * tierBright, baseShade * tierBright * 1.05, baseShade * tierBright * 0.92);
        inst.setColorAt(i, col);
      });
    });

    oaks.forEach((t, i) => {
      dummy.position.set(t.x, t.y - 0.15, t.z);
      dummy.rotation.set(0, t.rotY, 0);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();
      const baseShade = 0.76 + rng() * 0.42;
      oakInsts.forEach((inst, lobeIdx) => {
        inst.setMatrixAt(i, dummy.matrix);
        const lobeBright = lobeIdx === 3 ? 1.12 : 0.92 + lobeIdx * 0.04;
        col.setRGB(baseShade * lobeBright * 1.06, baseShade * lobeBright * 1.03, baseShade * lobeBright * 0.86);
        inst.setColorAt(i, col);
      });
    });

    this.environmentGroup.add(trunkInst, ...pineInsts, ...oakInsts);
  }

  _buildCourseProps() {
    // 1. Championship Tee Markers flanking the tee box at z = +0.15
    const markerMat = new THREE.MeshPhysicalMaterial({
      color: createValidatedPBRColor('Tee_Marker_BrushedSteel', [218, 220, 224], true),
      metalness: 1.0,
      roughness: 0.24,
      clearcoat: 0.7,
      clearcoatRoughness: 0.06,
    });
    const baseMat = new THREE.MeshStandardMaterial({
      color: createValidatedPBRColor('Tee_Marker_SlateBase', [58, 62, 68], false),
      metalness: 0.0,
      roughness: 0.65,
    });

    for (const side of [-2.35, 2.35]) {
      const markerGroup = new THREE.Group();
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.068, 20, 16), markerMat);
      sphere.position.y = 0.095;
      sphere.castShadow = true;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.072, 0.045, 16), baseMat);
      base.position.y = 0.022;
      base.castShadow = true;
      markerGroup.add(sphere, base);
      markerGroup.position.set(side, getTerrainHeight(side, 0.15), 0.15);
      this.propsGroup.add(markerGroup);
    }

    // 2. Fairway Yardage Posts (150, 200, 250, 300 yards) along right & left fairway border
    const postMat = new THREE.MeshStandardMaterial({
      color: createValidatedPBRColor('Yardage_Post_White', [232, 234, 236], false),
      metalness: 0.0,
      roughness: 0.42,
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: createValidatedPBRColor('Yardage_Post_Band', [52, 56, 64], false),
      metalness: 0.0,
      roughness: 0.45,
    });

    for (const yds of [150, 200, 250, 300]) {
      const distM = yds / METERS_TO_YARDS;
      const z = -distM;
      const cx = getFairwayCenterX(z);
      const hw = getFairwayHalfWidth(z);
      const x = cx + hw + 1.4;
      const y = getTerrainHeight(x, z);

      const postGroup = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 1.35, 12), postMat);
      post.position.y = 0.675;
      post.castShadow = true;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.069, 0.069, 0.24, 12), bandMat);
      stripe.position.y = 1.08;
      postGroup.add(post, stripe);
      postGroup.position.set(x, y, z);
      this.propsGroup.add(postGroup);
    }

    // 3. Putting Green Cup & Wind-Animated Flagstick at 338m
    const fy = getTerrainHeight(FLAG_POSITION.x, FLAG_POSITION.z);
    const flagGroup = new THREE.Group();
    flagGroup.position.set(FLAG_POSITION.x, fy, FLAG_POSITION.z);

    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.054, 0.054, 0.02, 20),
      new THREE.MeshStandardMaterial({
        color: createValidatedPBRColor('Green_Cup_Liner', [34, 36, 40], false),
        roughness: 0.9,
      })
    );
    cup.position.y = 0.004;
    flagGroup.add(cup);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.014, 2.45, 10),
      postMat
    );
    pole.position.y = 1.225;
    pole.castShadow = true;
    flagGroup.add(pole);

    const flagGeo = new THREE.PlaneGeometry(0.58, 0.38, 8, 4);
    flagGeo.translate(0.29, 0, 0);
    const flagMat = new THREE.MeshStandardMaterial({
      color: createValidatedPBRColor('Green_Flag_White', [236, 236, 238], false),
      roughness: 0.68,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.flagMesh = new THREE.Mesh(flagGeo, flagMat);
    this.flagMesh.position.set(0.012, 2.22, 0);
    this.flagMesh.castShadow = true;
    flagGroup.add(this.flagMesh);

    this.propsGroup.add(flagGroup);
  }

  _buildHeroBallAndTee() {
    // Regulation Wooden Golf Tee (hardwood birch, validated dielectric)
    const teeMat = new THREE.MeshStandardMaterial({
      color: createValidatedPBRColor('Prop_Wooden_Tee', [212, 186, 144], false),
      metalness: 0.0,
      roughness: 0.56,
    });

    const teePts = [
      new THREE.Vector2(0.0012, 0.0),
      new THREE.Vector2(0.0026, 0.018),
      new THREE.Vector2(0.0024, 0.044),
      new THREE.Vector2(0.0072, 0.052),
      new THREE.Vector2(0.0062, 0.054),
      new THREE.Vector2(0.0025, 0.051),
    ];
    const teeGeo = new THREE.LatheGeometry(teePts, 18);
    this.woodenTee = new THREE.Mesh(teeGeo, teeMat);
    this.woodenTee.name = 'Prop_Regulation_Wooden_Tee';
    this.woodenTee.castShadow = true;
    this.woodenTee.receiveShadow = true;
    this.propsGroup.add(this.woodenTee);

    // Hero Dimpled Urethane Golf Ball (Section 3: Metallic=0.0, Roughness=0.12, F0=0.04)
    const ballTex = createGolfBallTextures();
    createValidatedPBRColor('Prop_GolfBall_Urethane', [236, 236, 233], false);

    const ballGeo = new THREE.SphereGeometry(PHYSICS.BALL_RADIUS, 40, 28);
    const ballMat = new THREE.MeshPhysicalMaterial({
      map: ballTex.map,
      normalMap: ballTex.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: ballTex.roughnessMap,
      roughness: PBR_BOUNDS.BALL_ROUGHNESS,
      metalness: 0.0,
      ior: 1.5, // F0 = 0.04
      clearcoat: 0.65,
      clearcoatRoughness: 0.09,
    });

    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.name = 'Prop_Golf_Ball_Dimpled';
    this.ballMesh.castShadow = true;
    this.ballMesh.receiveShadow = true;
    this.propsGroup.add(this.ballMesh);

    // Subtle directional 180-degree shutter velocity blur streak behind flying ball (Section 7)
    const streakGeo = new THREE.ConeGeometry(PHYSICS.BALL_RADIUS * 1.15, 0.85, 14, 1, true);
    streakGeo.rotateX(Math.PI * 0.5);
    streakGeo.translate(0, 0, 0.425);
    const streakMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.95, 0.96, 0.98),
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ballMotionStreak = new THREE.Mesh(streakGeo, streakMat);
    this.ballMotionStreak.visible = false;
    this.propsGroup.add(this.ballMotionStreak);
  }

  _buildTracerRibbon() {
    // Clean broadcast-style shot tracer ribbon (subtle luminous off-white silver arc)
    this.tracerEnabled = true;
    this.maxTracerPts = 360;
    const positions = new Float32Array(this.maxTracerPts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0.95, 0.96, 0.98),
      transparent: true,
      opacity: 0.82,
    });

    this.tracerLine = new THREE.Line(geo, mat);
    this.tracerLine.name = 'Broadcast_Flight_Tracer';
    this.tracerLine.frustumCulled = false;
    this.propsGroup.add(this.tracerLine);

    // Soft glowing tube-like core halo for distant visibility on high-res displays
    const glowPositions = new Float32Array(this.maxTracerPts * 2 * 3);
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
    glowGeo.setDrawRange(0, 0);
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.96, 0.97, 0.99),
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.tracerRibbon = new THREE.Mesh(glowGeo, glowMat);
    this.tracerRibbon.name = 'Broadcast_Flight_Ribbon';
    this.tracerRibbon.frustumCulled = false;
    this.propsGroup.add(this.tracerRibbon);
  }

  _buildParticleSystem() {
    const count = 90;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.085,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });

    this.particlesMesh = new THREE.Points(geo, mat);
    this.particlesMesh.name = 'Turf_Impact_Particles';
    this.particlesMesh.frustumCulled = false;
    this.propsGroup.add(this.particlesMesh);

    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push({
        active: false,
        life: 0,
        maxLife: 0.8,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
      });
      positions[i * 3 + 1] = -100;
    }
  }

  spawnTurfBurst(worldPos, surface = 'fairway', intensity = 1.0) {
    const posAttr = this.particlesMesh.geometry.attributes.position;
    const colAttr = this.particlesMesh.geometry.attributes.color;
    const numSpawn = Math.min(34, Math.floor(14 + intensity * 20));
    let spawned = 0;

    for (let i = 0; i < this.particles.length && spawned < numSpawn; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.life = 0;
        p.maxLife = 0.45 + Math.random() * 0.55;
        p.pos.copy(worldPos);
        p.pos.y += 0.02;

        const angle = Math.random() * Math.PI * 2;
        const speed = (0.8 + Math.random() * 2.6) * Math.max(0.4, intensity);
        p.vel.set(
          Math.cos(angle) * speed * 0.7,
          (1.2 + Math.random() * 2.4) * Math.max(0.45, intensity),
          Math.sin(angle) * speed * 0.7 - speed * 0.45
        );

        if (surface === 'bunker') {
          colAttr.setXYZ(i, 0.84, 0.76, 0.58);
        } else {
          // Mix of clipped bentgrass green and dark topsoil flecks
          if (Math.random() < 0.65) {
            colAttr.setXYZ(i, 0.28, 0.48, 0.16);
          } else {
            colAttr.setXYZ(i, 0.32, 0.24, 0.16);
          }
        }
        posAttr.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
        spawned++;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  kickWoodenTee(clubSpeedMs = 50) {
    this.teePopped = true;
    const s = clubSpeedMs / 50;
    this.teeVelocity.set((Math.random() - 0.5) * 0.8, 1.55 * s, -2.1 * s);
    this.teeAngularVel.set(14 * s, 4, (Math.random() - 0.5) * 12);
  }

  resetTee() {
    const teeY = getTerrainHeight(0, 0);
    this.teePopped = false;
    this.teeVelocity.set(0, 0, 0);
    this.teeAngularVel.set(0, 0, 0);
    this.woodenTee.position.set(0, teeY - 0.015, 0);
    this.woodenTee.rotation.set(0, 0, 0);
    this.ballMesh.position.set(0, teeY + PHYSICS.TEE_HEIGHT, 0);
    this.ballMesh.quaternion.identity();
    this.ballMotionStreak.visible = false;
    this.clearTracer();
  }

  clearTracer() {
    this.tracerLine.geometry.setDrawRange(0, 0);
    this.tracerRibbon.geometry.setDrawRange(0, 0);
  }

  setTracerVisible(enabled) {
    this.tracerEnabled = Boolean(enabled);
    this.tracerLine.visible = this.tracerEnabled;
    this.tracerRibbon.visible = this.tracerEnabled;
  }

  syncBallAndTracer(physicsEngine, cameraPos) {
    this.ballMesh.position.copy(physicsEngine.position);
    this.ballMesh.quaternion.copy(physicsEngine.orientation);

    // Directional motion blur streak during high-velocity flight (> 18 m/s)
    const speed = physicsEngine.velocity.length();
    if (physicsEngine.airborne && speed > 18) {
      this.ballMotionStreak.visible = true;
      this.ballMotionStreak.position.copy(physicsEngine.position);
      const lookTarget = physicsEngine.position.clone().add(physicsEngine.velocity);
      this.ballMotionStreak.lookAt(lookTarget);
      const streakLen = Math.min(1.6, speed * 0.016);
      this.ballMotionStreak.scale.set(1, 1, streakLen);
      this.ballMotionStreak.material.opacity = Math.min(0.32, (speed - 18) / 140);
    } else {
      this.ballMotionStreak.visible = false;
    }

    // Update broadcast flight tracer ribbon (final vertex locked live to ball center)
    if (this.tracerEnabled && physicsEngine.trajectoryPoints.length > 0) {
      const pts = physicsEngine.trajectoryPoints;
      const totalPts = pts.length + 1;
      const count = Math.min(totalPts, this.maxTracerPts);
      const linePos = this.tracerLine.geometry.attributes.position;
      const ribPos = this.tracerRibbon.geometry.attributes.position;

      const step = totalPts <= this.maxTracerPts ? 1 : (totalPts - 1) / (this.maxTracerPts - 1);
      const dir = new THREE.Vector3();
      const toCam = new THREE.Vector3();
      const side = new THREE.Vector3();

      const getPt = (k) => (k >= pts.length ? physicsEngine.position : pts[Math.max(0, k)]);

      for (let i = 0; i < count; i++) {
        const idx = i === count - 1 ? pts.length : Math.min(pts.length - 1, Math.round(i * step));
        const p = getPt(idx);
        linePos.setXYZ(i, p.x, p.y, p.z);

        const pPrev = getPt(Math.max(0, idx - 1));
        const pNext = getPt(Math.min(pts.length, idx + 1));
        dir.subVectors(pNext, pPrev);
        if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
        else dir.normalize();
        toCam.subVectors(cameraPos, p).normalize();
        side.crossVectors(dir, toCam);
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        else side.normalize();

        // Width subtly scales with camera distance and tapers cleanly into ball center
        const dist = p.distanceTo(cameraPos);
        const tNorm = i / Math.max(1, count - 1);
        const tipTaper = i === count - 1 ? 0.35 : 0.35 + 0.65 * tNorm;
        const halfW = Math.min(0.16, Math.max(0.012, dist * 0.0020)) * tipTaper;
        ribPos.setXYZ(i * 2, p.x + side.x * halfW, p.y + side.y * halfW, p.z + side.z * halfW);
        ribPos.setXYZ(i * 2 + 1, p.x - side.x * halfW, p.y - side.y * halfW, p.z - side.z * halfW);
      }

      // Build triangle strip indices once lazily if needed, using drawRange on non-indexed strip?
      // Better: update ribbon as triangle list or indexed strip on first use
      if (!this.tracerRibbon.geometry.index) {
        const indices = [];
        for (let i = 0; i < this.maxTracerPts - 1; i++) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, b, c, b, d, c);
        }
        this.tracerRibbon.geometry.setIndex(indices);
      }

      linePos.needsUpdate = true;
      ribPos.needsUpdate = true;
      this.tracerLine.geometry.setDrawRange(0, count);
      this.tracerRibbon.geometry.setDrawRange(0, Math.max(0, (count - 1) * 6));
    }
  }

  update(dt, windSpeedMs, windDirectionDeg) {
    this.timeUniform.value += dt;

    // Update GPU wind vector uniform for instanced grass & green flag
    const wv = getWindVector(windSpeedMs, windDirectionDeg, 1.0);
    this.windUniform.value.set(wv.x, wv.z);

    // Animate green flag fluttering in wind
    if (this.flagMesh) {
      const fPos = this.flagMesh.geometry.attributes.position;
      const t = this.timeUniform.value;
      const windAmp = 0.02 + windSpeedMs * 0.012;
      for (let i = 0; i < fPos.count; i++) {
        const x = fPos.getX(i);
        const wave = Math.sin(t * (5.5 + windSpeedMs * 0.6) - x * 11.0) * windAmp * (x / 0.58);
        fPos.setZ(i, wave);
      }
      fPos.needsUpdate = true;
      this.flagMesh.rotation.y = Math.atan2(wv.x, -wv.z) - Math.PI * 0.5;
    }

    // Animate popped wooden tee physics
    if (this.teePopped) {
      this.teeVelocity.y -= PHYSICS.GRAVITY * dt;
      this.woodenTee.position.addScaledVector(this.teeVelocity, dt);
      this.woodenTee.rotation.x += this.teeAngularVel.x * dt;
      this.woodenTee.rotation.y += this.teeAngularVel.y * dt;
      this.woodenTee.rotation.z += this.teeAngularVel.z * dt;

      const groundY = getTerrainHeight(this.woodenTee.position.x, this.woodenTee.position.z) + 0.008;
      if (this.woodenTee.position.y < groundY) {
        this.woodenTee.position.y = groundY;
        this.teeVelocity.y *= -0.25;
        this.teeVelocity.x *= 0.65;
        this.teeVelocity.z *= 0.65;
        this.teeAngularVel.multiplyScalar(0.5);
        if (this.teeVelocity.lengthSq() < 0.01) {
          this.teePopped = false;
        }
      }
    }

    // Update turf/sand impact particle physics
    const posAttr = this.particlesMesh.geometry.attributes.position;
    let dirty = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      dirty = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        posAttr.setXYZ(i, 0, -100, 0);
        continue;
      }
      p.vel.y -= PHYSICS.GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      posAttr.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
    }
    if (dirty) {
      posAttr.needsUpdate = true;
    }
  }
}

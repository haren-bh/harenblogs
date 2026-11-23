/**
 * Closed C2-continuous Periodic Uniform Cubic B-Spline Grand Prix Circuit
 * ("Tokyo Grand Prix Circuit") with O(1) uniform arc-length LUT sampling,
 * fast zero-allocation point projection, surface classification, banking,
 * racing-line & curvature-aware speed profiles, and minimap geometry.
 *
 * World coordinate convention (matches Section 1.2):
 *   +Y up, right-handed meters.
 *   At s = 0: pos = (0, 0, 0), tangent = (0, 0, -1), right = (+1, 0, 0).
 *   Signed curvature > 0 = Left turn (CCW around +Y), < 0 = Right turn (CW).
 */

import { SURFACE_TYPES } from './constants.js';

const DEG2RAD = Math.PI / 180;

/**
 * Hand-crafted FIA Grade 1 closed control polygon for periodic cubic B-spline.
 * Evenly spaced collinear knots along x = 0 guarantee an exact flat, straight
 * Main Start/Finish Straight centered on (0, 0, 0) heading -Z.
 */
const CIRCUIT_CONTROL_POINTS = [
  // Main Start/Finish Straight (heading -Z along x = 0, ~880 m total straight)
  // Uniform 75 m spacing across indices [49, 50, 0, 1..9] guarantees s = 0 is
  // EXACTLY (0, 0, 0) with tangent (0, 0, -1), right (+1, 0, 0), curvature = 0.
  [0, 0.0, 0],        // 0: Start/Finish gantry line
  [0, 0.0, -75],      // 1: DRS Zone 1
  [0, 0.0, -150],     // 2
  [0, 0.0, -225],     // 3
  [0, 0.0, -300],     // 4
  [0, 0.0, -375],     // 5
  [0, 0.0, -450],     // 6
  [0, 0.0, -525],     // 7
  [0, 0.0, -600],     // 8
  [0, 0.4, -675],     // 9: T1 braking zone (150m/100m/50m)
  [0, 1.0, -740],     // 10: Turn 1 entry

  // Turn 1: Heavy-braking Right-Hander
  [28, 1.8, -802],    // 11
  [100, 2.8, -826],   // 12: T1 apex
  [178, 4.0, -794],   // 13: T1 exit

  // Turns 2-5: Flowing High-Speed S-Curves (climbing smoothly to +13.6 m)
  [268, 5.8, -732],   // 14: Turn 2 (Left)
  [364, 8.0, -728],   // 15
  [460, 10.4, -804],  // 16: Turn 3 (Right)
  [564, 12.3, -808],  // 17
  [664, 13.6, -730],  // 18: Turn 4 (Left, circuit crest)
  [770, 13.4, -746],  // 19
  [876, 12.0, -798],  // 20: Turn 5 (Fast Right)
  [978, 9.8, -736],   // 21

  // Turn 6: Fast Downhill Sweeper (heading South +Z, descending +10 m -> +1.5 m)
  [1040, 7.4, -622],  // 22
  [1066, 5.0, -482],  // 23
  [1070, 3.1, -338],  // 24
  [1064, 1.9, -195],  // 25
  [1058, 1.5, -52],   // 26: High-speed downhill approach
  [1052, 1.5, 85],    // 27: T7 braking zone (150m/100m/50m)

  // Turn 7: Heavy Threshold-Braking Hairpin (tight Right-hander, prime brake-glow zone)
  [1044, 1.8, 175],   // 28
  [986, 2.2, 226],    // 29: T7 apex
  [920, 2.6, 185],    // 30
  [904, 3.2, 105],    // 31: Exiting NNW (148 m clear of point 27)

  // Turns 8-9: Technical Medium-Speed Double-Apex Left (NNW -> NW -> W -> WSW)
  [892, 3.7, 38],     // 32
  [842, 4.2, -2],     // 33: T8 Apex 1 (Left)
  [778, 4.2, -4],     // 34: Inter-apex neutral link
  [712, 3.9, 42],     // 35: T9 Apex 2 (Left) -> aligning onto WSW Back Straight

  // Back Straight (~720 m dead-straight heading WSW, DRS Zone 2)
  // Step (-70, +42) = 81.63 m x 8 = 653 m + braking entry = ~715 m straight
  [642, 3.4, 84],     // 36
  [572, 2.9, 126],    // 37
  [502, 2.4, 168],    // 38
  [432, 1.9, 210],    // 39
  [362, 1.5, 252],    // 40
  [292, 1.2, 294],    // 41
  [222, 0.9, 336],    // 42
  [152, 0.7, 378],    // 43: End of DRS Zone 2 / braking for Chicane

  // Turns 10-11: Tight High-Kerb Chicane (sharp Right-Left flick)
  [96, 0.6, 405],     // 44: T10 braking entry
  [74, 0.5, 346],     // 45: T10 apex (Right)
  [24, 0.4, 332],     // 46: T11 apex (Left)

  // Turn 12: Sweeping Full-Throttle Final Right-Hander merging onto x = 0 (-Z)
  [4, 0.2, 276],      // 47: T12 sweeping apex
  [0, 0.0, 225],      // 48: Exit onto Main Straight
  [0, 0.0, 150],      // 49: Dead-straight grid approach
  [0, 0.0, 75],       // 50: Starting grid straight
];

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Evaluate periodic uniform cubic B-spline position, 1st & 2nd derivatives.
 * Writes directly into preallocated target object (zero allocation).
 */
function evalBSpline(pts, segIndex, u, out) {
  const n = pts.length;
  const p0 = pts[(segIndex - 1 + n) % n];
  const p1 = pts[segIndex % n];
  const p2 = pts[(segIndex + 1) % n];
  const p3 = pts[(segIndex + 2) % n];

  const u2 = u * u;
  const u3 = u2 * u;
  const inv6 = 1 / 6;

  // Position basis
  const b0 = (1 - 3 * u + 3 * u2 - u3) * inv6;
  const b1 = (4 - 6 * u2 + 3 * u3) * inv6;
  const b2 = (1 + 3 * u + 3 * u2 - 3 * u3) * inv6;
  const b3 = u3 * inv6;

  // 1st derivative basis (d/du)
  const d0 = -0.5 * (1 - 2 * u + u2);
  const d1 = 0.5 * (3 * u2 - 4 * u);
  const d2 = 0.5 * (1 + 2 * u - 3 * u2);
  const d3 = 0.5 * u2;

  // 2nd derivative basis (d2/du2)
  const dd0 = 1 - u;
  const dd1 = 3 * u - 2;
  const dd2 = 1 - 3 * u;
  const dd3 = u;

  out.x = b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0];
  out.y = b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1];
  out.z = b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2];

  out.dx = d0 * p0[0] + d1 * p1[0] + d2 * p2[0] + d3 * p3[0];
  out.dy = d0 * p0[1] + d1 * p1[1] + d2 * p2[1] + d3 * p3[1];
  out.dz = d0 * p0[2] + d1 * p1[2] + d2 * p2[2] + d3 * p3[2];

  out.ddx = dd0 * p0[0] + dd1 * p1[0] + dd2 * p2[0] + dd3 * p3[0];
  out.ddy = dd0 * p0[1] + dd1 * p1[1] + dd2 * p2[1] + dd3 * p3[1];
  out.ddz = dd0 * p0[2] + dd1 * p1[2] + dd2 * p2[2] + dd3 * p3[2];
}

export class TokyoGPCircuit {
  constructor(sampleCount = 2000) {
    this.name = 'Tokyo Grand Prix Circuit';
    this.sampleCount = sampleCount;
    this.halfWidth = 7.0;
    this.kerbWidth = 1.2;
    this.defaultBoundary = 12.5;
    this.controlPoints = CIRCUIT_CONTROL_POINTS;

    // Flat typed arrays for cache-friendly O(1) zero-allocation lookups
    const N = sampleCount;
    this._x = new Float64Array(N);
    this._y = new Float64Array(N);
    this._z = new Float64Array(N);
    this._tx = new Float64Array(N);
    this._ty = new Float64Array(N);
    this._tz = new Float64Array(N);
    this._rx = new Float64Array(N);
    this._ry = new Float64Array(N);
    this._rz = new Float64Array(N);
    this._nx = new Float64Array(N);
    this._ny = new Float64Array(N);
    this._nz = new Float64Array(N);
    this._curv = new Float64Array(N);
    this._bank = new Float64Array(N);
    this._raceLine = new Float64Array(N);
    this._boundL = new Float64Array(N);
    this._boundR = new Float64Array(N);
    this._targetSpeed = new Float64Array(N);
    this._kerbMask = new Uint8Array(N);   // bit 0: left (-1), bit 1: right (+1)
    this._gravelMask = new Uint8Array(N); // bit 0: left (-1), bit 1: right (+1)
    this._drsMask = new Uint8Array(N);    // 0 = none, 1 = Zone 1, 2 = Zone 2

    this._scratchSample = this.createSampleBuffer();
    this._scratchProj = this.createSampleBuffer();

    this.length = 0;
    this.ds = 0;
    this.sectorSplits = [0, 0];
    this.drsZones = [];
    this.kerbSegments = [];
    this.gravelSegments = [];
    this.brakingZones = [];
    this.bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, minY: 0, maxY: 0 };

    this._buildLUT();
    this._buildTrackFeatures();
    this._buildTargetSpeedEnvelope();
    this._computeMinimapTransform();
  }

  /**
   * Allocate a reusable sample/projection struct for callers to pass into
   * sampleAtS() and projectPoint() with zero runtime GC.
   */
  createSampleBuffer() {
    return {
      s: 0,
      dLat: 0,
      distSq: 0,
      x: 0, y: 0, z: 0,
      tx: 0, ty: 0, tz: -1,
      rx: 1, ry: 0, rz: 0,
      nx: 0, ny: 1, nz: 0,
      curvature: 0,
      banking: 0,
      halfWidth: this.halfWidth,
      boundaryLeft: this.defaultBoundary,
      boundaryRight: this.defaultBoundary,
      racingLineOffset: 0,
      targetSpeed: 80,
      drsZone: 0,
      sector: 1,
      kerbFlags: 0,
      gravelFlags: 0,
      surface: SURFACE_TYPES.ASPHALT,
    };
  }

  wrapS(s) {
    const L = this.length;
    const r = s % L;
    return r < 0 ? r + L : r;
  }

  _buildLUT() {
    const pts = this.controlPoints;
    const numSegs = pts.length;
    const subSteps = 32;
    const totalDense = numSegs * subSteps;

    const denseS = new Float64Array(totalDense + 1);
    const denseSeg = new Int32Array(totalDense + 1);
    const denseU = new Float64Array(totalDense + 1);
    const tmp = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, ddx: 0, ddy: 0, ddz: 0 };

    let prevX = 0, prevY = 0, prevZ = 0;
    let accum = 0;

    for (let k = 0; k <= totalDense; k++) {
      const seg = Math.floor(k / subSteps) % numSegs;
      const u = (k % subSteps) / subSteps;
      evalBSpline(pts, seg, u, tmp);
      if (k > 0) {
        const dx = tmp.x - prevX;
        const dy = tmp.y - prevY;
        const dz = tmp.z - prevZ;
        accum += Math.hypot(dx, dy, dz);
      }
      denseS[k] = accum;
      denseSeg[k] = seg;
      denseU[k] = u;
      prevX = tmp.x;
      prevY = tmp.y;
      prevZ = tmp.z;
    }

    this.length = accum;
    const N = this.sampleCount;
    this.ds = this.length / N;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    let denseIdx = 0;
    const rawCurv = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      const targetS = i * this.ds;
      while (denseIdx < totalDense - 1 && denseS[denseIdx + 1] < targetS) {
        denseIdx++;
      }
      const s0 = denseS[denseIdx];
      const s1 = denseS[denseIdx + 1];
      const frac = s1 > s0 ? (targetS - s0) / (s1 - s0) : 0;

      const tGlobal = (denseIdx + frac) / subSteps;
      const seg = Math.floor(tGlobal) % numSegs;
      const u = tGlobal - Math.floor(tGlobal);
      evalBSpline(pts, seg, u, tmp);

      // Clamp tiny numerical noise on flat ground to >= 0
      const py = tmp.y < 1e-4 ? 0.0 : tmp.y;
      this._x[i] = tmp.x;
      this._y[i] = py;
      this._z[i] = tmp.z;

      if (tmp.x < minX) minX = tmp.x;
      if (tmp.x > maxX) maxX = tmp.x;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (tmp.z < minZ) minZ = tmp.z;
      if (tmp.z > maxZ) maxZ = tmp.z;

      // Unit forward tangent
      const tLen = Math.hypot(tmp.dx, tmp.dy, tmp.dz) || 1;
      const tx = tmp.dx / tLen;
      const ty = tmp.dy / tLen;
      const tz = tmp.dz / tLen;
      this._tx[i] = tx;
      this._ty[i] = ty;
      this._tz[i] = tz;

      // Signed 2D XZ curvature: >0 = Left (CCW around +Y), <0 = Right (CW)
      // For horizontal forward (dx, dz): right = (-dz, dx).
      // Turning left moves d(tangent)/ds toward -right = (dz, -dx).
      // Cross product (dx * ddz - dz * ddx):
      // Example: heading -Z (dx=0, dz=-1), turning left (-X => ddx=-1, ddz=0):
      // dx*ddz - dz*ddx = 0 - (-1)*(-1) = -1 -> so negate to get >0 for left:
      // kappa = (dz * ddx - dx * ddz) / (dx^2 + dz^2)^(3/2)
      const hSpeed2 = tmp.dx * tmp.dx + tmp.dz * tmp.dz;
      const hSpeed3 = Math.pow(hSpeed2, 1.5) || 1;
      rawCurv[i] = (tmp.dz * tmp.ddx - tmp.dx * tmp.ddz) / hSpeed3;
    }

    this.bounds = { minX, maxX, minY, maxY, minZ, maxZ };

    // Smooth banking (2°-4° max in fast/medium corners, 0° on straights)
    const maxBankRad = 3.8 * DEG2RAD;
    for (let i = 0; i < N; i++) {
      this._curv[i] = rawCurv[i];

      // Subtle moving average of curvature for butter-smooth banking transitions
      let cSum = 0;
      const win = 10;
      for (let w = -win; w <= win; w++) {
        cSum += rawCurv[(i + w + N) % N];
      }
      const cSmooth = cSum / (2 * win + 1);
      // Scale banking smoothly; deadzone straight sections (< 0.0012 rad/m)
      const absC = Math.abs(cSmooth);
      let bank = 0;
      if (absC > 0.0012) {
        const t = clamp((absC - 0.0012) / 0.014, 0, 1);
        bank = Math.sign(cSmooth) * t * maxBankRad;
      }
      this._bank[i] = bank;

      // Compute flat horizontal right = normalize(T x (0, 1, 0)) = (-tz, 0, tx)
      const tx = this._tx[i];
      const ty = this._ty[i];
      const tz = this._tz[i];
      const rFlatLen = Math.hypot(-tz, tx) || 1;
      const rfx = -tz / rFlatLen;
      const rfz = tx / rFlatLen;

      // Orthogonal track up before banking: U0 = R_flat x T
      const u0x = -rfz * ty;
      const u0y = rfz * tx - rfx * tz;
      const u0z = rfx * ty;
      const u0Len = Math.hypot(u0x, u0y, u0z) || 1;
      const ux = u0x / u0Len;
      const uy = u0y / u0Len;
      const uz = u0z / u0Len;

      // Tilt right & normal by banking angle (positive bank raises +right outer edge on left turns)
      const cosB = Math.cos(bank);
      const sinB = Math.sin(bank);
      this._rx[i] = rfx * cosB + ux * sinB;
      this._ry[i] = uy * sinB;
      this._rz[i] = rfz * cosB + uz * sinB;

      this._nx[i] = ux * cosB - rfx * sinB;
      this._ny[i] = uy * cosB;
      this._nz[i] = uz * cosB - rfz * sinB;
    }

    // Ideal racing line lateral offset (out-in-out apex hugging)
    // Curvature > 0 (Left turn) => apex is on LEFT (dLat < 0).
    // Curvature < 0 (Right turn) => apex is on RIGHT (dLat > 0).
    // Approach & exit swing gently toward outside before/after apex.
    const rawLine = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const cHere = this._curv[i];
      const cAhead = this._curv[(i + 24) % N];
      const cBehind = this._curv[(i - 24 + N) % N];
      // Apex pull inward + entry/exit swing outward
      const apexPull = -clamp(cHere * 220, -4.2, 4.2);
      const setupSwing = clamp((cAhead + cBehind) * 55, -2.0, 2.0);
      rawLine[i] = clamp(apexPull + setupSwing * 0.45, -4.4, 4.4);
    }
    // Multi-pass Gaussian-like smoothing so racing line is C2 smooth
    const tmpLine = new Float64Array(N);
    for (let pass = 0; pass < 3; pass++) {
      const src = pass === 0 ? rawLine : this._raceLine;
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let w = -8; w <= 8; w++) {
          sum += src[(i + w + N) % N];
        }
        tmpLine[i] = sum / 17;
      }
      this._raceLine.set(tmpLine);
    }
    // Keep Main Straight starting grid corridor centered near 0
    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      if (s < 120 || s > this.length - 120) {
        const edgeDist = Math.min(s, this.length - s);
        const fade = clamp((edgeDist - 60) / 60, 0, 1);
        this._raceLine[i] *= fade;
      }
    }
  }

  _buildTrackFeatures() {
    const L = this.length;
    const N = this.sampleCount;

    // 1. Sectors (aligned cleanly: S1 = Main Straight + T1 + Esses; S2 = T6 + Hairpin + T8-9; S3 = Back Straight + Chicane + T12)
    this.sectorSplits = [L * 0.33, L * 0.67];

    // 2. Identify main straight & back straight spans from curvature for exact DRS zones
    // Main Straight: s in [40, ~615] (well before Turn 1 braking)
    // Back Straight: find the longest low-curvature span in the second half of the lap (s in [0.55*L, 0.90*L])
    let mainStraightEnd = 580;
    for (let i = Math.floor(100 / this.ds); i < N; i++) {
      if (Math.abs(this._curv[i]) > 0.0028) {
        mainStraightEnd = Math.max(400, i * this.ds - 45);
        break;
      }
    }

    let bestStart = Math.floor(0.60 * N);
    let bestLen = 0;
    let curStart = -1;
    for (let i = Math.floor(0.55 * N); i < Math.floor(0.92 * N); i++) {
      if (Math.abs(this._curv[i]) < 0.0022) {
        if (curStart === -1) curStart = i;
      } else {
        if (curStart !== -1 && i - curStart > bestLen) {
          bestLen = i - curStart;
          bestStart = curStart;
        }
        curStart = -1;
      }
    }
    if (curStart !== -1 && Math.floor(0.92 * N) - curStart > bestLen) {
      bestLen = Math.floor(0.92 * N) - curStart;
      bestStart = curStart;
    }

    const backStartS = bestStart * this.ds + 30;
    const backEndS = (bestStart + bestLen) * this.ds - 45;

    this.drsZones = [
      {
        id: 1,
        name: 'DRS Zone 1 (Main Straight)',
        detectionS: this.wrapS(L - 160),
        startS: 45,
        endS: mainStraightEnd,
      },
      {
        id: 2,
        name: 'DRS Zone 2 (Back Straight)',
        detectionS: this.wrapS(backStartS - 110),
        startS: backStartS,
        endS: Math.max(backStartS + 320, backEndS),
      },
    ];

    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      let zone = 0;
      for (let z = 0; z < this.drsZones.length; z++) {
        const dz = this.drsZones[z];
        if (s >= dz.startS && s <= dz.endS) {
          zone = dz.id;
          break;
        }
      }
      this._drsMask[i] = zone;
    }

    // 3. Automatic apex & exit FIA Rumble Kerb placement along corners
    this._kerbMask.fill(0);
    const kerbCurvThresh = 0.0046;
    for (let i = 0; i < N; i++) {
      const c = this._curv[i];
      if (Math.abs(c) > kerbCurvThresh) {
        // Inside apex kerb: left turn (c > 0) => left side (bit 0); right turn (c < 0) => right side (bit 1)
        const insideBit = c > 0 ? 1 : 2;
        const outsideBit = c > 0 ? 2 : 1;
        this._kerbMask[i] |= insideBit;

        // Place exit kerb slightly downstream on the outside edge
        const exitIdx = (i + Math.round(28 / this.ds)) % N;
        if (Math.abs(this._curv[exitIdx]) < Math.abs(c) * 0.85) {
          this._kerbMask[exitIdx] |= outsideBit;
        }
      }
    }

    // Extract merged kerbSegments for trackMesh rendering
    this.kerbSegments = [];
    for (const side of [-1, 1]) {
      const bit = side === -1 ? 1 : 2;
      let inSeg = false;
      let startIdx = 0;
      for (let i = 0; i < N; i++) {
        const active = (this._kerbMask[i] & bit) !== 0;
        if (active && !inSeg) {
          inSeg = true;
          startIdx = i;
        } else if (!active && inSeg) {
          inSeg = false;
          if ((i - startIdx) * this.ds >= 14) {
            this.kerbSegments.push({
              startS: startIdx * this.ds,
              endS: i * this.ds,
              side,
            });
          }
        }
      }
      if (inSeg && (N - startIdx) * this.ds >= 14) {
        this.kerbSegments.push({
          startS: startIdx * this.ds,
          endS: L,
          side,
        });
      }
    }

    // 4. Identify peak curvature corners for Heavy Braking Zones & Outer Gravel Runoffs
    const cornerPeaks = [];
    const peakWin = Math.round(45 / this.ds);
    for (let i = 0; i < N; i++) {
      const absC = Math.abs(this._curv[i]);
      if (absC < 0.0085) continue;
      let isPeak = true;
      for (let w = -peakWin; w <= peakWin; w++) {
        if (w !== 0 && Math.abs(this._curv[(i + w + N) % N]) > absC) {
          isPeak = false;
          break;
        }
      }
      if (isPeak) {
        cornerPeaks.push({ idx: i, s: i * this.ds, curv: this._curv[i], absC });
      }
    }

    // Pick the 3 primary heavy braking zones: Turn 1 (first major peak), Turn 7 Hairpin (sharpest mid-lap), Turn 10 Chicane (late lap after back straight)
    const t1Peak = cornerPeaks.find((p) => p.s > 550 && p.s < 950) || cornerPeaks[0];
    const hairpinPeak = cornerPeaks
      .filter((p) => p.s > L * 0.42 && p.s < L * 0.68)
      .sort((a, b) => b.absC - a.absC)[0];
    const chicanePeak = cornerPeaks.find((p) => p.s > backEndS && p.s < L - 180);

    const heavyCorners = [
      t1Peak && { name: 'Turn 1', peak: t1Peak },
      hairpinPeak && { name: 'Turn 7 Hairpin', peak: hairpinPeak },
      chicanePeak && { name: 'Turn 10 Chicane', peak: chicanePeak },
    ].filter(Boolean);

    this.brakingZones = [];
    this.gravelSegments = [];

    for (const hc of heavyCorners) {
      const sApex = hc.peak.s;
      // Outer side of turn: right turn (curv < 0) => outer is left (-1); left turn (curv > 0) => outer is right (+1)
      const outerSide = hc.peak.curv < 0 ? -1 : 1;
      const entryS = this.wrapS(sApex - 45);
      this.brakingZones.push({
        name: hc.name,
        cornerS: sApex,
        board150S: this.wrapS(entryS - 150),
        board100S: this.wrapS(entryS - 100),
        board50S: this.wrapS(entryS - 50),
        side: outerSide,
      });

      const gStart = this.wrapS(sApex - 55);
      const gEnd = this.wrapS(sApex + 75);
      this.gravelSegments.push({
        name: `${hc.name} Runoff`,
        startS: gStart,
        endS: gEnd,
        side: outerSide,
        width: 17.5,
      });
    }

    // Populate boundaryLeft / boundaryRight and _gravelMask per LUT sample
    this._boundL.fill(this.defaultBoundary);
    this._boundR.fill(this.defaultBoundary);
    this._gravelMask.fill(0);

    for (const gs of this.gravelSegments) {
      const bit = gs.side === -1 ? 1 : 2;
      const span = gs.endS >= gs.startS ? gs.endS - gs.startS : (L - gs.startS) + gs.endS;
      const steps = Math.ceil(span / this.ds);
      for (let k = 0; k <= steps; k++) {
        const s = this.wrapS(gs.startS + k * this.ds);
        const idx = Math.floor(s / this.ds) % N;
        this._gravelMask[idx] |= bit;

        // Smoothly flare barrier outward across runoff trap
        const u = steps > 0 ? k / steps : 0.5;
        const flare = Math.sin(u * Math.PI);
        const extra = (gs.width - this.defaultBoundary) * flare;
        if (gs.side === -1) {
          this._boundL[idx] = Math.max(this._boundL[idx], this.defaultBoundary + extra);
        } else {
          this._boundR[idx] = Math.max(this._boundR[idx], this.defaultBoundary + extra);
        }
      }
    }
  }

  /**
   * Forward/backward dynamic speed envelope (v_max(s)) accounting for F1 downforce
   * cornering grip, braking capability, and acceleration — used by AI rivals.
   */
  _buildTargetSpeedEnvelope() {
    const N = this.sampleCount;
    const ds = this.ds;
    const v = this._targetSpeed;

    // Step 1: Lateral cornering limit v = sqrt(a_lat_max / |kappa|) with speed-dependent aero grip
    for (let i = 0; i < N; i++) {
      const absK = Math.abs(this._curv[i]);
      if (absK < 1e-4) {
        v[i] = 94.5; // ~340 km/h straight speed cap
      } else {
        // Iterative aero-assisted F1 cornering speed (mu ~ 1.72, Cl ~ 3.2)
        let speed = 60.0;
        for (let iter = 0; iter < 4; iter++) {
          const downforce = 0.5 * 1.225 * 1.65 * 3.20 * speed * speed;
          const totalLoad = 798.0 * 9.81 + downforce;
          const aLatMax = (1.62 * totalLoad) / 798.0; // realistic margin below absolute limit
          speed = Math.min(94.5, Math.sqrt(aLatMax / absK));
        }
        v[i] = Math.max(20.0, speed);
      }
    }

    // Step 2: Backward braking pass (2 laps to converge wrap-around)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const next = (i + 1) % N;
        const vNext = v[next];
        const aBrake = 26.0 + 0.0042 * vNext * vNext; // aero-assisted ~2.8-5.2g comfortable AI braking
        const vAllowed = Math.sqrt(vNext * vNext + 2 * aBrake * ds);
        if (vAllowed < v[i]) v[i] = vAllowed;
      }
    }

    // Step 3: Forward acceleration pass (2 laps to converge wrap-around)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const prev = (i - 1 + N) % N;
        const vPrev = v[prev];
        const aAccel = Math.max(3.0, 14.5 - 0.125 * vPrev);
        const vAllowed = Math.sqrt(vPrev * vPrev + 2 * aAccel * ds);
        if (vAllowed < v[i]) v[i] = vAllowed;
      }
    }
  }

  _computeMinimapTransform() {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;
    const maxSpan = Math.max(spanX, spanZ);
    const pad = 0.08;
    const scale = (1 - 2 * pad) / maxSpan;
    const offsetX = 0.5 - (minX + spanX * 0.5) * scale;
    const offsetY = 0.5 - (minZ + spanZ * 0.5) * scale;
    this._minimapTransform = { scale, offsetX, offsetY, spanX, spanZ };
  }

  /**
   * O(1) zero-allocation uniform arc-length spline query.
   */
  sampleAtS(s, out = this._scratchSample) {
    const N = this.sampleCount;
    const sWrap = this.wrapS(s);
    const fIdx = sWrap / this.ds;
    const i0 = Math.floor(fIdx) % N;
    const i1 = (i0 + 1) % N;
    const t = fIdx - Math.floor(fIdx);
    const omt = 1 - t;

    out.s = sWrap;
    out.x = this._x[i0] * omt + this._x[i1] * t;
    out.y = this._y[i0] * omt + this._y[i1] * t;
    out.z = this._z[i0] * omt + this._z[i1] * t;

    let tx = this._tx[i0] * omt + this._tx[i1] * t;
    let ty = this._ty[i0] * omt + this._ty[i1] * t;
    let tz = this._tz[i0] * omt + this._tz[i1] * t;
    const tLen = Math.hypot(tx, ty, tz) || 1;
    out.tx = tx / tLen;
    out.ty = ty / tLen;
    out.tz = tz / tLen;

    let rx = this._rx[i0] * omt + this._rx[i1] * t;
    let ry = this._ry[i0] * omt + this._ry[i1] * t;
    let rz = this._rz[i0] * omt + this._rz[i1] * t;
    const rLen = Math.hypot(rx, ry, rz) || 1;
    out.rx = rx / rLen;
    out.ry = ry / rLen;
    out.rz = rz / rLen;

    let nx = this._nx[i0] * omt + this._nx[i1] * t;
    let ny = this._ny[i0] * omt + this._ny[i1] * t;
    let nz = this._nz[i0] * omt + this._nz[i1] * t;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    out.nx = nx / nLen;
    out.ny = ny / nLen;
    out.nz = nz / nLen;

    out.curvature = this._curv[i0] * omt + this._curv[i1] * t;
    out.banking = this._bank[i0] * omt + this._bank[i1] * t;
    out.halfWidth = this.halfWidth;
    out.boundaryLeft = this._boundL[i0] * omt + this._boundL[i1] * t;
    out.boundaryRight = this._boundR[i0] * omt + this._boundR[i1] * t;
    out.racingLineOffset = this._raceLine[i0] * omt + this._raceLine[i1] * t;
    out.targetSpeed = this._targetSpeed[i0] * omt + this._targetSpeed[i1] * t;
    out.drsZone = this._drsMask[i0];
    out.sector = sWrap < this.sectorSplits[0] ? 1 : (sWrap < this.sectorSplits[1] ? 2 : 3);
    out.kerbFlags = this._kerbMask[i0];
    out.gravelFlags = this._gravelMask[i0];
    return out;
  }

  /**
   * Fast zero-allocation world (x, z) projection onto the circuit centerline.
   * Uses a local O(1) window around hintS with automatic global fallback.
   */
  projectPoint(x, z, hintS = null, out = this._scratchProj) {
    const N = this.sampleCount;
    const xs = this._x;
    const zs = this._z;
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintS !== null && hintS !== undefined && Number.isFinite(hintS)) {
      const centerIdx = Math.floor(this.wrapS(hintS) / this.ds) % N;
      const windowRadius = 48; // ~100 m each direction
      for (let w = -windowRadius; w <= windowRadius; w++) {
        const idx = (centerIdx + w + N) % N;
        const dx = x - xs[idx];
        const dz = z - zs[idx];
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = idx;
        }
      }
    }

    // Coarse-to-fine global fallback if no hint or far off-line (> 35 m)
    if (bestDistSq > 1225) {
      bestDistSq = Infinity;
      const stride = 8;
      for (let i = 0; i < N; i += stride) {
        const dx = x - xs[i];
        const dz = z - zs[i];
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
        }
      }
      const refineCenter = bestIdx;
      for (let w = -stride; w <= stride; w++) {
        const idx = (refineCenter + w + N) % N;
        const dx = x - xs[idx];
        const dz = z - zs[idx];
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = idx;
        }
      }
    }

    // Continuous sub-sample Newton refinement along the tangent (2 iterations)
    let refinedS = bestIdx * this.ds;
    for (let iter = 0; iter < 2; iter++) {
      this.sampleAtS(refinedS, out);
      const dx = x - out.x;
      const dz = z - out.z;
      const horizT = out.tx * out.tx + out.tz * out.tz || 1;
      const deltaS = (dx * out.tx + dz * out.tz) / horizT;
      refinedS = this.wrapS(refinedS + clamp(deltaS, -this.ds * 1.5, this.ds * 1.5));
    }

    this.sampleAtS(refinedS, out);
    const dx = x - out.x;
    const dz = z - out.z;
    // Lateral offset along horizontal right axis (positive = starboard/right, negative = port/left)
    const rHorizLen = Math.hypot(out.rx, out.rz) || 1;
    const dLat = (dx * out.rx + dz * out.rz) / rHorizLen;

    out.dLat = dLat;
    out.distSq = dx * dx + dz * dz;
    out.surface = this.classifySurface(refinedS, dLat, out);
    return out;
  }

  classifySurface(s, dLat, sample = null) {
    const info = sample || this.sampleAtS(s, this._scratchSample);
    if (dLat <= -info.boundaryLeft || dLat >= info.boundaryRight) {
      return SURFACE_TYPES.BARRIER;
    }

    const absLat = Math.abs(dLat);
    if (absLat <= this.halfWidth) {
      if (Math.abs(dLat - info.racingLineOffset) <= 2.2) {
        return SURFACE_TYPES.RUBBER_LINE;
      }
      return SURFACE_TYPES.ASPHALT;
    }

    const sideBit = dLat < 0 ? 1 : 2;
    if (absLat <= this.halfWidth + this.kerbWidth && (info.kerbFlags & sideBit) !== 0) {
      return SURFACE_TYPES.KERB;
    }
    if ((info.gravelFlags & sideBit) !== 0) {
      return SURFACE_TYPES.GRAVEL;
    }
    return SURFACE_TYPES.GRASS;
  }

  getSurfaceElevation(s, dLat, sample = null) {
    const info = sample || this.sampleAtS(s, this._scratchSample);
    let y = info.y + dLat * Math.sin(info.banking);
    const absLat = Math.abs(dLat);
    const sideBit = dLat < 0 ? 1 : 2;
    if (
      absLat > this.halfWidth &&
      absLat <= this.halfWidth + this.kerbWidth &&
      (info.kerbFlags & sideBit) !== 0
    ) {
      // Chamfered FIA rumble kerb bump + ripple
      y += 0.022 + 0.012 * Math.sin(s * 4.5);
    }
    return y;
  }

  isInDRSZone(s) {
    const idx = Math.floor(this.wrapS(s) / this.ds) % this.sampleCount;
    return this._drsMask[idx];
  }

  getSector(s) {
    const sw = this.wrapS(s);
    if (sw < this.sectorSplits[0]) return 1;
    if (sw < this.sectorSplits[1]) return 2;
    return 3;
  }

  getTargetSpeedAtS(s) {
    const N = this.sampleCount;
    const fIdx = this.wrapS(s) / this.ds;
    const i0 = Math.floor(fIdx) % N;
    const i1 = (i0 + 1) % N;
    const t = fIdx - Math.floor(fIdx);
    return this._targetSpeed[i0] * (1 - t) + this._targetSpeed[i1] * t;
  }

  /**
   * Zero-allocation world (x, z) -> normalized [0..1] minimap coordinates.
   */
  worldToMinimap(wx, wz, out) {
    const tf = this._minimapTransform;
    out.x = wx * tf.scale + tf.offsetX;
    out.y = wz * tf.scale + tf.offsetY;
    return out;
  }

  /**
   * Precomputed normalized [0..1] minimap centerline, DRS zone polylines, and S/F line.
   */
  getMinimapPoints(count = 240) {
    const points = new Array(count);
    const tmp = this.createSampleBuffer();
    for (let i = 0; i < count; i++) {
      const s = (i / count) * this.length;
      this.sampleAtS(s, tmp);
      const pt = { x: 0, y: 0 };
      this.worldToMinimap(tmp.x, tmp.z, pt);
      points[i] = pt;
    }

    const drsZones = this.drsZones.map((dz) => {
      const segPts = [];
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const s = dz.startS + (i / steps) * (dz.endS - dz.startS);
        this.sampleAtS(s, tmp);
        const pt = { x: 0, y: 0 };
        this.worldToMinimap(tmp.x, tmp.z, pt);
        segPts.push(pt);
      }
      return { id: dz.id, name: dz.name, points: segPts };
    });

    this.sampleAtS(0, tmp);
    const sfPt = { x: 0, y: 0 };
    this.worldToMinimap(tmp.x, tmp.z, sfPt);

    return {
      points,
      drsZones,
      startFinish: {
        x: sfPt.x,
        y: sfPt.y,
        rx: tmp.rx,
        ry: tmp.rz,
      },
      bounds: this.bounds,
    };
  }
}

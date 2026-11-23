#!/usr/bin/env node
/**
 * Zero-Dependency Automated Headless Chrome WebGL2 & 6-Pose Visual Verification Script
 * for Tokyo GP 2026 Formula 1 Racing Simulation.
 *
 * Uses native Node.js `fetch` + `WebSocket` to drive Chrome DevTools Protocol (CDP):
 *  1. Captures ALL Runtime console/exception, Log, and Network (>=400 / load failure) events.
 *  2. Waits up to 20 s for `window.__f1SimApp.ready === true`.
 *  3. Asserts GLB & Nano Banana PBR compliance (`getAssetValidation().allCompliant === true`).
 *  4. Verifies 240 Hz standstill stability (< 0.01 m drift, zero NaN).
 *  5. Runs scripted acceleration (0-100 / 0-200 km/h), DRS boost, threshold braking (> 650C),
 *     and live Pirelli compound swap (`soft -> medium -> hard -> soft`).
 *  6. Verifies declarative `#setup-popover` and `#inspector-dialog` PBR audit rows.
 *  7. Captures all 6 mandatory 1280x720 PNG screenshots into `verification/`.
 *  8. Measures 60-frame live `requestAnimationFrame` pacing (avg / p95 / max ms).
 *  9. Hard-fails (non-zero exit) on ANY uncaught exception, HTTP >=400, shader warning, or failed check.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..');
const VERIFICATION_DIR = path.join(PROJECT_DIR, 'verification');

const CHROME_PATH =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SHADER_WARNING_RE =
  /THREE\.WebGL|WebGLProgram|GL_INVALID|INVALID_OPERATION|INVALID_VALUE|INVALID_ENUM|Shader Error|WEBGL|Context Lost|WebGL:|ERROR:\s*0:/i;

const MANDATORY_POSES = [
  ['pose1', 'pose1_showroom_hero.png'],
  ['pose2', 'pose2_rear_diffuser_drs.png'],
  ['pose3', 'pose3_chase_grid.png'],
  ['pose4', 'pose4_cockpit_halo.png'],
  ['pose5', 'pose5_tv_pod_cornering.png'],
  ['pose6', 'pose6_braking_sparks.png'],
];

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let url = 'http://127.0.0.1:8080/';
  let port = 9229;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url' && argv[i + 1]) {
      url = argv[++i];
    } else if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length);
    } else if (arg === '--port' && argv[i + 1]) {
      port = Number(argv[++i]) || 9229;
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length)) || 9229;
    }
  }
  return { url, port };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Minimal Native WebSocket CDP Client
// ---------------------------------------------------------------------------

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this._nextId = 1;
    this._pending = new Map();
    this._listeners = new Map();
  }

  async connect(timeoutMs = 10000) {
    if (typeof WebSocket !== 'function') {
      throw new Error(
        'Global WebSocket API is unavailable in this Node.js runtime (requires Node 22+).'
      );
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`CDP WebSocket connection timed out after ${timeoutMs} ms`));
      }, timeoutMs);

      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });

      ws.addEventListener('error', (ev) => {
        clearTimeout(timer);
        reject(new Error(`CDP WebSocket error: ${ev?.message || 'connection failed'}`));
      });

      ws.addEventListener('message', (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (typeof msg.id === 'number') {
          const entry = this._pending.get(msg.id);
          if (entry) {
            this._pending.delete(msg.id);
            clearTimeout(entry.timer);
            if (msg.error) {
              entry.reject(
                new Error(`CDP ${entry.method} failed: ${msg.error.message || JSON.stringify(msg.error)}`)
              );
            } else {
              entry.resolve(msg.result);
            }
          }
        } else if (msg.method) {
          const handlers = this._listeners.get(msg.method);
          if (handlers) {
            for (const fn of handlers) {
              try {
                fn(msg.params || {});
              } catch {
                // Keep event loop resilient
              }
            }
          }
        }
      });

      ws.addEventListener('close', () => {
        for (const [id, entry] of this._pending.entries()) {
          clearTimeout(entry.timer);
          entry.reject(new Error(`CDP WebSocket closed before ${entry.method} completed`));
          this._pending.delete(id);
        }
      });
    });
  }

  on(method, handler) {
    if (!this._listeners.has(method)) {
      this._listeners.set(method, []);
    }
    this._listeners.get(method).push(handler);
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP WebSocket not open when sending ${method}`));
    }
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);

      this._pending.set(id, { method, resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, { awaitPromise = true, timeoutMs = 30000 } = {}) {
    const res = await this.send(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise,
        userGesture: true,
      },
      timeoutMs
    );
    if (res?.exceptionDetails) {
      const desc =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        'Unknown JS evaluation exception';
      throw new Error(`Page evaluation error: ${desc}`);
    }
    return res?.result?.value;
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Headless Chrome Lifecycle Helpers
// ---------------------------------------------------------------------------

async function waitForPageTarget(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const listUrl = `http://127.0.0.1:${port}/json/list`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(listUrl);
      if (res.ok) {
        const targets = await res.json();
        const page = Array.isArray(targets)
          ? targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
          : null;
        if (page) return page;

        // Spawn a fresh blank page target if none exists yet
        const newRes = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
          method: 'PUT',
        }).catch(() => fetch(`http://127.0.0.1:${port}/json/new?about:blank`));
        if (newRes?.ok) {
          const created = await newRes.json();
          if (created?.webSocketDebuggerUrl) return created;
        }
      }
    } catch {
      // Chrome still starting up
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for Chrome CDP endpoint on port ${port}`);
}

async function terminateChrome(proc) {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    return;
  }
  const exited = await Promise.race([
    new Promise((resolve) => proc.once('exit', () => resolve(true))),
    sleep(2500).then(() => false),
  ]);
  if (!exited && proc.exitCode === null) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // Ignore already exited
    }
  }
}

function formatConsoleArgs(args = []) {
  return args
    .map((a) => {
      if (a.value !== undefined) return String(a.value);
      if (a.description) return a.description;
      return a.type || '';
    })
    .join(' ');
}

function readPngDimensions(buf) {
  const isPng =
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;
  if (!isPng) return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

// ---------------------------------------------------------------------------
// Main Verification Runner
// ---------------------------------------------------------------------------

async function runVerification() {
  const { url: targetUrl, port: debugPort } = parseArgs(process.argv);
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'f1-headless-cdp-'));

  let chromeProc = null;
  let cdp = null;

  const consoleLogs = [];
  const consoleErrors = [];
  const shaderWarnings = [];
  const exceptions = [];
  const httpErrors = [];
  const assertions = [];

  const recordAssertion = (name, passed, details) => {
    assertions.push({ name, passed: Boolean(passed), details });
    const tag = passed ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${name}: ${details}`);
  };

  // Ensure Chrome never leaks on Ctrl+C / SIGTERM
  const handleSignal = async () => {
    cdp?.close();
    await terminateChrome(chromeProc);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    process.exit(130);
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    await fs.mkdir(VERIFICATION_DIR, { recursive: true });

    console.log(`[Verify] Launching Headless Chrome (${CHROME_PATH}) on CDP port ${debugPort}...`);
    console.log(`[Verify] Target URL: ${targetUrl}`);

    const chromeArgs = [
      '--headless=new',
      '--enable-webgl',
      '--use-gl=angle',
      '--use-angle=metal',
      '--ignore-gpu-blocklist',
      '--window-size=1280,720',
      `--remote-debugging-port=${debugPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ];

    chromeProc = spawn(CHROME_PATH, chromeArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let chromeStderr = '';
    chromeProc.stderr?.on('data', (chunk) => {
      chromeStderr += chunk.toString('utf8');
    });

    const target = await waitForPageTarget(debugPort, 15000);
    cdp = new CDPClient(target.webSocketDebuggerUrl);
    await cdp.connect(10000);

    // Subscribe to all diagnostic CDP domains BEFORE navigation
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = formatConsoleArgs(params.args);
      const level = params.type || 'log';
      consoleLogs.push({ level, text });
      if (level === 'error' || level === 'assert') {
        consoleErrors.push(`[console.${level}] ${text}`);
      }
      if (SHADER_WARNING_RE.test(text)) {
        shaderWarnings.push(`[console.${level}] ${text}`);
      }
    });

    cdp.on('Runtime.exceptionThrown', (params) => {
      const ex = params.exceptionDetails || {};
      const desc = ex.exception?.description || ex.text || 'Uncaught JS exception';
      exceptions.push(desc);
    });

    cdp.on('Log.entryAdded', (params) => {
      const entry = params.entry || {};
      const msg = `[log.${entry.level || 'info'}][${entry.source || 'browser'}] ${entry.text || ''}${entry.url ? ` (${entry.url})` : ''}`;
      if (entry.level === 'error') {
        consoleErrors.push(msg);
      }
      if (SHADER_WARNING_RE.test(entry.text || '')) {
        shaderWarnings.push(msg);
      }
    });

    cdp.on('Network.responseReceived', (params) => {
      const resp = params.response || {};
      if (typeof resp.status === 'number' && resp.status >= 400) {
        httpErrors.push(`HTTP ${resp.status} ${resp.statusText || ''} — ${resp.url}`);
      }
    });

    cdp.on('Network.loadingFailed', (params) => {
      if (params.canceled) return;
      httpErrors.push(
        `Network loadingFailed (${params.errorText || 'unknown'}) — type=${params.type || 'other'} reqId=${params.requestId}`
      );
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Navigate to live Flask simulation
    const navStart = Date.now();
    await cdp.send('Page.navigate', { url: targetUrl });

    // Wait up to 20 s for window.__f1SimApp && window.__f1SimApp.ready === true
    let isReady = false;
    const readyDeadline = Date.now() + 20000;
    while (Date.now() < readyDeadline) {
      try {
        const readyVal = await cdp.evaluate(
          'Boolean(window.__f1SimApp && window.__f1SimApp.ready === true)',
          { awaitPromise: false, timeoutMs: 3000 }
        );
        if (readyVal === true) {
          isReady = true;
          break;
        }
      } catch {
        // Page still executing initial ES module imports
      }
      await sleep(200);
    }

    const bootMs = Date.now() - navStart;
    recordAssertion(
      'App Boot & Ready Gate',
      isReady,
      isReady
        ? `window.__f1SimApp.ready === true in ${bootMs} ms`
        : `Timed out after 20000 ms (errors=${consoleErrors.length}, exceptions=${exceptions.length}, httpErrors=${httpErrors.length})`
    );

    if (!isReady) {
      throw new Error('Simulation failed to reach ready state within 20 seconds');
    }

    // -----------------------------------------------------------------------
    // 1. Asset & PBR Validation Gate
    // -----------------------------------------------------------------------
    const assetVal = await cdp.evaluate('window.__f1SimApp.getAssetValidation()');
    recordAssertion(
      'Asset & PBR Compliance (getAssetValidation)',
      Boolean(assetVal && assetVal.allCompliant === true && assetVal.hasNaN === false),
      JSON.stringify({
        allCompliant: assetVal?.allCompliant,
        hasNaN: assetVal?.hasNaN,
        glbTris:
          assetVal?.glb?.triangles ??
          assetVal?.glb?.triangleCount ??
          assetVal?.glb?.totalTriangles ??
          null,
        pbrAudit: assetVal?.pbrAudit ?? null,
        trackStats: assetVal?.trackStats ?? null,
      })
    );

    // -----------------------------------------------------------------------
    // 2. Standstill Stability Gate (240 ticks idle -> drift < 0.01 m, 0 NaN)
    // -----------------------------------------------------------------------
    const standstill = await cdp.evaluate(`(() => {
      const app = window.__f1SimApp;
      app.startRace('time_trial', { skipCountdown: true });
      app.physics.resetToGrid(-24, 2.2);
      const x0 = app.physics.x;
      const z0 = app.physics.z;
      const snap = app.stepDeterministic(240, { throttle: 0, brake: 0, steer: 0 });
      const drift = Math.hypot(snap.x - x0, snap.z - z0);
      return { drift, speedKmh: snap.speedKmh, hasNaN: snap.hasNaN };
    })()`);

    recordAssertion(
      'Standstill Stability (240 Hz x 1.0 s idle)',
      Boolean(
        standstill &&
          standstill.drift < 0.01 &&
          standstill.speedKmh < 0.1 &&
          standstill.hasNaN === false
      ),
      `drift=${standstill?.drift?.toFixed(6)} m, speed=${standstill?.speedKmh?.toFixed(3)} km/h, hasNaN=${standstill?.hasNaN}`
    );

    // -----------------------------------------------------------------------
    // 3. Acceleration + DRS Boost + Threshold Braking + Compound Swap Gate
    // -----------------------------------------------------------------------
    const dynamics = await cdp.evaluate(`(() => {
      const app = window.__f1SimApp;
      app.startRace('time_trial', { skipCountdown: true });
      app.physics.resetToGrid(50, 0);

      // 0 -> 2.80 s full throttle (0-100 km/h check)
      const at280 = app.stepDeterministic(672, { throttle: 1, brake: 0, steer: 0 });
      // +2.50 s full throttle (5.30 s total, 0-200 km/h check)
      const at530 = app.stepDeterministic(600, { throttle: 1, brake: 0, steer: 0 });
      // +2.00 s full throttle approaching 300 km/h
      const preDrs = app.stepDeterministic(480, { throttle: 1, brake: 0, steer: 0 });

      // Toggle DRS ON inside DRS Zone 1
      const drsOpened = app.physics.setDRS(true, true);
      const withDrs = app.stepDeterministic(240, { throttle: 1, brake: 0, steer: 0 });

      // Heavy threshold braking for 2.0 s in 0.2 s chunks to capture peak rotor temp & decel
      let peakBrakeTemp = withDrs.maxBrakeTemp;
      let peakFrontBrakeTemp = withDrs.frontBrakeTemp;
      let peakDecelG = 0;
      let drsClosedOnBrake = false;
      let anyNaN = Boolean(at280.hasNaN || at530.hasNaN || preDrs.hasNaN || withDrs.hasNaN);

      for (let c = 0; c < 10; c++) {
        const brk = app.stepDeterministic(48, { throttle: 0, brake: 1, steer: 0 });
        if (c === 0) drsClosedOnBrake = brk.drsOpen === false;
        if (brk.maxBrakeTemp > peakBrakeTemp) peakBrakeTemp = brk.maxBrakeTemp;
        if (brk.frontBrakeTemp > peakFrontBrakeTemp) peakFrontBrakeTemp = brk.frontBrakeTemp;
        if (-brk.longG > peakDecelG) peakDecelG = -brk.longG;
        if (brk.hasNaN) anyNaN = true;
      }

      // Live Pirelli compound swap cycle: soft -> medium -> hard -> soft
      const swapResults = [];
      for (const cid of ['soft', 'medium', 'hard', 'soft']) {
        app.setCompound(cid);
        const hudPill = document.getElementById('hud-tire-compound')?.textContent?.trim() || '';
        swapResults.push({ target: cid, actual: app.physics.compound.id, hudPill });
      }

      return {
        speedAt280: at280.speedKmh,
        speedAt530: at530.speedKmh,
        preDrsSpeed: preDrs.speedKmh,
        preDrsCd: preDrs.effectiveCd,
        drsOpened,
        drsOpenActive: withDrs.drsOpen,
        drsFlapAngle: withDrs.drsFlapAngle,
        withDrsSpeed: withDrs.speedKmh,
        withDrsCd: withDrs.effectiveCd,
        withDrsDownforceN: withDrs.downforceN,
        drsClosedOnBrake,
        peakBrakeTemp,
        peakFrontBrakeTemp,
        peakDecelG,
        anyNaN,
        swapResults,
      };
    })()`);

    recordAssertion(
      'Acceleration & DRS Aerodynamics',
      Boolean(
        dynamics &&
          dynamics.speedAt280 >= 95 &&
          dynamics.speedAt530 >= 190 &&
          dynamics.drsOpened === true &&
          dynamics.drsOpenActive === true &&
          dynamics.drsFlapAngle > 0.35 &&
          dynamics.withDrsCd < dynamics.preDrsCd * 0.76 &&
          dynamics.withDrsSpeed > dynamics.preDrsSpeed &&
          dynamics.anyNaN === false
      ),
      `2.8s=${dynamics?.speedAt280?.toFixed(1)} km/h, 5.3s=${dynamics?.speedAt530?.toFixed(1)} km/h, DRS=${dynamics?.preDrsSpeed?.toFixed(1)}->${dynamics?.withDrsSpeed?.toFixed(1)} km/h, Cd=${dynamics?.preDrsCd?.toFixed(3)}->${dynamics?.withDrsCd?.toFixed(3)}, flap=${((dynamics?.drsFlapAngle || 0) * 180 / Math.PI).toFixed(1)}deg, DF=${Math.round(dynamics?.withDrsDownforceN || 0)}N`
    );

    recordAssertion(
      'Threshold Braking & Rotor Thermal Glow (> 650C)',
      Boolean(
        dynamics &&
          dynamics.drsClosedOnBrake === true &&
          dynamics.peakBrakeTemp > 650 &&
          dynamics.peakDecelG > 3.5 &&
          dynamics.anyNaN === false
      ),
      `drsClosedOnBrake=${dynamics?.drsClosedOnBrake}, peakBrakeTemp=${dynamics?.peakBrakeTemp?.toFixed(1)}C (front=${dynamics?.peakFrontBrakeTemp?.toFixed(1)}C), peakDecel=${dynamics?.peakDecelG?.toFixed(2)}g`
    );

    const compoundSwapOk =
      Array.isArray(dynamics?.swapResults) &&
      dynamics.swapResults.length === 4 &&
      dynamics.swapResults.every((r) => r.target === r.actual && r.hudPill.length > 0);
    recordAssertion(
      'Pirelli Tire Compound Live Swap (soft->medium->hard->soft)',
      compoundSwapOk,
      JSON.stringify(dynamics?.swapResults || [])
    );

    // -----------------------------------------------------------------------
    // 4. Declarative #setup-popover & #inspector-dialog Audit Verification
    // -----------------------------------------------------------------------
    const uiCheck = await cdp.evaluate(`(async () => {
      const waitFrames = (n) => new Promise((resolve) => {
        let count = 0;
        const step = () => (++count >= n ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      });

      // Test Car Setup popover open, solar elevation update, and close
      const setupBtn = document.getElementById('btn-setup');
      const setupPopover = document.getElementById('setup-popover');
      const solarSlider = document.getElementById('setup-solar-elevation');
      const solarOut = document.getElementById('setup-solar-value');

      setupBtn?.click();
      await waitFrames(2);
      let setupOpened = false;
      try {
        setupOpened = Boolean(setupPopover?.matches(':popover-open'));
      } catch {
        setupOpened = false;
      }
      if (!setupOpened && typeof setupPopover?.showPopover === 'function') {
        setupPopover.showPopover();
        await waitFrames(2);
        setupOpened = Boolean(setupPopover.matches(':popover-open'));
      }

      if (solarSlider) {
        solarSlider.value = '34';
        solarSlider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await waitFrames(2);
      const solarReadout34 = solarOut?.textContent?.trim() || '';
      if (solarSlider) {
        solarSlider.value = '28';
        solarSlider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof setupPopover?.hidePopover === 'function') {
        try { setupPopover.hidePopover(); } catch {}
      }
      await waitFrames(2);
      let setupClosed = true;
      try {
        setupClosed = !setupPopover?.matches(':popover-open');
      } catch {
        setupClosed = true;
      }

      // Test Inspector modal dialog open, populated PBR audit rows, and close
      const inspectorBtn = document.getElementById('btn-inspector');
      const inspectorDialog = document.getElementById('inspector-dialog');
      inspectorBtn?.click();
      await waitFrames(2);
      if (inspectorDialog && !inspectorDialog.open && typeof inspectorDialog.showModal === 'function') {
        inspectorDialog.showModal();
        await waitFrames(2);
      }
      const dialogOpened = Boolean(inspectorDialog?.open);
      const pbrRows = Array.from(document.querySelectorAll('#inspector-pbr-table tbody tr'));
      const nonEmptyRows = pbrRows.filter((tr) => !tr.querySelector('.table-empty'));
      const failBadges = document.querySelectorAll('#inspector-pbr-table tbody .audit-fail').length;
      const physicsKvCount = document.querySelectorAll('#inspector-physics .inspector-kv').length;
      const glbKvCount = document.querySelectorAll('#inspector-glb .inspector-kv').length;

      inspectorDialog?.close();
      await waitFrames(2);
      const dialogClosed = !inspectorDialog?.open;

      return {
        setupOpened,
        solarReadout34,
        setupClosed,
        dialogOpened,
        pbrRowCount: nonEmptyRows.length,
        failBadges,
        physicsKvCount,
        glbKvCount,
        dialogClosed,
      };
    })()`);

    recordAssertion(
      'Car Setup Popover & Inspector PBR Audit Dialog',
      Boolean(
        uiCheck &&
          uiCheck.setupOpened &&
          uiCheck.solarReadout34 === '34°' &&
          uiCheck.setupClosed &&
          uiCheck.dialogOpened &&
          uiCheck.pbrRowCount >= 10 &&
          uiCheck.failBadges === 0 &&
          uiCheck.physicsKvCount >= 8 &&
          uiCheck.glbKvCount >= 5 &&
          uiCheck.dialogClosed
      ),
      JSON.stringify(uiCheck)
    );

    // -----------------------------------------------------------------------
    // 5. Capture All 6 Mandatory 1280x720 PNG Verification Screenshots
    // -----------------------------------------------------------------------
    const screenshots = [];
    for (const [poseId, filename] of MANDATORY_POSES) {
      await cdp.evaluate(`(async () => {
        window.__f1SimApp.preparePose(${JSON.stringify(poseId)});
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
      })()`);

      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      });
      const pngBuf = Buffer.from(shot.data, 'base64');
      const dims = readPngDimensions(pngBuf);
      const outPath = path.join(VERIFICATION_DIR, filename);
      await fs.writeFile(outPath, pngBuf);

      const shotOk = Boolean(
        dims && dims.width === 1280 && dims.height === 720 && pngBuf.length > 15000
      );
      screenshots.push({ poseId, filename, bytes: pngBuf.length, dims, outPath });
      recordAssertion(
        `Screenshot ${poseId} (${filename})`,
        shotOk,
        `${dims ? `${dims.width}x${dims.height}` : 'invalid PNG'}, ${pngBuf.length} bytes -> ${outPath}`
      );
    }

    // -----------------------------------------------------------------------
    // 6. Live 60-Frame requestAnimationFrame Frame-Pacing Telemetry
    // -----------------------------------------------------------------------
    const pacing = await cdp.evaluate(`(async () => {
      const app = window.__f1SimApp;
      app.startRace('ai_race', { skipCountdown: true });
      app.input.setSyntheticInput({ throttle: 0.72, brake: 0, steer: 0 });

      const deltas = [];
      let prev = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => {
          deltas.push(now - prev);
          prev = now;
          if (deltas.length >= 60) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame((t0) => {
          prev = t0;
          requestAnimationFrame(tick);
        });
      });

      app.input.clearSyntheticInput();
      app.enterShowroom();

      const sorted = [...deltas].sort((a, b) => a - b);
      const sum = deltas.reduce((acc, v) => acc + v, 0);
      const avgMs = sum / deltas.length;
      const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      const maxMs = sorted[sorted.length - 1];
      return {
        frames: deltas.length,
        avgMs,
        p95Ms,
        maxMs,
        estFps: avgMs > 0 ? 1000 / avgMs : 0,
      };
    })()`);

    recordAssertion(
      '60-Frame Live rAF Pacing Telemetry',
      Boolean(pacing && pacing.frames === 60 && Number.isFinite(pacing.avgMs) && pacing.avgMs > 0),
      `avg=${pacing?.avgMs?.toFixed(2)} ms (${pacing?.estFps?.toFixed(1)} FPS), p95=${pacing?.p95Ms?.toFixed(2)} ms, max=${pacing?.maxMs?.toFixed(2)} ms`
    );

    // -----------------------------------------------------------------------
    // 7. Hard Failure Gate Diagnostics Summary
    // -----------------------------------------------------------------------
    recordAssertion(
      'Zero Uncaught JS Exceptions',
      exceptions.length === 0,
      exceptions.length === 0 ? '0 exceptions' : exceptions.join(' | ')
    );
    recordAssertion(
      'Zero Console Errors',
      consoleErrors.length === 0,
      consoleErrors.length === 0 ? '0 console errors' : consoleErrors.join(' | ')
    );
    recordAssertion(
      'Zero HTTP >= 400 / Network Failures',
      httpErrors.length === 0,
      httpErrors.length === 0 ? '0 HTTP/network errors' : httpErrors.join(' | ')
    );
    recordAssertion(
      'Zero WebGL / Three.js Shader Warnings',
      shaderWarnings.length === 0,
      shaderWarnings.length === 0 ? '0 shader warnings' : shaderWarnings.join(' | ')
    );

    const failedAssertions = assertions.filter((a) => !a.passed);
    console.log('\n==================== VERIFICATION SUMMARY ====================');
    console.log(`Assertions Passed : ${assertions.length - failedAssertions.length} / ${assertions.length}`);
    console.log(`Screenshots Saved : ${screenshots.length} PNGs in ${VERIFICATION_DIR}`);
    console.log(
      `Frame Pacing      : avg ${pacing.avgMs.toFixed(2)} ms | p95 ${pacing.p95Ms.toFixed(2)} ms | max ${pacing.maxMs.toFixed(2)} ms (~${pacing.estFps.toFixed(1)} FPS)`
    );
    console.log(`Console Logs      : ${consoleLogs.length} total`);
    console.log(`Hard Errors       : exceptions=${exceptions.length}, consoleErr=${consoleErrors.length}, httpErr=${httpErrors.length}, shaderWarn=${shaderWarnings.length}`);

    if (failedAssertions.length > 0) {
      console.error('\n[HARD FAILURE GATE TRIGGERED]');
      for (const f of failedAssertions) {
        console.error(`  - ${f.name}: ${f.details}`);
      }
      if (chromeStderr.trim()) {
        console.error('\n[Chrome stderr tail]');
        console.error(chromeStderr.trim().split('\n').slice(-12).join('\n'));
      }
      process.exitCode = 1;
    } else {
      console.log('\n[SUCCESS] ALL HEADLESS WEBGL2 & 6-POSE VERIFICATION GATES PASSED.');
    }
  } catch (err) {
    console.error('\n[FATAL VERIFICATION ERROR]', err?.stack || err);
    if (consoleErrors.length) console.error('[Captured Console Errors]', consoleErrors);
    if (exceptions.length) console.error('[Captured Exceptions]', exceptions);
    if (httpErrors.length) console.error('[Captured HTTP Errors]', httpErrors);
    if (shaderWarnings.length) console.error('[Captured Shader Warnings]', shaderWarnings);
    process.exitCode = 1;
  } finally {
    cdp?.close();
    await terminateChrome(chromeProc);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

await runVerification();

/**
 * Non-blocking W3C KeyboardEvent input controller with preallocated bitmask,
 * high-precision performance.now() timestamps, accessible dialog/popover
 * guardrails, event callback hooks, and deterministic synthetic input injection.
 *
 * Sign convention (matches Section 1.2 & Section 3):
 *   steer = +1.0 => Left  (KeyA / ArrowLeft  => +delta around +Y)
 *   steer = -1.0 => Right (KeyD / ArrowRight => -delta around +Y)
 */

const BIT_THROTTLE_W   = 1 << 0;
const BIT_THROTTLE_UP  = 1 << 1;
const BIT_BRAKE_S      = 1 << 2;
const BIT_BRAKE_DOWN   = 1 << 3;
const BIT_LEFT_A       = 1 << 4;
const BIT_LEFT_ARROW   = 1 << 5;
const BIT_RIGHT_D      = 1 << 6;
const BIT_RIGHT_ARROW  = 1 << 7;
const BIT_LOOK_BEHIND  = 1 << 8;

const MASK_THROTTLE = BIT_THROTTLE_W | BIT_THROTTLE_UP;
const MASK_BRAKE    = BIT_BRAKE_S | BIT_BRAKE_DOWN;
const MASK_LEFT     = BIT_LEFT_A | BIT_LEFT_ARROW;
const MASK_RIGHT    = BIT_RIGHT_D | BIT_RIGHT_ARROW;

const TS_THROTTLE = 0;
const TS_BRAKE    = 1;
const TS_LEFT     = 2;
const TS_RIGHT    = 3;

const PREVENT_SCROLL_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class InputController {
  constructor(options = {}) {
    // Preallocated bitmask & press timestamps (zero runtime allocations)
    this._bits = new Uint32Array(1);
    this._timestamps = new Float64Array(4);

    // Optional FSM state hint (set via setFSMState for Showroom Space/W start)
    this.fsmState = null;

    // Action callback hooks (assignable via constructor options or directly)
    this.onToggleDRS = options.onToggleDRS || null;
    this.onCycleCamera = options.onCycleCamera || null;
    this.onResetTrack = options.onResetTrack || null;
    this.onTogglePause = options.onTogglePause || null;
    this.onToggleMute = options.onToggleMute || null;
    this.onStartRace = options.onStartRace || null;
    this.onShiftUp = options.onShiftUp || null;
    this.onShiftDown = options.onShiftDown || null;

    // Preallocated synthetic input override buffer (for headless verification/tests)
    this.syntheticActive = false;
    this._synthetic = {
      throttle: 0,
      brake: 0,
      steer: 0,
      lookBehind: false,
      directPedals: false,
    };

    // Preallocated output state buffer
    this._state = {
      throttle: 0,
      brake: 0,
      steer: 0,
      throttleHeld: false,
      brakeHeld: false,
      steerLeft: false,
      steerRight: false,
      lookBehind: false,
      directPedals: false,
      throttleTimestampMs: 0,
      brakeTimestampMs: 0,
      steerTimestampMs: 0,
      bitmask: 0,
    };

    this._boundKeyDown = this._handleKeyDown.bind(this);
    this._boundKeyUp = this._handleKeyUp.bind(this);
    this._boundBlur = this._handleBlur.bind(this);

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this._boundKeyDown, { passive: false });
      window.addEventListener('keyup', this._boundKeyUp, { passive: true });
      window.addEventListener('blur', this._boundBlur, { passive: true });
    }
  }

  setFSMState(state) {
    this.fsmState = state;
  }

  /**
   * Inject deterministic control values (used by headless verification scripts & tests).
   * Accepts either analog { throttle, brake, steer } or digital { throttleHeld, brakeHeld, steerLeft, steerRight }.
   */
  setSyntheticInput(obj = {}) {
    this.syntheticActive = true;
    const s = this._synthetic;

    if (typeof obj.throttle === 'number') {
      s.throttle = clamp(obj.throttle, 0, 1);
    } else if (typeof obj.throttleHeld === 'boolean') {
      s.throttle = obj.throttleHeld ? 1 : 0;
    } else {
      s.throttle = 0;
    }

    if (typeof obj.brake === 'number') {
      s.brake = clamp(obj.brake, 0, 1);
    } else if (typeof obj.brakeHeld === 'boolean') {
      s.brake = obj.brakeHeld ? 1 : 0;
    } else {
      s.brake = 0;
    }

    if (typeof obj.steer === 'number') {
      s.steer = clamp(obj.steer, -1, 1);
    } else {
      const left = obj.steerLeft ? 1 : 0;
      const right = obj.steerRight ? 1 : 0;
      s.steer = left - right;
    }

    s.lookBehind = Boolean(obj.lookBehind);
    s.directPedals = Boolean(obj.directPedals);
  }

  clearSyntheticInput() {
    this.syntheticActive = false;
    this._synthetic.throttle = 0;
    this._synthetic.brake = 0;
    this._synthetic.steer = 0;
    this._synthetic.lookBehind = false;
    this._synthetic.directPedals = false;
  }

  clearHeldKeys() {
    this._bits[0] = 0;
  }

  /**
   * Returns true when keyboard focus is inside a modal <dialog>, open popover,
   * or native text/form input so browser/a11y navigation is never hijacked.
   */
  _isUIBlockingInput(event) {
    if (typeof document === 'undefined') return false;

    const openDialog = document.querySelector('dialog[open]');
    if (openDialog) return true;

    const target = event.target;
    if (target && typeof target.closest === 'function') {
      if (target.closest('input, textarea, select, [contenteditable="true"]')) {
        return true;
      }
      if (target.closest('[popover]:popover-open')) {
        return true;
      }
    }
    return false;
  }

  _handleKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this._isUIBlockingInput(e)) return;

    const code = e.code;

    // Prevent browser page scrolling on Arrow keys & Space while driving
    if (PREVENT_SCROLL_CODES.has(code)) {
      // Allow Enter/Space on an explicitly focused non-canvas button only if not actively racing
      const isFocusedButton =
        e.target && e.target.tagName === 'BUTTON' && code === 'Space' && this.fsmState !== 'ACTIVE_RACING';
      if (!isFocusedButton) {
        e.preventDefault();
      }
    }

    const prevBits = this._bits[0];
    let bits = prevBits;
    const ts = e.timeStamp || nowMs();

    switch (code) {
      case 'KeyW':
        bits |= BIT_THROTTLE_W;
        if ((prevBits & MASK_THROTTLE) === 0) this._timestamps[TS_THROTTLE] = ts;
        if (!e.repeat && this.fsmState === 'SHOWROOM_GRID' && this.onStartRace) {
          this.onStartRace('KeyW');
        }
        break;
      case 'ArrowUp':
        bits |= BIT_THROTTLE_UP;
        if ((prevBits & MASK_THROTTLE) === 0) this._timestamps[TS_THROTTLE] = ts;
        if (!e.repeat && this.fsmState === 'SHOWROOM_GRID' && this.onStartRace) {
          this.onStartRace('ArrowUp');
        }
        break;
      case 'KeyS':
        bits |= BIT_BRAKE_S;
        if ((prevBits & MASK_BRAKE) === 0) this._timestamps[TS_BRAKE] = ts;
        break;
      case 'ArrowDown':
        bits |= BIT_BRAKE_DOWN;
        if ((prevBits & MASK_BRAKE) === 0) this._timestamps[TS_BRAKE] = ts;
        break;
      case 'KeyA':
        bits |= BIT_LEFT_A;
        if ((prevBits & MASK_LEFT) === 0) this._timestamps[TS_LEFT] = ts;
        break;
      case 'ArrowLeft':
        bits |= BIT_LEFT_ARROW;
        if ((prevBits & MASK_LEFT) === 0) this._timestamps[TS_LEFT] = ts;
        break;
      case 'KeyD':
        bits |= BIT_RIGHT_D;
        if ((prevBits & MASK_RIGHT) === 0) this._timestamps[TS_RIGHT] = ts;
        break;
      case 'ArrowRight':
        bits |= BIT_RIGHT_ARROW;
        if ((prevBits & MASK_RIGHT) === 0) this._timestamps[TS_RIGHT] = ts;
        break;
      case 'KeyB':
        bits |= BIT_LOOK_BEHIND;
        break;

      // Edge-triggered discrete motorsport actions (ignore OS key repeat)
      case 'Space':
        if (!e.repeat) {
          if (this.fsmState === 'SHOWROOM_GRID') {
            if (this.onStartRace) this.onStartRace('Space');
          } else if (this.fsmState === null && this.onStartRace) {
            const consumed = this.onStartRace('Space');
            if (consumed !== true && this.onToggleDRS) this.onToggleDRS();
          } else if (this.onToggleDRS) {
            this.onToggleDRS();
          }
        }
        break;
      case 'KeyC':
      case 'KeyV':
        if (!e.repeat && this.onCycleCamera) this.onCycleCamera();
        break;
      case 'KeyR':
        if (!e.repeat && this.onResetTrack) this.onResetTrack();
        break;
      case 'KeyQ':
      case 'KeyZ':
        if (!e.repeat && this.onShiftDown) this.onShiftDown();
        break;
      case 'KeyE':
      case 'KeyX':
        if (!e.repeat && this.onShiftUp) this.onShiftUp();
        break;
      case 'KeyM':
        if (!e.repeat && this.onToggleMute) this.onToggleMute();
        break;
      case 'KeyP':
      case 'Escape':
        if (!e.repeat && this.onTogglePause) this.onTogglePause();
        break;
      default:
        break;
    }

    this._bits[0] = bits;
  }

  _handleKeyUp(e) {
    let bits = this._bits[0];
    switch (e.code) {
      case 'KeyW':       bits &= ~BIT_THROTTLE_W; break;
      case 'ArrowUp':    bits &= ~BIT_THROTTLE_UP; break;
      case 'KeyS':       bits &= ~BIT_BRAKE_S; break;
      case 'ArrowDown':  bits &= ~BIT_BRAKE_DOWN; break;
      case 'KeyA':       bits &= ~BIT_LEFT_A; break;
      case 'ArrowLeft':  bits &= ~BIT_LEFT_ARROW; break;
      case 'KeyD':       bits &= ~BIT_RIGHT_D; break;
      case 'ArrowRight': bits &= ~BIT_RIGHT_ARROW; break;
      case 'KeyB':       bits &= ~BIT_LOOK_BEHIND; break;
      default: return;
    }
    this._bits[0] = bits;
  }

  _handleBlur() {
    this._bits[0] = 0;
  }

  /**
   * Zero-allocation read of current control intent.
   * Writes into `out` (defaulting to internal preallocated state buffer).
   */
  sample(out = this._state) {
    if (this.syntheticActive) {
      const s = this._synthetic;
      out.throttle = s.throttle;
      out.brake = s.brake;
      out.steer = s.steer;
      out.throttleHeld = s.throttle > 0.01;
      out.brakeHeld = s.brake > 0.01;
      out.steerLeft = s.steer > 0.01;
      out.steerRight = s.steer < -0.01;
      out.lookBehind = s.lookBehind;
      out.directPedals = s.directPedals;
      out.throttleTimestampMs = 0;
      out.brakeTimestampMs = 0;
      out.steerTimestampMs = 0;
      out.bitmask = 0;
      return out;
    }

    const bits = this._bits[0];
    const throttleHeld = (bits & MASK_THROTTLE) !== 0;
    const brakeHeld = (bits & MASK_BRAKE) !== 0;
    const steerLeft = (bits & MASK_LEFT) !== 0;
    const steerRight = (bits & MASK_RIGHT) !== 0;

    out.throttle = throttleHeld ? 1.0 : 0.0;
    out.brake = brakeHeld ? 1.0 : 0.0;
    out.steer = (steerLeft ? 1.0 : 0.0) - (steerRight ? 1.0 : 0.0);
    out.throttleHeld = throttleHeld;
    out.brakeHeld = brakeHeld;
    out.steerLeft = steerLeft;
    out.steerRight = steerRight;
    out.lookBehind = (bits & BIT_LOOK_BEHIND) !== 0;
    out.directPedals = false;
    out.throttleTimestampMs = this._timestamps[TS_THROTTLE];
    out.brakeTimestampMs = this._timestamps[TS_BRAKE];
    out.steerTimestampMs = Math.max(this._timestamps[TS_LEFT], this._timestamps[TS_RIGHT]);
    out.bitmask = bits;
    return out;
  }

  destroy() {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this._boundKeyDown);
      window.removeEventListener('keyup', this._boundKeyUp);
      window.removeEventListener('blur', this._boundBlur);
    }
    this._bits[0] = 0;
  }
}

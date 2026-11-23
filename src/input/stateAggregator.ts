/**
 * State Aggregator for Padly
 * Subscribes to inputBus and maintains a single consolidated ControllerState snapshot.
 *
 * Axis Scaling Conversion:
 * - In the app's UI/gesture layer:
 *   Stick inputs are normalized to [-1, 1]. Pushing the stick UP produces positive Y (+1.0).
 * - PROTOCOL.md & Linux evdev convention:
 *   Sticks are serialized as 16-bit signed integers [-32768, 32767].
 *   Crucially: "up is NEGATIVE y (evdev convention)".
 *   Therefore, the Y axis is inverted: evdevY = -appY.
 *   - Up (+1.0) maps to -32768
 *   - Down (-1.0) maps to +32767
 *   - Center (0.0) maps to 0
 *   - Left (-1.0) maps to -32768
 *   - Right (+1.0) maps to +32767
 * - Triggers:
 *   Normalized [0, 1] maps linearly to 8-bit unsigned [0, 255].
 */

import { subscribe, ButtonEvent, StickEvent, TriggerEvent } from './inputBus';
import { BUTTON_ID_TO_BIT } from '../protocol/buttons';
import { ControllerProfile, profileStore, DEFAULT_PROFILES } from '../profiles/ProfileStore';

export interface ControllerState {
  buttons: number; // u32 bitmask
  lx: number; // i16 (-32768..32767)
  ly: number; // i16 (-32768..32767, up is NEGATIVE y)
  rx: number; // i16 (-32768..32767)
  ry: number; // i16 (-32768..32767, up is NEGATIVE y)
  lt: number; // u8 (0..255)
  rt: number; // u8 (0..255)
  flags: number; // u16 (reserved, 0)
}

/**
 * Converts app normalized X axis [-1..1] to signed int16 [-32768..32767].
 */
export function scaleStickX(appX: number): number {
  if (appX === 0) return 0;
  const clamped = Math.max(-1, Math.min(1, appX));
  if (clamped >= 0) {
    const val = Math.round(clamped * 32767);
    return val === 0 ? 0 : val;
  }
  return Math.round(clamped * 32768);
}

/**
 * Converts app normalized Y axis [-1..1] (where UP is +1) to evdev int16 [-32768..32767],
 * where UP is NEGATIVE Y per PROTOCOL.md.
 */
export function scaleStickY(appY: number): number {
  if (appY === 0) return 0;
  const evdevY = -appY;
  const clamped = Math.max(-1, Math.min(1, evdevY));
  if (clamped >= 0) {
    const val = Math.round(clamped * 32767);
    return val === 0 ? 0 : val;
  }
  return Math.round(clamped * 32768);
}

/**
 * Converts app normalized trigger value [0..1] to unsigned 8-bit [0..255].
 */
export function scaleTrigger(appVal: number): number {
  if (appVal === 0) return 0;
  const clamped = Math.max(0, Math.min(1, appVal));
  return Math.round(clamped * 255);
}

/**
 * Applies active controller profile to raw stick input:
 * - Deadzone: zeroes micro-drift inside threshold, rescales smoothly past it
 * - Stick response curve: 'linear', 'exponential' (precise center), or 'aggressive' (fast ramp)
 * - Stick sensitivity: multiplier on stick range
 * - Serializes to int16 (-32768..32767, UP is NEGATIVE Y)
 */
export function processStickInput(
  rawX: number,
  rawY: number,
  profile: ControllerProfile
): { scaledX: number; scaledY: number } {
  const deadzone = profile.deadzone ?? 0.10;
  const curve = profile.stickCurve || 'linear';
  const sensitivity = profile.stickSensitivity || 1.0;

  const processAxis = (val: number): number => {
    const abs = Math.abs(val);
    if (abs <= deadzone || abs === 0) return 0;

    // 1. Rescale smoothly from edge of deadzone to full throw [0, 1]
    const scaled = Math.min(1, (abs - deadzone) / Math.max(0.001, 1 - deadzone));

    // 2. Response curve
    let curved = scaled;
    if (curve === 'exponential') {
      curved = Math.pow(scaled, 2);
    } else if (curve === 'aggressive') {
      curved = Math.pow(scaled, 0.7);
    }

    // 3. Sensitivity
    const finalVal = Math.min(1, curved * sensitivity);
    return Math.sign(val) * finalVal;
  };

  const normX = processAxis(rawX);
  const normY = processAxis(rawY);

  return {
    scaledX: scaleStickX(normX),
    scaledY: scaleStickY(normY),
  };
}

/**
 * Applies active controller profile to trigger input:
 * - 'smooth': analog 0..255
 * - 'hair-trigger': instantaneous digital snap to 255 if pressed > 5%, otherwise 0
 */
export function processTriggerInput(
  rawVal: number,
  profile: ControllerProfile
): number {
  if (rawVal <= 0) return 0;
  if (profile.triggerBehavior === 'hair-trigger') {
    return rawVal > 0.05 ? 255 : 0;
  }
  return scaleTrigger(rawVal);
}

export type StateChangeCallback = (state: ControllerState) => void;

class StateAggregator {
  private state: ControllerState = {
    buttons: 0,
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    lt: 0,
    rt: 0,
    flags: 0,
  };

  private profile: ControllerProfile = DEFAULT_PROFILES[0];
  private listeners = new Set<StateChangeCallback>();
  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.start();
    // Auto-sync with ProfileStore
    this.profile = profileStore.getActiveProfile();
    this.unsubscribers.push(
      profileStore.onChange((active) => {
        this.setProfile(active);
      })
    );
  }

  public setProfile(profile: ControllerProfile): void {
    this.profile = { ...profile };
  }

  public getProfile(): ControllerProfile {
    return { ...this.profile };
  }

  public start(): void {
    if (this.unsubscribers.length > 1) return; // Keep profile listener

    // 1. Subscribe to button events
    const unsubButton = subscribe('button', (event: ButtonEvent) => {
      const bit = BUTTON_ID_TO_BIT[event.id];
      if (bit === undefined) return;

      const prevButtons = this.state.buttons;
      let newButtons = prevButtons;
      if (event.pressed) {
        newButtons |= bit;
      } else {
        newButtons &= ~bit;
      }

      if (newButtons !== prevButtons) {
        this.state = { ...this.state, buttons: newButtons >>> 0 };
        this.notify();
      }
    });

    // 2. Subscribe to stick events with profile processing
    const unsubStick = subscribe('stick', (event: StickEvent) => {
      const { scaledX, scaledY } = processStickInput(event.x, event.y, this.profile);

      if (event.id === 'left') {
        if (this.state.lx !== scaledX || this.state.ly !== scaledY) {
          this.state = { ...this.state, lx: scaledX, ly: scaledY };
          this.notify();
        }
      } else if (event.id === 'right') {
        if (this.state.rx !== scaledX || this.state.ry !== scaledY) {
          this.state = { ...this.state, rx: scaledX, ry: scaledY };
          this.notify();
        }
      }
    });

    // 3. Subscribe to trigger events with profile processing
    const unsubTrigger = subscribe('trigger', (event: TriggerEvent) => {
      const scaled = processTriggerInput(event.value, this.profile);

      if (event.id === 'LT') {
        if (this.state.lt !== scaled) {
          this.state = { ...this.state, lt: scaled };
          this.notify();
        }
      } else if (event.id === 'RT') {
        if (this.state.rt !== scaled) {
          this.state = { ...this.state, rt: scaled };
          this.notify();
        }
      }
    });

    this.unsubscribers.push(unsubButton, unsubStick, unsubTrigger);
  }

  public stop(): void {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
  }

  public getState(): ControllerState {
    return { ...this.state };
  }

  public resetState(): void {
    this.state = {
      buttons: 0,
      lx: 0,
      ly: 0,
      rx: 0,
      ry: 0,
      lt: 0,
      rt: 0,
      flags: 0,
    };
    this.notify();
  }

  public onChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify(): void {
    const snapshot = this.getState();
    this.listeners.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (err) {
        console.error('[StateAggregator] Error in onChange callback:', err);
      }
    });
  }
}

// Global singleton instance
const aggregatorInstance = new StateAggregator();

/**
 * Returns current snapshot of the consolidated controller state.
 */
export function getState(): ControllerState {
  return aggregatorInstance.getState();
}

/**
 * Subscribes to changes in controller state. Returns an unsubscribe function.
 */
export function onChange(callback: StateChangeCallback): () => void {
  return aggregatorInstance.onChange(callback);
}

/**
 * Resets all inputs (all buttons released, sticks centered at 0, triggers 0).
 */
export function resetState(): void {
  aggregatorInstance.resetState();
}

export { StateAggregator };

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

  private listeners = new Set<StateChangeCallback>();
  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.start();
  }

  public start(): void {
    if (this.unsubscribers.length > 0) return;

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

    // 2. Subscribe to stick events
    const unsubStick = subscribe('stick', (event: StickEvent) => {
      const scaledX = scaleStickX(event.x);
      const scaledY = scaleStickY(event.y);

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

    // 3. Subscribe to trigger events
    const unsubTrigger = subscribe('trigger', (event: TriggerEvent) => {
      const scaled = scaleTrigger(event.value);

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

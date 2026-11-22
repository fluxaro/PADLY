/**
 * Central typed event bus for controller inputs (no external libraries).
 */

export type ButtonId =
  | 'A'
  | 'B'
  | 'X'
  | 'Y'
  | 'LB'
  | 'RB'
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'START'
  | 'BACK'
  | 'HOME'
  | 'SHARE'
  | 'SHARE-LEFT'
  | 'L3'
  | 'R3';

export interface ButtonEvent {
  id: ButtonId;
  pressed: boolean;
}

export interface StickEvent {
  id: 'left' | 'right';
  x: number; // normalized -1..1
  y: number; // normalized -1..1
}

export interface TriggerEvent {
  id: 'LT' | 'RT';
  value: number; // 0..1
}

export interface TouchpadEvent {
  dx: number;
  dy: number;
  type: 'move' | 'tap' | 'scroll';
}

export interface InputEvents {
  button: ButtonEvent;
  stick: StickEvent;
  trigger: TriggerEvent;
  touchpad: TouchpadEvent;
}

export type InputEventName = keyof InputEvents;
export type InputEventHandler<K extends InputEventName> = (payload: InputEvents[K]) => void;

/**
 * When true, every emitted event is logged to the console.
 */
export let DEBUG_INPUT = true;

export function setDebugInput(enabled: boolean): void {
  DEBUG_INPUT = enabled;
}

type ListenerMap = {
  [K in InputEventName]?: Set<InputEventHandler<K>>;
};

const listeners: ListenerMap = {};

/**
 * Emit a typed input event on the bus.
 */
export function emit<K extends InputEventName>(event: K, payload: InputEvents[K]): void {
  if (DEBUG_INPUT) {
    console.log(`[InputBus] ${event}:`, payload);
  }

  const handlers = listeners[event];
  if (handlers) {
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[InputBus] Error handling event "${event}":`, err);
      }
    });
  }
}

/**
 * Subscribe to a typed input event. Returns an unsubscribe function.
 */
export function subscribe<K extends InputEventName>(
  event: K,
  handler: InputEventHandler<K>
): () => void {
  if (!listeners[event]) {
    listeners[event] = new Set() as ListenerMap[K];
  }
  const handlers = listeners[event] as Set<InputEventHandler<K>>;
  handlers.add(handler);

  return () => {
    handlers.delete(handler);
  };
}

export const inputBus = {
  emit,
  subscribe,
  setDebugInput,
};

export default inputBus;

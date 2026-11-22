import { Image } from 'react-native';

export const FRAME_IMAGE = require('../../assets/frame/frame.png');

const resolvedAsset = Image.resolveAssetSource(FRAME_IMAGE);
const assetW = resolvedAsset?.width;
const assetH = resolvedAsset?.height;

/**
 * Natural dimensions of the underlying frame.png asset (1846 x 852).
 */
export const FRAME_NATURAL_W: number = typeof assetW === 'number' ? assetW : 1846;
export const FRAME_NATURAL_H: number = typeof assetH === 'number' ? assetH : 852;

/**
 * Design coordinate space dimensions.
 * Using 923 x 426 (exact 1/2 scale of the 1846 x 852 image, aspect ratio 2.1667).
 * This eliminates all vertical letterboxing and allows the controller frame
 * to scale up and fill the entire screen on mobile devices.
 */
export const DESIGN_W = 923;
export const DESIGN_H = 426;

/**
 * Debug flag: When true, draws translucent outlines over sockets.
 * Default is FALSE so authentic button labels, colors, and graphics are shown.
 */
export let DEBUG_LAYOUT = false;

export function setDebugLayout(enabled: boolean): void {
  DEBUG_LAYOUT = enabled;
}

/**
 * Button label theme preference:
 * 'xbox': Y, X, B, A and LT, LB, RT, RB
 * 'playstation': △, □, ○, ✕ and L2, L1, R2, R1
 */
export type ButtonStyleMode = 'playstation' | 'xbox';
export let ACTIVE_BUTTON_STYLE: ButtonStyleMode = 'playstation';

export function setButtonStyleMode(mode: ButtonStyleMode): void {
  ACTIVE_BUTTON_STYLE = mode;
}

/**
 * Socket layout coordinates in design pixels (923 x 426 space).
 * Derived directly from pixel analysis on the natural 1846 x 852 chassis frame.
 */
export const SOCKETS = {
  // Left Stick: centered in the recessed circular well
  leftStick: { cx: 195, cy: 158, r: 52 },

  // Right Stick: centered in the lower-right recessed circular well
  rightStick: { cx: 626, cy: 271, r: 52 },

  // D-Pad: centered in the lower-left circular cross well
  dpad: { cx: 297, cy: 263, size: 116 },

  // Face Buttons: diamond cluster on the upper-right
  faceY: { cx: 730, cy: 119, r: 28 }, // Y / Triangle
  faceX: { cx: 678, cy: 170, r: 28 }, // X / Square
  faceB: { cx: 778, cy: 174, r: 28 }, // B / Circle
  faceA: { cx: 729, cy: 218, r: 28 }, // A / Cross

  // Central Touchpad Panel
  touchpad: { x: 326, y: 20, w: 270, h: 122, radius: 18 },

  // Shoulder Triggers and Bumpers sculpted to fit the exact cavities in frame.png
  // L2 (LT Trigger): Top left cavity
  LT: { x: 88.5, y: 21, w: 121, h: 43 },
  // L1 (LB Bumper): Bottom left cavity
  LB: { x: 88, y: 60.5, w: 108, h: 40 },
  // R2 (RT Trigger): Top right cavity
  RT: { x: 714, y: 21, w: 121.5, h: 42 },
  // R1 (RB Bumper): Bottom right cavity
  RB: { x: 728, y: 60.5, w: 107.5, h: 39.5 },

  // Central Functional Buttons
  home: { cx: 461, cy: 192, r: 34 },
  smallLeft: { cx: 380, cy: 190, r: 21 },
  smallRight: { cx: 540, cy: 191, r: 21 },
  topLeftSmall: { cx: 279, cy: 70, r: 20 },
  topRightSmall: { cx: 642, cy: 70, r: 20 },
} as const;

export type SocketsType = typeof SOCKETS;

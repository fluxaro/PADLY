import { ButtonId } from '../input/inputBus';

/**
 * Button bit masks as specified in PROTOCOL.md v1:
 * A0 B1 X2 Y3 LB4 RB5 BACK6 START7 HOME8 L3=9 R3=10 UP11 DOWN12 LEFT13 RIGHT14 SHARE15
 */
export const BUTTON_BITS = {
  A: 1 << 0, // 0x0001 (1)
  B: 1 << 1, // 0x0002 (2)
  X: 1 << 2, // 0x0004 (4)
  Y: 1 << 3, // 0x0008 (8)
  LB: 1 << 4, // 0x0010 (16)
  RB: 1 << 5, // 0x0020 (32)
  BACK: 1 << 6, // 0x0040 (64)
  START: 1 << 7, // 0x0080 (128)
  HOME: 1 << 8, // 0x0100 (256)
  L3: 1 << 9, // 0x0200 (512)
  R3: 1 << 10, // 0x0400 (1024)
  UP: 1 << 11, // 0x0800 (2048)
  DOWN: 1 << 12, // 0x1000 (4096)
  LEFT: 1 << 13, // 0x2000 (8192)
  RIGHT: 1 << 14, // 0x4000 (16384)
  SHARE: 1 << 15, // 0x8000 (32768)
} as const;

export type ButtonBitKey = keyof typeof BUTTON_BITS;

/**
 * Maps an inputBus ButtonId to its corresponding PROTOCOL bitmask.
 * Note: 'SHARE-LEFT' is an alternate physical socket alias that maps to SHARE.
 */
export const BUTTON_ID_TO_BIT: Record<ButtonId, number> = {
  A: BUTTON_BITS.A,
  B: BUTTON_BITS.B,
  X: BUTTON_BITS.X,
  Y: BUTTON_BITS.Y,
  LB: BUTTON_BITS.LB,
  RB: BUTTON_BITS.RB,
  BACK: BUTTON_BITS.BACK,
  START: BUTTON_BITS.START,
  HOME: BUTTON_BITS.HOME,
  L3: BUTTON_BITS.L3,
  R3: BUTTON_BITS.R3,
  UP: BUTTON_BITS.UP,
  DOWN: BUTTON_BITS.DOWN,
  LEFT: BUTTON_BITS.LEFT,
  RIGHT: BUTTON_BITS.RIGHT,
  SHARE: BUTTON_BITS.SHARE,
  'SHARE-LEFT': BUTTON_BITS.SHARE,
};

/**
 * Unit Tests for Padly Protocol v1
 * Covers:
 * 1. Round-trip codec tests for every message type (STATE, PING, PONG, HELLO, HELLO_ACK, RUMBLE, BYE)
 * 2. Known-byte test vectors for STATE packet and HKDF key derivation (reusable on PC side)
 * 3. Encrypt/decrypt round-trip for Handshake and Session frames
 * 4. Replay attack rejection (counter monotonicity)
 * 5. Tampered ciphertext / header rejection
 * 6. Stick and trigger conversion edge cases (-1, 0, 1, up direction evdev convention)
 * 7. StateAggregator event subscription and state tracking
 */

import { describe, test, expect } from '@jest/globals';
import {
  encodeInner,
  decodeInner,
  MessageType,
  StateMessage,
  PingMessage,
  PongMessage,
  HelloMessage,
  HelloAckMessage,
  RumbleMessage,
  ByeMessage,
} from '../protocol/codec';
import {
  encryptHandshake,
  decryptHandshake,
  deriveSessionKey,
  SessionCipher,
  buildSessionNonce,
} from '../protocol/crypto';
import { BUTTON_BITS } from '../protocol/buttons';
import {
  scaleStickX,
  scaleStickY,
  scaleTrigger,
  StateAggregator,
} from '../input/stateAggregator';
import { emit, setDebugInput } from '../input/inputBus';

// Disable input bus debug spam during tests
setDebugInput(false);

/**
 * ============================================================================
 * PC-COMPATIBLE TEST VECTORS
 * You can copy these hex strings into the PC/Rust/Python/C++ receiver tests!
 * ============================================================================
 */
export const TEST_VECTORS = {
  /**
   * Known STATE message vector:
   * Header:
   *   ver = 1 (0x01)
   *   type = 0x01 (STATE)
   *   seq = 42 (0x002a)
   *   ts = 1337000 (0x001466a8)
   * Payload:
   *   buttons = A | X | UP = (1 | 4 | 2048) = 2053 (0x00000805)
   *   lx = 1000 (0x03e8)
   *   ly = -2000 (0xf830)
   *   rx = 32767 (0x7fff)
   *   ry = -32768 (0x8000)
   *   lt = 128 (0x80)
   *   rt = 255 (0xff)
   *   flags = 0 (0x0000)
   *
   * Exact 24 bytes (little-endian hex):
   * 01 01 2a 00 a8 66 14 00 05 08 00 00 e8 03 30 f8 ff 7f 00 80 80 ff 00 00
   */
  STATE_HEX: '01012a00a866140005080000e80330f8ff7f008080ff0000',

  /**
   * Known Pairing Key (32 bytes):
   * 00 01 02 ... 1f
   */
  PAIRING_KEY_HEX:
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',

  /**
   * Known Salts (8 bytes each):
   */
  PHONE_SALT_HEX: '0102030405060708',
  PC_SALT_HEX: '090a0b0c0d0e0f10',

  /**
   * Expected HKDF-SHA256 Derived Session Key (32 bytes):
   * HKDF(ikm=PAIRING_KEY, salt=PHONE_SALT||PC_SALT, info="padly-session-v1", 32)
   */
  SESSION_KEY_HEX:
    '81e34750bd9672319e2ea8e16f4a5e6c7c2498e24c78441ac8447ee91d76aee2',
};

// Helper: Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Helper: Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('Padly Protocol Codec', () => {
  test('Known-byte test vector: STATE packet matches exact hex string', () => {
    const stateMsg: StateMessage = {
      ver: 1,
      type: MessageType.STATE,
      seq: 42,
      ts: 1337000,
      buttons: BUTTON_BITS.A | BUTTON_BITS.X | BUTTON_BITS.UP, // 2053
      lx: 1000,
      ly: -2000,
      rx: 32767,
      ry: -32768,
      lt: 128,
      rt: 255,
      flags: 0,
    };

    const encoded = encodeInner(stateMsg);
    const hex = bytesToHex(encoded);

    expect(hex).toBe(TEST_VECTORS.STATE_HEX);

    // Decode from raw known-byte hex string
    const decoded = decodeInner(hexToBytes(TEST_VECTORS.STATE_HEX));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value).toEqual(stateMsg);
    }
  });

  test('Round-trip every message type', () => {
    // 1. STATE
    const state: StateMessage = {
      type: MessageType.STATE,
      seq: 101,
      ts: 9876543,
      buttons: BUTTON_BITS.B | BUTTON_BITS.RB | BUTTON_BITS.START,
      lx: -15000,
      ly: 25000,
      rx: 0,
      ry: 0,
      lt: 0,
      rt: 200,
      flags: 0,
    };
    const decState = decodeInner(encodeInner(state));
    expect(decState.ok).toBe(true);
    expect(decState.value).toEqual({ ...state, ver: 1, flags: 0 });

    // 2. PING
    const ping: PingMessage = {
      type: MessageType.PING,
      seq: 55,
      ts: 123456,
    };
    const decPing = decodeInner(encodeInner(ping));
    expect(decPing.ok).toBe(true);
    expect(decPing.value).toEqual({ ...ping, ver: 1 });

    // 3. PONG
    const pong: PongMessage = {
      type: MessageType.PONG,
      seq: 56,
      ts: 123500,
      echoed_seq: 55,
      echoed_ts: 123456,
    };
    const decPong = decodeInner(encodeInner(pong));
    expect(decPong.ok).toBe(true);
    expect(decPong.value).toEqual({ ...pong, ver: 1 });

    // 4. HELLO
    const hello: HelloMessage = {
      type: MessageType.HELLO,
      seq: 1,
      ts: 100,
      phone_salt: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      name: 'Pixel-Gamepad',
    };
    const decHello = decodeInner(encodeInner(hello));
    expect(decHello.ok).toBe(true);
    expect(decHello.value).toEqual({ ...hello, ver: 1 });

    // 5. HELLO_ACK
    const helloAck: HelloAckMessage = {
      type: MessageType.HELLO_ACK,
      seq: 1,
      ts: 110,
      pc_salt: new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]),
      accepted: 1,
      target: 0, // xbox
      pc_name: 'Gaming-Rig-PC',
    };
    const decHelloAck = decodeInner(encodeInner(helloAck));
    expect(decHelloAck.ok).toBe(true);
    expect(decHelloAck.value).toEqual({ ...helloAck, ver: 1 });

    // 6. RUMBLE
    const rumble: RumbleMessage = {
      type: MessageType.RUMBLE,
      seq: 200,
      ts: 500000,
      strong: 200,
      weak: 50,
      duration_ms: 150,
    };
    const decRumble = decodeInner(encodeInner(rumble));
    expect(decRumble.ok).toBe(true);
    expect(decRumble.value).toEqual({ ...rumble, ver: 1 });

    // 7. BYE
    const bye: ByeMessage = {
      type: MessageType.BYE,
      seq: 999,
      ts: 9999999,
    };
    const decBye = decodeInner(encodeInner(bye));
    expect(decBye.ok).toBe(true);
    expect(decBye.value).toEqual({ ...bye, ver: 1 });
  });

  test('Rejects invalid versions and lengths with typed CodecError', () => {
    // Too short header (< 8 bytes)
    const tooShort = decodeInner(new Uint8Array([1, 1, 0]));
    expect(tooShort.ok).toBe(false);
    expect(tooShort.error?.code).toBe('INVALID_LENGTH');

    // Wrong version (ver = 2, expected 1)
    const wrongVer = new Uint8Array(8);
    wrongVer[0] = 2; // ver
    wrongVer[1] = MessageType.PING;
    const resVer = decodeInner(wrongVer);
    expect(resVer.ok).toBe(false);
    expect(resVer.error?.code).toBe('INVALID_VERSION');

    // Wrong STATE payload length (20 bytes instead of 24)
    const truncatedState = new Uint8Array(20);
    truncatedState[0] = 1;
    truncatedState[1] = MessageType.STATE;
    const resState = decodeInner(truncatedState);
    expect(resState.ok).toBe(false);
    expect(resState.error?.code).toBe('INVALID_LENGTH');

    // Unknown message type 0x99
    const unknownType = new Uint8Array(8);
    unknownType[0] = 1;
    unknownType[1] = 0x99;
    const resUnknown = decodeInner(unknownType);
    expect(resUnknown.ok).toBe(false);
    expect(resUnknown.error?.code).toBe('UNKNOWN_TYPE');
  });
});

describe('Padly Cryptography & SessionCipher', () => {
  const pairingKey = hexToBytes(TEST_VECTORS.PAIRING_KEY_HEX);
  const phoneSalt = hexToBytes(TEST_VECTORS.PHONE_SALT_HEX);
  const pcSalt = hexToBytes(TEST_VECTORS.PC_SALT_HEX);

  test('Session key derivation matches HKDF test vector', () => {
    const derived = deriveSessionKey(pairingKey, phoneSalt, pcSalt);
    expect(bytesToHex(derived)).toBe(TEST_VECTORS.SESSION_KEY_HEX);
  });

  test('Handshake encrypt/decrypt round-trip', () => {
    const hello: HelloMessage = {
      type: MessageType.HELLO,
      seq: 1,
      ts: 1000,
      phone_salt: phoneSalt,
      name: 'Phone1',
    };
    const inner = encodeInner(hello);

    const wire = encryptHandshake(inner, pairingKey);
    expect(wire[0]).toBe(0x01); // Handshake wire prefix
    expect(wire.length).toBe(1 + 12 + inner.length + 16);

    const decrypted = decryptHandshake(wire, pairingKey);
    expect(decrypted).not.toBeNull();
    expect(decrypted).toEqual(inner);

    const decoded = decodeInner(decrypted!);
    expect(decoded.ok).toBe(true);
    expect(decoded.value).toEqual({ ...hello, ver: 1 });
  });

  test('Handshake rejects wrong pairing key or tampered wire', () => {
    const inner = new TextEncoder().encode('handshake payload');
    const wire = encryptHandshake(inner, pairingKey);

    // Wrong pairing key
    const wrongKey = new Uint8Array(32);
    wrongKey[0] = 0xff;
    expect(decryptHandshake(wire, wrongKey)).toBeNull();

    // Tampered wire byte
    const tampered = new Uint8Array(wire);
    tampered[14] ^= 0x01; // flip a bit in ciphertext
    expect(decryptHandshake(tampered, pairingKey)).toBeNull();
  });

  test('SessionCipher seal and open round-trip', () => {
    const sessionKey = deriveSessionKey(pairingKey, phoneSalt, pcSalt);

    const phoneSender = new SessionCipher(sessionKey, { direction: 'phone' });
    const pcReceiver = new SessionCipher(sessionKey, { direction: 'pc' });

    const statePayload = encodeInner({
      type: MessageType.STATE,
      seq: 1,
      ts: 500,
      buttons: BUTTON_BITS.A,
      lx: 100,
      ly: -100,
      rx: 0,
      ry: 0,
      lt: 0,
      rt: 0,
      flags: 0,
    });

    const wire = phoneSender.seal(statePayload);
    expect(wire[0]).toBe(0x02); // Session frame prefix

    const opened = pcReceiver.open(wire);
    expect(opened).not.toBeNull();
    expect(opened).toEqual(statePayload);
  });

  test('Replay attack rejection: counter must strictly increment', () => {
    const sessionKey = deriveSessionKey(pairingKey, phoneSalt, pcSalt);
    const sender = new SessionCipher(sessionKey, { direction: 'phone' });
    const receiver = new SessionCipher(sessionKey, { direction: 'pc' });

    const msgA = new TextEncoder().encode('frame0');
    const msgB = new TextEncoder().encode('frame1');
    const msgC = new TextEncoder().encode('frame2');

    const wire0 = sender.seal(msgA); // counter 0
    const wire1 = sender.seal(msgB); // counter 1
    const wire2 = sender.seal(msgC); // counter 2

    // 1. In-order reception succeeds
    expect(receiver.open(wire0)).toEqual(msgA);
    expect(receiver.open(wire1)).toEqual(msgB);

    // 2. Replayed frame 1 (duplicate) is rejected
    expect(receiver.open(wire1)).toBeNull();

    // 3. Old frame 0 is rejected
    expect(receiver.open(wire0)).toBeNull();

    // 4. Newer frame 2 is accepted
    expect(receiver.open(wire2)).toEqual(msgC);

    // 5. Subsequent attempt to replay frame 2 is rejected
    expect(receiver.open(wire2)).toBeNull();
  });

  test('Tampered session frame rejection', () => {
    const sessionKey = deriveSessionKey(pairingKey, phoneSalt, pcSalt);
    const sender = new SessionCipher(sessionKey, { direction: 'phone' });
    const receiver = new SessionCipher(sessionKey, { direction: 'pc' });

    const wire = sender.seal(new Uint8Array([1, 2, 3, 4]));

    // Tamper counter in header (AAD mismatch)
    const tamperedHeader = new Uint8Array(wire);
    tamperedHeader[1] ^= 0x01;
    expect(receiver.open(tamperedHeader)).toBeNull();

    // Tamper ciphertext byte
    const tamperedCiphertext = new Uint8Array(wire);
    tamperedCiphertext[7] ^= 0x01;
    expect(receiver.open(tamperedCiphertext)).toBeNull();

    // Tamper Poly1305 authentication tag
    const tamperedTag = new Uint8Array(wire);
    tamperedTag[tamperedTag.length - 1] ^= 0x01;
    expect(receiver.open(tamperedTag)).toBeNull();
  });

  test('Session nonce construction matches spec', () => {
    // Nonce (12 bytes) = direction u8 (0 phone->PC, 1 PC->phone) | 0,0,0 | counter u32 | 0,0,0,0
    const nonce = buildSessionNonce(0, 0x12345678);
    expect(nonce.length).toBe(12);
    expect(nonce[0]).toBe(0); // direction
    expect(nonce[1]).toBe(0);
    expect(nonce[2]).toBe(0);
    expect(nonce[3]).toBe(0);
    // counter 0x12345678 in little-endian: 78 56 34 12
    expect(nonce[4]).toBe(0x78);
    expect(nonce[5]).toBe(0x56);
    expect(nonce[6]).toBe(0x34);
    expect(nonce[7]).toBe(0x12);
    // remaining 4 bytes 0
    expect(nonce[8]).toBe(0);
    expect(nonce[9]).toBe(0);
    expect(nonce[10]).toBe(0);
    expect(nonce[11]).toBe(0);
  });
});

describe('Axis Conversion & StateAggregator', () => {
  test('Stick conversion edge cases: -1, 0, 1, and evdev UP negative convention', () => {
    // X Axis:
    expect(scaleStickX(0)).toBe(0);
    expect(scaleStickX(1.0)).toBe(32767);
    expect(scaleStickX(-1.0)).toBe(-32768);
    expect(scaleStickX(0.5)).toBe(16384);
    expect(scaleStickX(-0.5)).toBe(-16384);

    // Y Axis (Pushing UP is +1.0 in app, maps to NEGATIVE in evdev):
    expect(scaleStickY(0)).toBe(0);
    // Pushing UP (+1.0) -> MUST be negative (-32768)
    expect(scaleStickY(1.0)).toBe(-32768);
    // Pushing DOWN (-1.0) -> MUST be positive (+32767)
    expect(scaleStickY(-1.0)).toBe(32767);
    // Partial up (0.5) -> negative
    expect(scaleStickY(0.5)).toBe(-16384);
    // Partial down (-0.5) -> positive
    expect(scaleStickY(-0.5)).toBe(16384);

    // Triggers: [0, 1] -> [0, 255]
    expect(scaleTrigger(0)).toBe(0);
    expect(scaleTrigger(1.0)).toBe(255);
    expect(scaleTrigger(0.5)).toBe(128);
  });

  test('StateAggregator tracks inputBus events and notifies onChange listeners', () => {
    const aggregator = new StateAggregator();
    aggregator.resetState();

    const history: any[] = [];
    const unsub = aggregator.onChange((st) => {
      history.push({ ...st });
    });

    // 1. Press Button A
    emit('button', { id: 'A', pressed: true });
    expect(aggregator.getState().buttons & BUTTON_BITS.A).toBe(BUTTON_BITS.A);

    // 2. Press Button X simultaneously
    emit('button', { id: 'X', pressed: true });
    expect(aggregator.getState().buttons & (BUTTON_BITS.A | BUTTON_BITS.X)).toBe(
      BUTTON_BITS.A | BUTTON_BITS.X
    );

    // 3. Move Left Stick UP (app y = 1.0) and RIGHT (app x = 1.0)
    emit('stick', { id: 'left', x: 1.0, y: 1.0 });
    const current = aggregator.getState();
    expect(current.lx).toBe(32767);
    expect(current.ly).toBe(-32768); // Evdev convention: UP is negative

    // 4. Press Right Trigger RT to 50%
    emit('trigger', { id: 'RT', value: 0.5 });
    expect(aggregator.getState().rt).toBe(128);

    // 5. Release Button A
    emit('button', { id: 'A', pressed: false });
    expect(aggregator.getState().buttons & BUTTON_BITS.A).toBe(0);
    expect(aggregator.getState().buttons & BUTTON_BITS.X).toBe(BUTTON_BITS.X);

    expect(history.length).toBeGreaterThanOrEqual(5);

    unsub();
    aggregator.stop();
  });
});

/**
 * Padly Protocol v1 Cryptography
 * Implements ChaCha20-Poly1305 encryption, HKDF session key derivation,
 * and SessionCipher per PROTOCOL.md.
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';

let expoCrypto: typeof import('expo-crypto') | null = null;
try {
  expoCrypto = require('expo-crypto');
} catch {
  // Fallback for non-native / Node test runner environments
}

export const HANDSHAKE_FRAME_TYPE = 0x01;
export const SESSION_FRAME_TYPE = 0x02;
export const POLY1305_TAG_LENGTH = 16;
export const NONCE_LENGTH = 12;
export const PAIRING_KEY_LENGTH = 32;
export const SESSION_KEY_LENGTH = 32;
export const SALT_LENGTH = 8;
export const SESSION_INFO_STRING = 'padly-session-v1';

const sessionInfoBytes = new TextEncoder().encode(SESSION_INFO_STRING);
const handshakeAad = new Uint8Array([HANDSHAKE_FRAME_TYPE]);

/**
 * Generates cryptographically secure random bytes using expo-crypto,
 * with WebCrypto / Node fallback for non-native test environments.
 */
export function generateSecureRandomBytes(byteCount: number): Uint8Array {
  if (expoCrypto && typeof expoCrypto.getRandomBytes === 'function') {
    try {
      return expoCrypto.getRandomBytes(byteCount);
    } catch {
      // Fallback
    }
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const arr = new Uint8Array(byteCount);
    globalThis.crypto.getRandomValues(arr);
    return arr;
  }

  const arr = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

/**
 * Encrypts an inner handshake message (HELLO / HELLO_ACK) for transmission on the wire.
 * Wire format: 0x01 | nonce (12 random bytes) | ciphertext+tag
 * Key = pairing_key (32 bytes), AAD = [0x01]
 */
export function encryptHandshake(
  inner: Uint8Array,
  pairingKey: Uint8Array,
  nonceOverride?: Uint8Array
): Uint8Array {
  if (pairingKey.length !== PAIRING_KEY_LENGTH) {
    throw new Error(`Invalid pairing key length: expected 32, got ${pairingKey.length}`);
  }

  const nonce = nonceOverride ?? generateSecureRandomBytes(NONCE_LENGTH);
  if (nonce.length !== NONCE_LENGTH) {
    throw new Error(`Invalid nonce length: expected 12, got ${nonce.length}`);
  }

  const cipher = chacha20poly1305(pairingKey, nonce, handshakeAad);
  const ciphertext = cipher.encrypt(inner);

  const wire = new Uint8Array(1 + NONCE_LENGTH + ciphertext.length);
  wire[0] = HANDSHAKE_FRAME_TYPE;
  wire.set(nonce, 1);
  wire.set(ciphertext, 1 + NONCE_LENGTH);

  return wire;
}

/**
 * Decrypts a wire handshake frame.
 * Checks AAD, extracts nonce, decrypts with pairing_key.
 * Returns decrypted inner bytes or null if verification fails.
 */
export function decryptHandshake(
  wire: Uint8Array,
  pairingKey: Uint8Array
): Uint8Array | null {
  if (wire.length < 1 + NONCE_LENGTH + POLY1305_TAG_LENGTH) {
    return null;
  }
  if (wire[0] !== HANDSHAKE_FRAME_TYPE) {
    return null;
  }
  if (pairingKey.length !== PAIRING_KEY_LENGTH) {
    return null;
  }

  const nonce = wire.subarray(1, 1 + NONCE_LENGTH);
  const ciphertext = wire.subarray(1 + NONCE_LENGTH);

  try {
    const cipher = chacha20poly1305(pairingKey, nonce, handshakeAad);
    return cipher.decrypt(ciphertext);
  } catch {
    return null;
  }
}

/**
 * Derives a 32-byte session key from pairing_key and salts.
 * Session key = HKDF-SHA256(ikm=pairing_key, salt=phone_salt||pc_salt, info="padly-session-v1", 32 bytes)
 */
export function deriveSessionKey(
  pairingKey: Uint8Array,
  phoneSalt: Uint8Array,
  pcSalt: Uint8Array
): Uint8Array {
  if (pairingKey.length !== PAIRING_KEY_LENGTH) {
    throw new Error(`Invalid pairing key length: expected 32, got ${pairingKey.length}`);
  }
  if (phoneSalt.length !== SALT_LENGTH) {
    throw new Error(`Invalid phone_salt length: expected 8, got ${phoneSalt.length}`);
  }
  if (pcSalt.length !== SALT_LENGTH) {
    throw new Error(`Invalid pc_salt length: expected 8, got ${pcSalt.length}`);
  }

  const salt = new Uint8Array(16);
  salt.set(phoneSalt, 0);
  salt.set(pcSalt, 8);

  return hkdf(sha256, pairingKey, salt, sessionInfoBytes, SESSION_KEY_LENGTH);
}

/**
 * Constructs a 12-byte nonce for session frames:
 * direction u8 (0 phone->PC, 1 PC->phone) | 0,0,0 | counter u32 (LE) | 0,0,0,0
 */
export function buildSessionNonce(direction: number, counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce[0] = direction & 0xff;
  // bytes 1..3 are 0
  const view = new DataView(nonce.buffer, nonce.byteOffset, 12);
  view.setUint32(4, counter >>> 0, true); // little-endian u32
  // bytes 8..11 are 0
  return nonce;
}

export interface SessionCipherOptions {
  /**
   * 'phone': sends as direction 0, receives as direction 1 (default)
   * 'pc': sends as direction 1, receives as direction 0
   */
  direction?: 'phone' | 'pc';
  /** Optional custom initial send counter (default: 0) */
  initialSendCounter?: number;
}

/**
 * SessionCipher manages stateful encryption, counter management, and replay rejection
 * for active Padly protocol sessions.
 */
export class SessionCipher {
  private sendCounter: number;
  private lastAcceptedCounter: number | null = null;
  private readonly sendDirection: number;
  private readonly recvDirection: number;

  constructor(
    private readonly sessionKey: Uint8Array,
    options: SessionCipherOptions = {}
  ) {
    if (sessionKey.length !== SESSION_KEY_LENGTH) {
      throw new Error(`Invalid session key length: expected 32, got ${sessionKey.length}`);
    }

    const isPhone = (options.direction ?? 'phone') === 'phone';
    this.sendDirection = isPhone ? 0 : 1;
    this.recvDirection = isPhone ? 1 : 0;
    this.sendCounter = options.initialSendCounter ?? 0;
  }

  /** Current outgoing counter */
  public getSendCounter(): number {
    return this.sendCounter;
  }

  /** Highest accepted incoming counter */
  public getLastAcceptedCounter(): number | null {
    return this.lastAcceptedCounter;
  }

  /**
   * Seals an inner message into a wire frame.
   * Wire format: 0x02 | counter u32 (LE) | ciphertext+tag
   * Nonce (12 bytes): direction u8 | 0,0,0 | counter u32 (LE) | 0,0,0,0
   * AAD = first 5 bytes of wire
   * Increments the send counter.
   */
  public seal(inner: Uint8Array): Uint8Array {
    const counter = this.sendCounter >>> 0;
    this.sendCounter = (this.sendCounter + 1) >>> 0;

    // First 5 bytes: 0x02 | counter u32 LE
    const header = new Uint8Array(5);
    header[0] = SESSION_FRAME_TYPE;
    const view = new DataView(header.buffer, header.byteOffset, 5);
    view.setUint32(1, counter, true);

    const nonce = buildSessionNonce(this.sendDirection, counter);
    const cipher = chacha20poly1305(this.sessionKey, nonce, header);
    const ciphertext = cipher.encrypt(inner);

    const wire = new Uint8Array(5 + ciphertext.length);
    wire.set(header, 0);
    wire.set(ciphertext, 5);

    return wire;
  }

  /**
   * Opens an incoming wire frame.
   * Verifies frame type (0x02), strictly enforces replay protection (counter > lastAcceptedCounter),
   * verifies Poly1305 authentication tag using AAD and session key.
   *
   * Returns decrypted inner plaintext, or null if tampered, replayed, or invalid.
   */
  public open(wire: Uint8Array): Uint8Array | null {
    if (wire.length < 5 + POLY1305_TAG_LENGTH) {
      return null;
    }
    if (wire[0] !== SESSION_FRAME_TYPE) {
      return null;
    }

    const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
    const counter = view.getUint32(1, true);

    // Replay rejection: The receiver drops any frame whose counter is not greater than the last accepted one.
    if (this.lastAcceptedCounter !== null && counter <= this.lastAcceptedCounter) {
      return null;
    }

    const aad = wire.subarray(0, 5);
    const ciphertext = wire.subarray(5);
    const nonce = buildSessionNonce(this.recvDirection, counter);

    try {
      const cipher = chacha20poly1305(this.sessionKey, nonce, aad);
      const plaintext = cipher.decrypt(ciphertext);

      // On successful authentication and decryption, advance the accepted counter
      this.lastAcceptedCounter = counter;
      return plaintext;
    } catch {
      // Decryption or tag verification failed: drop without updating counter
      return null;
    }
  }
}

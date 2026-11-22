/**
 * Padly Protocol v1 Codec
 * Implements inner message encoding and decoding according to PROTOCOL.md.
 * All integers are serialized as little-endian using DataView.
 */

export const PROTOCOL_VERSION = 1;

export enum MessageType {
  STATE = 0x01,
  PING = 0x02,
  PONG = 0x03,
  HELLO = 0x10,
  HELLO_ACK = 0x11,
  RUMBLE = 0x20,
  BYE = 0x30,
}

export type CodecErrorCode =
  | 'INVALID_LENGTH'
  | 'INVALID_VERSION'
  | 'UNKNOWN_TYPE'
  | 'CORRUPT_PAYLOAD';

export class CodecError extends Error {
  constructor(
    message: string,
    public readonly code: CodecErrorCode
  ) {
    super(message);
    this.name = 'CodecError';
  }
}

export type DecodeResult<T = InnerMessage> =
  | { ok: true; value: T; error?: undefined }
  | { ok: false; value?: undefined; error: CodecError };

export interface BaseHeader {
  ver?: number; // Defaults to PROTOCOL_VERSION (=1)
  seq: number; // u16
  ts: number; // u32 (sender ms, wraps)
}

export interface StateMessage extends BaseHeader {
  type: MessageType.STATE;
  buttons: number; // u32
  lx: number; // i16 (-32768..32767)
  ly: number; // i16 (-32768..32767, up is NEGATIVE y)
  rx: number; // i16 (-32768..32767)
  ry: number; // i16 (-32768..32767, up is NEGATIVE y)
  lt: number; // u8 (0..255)
  rt: number; // u8 (0..255)
  flags?: number; // u16 (reserved, 0)
}

export interface PingMessage extends BaseHeader {
  type: MessageType.PING;
}

export interface PongMessage extends BaseHeader {
  type: MessageType.PONG;
  echoed_seq: number; // u16
  echoed_ts: number; // u32
}

export interface HelloMessage extends BaseHeader {
  type: MessageType.HELLO;
  phone_salt: Uint8Array; // 8 bytes
  name: string; // UTF-8 string
}

export interface HelloAckMessage extends BaseHeader {
  type: MessageType.HELLO_ACK;
  pc_salt: Uint8Array; // 8 bytes
  accepted: number; // u8 (1 = accepted, 0 = rejected)
  target: number; // u8 (0 = xbox, 1 = ds4)
  pc_name: string; // UTF-8 string
}

export interface RumbleMessage extends BaseHeader {
  type: MessageType.RUMBLE;
  strong: number; // u8 (0..255)
  weak: number; // u8 (0..255)
  duration_ms: number; // u16
}

export interface ByeMessage extends BaseHeader {
  type: MessageType.BYE;
}

export type InnerMessage =
  | StateMessage
  | PingMessage
  | PongMessage
  | HelloMessage
  | HelloAckMessage
  | RumbleMessage
  | ByeMessage;

// Text encoder / decoder for UTF-8 string fields
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Encodes an InnerMessage into wire bytes (Uint8Array) before encryption.
 * Header (8 bytes): ver u8 (=1) | type u8 | seq u16 | ts u32 (little-endian)
 */
export function encodeInner(msg: InnerMessage): Uint8Array {
  const ver = msg.ver ?? PROTOCOL_VERSION;
  const seq = msg.seq & 0xffff;
  const ts = msg.ts >>> 0;

  switch (msg.type) {
    case MessageType.STATE: {
      // 8-byte header + 16-byte payload = 24 bytes
      const buf = new Uint8Array(24);
      const view = new DataView(buf.buffer, buf.byteOffset, 24);

      view.setUint8(0, ver);
      view.setUint8(1, MessageType.STATE);
      view.setUint16(2, seq, true);
      view.setUint32(4, ts, true);

      view.setUint32(8, msg.buttons >>> 0, true);
      view.setInt16(12, msg.lx, true);
      view.setInt16(14, msg.ly, true);
      view.setInt16(16, msg.rx, true);
      view.setInt16(18, msg.ry, true);
      view.setUint8(20, msg.lt & 0xff);
      view.setUint8(21, msg.rt & 0xff);
      view.setUint16(22, (msg.flags ?? 0) & 0xffff, true);

      return buf;
    }

    case MessageType.PING: {
      // 8-byte header only
      const buf = new Uint8Array(8);
      const view = new DataView(buf.buffer, buf.byteOffset, 8);

      view.setUint8(0, ver);
      view.setUint8(1, MessageType.PING);
      view.setUint16(2, seq, true);
      view.setUint32(4, ts, true);

      return buf;
    }

    case MessageType.PONG: {
      // 8-byte header + 6-byte payload = 14 bytes
      const buf = new Uint8Array(14);
      const view = new DataView(buf.buffer, buf.byteOffset, 14);

      view.setUint8(0, ver);
      view.setUint8(1, MessageType.PONG);
      view.setUint16(2, seq, true);
      view.setUint32(4, ts, true);

      view.setUint16(8, msg.echoed_seq & 0xffff, true);
      view.setUint32(10, msg.echoed_ts >>> 0, true);

      return buf;
    }

    case MessageType.HELLO: {
      const nameBytes = textEncoder.encode(msg.name);
      if (nameBytes.length > 255) {
        throw new CodecError('HELLO name exceeds 255 bytes', 'CORRUPT_PAYLOAD');
      }
      if (msg.phone_salt.length !== 8) {
        throw new CodecError('phone_salt must be exactly 8 bytes', 'CORRUPT_PAYLOAD');
      }

      // 8 header + 8 salt + 1 name_len + name_len bytes
      const totalLen = 17 + nameBytes.length;
      const buf = new Uint8Array(totalLen);
      const view = new DataView(buf.buffer, buf.byteOffset, totalLen);

      view.setUint8(0, ver);
      view.setUint8(1, MessageType.HELLO);
      view.setUint16(2, seq, true);
      view.setUint32(4, ts, true);

      buf.set(msg.phone_salt, 8);
      view.setUint8(16, nameBytes.length);
      buf.set(nameBytes, 17);

      return buf;
    }

    case MessageType.HELLO_ACK: {
      const pcNameBytes = textEncoder.encode(msg.pc_name);
      if (pcNameBytes.length > 255) {
        throw new CodecError('pc_name exceeds 255 bytes', 'CORRUPT_PAYLOAD');
      }
      if (msg.pc_salt.length !== 8) {
        throw new CodecError('pc_salt must be exactly 8 bytes', 'CORRUPT_PAYLOAD');
      }

      // 8 header + 8 pc_salt + 1 accepted + 1 target + 1 pc_name_len + name_len bytes
      const totalLen = 19 + pcNameBytes.length;
      const buf = new Uint8Array(totalLen);
      const view = new DataView(buf.buffer, buf.byteOffset, totalLen);

      view.setUint8(0, ver);
      view.setUint8(1, MessageType.HELLO_ACK);
      view.setUint16(2, seq, true);
      view.setUint32(4, ts, true);

      buf.set(msg.pc_salt, 8);
      view.setUint8(16, msg.accepted & 0xff);
      view.setUint8(17, msg.target & 0xff);
      view.setUint8(18, pcNameBytes.length);
      buf.set(pcNameBytes, 19);

      return buf;
    }

    case MessageType.RUMBLE: {
      // 8 header + 4 payload = 12 bytes
      const buf = new Uint8Array(12);
      const view = new DataView(buf.buffer, buf.byteOffset, 12);

      view.setUint8(0, ver);
      view.setUint8(1, MessageType.RUMBLE);
      view.setUint16(2, seq, true);
      view.setUint32(4, ts, true);

      view.setUint8(8, msg.strong & 0xff);
      view.setUint8(9, msg.weak & 0xff);
      view.setUint16(10, msg.duration_ms & 0xffff, true);

      return buf;
    }

    case MessageType.BYE: {
      // 8-byte header only
      const buf = new Uint8Array(8);
      const view = new DataView(buf.buffer, buf.byteOffset, 8);

      view.setUint8(0, ver);
      view.setUint8(1, MessageType.BYE);
      view.setUint16(2, seq, true);
      view.setUint32(4, ts, true);

      return buf;
    }

    default: {
      const exhaustiveCheck: never = msg;
      throw new CodecError(
        `Unknown message type: ${(exhaustiveCheck as any)?.type}`,
        'UNKNOWN_TYPE'
      );
    }
  }
}

/**
 * Decodes wire bytes into an InnerMessage object.
 * Validates version and payload lengths, returning a typed Result object.
 * Never throws uncaught exceptions.
 */
export function decodeInner(bytes: Uint8Array): DecodeResult<InnerMessage> {
  if (!bytes || bytes.length < 8) {
    return {
      ok: false,
      error: new CodecError(
        `Message too short: received ${bytes?.length ?? 0} bytes, expected at least 8`,
        'INVALID_LENGTH'
      ),
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const ver = view.getUint8(0);
  if (ver !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: new CodecError(
        `Unsupported protocol version: ${ver}, expected ${PROTOCOL_VERSION}`,
        'INVALID_VERSION'
      ),
    };
  }

  const type = view.getUint8(1);
  const seq = view.getUint16(2, true);
  const ts = view.getUint32(4, true);

  switch (type) {
    case MessageType.STATE: {
      if (bytes.length !== 24) {
        return {
          ok: false,
          error: new CodecError(
            `Invalid STATE length: received ${bytes.length} bytes, expected 24`,
            'INVALID_LENGTH'
          ),
        };
      }

      const buttons = view.getUint32(8, true);
      const lx = view.getInt16(12, true);
      const ly = view.getInt16(14, true);
      const rx = view.getInt16(16, true);
      const ry = view.getInt16(18, true);
      const lt = view.getUint8(20);
      const rt = view.getUint8(21);
      const flags = view.getUint16(22, true);

      return {
        ok: true,
        value: {
          ver,
          type: MessageType.STATE,
          seq,
          ts,
          buttons,
          lx,
          ly,
          rx,
          ry,
          lt,
          rt,
          flags,
        },
      };
    }

    case MessageType.PING: {
      if (bytes.length !== 8) {
        return {
          ok: false,
          error: new CodecError(
            `Invalid PING length: received ${bytes.length} bytes, expected 8`,
            'INVALID_LENGTH'
          ),
        };
      }

      return {
        ok: true,
        value: {
          ver,
          type: MessageType.PING,
          seq,
          ts,
        },
      };
    }

    case MessageType.PONG: {
      if (bytes.length !== 14) {
        return {
          ok: false,
          error: new CodecError(
            `Invalid PONG length: received ${bytes.length} bytes, expected 14`,
            'INVALID_LENGTH'
          ),
        };
      }

      const echoed_seq = view.getUint16(8, true);
      const echoed_ts = view.getUint32(10, true);

      return {
        ok: true,
        value: {
          ver,
          type: MessageType.PONG,
          seq,
          ts,
          echoed_seq,
          echoed_ts,
        },
      };
    }

    case MessageType.HELLO: {
      if (bytes.length < 17) {
        return {
          ok: false,
          error: new CodecError(
            `Invalid HELLO length: received ${bytes.length} bytes, expected at least 17`,
            'INVALID_LENGTH'
          ),
        };
      }

      const nameLen = view.getUint8(16);
      const expectedTotal = 17 + nameLen;
      if (bytes.length !== expectedTotal) {
        return {
          ok: false,
          error: new CodecError(
            `Invalid HELLO length: received ${bytes.length} bytes, expected ${expectedTotal}`,
            'INVALID_LENGTH'
          ),
        };
      }

      const phone_salt = bytes.slice(8, 16);
      const name = textDecoder.decode(bytes.subarray(17, 17 + nameLen));

      return {
        ok: true,
        value: {
          ver,
          type: MessageType.HELLO,
          seq,
          ts,
          phone_salt,
          name,
        },
      };
    }

    case MessageType.HELLO_ACK: {
      if (bytes.length < 19) {
        return {
          ok: false,
          error: new CodecError(
            `Invalid HELLO_ACK length: received ${bytes.length} bytes, expected at least 19`,
            'INVALID_LENGTH'
          ),
        };
      }

      const accepted = view.getUint8(16);
      const target = view.getUint8(17);
      const pcNameLen = view.getUint8(18);
      const expectedTotal = 19 + pcNameLen;
      if (bytes.length !== expectedTotal) {
        return {
          ok: false,
          error: new CodecError(
            `Invalid HELLO_ACK length: received ${bytes.length} bytes, expected ${expectedTotal}`,
            'INVALID_LENGTH'
          ),
        };
      }

      const pc_salt = bytes.slice(8, 16);
      const pc_name = textDecoder.decode(bytes.subarray(19, 19 + pcNameLen));

      return {
        ok: true,
        value: {
          ver,
          type: MessageType.HELLO_ACK,
          seq,
          ts,
          pc_salt,
          accepted,
          target,
          pc_name,
        },
      };
    }

    case MessageType.RUMBLE: {
      if (bytes.length !== 12) {
        return {
          ok: false,
          error: new CodecError(
            `Invalid RUMBLE length: received ${bytes.length} bytes, expected 12`,
            'INVALID_LENGTH'
          ),
        };
      }

      const strong = view.getUint8(8);
      const weak = view.getUint8(9);
      const duration_ms = view.getUint16(10, true);

      return {
        ok: true,
        value: {
          ver,
          type: MessageType.RUMBLE,
          seq,
          ts,
          strong,
          weak,
          duration_ms,
        },
      };
    }

    case MessageType.BYE: {
      if (bytes.length !== 8) {
        return {
          ok: false,
          error: new CodecError(
            `Invalid BYE length: received ${bytes.length} bytes, expected 8`,
            'INVALID_LENGTH'
          ),
        };
      }

      return {
        ok: true,
        value: {
          ver,
          type: MessageType.BYE,
          seq,
          ts,
        },
      };
    }

    default:
      return {
        ok: false,
        error: new CodecError(
          `Unknown message type: 0x${type.toString(16).padStart(2, '0')}`,
          'UNKNOWN_TYPE'
        ),
      };
  }
}

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  StreamFrameParser,
  encodeStreamFrame,
  MAX_FRAME_LENGTH,
} from '../net/StreamFrameParser';

describe('StreamFrameParser & Length-Prefixed Framing (PROTOCOL.md)', () => {
  let parser: StreamFrameParser;

  beforeEach(() => {
    parser = new StreamFrameParser();
  });

  describe('encodeStreamFrame', () => {
    it('encodes u16 length prefix in little-endian format', () => {
      const payload = new Uint8Array([0x10, 0x20, 0x30, 0x40]); // 4 bytes
      const encoded = encodeStreamFrame(payload);

      expect(encoded.length).toBe(6);
      expect(encoded[0]).toBe(4); // LSB
      expect(encoded[1]).toBe(0); // MSB
      expect(encoded.slice(2)).toEqual(payload);
    });

    it('correctly encodes frames with length > 255', () => {
      const payload = new Uint8Array(300).fill(0xaa);
      const encoded = encodeStreamFrame(payload);

      expect(encoded.length).toBe(302);
      expect(encoded[0]).toBe(300 & 0xff); // 44
      expect(encoded[1]).toBe((300 >> 8) & 0xff); // 1
      expect(encoded.slice(2)).toEqual(payload);
    });
  });

  describe('StreamFrameParser single & complete frames', () => {
    it('parses a single complete frame in one chunk', () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5]);
      const chunk = encodeStreamFrame(payload);

      const frames = parser.push(chunk);
      expect(frames.length).toBe(1);
      expect(frames[0]).toEqual(payload);
      expect(parser.bufferedBytes).toBe(0);
    });

    it('returns empty array when fed an empty chunk', () => {
      const frames = parser.push(new Uint8Array(0));
      expect(frames).toEqual([]);
      expect(parser.bufferedBytes).toBe(0);
    });
  });

  describe('StreamFrameParser fragmented chunks', () => {
    it('handles fragmented header (1 byte + 1 byte) followed by payload', () => {
      const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const chunk = encodeStreamFrame(payload);

      // Feed byte 0 (first byte of u16 length)
      let frames = parser.push(chunk.slice(0, 1));
      expect(frames.length).toBe(0);
      expect(parser.bufferedBytes).toBe(1);

      // Feed byte 1 (second byte of u16 length)
      frames = parser.push(chunk.slice(1, 2));
      expect(frames.length).toBe(0);
      expect(parser.bufferedBytes).toBe(2);

      // Feed first part of payload
      frames = parser.push(chunk.slice(2, 4));
      expect(frames.length).toBe(0);
      expect(parser.bufferedBytes).toBe(4);

      // Feed remainder of payload
      frames = parser.push(chunk.slice(4));
      expect(frames.length).toBe(1);
      expect(frames[0]).toEqual(payload);
      expect(parser.bufferedBytes).toBe(0);
    });

    it('handles byte-by-byte streaming without dropping data', () => {
      const payload = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
      const chunk = encodeStreamFrame(payload);

      const receivedFrames: Uint8Array[] = [];
      for (let i = 0; i < chunk.length; i++) {
        const result = parser.push(new Uint8Array([chunk[i]]));
        if (result.length > 0) {
          receivedFrames.push(...result);
        }
      }

      expect(receivedFrames.length).toBe(1);
      expect(receivedFrames[0]).toEqual(payload);
      expect(parser.bufferedBytes).toBe(0);
    });
  });

  describe('StreamFrameParser coalesced chunks (multiple frames in one buffer)', () => {
    it('parses multiple complete frames coalesced into a single chunk', () => {
      const payloadA = new Uint8Array([1, 1, 1]);
      const payloadB = new Uint8Array([2, 2, 2, 2, 2]);
      const payloadC = new Uint8Array([3, 3]);

      const chunkA = encodeStreamFrame(payloadA);
      const chunkB = encodeStreamFrame(payloadB);
      const chunkC = encodeStreamFrame(payloadC);

      // Combine all into one single buffer
      const coalesced = new Uint8Array(chunkA.length + chunkB.length + chunkC.length);
      coalesced.set(chunkA, 0);
      coalesced.set(chunkB, chunkA.length);
      coalesced.set(chunkC, chunkA.length + chunkB.length);

      const frames = parser.push(coalesced);
      expect(frames.length).toBe(3);
      expect(frames[0]).toEqual(payloadA);
      expect(frames[1]).toEqual(payloadB);
      expect(frames[2]).toEqual(payloadC);
      expect(parser.bufferedBytes).toBe(0);
    });

    it('handles mixed coalesced and fragmented frames across boundaries', () => {
      const frame1 = new Uint8Array([0xaa, 0xbb]);
      const frame2 = new Uint8Array([0xcc, 0xdd, 0xee, 0xff]);

      const enc1 = encodeStreamFrame(frame1);
      const enc2 = encodeStreamFrame(frame2);

      const all = new Uint8Array(enc1.length + enc2.length);
      all.set(enc1, 0);
      all.set(enc2, enc1.length);

      // Cut in the middle of frame2's payload (e.g. at index 7)
      const chunk1 = all.slice(0, 7);
      const chunk2 = all.slice(7);

      const frames1 = parser.push(chunk1);
      // Chunk 1 has all of frame1 and part of frame2
      expect(frames1.length).toBe(1);
      expect(frames1[0]).toEqual(frame1);

      // Chunk 2 completes frame2
      const frames2 = parser.push(chunk2);
      expect(frames2.length).toBe(1);
      expect(frames2[0]).toEqual(frame2);
      expect(parser.bufferedBytes).toBe(0);
    });
  });

  describe('StreamFrameParser garbage & oversize detection', () => {
    it('rejects oversize frame lengths exceeding MAX_FRAME_LENGTH', () => {
      const oversizeLen = MAX_FRAME_LENGTH + 1;
      const badHeader = new Uint8Array([
        oversizeLen & 0xff,
        (oversizeLen >> 8) & 0xff,
        0x01,
        0x02,
      ]);

      expect(() => {
        parser.push(badHeader);
      }).toThrow('Oversize or garbage frame length');

      expect(parser.bufferedBytes).toBe(0);
    });

    it('rejects zero-length frame', () => {
      const zeroLenHeader = new Uint8Array([0x00, 0x00]);

      expect(() => {
        parser.push(zeroLenHeader);
      }).toThrow('Oversize or garbage frame length: 0');

      expect(parser.bufferedBytes).toBe(0);
    });
  });
});

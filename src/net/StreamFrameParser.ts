/**
 * Length-prefixed stream frame parser for Padly byte-stream transports (TCP adb-reverse & Bluetooth RFCOMM).
 *
 * PROTOCOL.md:
 * - "USB adb-reverse and Bluetooth RFCOMM: byte stream; each wire frame is prefixed with u16 length."
 * - "All integers little-endian"
 */

export const MAX_FRAME_LENGTH = 4096; // Max acceptable Padly wire frame (typical frames are 29-300 bytes)

/**
 * Prefixes a wire frame with a 2-byte little-endian u16 length.
 */
export function encodeStreamFrame(wireFrame: Uint8Array): Uint8Array {
  const len = wireFrame.length;
  if (len > 0xffff) {
    throw new Error(`Frame length ${len} exceeds u16 max size (65535)`);
  }

  const framed = new Uint8Array(2 + len);
  framed[0] = len & 0xff;
  framed[1] = (len >> 8) & 0xff;
  framed.set(wireFrame, 2);
  return framed;
}

/**
 * Stateful stream frame parser that parses incoming chunks, handles partial reads,
 * coalesced frames, and detects oversize or garbage frame lengths.
 */
export class StreamFrameParser {
  private buffer: Uint8Array = new Uint8Array(0);

  /**
   * Feeds a chunk of incoming bytes and returns any complete wire frames extracted.
   * Throws an Error if a frame length is 0 or exceeds MAX_FRAME_LENGTH.
   */
  public push(chunk: Uint8Array): Uint8Array[] {
    if (!chunk || chunk.length === 0) {
      return [];
    }

    // Append chunk to internal buffer
    const nextBuffer = new Uint8Array(this.buffer.length + chunk.length);
    nextBuffer.set(this.buffer, 0);
    nextBuffer.set(chunk, this.buffer.length);
    this.buffer = nextBuffer;

    const completeFrames: Uint8Array[] = [];

    // Process as many complete frames as possible
    while (this.buffer.length >= 2) {
      const frameLen = this.buffer[0] | (this.buffer[1] << 8);

      // Validate length per PROTOCOL.md & security requirements
      if (frameLen === 0 || frameLen > MAX_FRAME_LENGTH) {
        this.reset();
        throw new Error(
          `Oversize or garbage frame length: ${frameLen} (valid range: 1..${MAX_FRAME_LENGTH})`
        );
      }

      // Check if the entire frame (2-byte header + frameLen payload) has arrived
      if (this.buffer.length < 2 + frameLen) {
        // Need more data from subsequent chunks
        break;
      }

      // Extract complete wire frame
      const frame = this.buffer.slice(2, 2 + frameLen);
      completeFrames.push(frame);

      // Advance buffer past this frame
      this.buffer = this.buffer.slice(2 + frameLen);
    }

    return completeFrames;
  }

  /**
   * Resets the buffer to empty.
   */
  public reset(): void {
    this.buffer = new Uint8Array(0);
  }

  /**
   * Current number of unparsed buffered bytes waiting for completion.
   */
  public get bufferedBytes(): number {
    return this.buffer.length;
  }
}

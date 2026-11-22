/**
 * TCP Stream Transport for Padly adb-reverse USB mode.
 * Uses react-native-tcp-socket connecting to 127.0.0.1:<tcpPort>.
 *
 * PROTOCOL.md:
 * - "USB adb-reverse and Bluetooth RFCOMM: byte stream; each wire frame is prefixed with u16 length."
 * - Default TCP port: 47821
 * - TCP_NODELAY enabled to disable Nagle's algorithm for minimum latency.
 */

import { Transport, TransportKind, TransportTarget } from '../Transport';
import { StreamFrameParser, encodeStreamFrame } from '../StreamFrameParser';

// Safe require for react-native-tcp-socket to support test and non-RN environments
let TcpSocket: any = null;
try {
  TcpSocket = require('react-native-tcp-socket').default || require('react-native-tcp-socket');
} catch {
  // Test / non-native environment
}

export class TcpStreamTransport implements Transport {
  public readonly kind: TransportKind = 'usb-adb';
  private socket: any = null;
  private parser: StreamFrameParser = new StreamFrameParser();
  private isConnected: boolean = false;

  private messageListeners = new Set<(bytes: Uint8Array) => void>();
  private closeListeners = new Set<(err?: Error) => void>();

  constructor(kind: TransportKind = 'usb-adb') {
    this.kind = kind;
  }

  /**
   * Connects to 127.0.0.1:<tcpPort> via adb reverse.
   */
  public connect(target: TransportTarget): Promise<void> {
    const host = target.host || '127.0.0.1';
    const port = target.tcpPort ?? target.port ?? 47821;

    return new Promise<void>((resolve, reject) => {
      if (!TcpSocket || !TcpSocket.createConnection) {
        reject(new Error('react-native-tcp-socket is not available on this platform'));
        return;
      }

      this.close();
      this.parser.reset();

      let isEstablished = false;

      try {
        const client = TcpSocket.createConnection(
          {
            host,
            port,
          },
          () => {
            isEstablished = true;
            this.isConnected = true;

            // Enable TCP_NODELAY to minimize latency for game controller packets
            if (typeof client.setNoDelay === 'function') {
              client.setNoDelay(true);
            }

            resolve();
          }
        );

        this.socket = client;

        client.on('data', (data: any) => {
          this.handleIncomingData(data);
        });

        client.on('error', (err: Error) => {
          console.warn('[TcpStreamTransport] Socket error:', err?.message || err);
          if (!isEstablished) {
            reject(err);
          } else {
            this.notifyClose(err);
          }
        });

        client.on('close', (hadError: boolean) => {
          this.isConnected = false;
          this.notifyClose(hadError ? new Error('Socket closed with transmission error') : undefined);
        });
      } catch (err: any) {
        reject(err);
      }
    });
  }

  /**
   * Sends a wire frame prefixed with little-endian u16 length.
   */
  public send(bytes: Uint8Array): void {
    if (!this.socket || !this.isConnected) {
      return;
    }

    try {
      const framed = encodeStreamFrame(bytes);
      this.socket.write(framed);
    } catch (err) {
      console.error('[TcpStreamTransport] Failed to write stream frame:', err);
    }
  }

  public onMessage(cb: (bytes: Uint8Array) => void): () => void {
    this.messageListeners.add(cb);
    return () => {
      this.messageListeners.delete(cb);
    };
  }

  public onClose(cb: (err?: Error) => void): () => void {
    this.closeListeners.add(cb);
    return () => {
      this.closeListeners.delete(cb);
    };
  }

  public close(): void {
    this.isConnected = false;
    this.parser.reset();

    if (this.socket) {
      try {
        if (typeof this.socket.destroy === 'function') {
          this.socket.destroy();
        } else if (typeof this.socket.end === 'function') {
          this.socket.end();
        }
      } catch {}
      this.socket = null;
    }
  }

  private handleIncomingData(data: any): void {
    let chunk: Uint8Array;

    if (data instanceof Uint8Array) {
      chunk = data;
    } else if (typeof data === 'string') {
      const len = data.length;
      chunk = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        chunk[i] = data.charCodeAt(i) & 0xff;
      }
    } else if (data && typeof data.length === 'number') {
      // Buffer or ArrayLike
      chunk = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        chunk[i] = data[i];
      }
    } else {
      return;
    }

    try {
      // StreamFrameParser handles partial reads, fragmented frames, and coalesced chunks
      const frames = this.parser.push(chunk);
      for (const frame of frames) {
        this.messageListeners.forEach((listener) => {
          try {
            listener(frame);
          } catch (err) {
            console.error('[TcpStreamTransport] Error in message listener:', err);
          }
        });
      }
    } catch (err: any) {
      // Oversize or garbage frame length: close connection immediately
      console.warn('[TcpStreamTransport] Frame parser error, closing stream:', err?.message);
      this.close();
      this.notifyClose(err);
    }
  }

  private notifyClose(err?: Error): void {
    this.closeListeners.forEach((listener) => {
      try {
        listener(err);
      } catch {}
    });
  }
}

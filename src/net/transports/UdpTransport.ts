/**
 * UDP Transport implementation for Padly
 * Uses react-native-udp for datagram communication over Wi-Fi and USB-tethering.
 *
 * PROTOCOL.md:
 * - "WiFi/USB-tethering: UDP datagram = one wire frame."
 * - Default UDP port: 47820
 */

import dgram from 'react-native-udp';
import { Transport, TransportKind, TransportTarget } from '../Transport';

export class UdpTransport implements Transport {
  public readonly kind: TransportKind = 'wifi';
  private socket: any = null;
  private targetHost: string = '';
  private targetPort: number = 47820;

  private messageListeners = new Set<(bytes: Uint8Array) => void>();
  private closeListeners = new Set<(err?: Error) => void>();
  private isBound: boolean = false;

  constructor(kind: TransportKind = 'wifi') {
    this.kind = kind;
  }

  public async connect(target: TransportTarget): Promise<void> {
    if (!target.host) {
      throw new Error('UdpTransport requires target.host (IP address or hostname)');
    }

    this.targetHost = target.host;
    this.targetPort = target.port ?? 47820;

    return new Promise<void>((resolve, reject) => {
      try {
        const socket = dgram.createSocket({ type: 'udp4' });
        this.socket = socket;

        (socket as any).on('error', (err: Error) => {
          console.error('[UdpTransport] Socket error:', err);
          this.notifyClose(err);
        });

        (socket as any).on('close', () => {
          this.isBound = false;
          this.notifyClose();
        });

        (socket as any).on('message', (msg: any, rinfo: { address: string; port: number }) => {
          this.handleIncomingDatagram(msg, rinfo);
        });

        // Bind ephemeral port (port 0) on all interfaces
        socket.bind(0, (err?: Error) => {
          if (err) {
            reject(err);
            return;
          }
          this.isBound = true;
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public send(bytes: Uint8Array): void {
    if (!this.socket || !this.isBound) {
      throw new Error('UdpTransport: Cannot send on unbound or closed socket');
    }

    try {
      this.socket.send(
        bytes,
        0,
        bytes.length,
        this.targetPort,
        this.targetHost,
        (err?: Error) => {
          if (err) {
            console.warn('[UdpTransport] Send error:', err.message);
          }
        }
      );
    } catch (err: any) {
      console.error('[UdpTransport] Exception in send():', err.message);
    }
  }

  private handleIncomingDatagram(msg: any, rinfo: { address: string; port: number }): void {
    // Verify the source address matches the paired host for security
    if (!this.isSourceHostMatch(rinfo.address, this.targetHost)) {
      console.warn(
        `[UdpTransport] Dropping datagram from unexpected host ${rinfo.address}:${rinfo.port} (expected ${this.targetHost})`
      );
      return;
    }

    let uint8: Uint8Array;
    if (msg instanceof Uint8Array) {
      uint8 = msg;
    } else if (msg?.buffer) {
      uint8 = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
    } else {
      uint8 = new Uint8Array(msg);
    }

    this.messageListeners.forEach((cb) => {
      try {
        cb(uint8);
      } catch (e) {
        console.error('[UdpTransport] Error in onMessage listener:', e);
      }
    });
  }

  private isSourceHostMatch(src: string, target: string): boolean {
    if (src === target) return true;
    // Allow local loopback variations
    if (
      (src === '127.0.0.1' || src === 'localhost') &&
      (target === '127.0.0.1' || target === 'localhost')
    ) {
      return true;
    }
    return false;
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
    if (!this.socket) return;
    this.isBound = false;
    try {
      this.socket.close();
    } catch {}
    this.socket = null;
    this.notifyClose();
  }

  private notifyClose(err?: Error): void {
    this.closeListeners.forEach((cb) => {
      try {
        cb(err);
      } catch {}
    });
  }
}

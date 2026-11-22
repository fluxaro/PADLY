/**
 * Bluetooth RFCOMM Transport for Padly Phone <-> PC communication (Android only).
 * Uses react-native-bluetooth-classic with binary connectionType and u16 length-prefixed stream framing.
 *
 * PROTOCOL.md:
 * - "USB adb-reverse and Bluetooth RFCOMM: byte stream; each wire frame is prefixed with u16 length."
 * - Custom service UUID from pairing QR (bt=<rfcomm_uuid>), fallback to standard SPP UUID (00001101-0000-1000-8000-00805F9B34FB).
 */

import { Platform } from 'react-native';
import { Transport, TransportKind, TransportTarget } from '../Transport';
import { StreamFrameParser, encodeStreamFrame } from '../StreamFrameParser';
import { base64UrlToBytes, bytesToBase64Url } from '../../pairing/PairingStore';

// Safe require for react-native-bluetooth-classic to support non-RN / test environments
let RNBluetoothClassic: any = null;
try {
  RNBluetoothClassic =
    require('react-native-bluetooth-classic').default ||
    require('react-native-bluetooth-classic');
} catch {
  // Test / non-native environment
}

export const DEFAULT_RFCOMM_UUID = '00001101-0000-1000-8000-00805F9B34FB';

export class BluetoothTransport implements Transport {
  public readonly kind: TransportKind = 'bluetooth';
  private device: any = null;
  private parser: StreamFrameParser = new StreamFrameParser();
  private isConnected: boolean = false;
  private dataSubscription: any = null;
  private disconnectSubscription: any = null;

  private messageListeners = new Set<(bytes: Uint8Array) => void>();
  private closeListeners = new Set<(err?: Error) => void>();

  constructor(kind: TransportKind = 'bluetooth') {
    this.kind = kind;
  }

  /**
   * Connects to a bonded PC Bluetooth device by address with the custom RFCOMM service UUID.
   */
  public async connect(target: TransportTarget): Promise<void> {
    if (Platform.OS !== 'android') {
      throw new Error('Bluetooth RFCOMM transport is only supported on Android devices');
    }

    if (!RNBluetoothClassic) {
      throw new Error('react-native-bluetooth-classic is not available');
    }

    const address = target.btAddress || target.address || target.host;
    if (!address) {
      throw new Error('Bluetooth connection requires target Bluetooth device MAC address');
    }

    const serviceUUID = target.rfcommUuid || DEFAULT_RFCOMM_UUID;

    this.close();
    this.parser.reset();

    try {
      // Connect to bonded device using binary connectionType
      const device = await RNBluetoothClassic.connectToDevice(address, {
        connectorType: 'rfcomm',
        connectionType: 'binary',
        serviceUUID,
        uuid: serviceUUID,
      });

      if (!device) {
        throw new Error(`Failed to open RFCOMM connection to ${address}`);
      }

      this.device = device;
      this.isConnected = true;

      // Listen for binary data arriving over RFCOMM
      this.dataSubscription = device.onDataReceived((event: { data: string }) => {
        this.handleIncomingBase64Data(event?.data);
      });

      // Listen for unexpected device disconnection
      this.disconnectSubscription = RNBluetoothClassic.onDeviceDisconnected(
        (event: { device: { address: string } }) => {
          if (event?.device?.address === address) {
            console.warn('[BluetoothTransport] Device disconnected event received:', address);
            this.notifyClose(new Error('Bluetooth connection closed by remote device'));
          }
        }
      );
    } catch (err: any) {
      this.close();
      throw new Error(`Bluetooth RFCOMM connect failed: ${err?.message || err}`);
    }
  }

  /**
   * Sends binary wire frame prefixed with little-endian u16 length.
   */
  public send(bytes: Uint8Array): void {
    if (!this.device || !this.isConnected) {
      return;
    }

    try {
      // 1. Prefix with u16 length framing per PROTOCOL.md
      const framed = encodeStreamFrame(bytes);

      // 2. Convert to standard Base64 for the native module binary writer
      let binaryStr = '';
      for (let i = 0; i < framed.length; i++) {
        binaryStr += String.fromCharCode(framed[i]);
      }
      const b64 =
        typeof btoa === 'function'
          ? btoa(binaryStr)
          : (globalThis as any).Buffer?.from(framed).toString('base64');

      this.device.write(b64, 'base64');
    } catch (err) {
      console.error('[BluetoothTransport] Failed to send Bluetooth frame:', err);
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

    if (this.dataSubscription?.remove) {
      this.dataSubscription.remove();
      this.dataSubscription = null;
    }

    if (this.disconnectSubscription?.remove) {
      this.disconnectSubscription.remove();
      this.disconnectSubscription = null;
    }

    if (this.device) {
      try {
        if (typeof this.device.disconnect === 'function') {
          this.device.disconnect().catch(() => {});
        }
      } catch {}
      this.device = null;
    }
  }

  private handleIncomingBase64Data(b64Data?: string): void {
    if (!b64Data || typeof b64Data !== 'string') {
      return;
    }

    try {
      // Decode base64 to binary byte chunk
      let chunk: Uint8Array;
      if (typeof atob === 'function') {
        const bin = atob(b64Data.trim());
        chunk = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
          chunk[i] = bin.charCodeAt(i);
        }
      } else {
        const buf = (globalThis as any).Buffer?.from(b64Data.trim(), 'base64');
        chunk = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
      }

      // StreamFrameParser handles partial reads, fragmented frames, and coalesced frames
      const frames = this.parser.push(chunk);
      for (const frame of frames) {
        this.messageListeners.forEach((listener) => {
          try {
            listener(frame);
          } catch (err) {
            console.error('[BluetoothTransport] Error in message listener:', err);
          }
        });
      }
    } catch (err: any) {
      console.warn('[BluetoothTransport] Frame parser error, closing Bluetooth stream:', err?.message);
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

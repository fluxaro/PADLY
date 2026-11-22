/**
 * Transport abstraction for Padly Phone <-> PC communication.
 * Concrete transports (UDP, TCP socket, Bluetooth RFCOMM, FakeTransport) implement this interface.
 */

export type TransportKind = 'wifi' | 'usb-tether' | 'usb-adb' | 'bluetooth';

export interface TransportTarget {
  /** IP address or hostname for Wi-Fi and USB tethering */
  host?: string;
  /** Primary UDP port (default: 47820) */
  port?: number;
  /** TCP port for adb-reverse and byte-stream tunnels (default: 47821) */
  tcpPort?: number;
  /** RFCOMM UUID or MAC address for Bluetooth Classic */
  rfcommUuid?: string;
  /** Custom extra parameters */
  [key: string]: any;
}

export interface Transport {
  /** Identifier of the transport technology */
  readonly kind: TransportKind;

  /** Establishes physical transport connection to the target PC */
  connect(target: TransportTarget): Promise<void>;

  /**
   * Transmits raw wire bytes to the PC.
   * For datagram transports (UDP): single wire frame.
   * For stream transports (TCP/Bluetooth): prefixed with u16 length.
   */
  send(bytes: Uint8Array): void;

  /**
   * Registers a callback for incoming wire frames.
   * Returns an unregister function.
   */
  onMessage(cb: (bytes: Uint8Array) => void): () => void;

  /**
   * Registers a callback for connection close / transport drop.
   * Returns an unregister function.
   */
  onClose(cb: (err?: Error) => void): () => void;

  /** Closes and cleans up the transport */
  close(): void;
}

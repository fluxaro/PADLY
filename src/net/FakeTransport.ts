import { Transport, TransportKind, TransportTarget } from './Transport';

export type FakePeerHandler = (
  bytes: Uint8Array,
  peer: { sendToClient: (data: Uint8Array) => void; dropClient: (err?: Error) => void }
) => void;

/**
 * In-memory loopback transport for unit testing and offline development.
 */
export class FakeTransport implements Transport {
  public readonly kind: TransportKind;
  public isConnected: boolean = false;
  public sentBytes: Uint8Array[] = [];
  public target?: TransportTarget;

  private messageListeners = new Set<(bytes: Uint8Array) => void>();
  private closeListeners = new Set<(err?: Error) => void>();
  private peerHandler?: FakePeerHandler;

  constructor(kind: TransportKind = 'wifi', peerHandler?: FakePeerHandler) {
    this.kind = kind;
    this.peerHandler = peerHandler;
  }

  public setPeerHandler(handler: FakePeerHandler): void {
    this.peerHandler = handler;
  }

  public async connect(target: TransportTarget): Promise<void> {
    this.target = target;
    this.isConnected = true;
  }

  public send(bytes: Uint8Array): void {
    if (!this.isConnected) {
      throw new Error('Cannot send on closed FakeTransport');
    }

    // Save copy of sent bytes
    this.sentBytes.push(new Uint8Array(bytes));

    if (this.peerHandler) {
      this.peerHandler(new Uint8Array(bytes), {
        sendToClient: (resp: Uint8Array) => this.deliverToClient(resp),
        dropClient: (err?: Error) => this.simulateRemoteClose(err),
      });
    }
  }

  /**
   * Simulates reception of a wire frame from the remote PC.
   */
  public deliverToClient(bytes: Uint8Array): void {
    if (!this.isConnected) return;
    const copy = new Uint8Array(bytes);
    this.messageListeners.forEach((cb) => {
      try {
        cb(copy);
      } catch (err) {
        console.error('[FakeTransport] Error in message listener:', err);
      }
    });
  }

  /**
   * Simulates remote PC or network dropping the connection.
   */
  public simulateRemoteClose(err?: Error): void {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.closeListeners.forEach((cb) => {
      try {
        cb(err);
      } catch (e) {
        console.error('[FakeTransport] Error in close listener:', e);
      }
    });
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
    if (!this.isConnected) return;
    this.isConnected = false;
    this.closeListeners.forEach((cb) => cb());
  }
}

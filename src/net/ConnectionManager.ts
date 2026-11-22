/**
 * Padly Connection Manager & Protocol State Machine
 *
 * Implements:
 * 1. State machine: idle -> connecting -> handshaking -> connected -> reconnecting -> failed
 * 2. HELLO / HELLO_ACK handshake and SessionCipher creation per PROTOCOL.md
 * 3. Reactive tiny store exposing connection status, rttMs, jitterMs, lossPercent, transportKind, pcName
 * 4. Send loop: immediate STATE on change (coalesced to max 1 per 4ms) + 100ms heartbeat
 * 5. Release safety: neutral STATE + BYE sent on drop / background, and zero local state
 * 6. Auto-reconnect with backoff (0.5s, 1s, 2s, 5s), cancelable by user
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Transport, TransportKind, TransportTarget } from './Transport';
import {
  encodeInner,
  decodeInner,
  MessageType,
  HelloMessage,
  HelloAckMessage,
  StateMessage,
  PingMessage,
  PongMessage,
  ByeMessage,
} from '../protocol/codec';
import {
  encryptHandshake,
  decryptHandshake,
  deriveSessionKey,
  SessionCipher,
  generateSecureRandomBytes,
} from '../protocol/crypto';
import {
  ControllerState,
  getState as getAggregatedState,
  onChange as onAggregatorChange,
  resetState as resetAggregatorState,
} from '../input/stateAggregator';
import { WifiLockManager } from './WifiLockManager';

// Safe require of AppState for React Native & test environments
let AppState: any = null;
try {
  AppState = require('react-native').AppState;
} catch {
  // Test / non-RN environment
}

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export type ConnectionMode = 'auto' | 'usb' | 'wifi' | 'bluetooth';

export interface ConnectionStoreState {
  status: ConnectionStatus;
  connectionMode: ConnectionMode;
  rttMs: number;
  jitterMs: number;
  lossPercent: number;
  transportKind: TransportKind | null;
  pcName: string | null;
  reconnectAttempt: number;
  error?: string;
  isUsbHelpVisible?: boolean;
}

export interface ConnectOptions {
  transport: Transport;
  target: TransportTarget;
  pairingKey: Uint8Array;
  clientName?: string;
  autoReconnect?: boolean;
}

// Backoff schedule in milliseconds: 0.5s, 1s, 2s, 5s
export const BACKOFF_DELAYS = [500, 1000, 2000, 5000];

export class ConnectionManager {
  private activeTransport: Transport | null = null;
  private sessionCipher: SessionCipher | null = null;
  private lastConnectOptions: ConnectOptions | null = null;

  // Handshake tracking
  private currentPhoneSalt: Uint8Array | null = null;
  private handshakeTimer: any = null;

  // State sequences and timestamps
  private stateSeq: number = 0;
  private generalSeq: number = 0;
  private lastStateSendTime: number = 0;

  // Send loop coalescing (4ms) & heartbeat (100ms)
  private sendCoalesceTimer: any = null;
  private heartbeatInterval: any = null;
  private pingInterval: any = null;
  private pendingState: ControllerState | null = null;
  private latestState: ControllerState = getAggregatedState();
  private aggregatorUnsub: (() => void) | null = null;

  // Auto-reconnect tracking
  private reconnectTimer: any = null;
  private reconnectAttempt: number = 0;
  private isUserCanceled: boolean = false;

  // Ping tracking
  private lastPingSentTs: number = 0;

  // AppState subscription
  private appStateSub: any = null;

  // Store & listeners
  private state: ConnectionStoreState = {
    status: 'idle',
    connectionMode: 'auto',
    rttMs: 0,
    jitterMs: 0,
    lossPercent: 0,
    transportKind: null,
    pcName: null,
    reconnectAttempt: 0,
    isUsbHelpVisible: false,
  };
  private listeners = new Set<(s: ConnectionStoreState) => void>();

  constructor() {
    this.setupAppStateListener();
    this.loadPersistedConnectionMode();
  }

  private async loadPersistedConnectionMode(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem('padly_connection_mode');
      if (saved === 'auto' || saved === 'usb' || saved === 'wifi' || saved === 'bluetooth') {
        this.setState({ connectionMode: saved as ConnectionMode });
      }
    } catch {}
  }

  public async setConnectionMode(mode: ConnectionMode): Promise<void> {
    this.setState({ connectionMode: mode });
    try {
      await AsyncStorage.setItem('padly_connection_mode', mode);
    } catch {}

    // When mode is set to USB and we are not on USB, run immediate USB check
    if (mode === 'usb') {
      if (this.state.status !== 'connected' || (this.state.transportKind !== 'usb-adb' && this.state.transportKind !== 'usb-tether')) {
        try {
          const { usbWatcher } = require('./UsbWatcher');
          usbWatcher.tick();
        } catch {}
      }
    } else if (mode === 'wifi') {
      if (this.state.status !== 'connected' || this.state.transportKind !== 'wifi') {
        try {
          const { connectToPairedPc } = require('../pairing/connectHelper');
          connectToPairedPc().catch(() => {});
        } catch {}
      }
    }
  }

  public setUsbHelpVisible(visible: boolean): void {
    this.setState({ isUsbHelpVisible: visible });
  }

  // ==========================================================================
  // Store methods
  // ==========================================================================

  public getState(): ConnectionStoreState {
    return { ...this.state };
  }

  public subscribe(listener: (s: ConnectionStoreState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(partial: Partial<ConnectionStoreState>): void {
    this.state = { ...this.state, ...partial };
    const snapshot = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[ConnectionManager] Error in store listener:', err);
      }
    });
  }

  // ==========================================================================
  // Connection Lifecycle
  // ==========================================================================

  /**
   * Initiates a connection using the specified Transport and pairingKey.
   */
  public async connect(options: ConnectOptions): Promise<void> {
    this.cancelReconnect();
    this.cleanupActiveConnection(false);

    this.lastConnectOptions = options;
    this.isUserCanceled = false;
    this.activeTransport = options.transport;

    this.setState({
      status: 'connecting',
      transportKind: options.transport.kind,
      reconnectAttempt: this.reconnectAttempt,
      error: undefined,
    });

    try {
      // 1. Establish transport layer
      await options.transport.connect(options.target);

      // 2. Wire transport event listeners
      options.transport.onClose((err) => {
        this.handleTransportDrop(err);
      });

      options.transport.onMessage((bytes) => {
        this.handleIncomingWireFrame(bytes);
      });

      // 3. Initiate HELLO Handshake
      this.setState({ status: 'handshaking' });
      this.sendHelloHandshake(options);
    } catch (err: any) {
      console.error('[ConnectionManager] Connect failed:', err);
      this.handleConnectionFailure(err?.message || 'Transport connection failed');
    }
  }

  /**
   * Seamlessly handshakes and switches to a higher-priority or fallback transport
   * without dropping held inputs (immediately transmits the current full STATE upon handoff).
   */
  public async connectSeamless(options: ConnectOptions): Promise<void> {
    const candidateTransport = options.transport;
    let candidateTimer: any = null;

    try {
      await candidateTransport.connect(options.target);

      const phoneSalt = generateSecureRandomBytes(8);
      const helloMsg: HelloMessage = {
        ver: 1,
        type: MessageType.HELLO,
        seq: this.nextGeneralSeq(),
        ts: this.getTimestamp(),
        phone_salt: phoneSalt,
        name: options.clientName ?? 'Padly Mobile',
      };

      const innerBytes = encodeInner(helloMsg);
      const wireBytes = encryptHandshake(innerBytes, options.pairingKey);

      await new Promise<void>((resolve, reject) => {
        candidateTimer = setTimeout(() => {
          candidateTransport.close();
          reject(new Error('Candidate handshake timeout'));
        }, 3000);

        candidateTransport.onMessage((wire: Uint8Array) => {
          if (wire && wire.length > 0 && wire[0] === 0x01) {
            clearTimeout(candidateTimer);
            const decrypted = decryptHandshake(wire, options.pairingKey);
            if (!decrypted) {
              candidateTransport.close();
              reject(new Error('Candidate decryption failed: pairing key mismatch'));
              return;
            }

            const decodeRes = decodeInner(decrypted);
            if (!decodeRes.ok || decodeRes.value.type !== MessageType.HELLO_ACK) {
              candidateTransport.close();
              reject(new Error('Unexpected candidate handshake response'));
              return;
            }

            const ack = decodeRes.value as HelloAckMessage;
            if (ack.accepted !== 1) {
              candidateTransport.close();
              reject(new Error('Candidate connection rejected by PC'));
              return;
            }

            // Successfully handshaked on candidate transport!
            const sessionKey = deriveSessionKey(options.pairingKey, phoneSalt, ack.pc_salt);
            const newCipher = new SessionCipher(sessionKey, { direction: 'phone' });

            // Close old transport cleanly without sending release safety packets
            if (this.activeTransport && this.activeTransport !== candidateTransport) {
              try {
                this.activeTransport.close();
              } catch {}
            }

            this.activeTransport = candidateTransport;
            this.sessionCipher = newCipher;
            this.lastConnectOptions = options;
            this.reconnectAttempt = 0;

            // Wire messages and drops to active handlers
            candidateTransport.onClose((err) => {
              this.handleTransportDrop(err);
            });
            candidateTransport.onMessage((msgWire) => {
              this.handleIncomingWireFrame(msgWire);
            });

            this.setState({
              status: 'connected',
              transportKind: candidateTransport.kind,
              pcName: ack.pc_name || 'PC',
              reconnectAttempt: 0,
              error: undefined,
              isUsbHelpVisible: false,
            });

            if (candidateTransport.kind === 'wifi') {
              WifiLockManager.acquire().catch(() => {});
            } else {
              WifiLockManager.release().catch(() => {});
            }

            this.startSendLoop();
            this.startPingLoop();

            // Crucial: immediately send full current STATE without releasing inputs!
            this.sendStatePacket(this.latestState);

            resolve();
          }
        });

        candidateTransport.send(wireBytes);
      });
    } catch (err: any) {
      if (candidateTimer) clearTimeout(candidateTimer);
      try {
        candidateTransport.close();
      } catch {}
      throw err;
    }
  }

  /**
   * Disconnects active connection, cancels auto-reconnect, and returns to idle state.
   */
  public disconnect(): void {
    this.isUserCanceled = true;
    this.cancelReconnect();

    // Release safety: send neutral state and BYE before closing transport
    this.sendReleaseSafetyPackets();

    this.cleanupActiveConnection(true);
    this.setState({
      status: 'idle',
      rttMs: 0,
      jitterMs: 0,
      transportKind: null,
      pcName: null,
      reconnectAttempt: 0,
      error: undefined,
    });
  }

  /**
   * Cancels any pending auto-reconnect attempt.
   */
  public cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ==========================================================================
  // Handshake implementation (HELLO / HELLO_ACK)
  // ==========================================================================

  private sendHelloHandshake(options: ConnectOptions): void {
    if (!this.activeTransport) return;

    const phoneSalt = generateSecureRandomBytes(8);
    this.currentPhoneSalt = phoneSalt;

    const helloMsg: HelloMessage = {
      ver: 1,
      type: MessageType.HELLO,
      seq: this.nextGeneralSeq(),
      ts: this.getTimestamp(),
      phone_salt: phoneSalt,
      name: options.clientName ?? 'Padly Mobile',
    };

    const innerBytes = encodeInner(helloMsg);
    const wireBytes = encryptHandshake(innerBytes, options.pairingKey);

    // Arm 4-second handshake timeout
    this.clearHandshakeTimer();
    this.handshakeTimer = setTimeout(() => {
      this.handleConnectionFailure('Handshake timeout: no response from PC');
    }, 4000);

    this.activeTransport.send(wireBytes);
  }

  private handleIncomingWireFrame(wire: Uint8Array): void {
    if (!wire || wire.length === 0) return;

    // A. Handshake Frame (0x01 prefix)
    if (wire[0] === 0x01) {
      if (this.state.status !== 'handshaking' || !this.lastConnectOptions || !this.currentPhoneSalt) {
        return;
      }

      const decrypted = decryptHandshake(wire, this.lastConnectOptions.pairingKey);
      if (!decrypted) {
        console.warn('[ConnectionManager] Failed to decrypt handshake frame: pairing key mismatch or corrupted wire');
        return;
      }

      const decodeRes = decodeInner(decrypted);
      if (!decodeRes.ok || decodeRes.value.type !== MessageType.HELLO_ACK) {
        console.warn('[ConnectionManager] Unexpected handshake inner message:', decodeRes);
        return;
      }

      const ack = decodeRes.value as HelloAckMessage;
      if (ack.accepted !== 1) {
        this.clearHandshakeTimer();
        this.handleConnectionFailure('Connection rejected by PC (accepted != 1)');
        return;
      }

      // Success: derive session key and create SessionCipher
      this.clearHandshakeTimer();
      const sessionKey = deriveSessionKey(
        this.lastConnectOptions.pairingKey,
        this.currentPhoneSalt,
        ack.pc_salt
      );

      this.sessionCipher = new SessionCipher(sessionKey, { direction: 'phone' });
      this.reconnectAttempt = 0;

      this.setState({
        status: 'connected',
        pcName: ack.pc_name || 'PC',
        reconnectAttempt: 0,
        error: undefined,
      });

      // Wi-Fi Quality: Acquire low-latency lock if on Wi-Fi
      if (this.activeTransport?.kind === 'wifi') {
        WifiLockManager.acquire().catch(() => {});
      }

      // Start send loop, heartbeat, and ping loop
      this.startSendLoop();
      this.startPingLoop();
      return;
    }

    // B. Session Frame (0x02 prefix)
    if (wire[0] === 0x02) {
      if (this.state.status !== 'connected' || !this.sessionCipher) {
        return;
      }

      const plaintext = this.sessionCipher.open(wire);
      if (!plaintext) {
        // Replayed, out-of-order, or tampered frame: silently dropped per PROTOCOL.md
        return;
      }

      const decoded = decodeInner(plaintext);
      if (!decoded.ok) return;

      const msg = decoded.value;

      switch (msg.type) {
        case MessageType.PONG: {
          const pong = msg as PongMessage;
          const now = this.getTimestamp();
          const rtt = Math.max(0, now - pong.echoed_ts);
          const prevJitter = this.state.jitterMs;
          const prevRtt = this.state.rttMs;
          const jitterSample = Math.abs(rtt - prevRtt);
          const newJitter = prevRtt === 0 ? 0 : Math.round(0.8 * prevJitter + 0.2 * jitterSample);

          this.setState({
            rttMs: rtt,
            jitterMs: newJitter,
          });
          break;
        }

        case MessageType.RUMBLE: {
          // Handled by haptic driver
          break;
        }

        case MessageType.BYE: {
          // Remote PC disconnected
          this.handleTransportDrop(new Error('PC closed session (BYE)'));
          break;
        }
      }
    }
  }

  // ==========================================================================
  // Send Loop & Coalescing (4ms coalescing + 100ms heartbeat)
  // ==========================================================================

  private startSendLoop(): void {
    this.stopSendLoop();

    // Subscribe to state aggregator
    this.aggregatorUnsub = onAggregatorChange((state) => {
      this.onAggregatorStateChanged(state);
    });

    // Send initial snapshot
    this.latestState = getAggregatedState();
    this.sendStatePacket(this.latestState);

    const isBluetooth = this.activeTransport?.kind === 'bluetooth';
    // Wi-Fi/USB: 100ms heartbeat. Bluetooth: 50ms heartbeat
    const heartbeatDelay = isBluetooth ? 50 : 100;

    this.heartbeatInterval = setInterval(() => {
      if (this.state.status !== 'connected') return;
      const now = Date.now();
      if (now - this.lastStateSendTime >= heartbeatDelay) {
        this.sendStatePacket(this.latestState);
      }
    }, isBluetooth ? 20 : 25);
  }

  private stopSendLoop(): void {
    if (this.aggregatorUnsub) {
      this.aggregatorUnsub();
      this.aggregatorUnsub = null;
    }
    if (this.sendCoalesceTimer) {
      clearTimeout(this.sendCoalesceTimer);
      this.sendCoalesceTimer = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.pendingState = null;
  }

  private onAggregatorStateChanged(state: ControllerState): void {
    if (this.state.status !== 'connected') return;

    this.latestState = state;

    // Coalescing: If a send was recently dispatched (< 4ms ago),
    // replace pending state with the newest without queuing.
    if (this.sendCoalesceTimer !== null) {
      this.pendingState = state;
      return;
    }

    // Otherwise send immediately and arm the 4ms coalescing window
    this.sendStatePacket(state);
    this.startCoalesceWindow();
  }

  private startCoalesceWindow(): void {
    const isBluetooth = this.activeTransport?.kind === 'bluetooth';
    // No coalescing below 10ms for Bluetooth; 4ms for USB/Wi-Fi
    const coalesceDelay = isBluetooth ? 10 : 4;

    this.sendCoalesceTimer = setTimeout(() => {
      this.sendCoalesceTimer = null;
      if (this.pendingState && this.state.status === 'connected') {
        const next = this.pendingState;
        this.pendingState = null;
        this.sendStatePacket(next);
        this.startCoalesceWindow();
      }
    }, coalesceDelay);
  }

  public sendStatePacket(state: ControllerState): void {
    if (!this.activeTransport || !this.sessionCipher || this.state.status !== 'connected') {
      return;
    }

    const stateMsg: StateMessage = {
      ver: 1,
      type: MessageType.STATE,
      seq: this.nextStateSeq(),
      ts: this.getTimestamp(),
      buttons: state.buttons,
      lx: state.lx,
      ly: state.ly,
      rx: state.rx,
      ry: state.ry,
      lt: state.lt,
      rt: state.rt,
      flags: state.flags ?? 0,
    };

    const inner = encodeInner(stateMsg);
    const wire = this.sessionCipher.seal(inner);

    this.lastStateSendTime = Date.now();
    try {
      this.activeTransport.send(wire);
    } catch (err) {
      console.error('[ConnectionManager] Failed to send STATE frame:', err);
    }
  }

  // ==========================================================================
  // Ping Loop (1s)
  // ==========================================================================

  private startPingLoop(): void {
    this.stopPingLoop();

    this.pingInterval = setInterval(() => {
      if (this.state.status !== 'connected' || !this.sessionCipher || !this.activeTransport) {
        return;
      }

      const now = this.getTimestamp();
      this.lastPingSentTs = now;

      const ping: PingMessage = {
        ver: 1,
        type: MessageType.PING,
        seq: this.nextGeneralSeq(),
        ts: now,
      };

      try {
        const wire = this.sessionCipher.seal(encodeInner(ping));
        this.activeTransport.send(wire);
      } catch (err) {
        console.warn('[ConnectionManager] Ping send failed:', err);
      }
    }, 1000);
  }

  private stopPingLoop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ==========================================================================
  // Release Safety & Transport Drops
  // ==========================================================================

  /**
   * Release safety: When connection drops or app goes to background,
   * sends a neutral STATE (all inputs 0) and BYE, and zeroes local input state.
   */
  public sendReleaseSafetyPackets(): void {
    if (this.sessionCipher && this.activeTransport) {
      try {
        // 1. Send neutral state (all buttons released, sticks centered, triggers 0)
        const neutralState: StateMessage = {
          ver: 1,
          type: MessageType.STATE,
          seq: this.nextStateSeq(),
          ts: this.getTimestamp(),
          buttons: 0,
          lx: 0,
          ly: 0,
          rx: 0,
          ry: 0,
          lt: 0,
          rt: 0,
          flags: 0,
        };
        this.activeTransport.send(this.sessionCipher.seal(encodeInner(neutralState)));

        // 2. Send BYE
        const bye: ByeMessage = {
          ver: 1,
          type: MessageType.BYE,
          seq: this.nextGeneralSeq(),
          ts: this.getTimestamp(),
        };
        this.activeTransport.send(this.sessionCipher.seal(encodeInner(bye)));
      } catch {
        // Transport might already be closed
      }
    }

    // Zero local state in stateAggregator
    resetAggregatorState();
  }

  private handleTransportDrop(err?: Error): void {
    if (this.state.status === 'idle') return;

    console.warn('[ConnectionManager] Transport dropped:', err?.message);
    const droppedKind = this.state.transportKind;

    // In Auto mode: if USB dropped, fall back to Wi-Fi without dropping held inputs
    if (
      this.state.connectionMode === 'auto' &&
      (droppedKind === 'usb-adb' || droppedKind === 'usb-tether')
    ) {
      console.log('[ConnectionManager] Auto mode fallback: USB dropped, attempting Wi-Fi fallback...');
      this.cleanupActiveConnection(false);
      this.attemptAutoFallback('wifi');
      return;
    }

    // In USB mode: show setup help bottom sheet
    if (this.state.connectionMode === 'usb') {
      this.setUsbHelpVisible(true);
    }

    this.sendReleaseSafetyPackets();
    this.cleanupActiveConnection(false);

    if (this.isUserCanceled || !this.lastConnectOptions?.autoReconnect) {
      this.setState({
        status: 'failed',
        error: err?.message || 'Connection lost',
      });
      return;
    }

    // Trigger auto-reconnect with backoff
    this.scheduleAutoReconnect();
  }

  private handleConnectionFailure(errMsg: string): void {
    const droppedKind = this.state.transportKind;

    if (
      this.state.connectionMode === 'auto' &&
      (droppedKind === 'usb-adb' || droppedKind === 'usb-tether')
    ) {
      this.cleanupActiveConnection(false);
      this.attemptAutoFallback('wifi');
      return;
    }

    if (this.state.connectionMode === 'usb') {
      this.setUsbHelpVisible(true);
    }

    this.sendReleaseSafetyPackets();
    this.cleanupActiveConnection(false);

    if (this.isUserCanceled || !this.lastConnectOptions?.autoReconnect) {
      this.setState({
        status: 'failed',
        error: errMsg,
      });
      return;
    }

    this.scheduleAutoReconnect();
  }

  private async attemptAutoFallback(targetKind: 'wifi' | 'bluetooth'): Promise<void> {
    try {
      const { pairingStore } = require('../pairing/PairingStore');
      const last = await pairingStore.getLastUsed();
      if (!last) {
        this.scheduleAutoReconnect();
        return;
      }

      if (targetKind === 'wifi') {
        const { UdpTransport } = require('./transports/UdpTransport');
        const wifiTransport = new UdpTransport('wifi');
        await this.connectSeamless({
          transport: wifiTransport,
          target: { host: last.pc.host, port: last.pc.udpPort || 47820 },
          pairingKey: last.pairingKey,
          clientName: 'Padly Mobile (Auto Fallback)',
          autoReconnect: true,
        });
      }
    } catch (err) {
      console.warn('[ConnectionManager] Auto fallback failed, scheduling reconnect:', err);
      this.scheduleAutoReconnect();
    }
  }

  private scheduleAutoReconnect(): void {
    this.cancelReconnect();

    const delayIndex = Math.min(this.reconnectAttempt, BACKOFF_DELAYS.length - 1);
    const delay = BACKOFF_DELAYS[delayIndex];
    this.reconnectAttempt++;

    this.setState({
      status: 'reconnecting',
      reconnectAttempt: this.reconnectAttempt,
    });

    this.reconnectTimer = setTimeout(() => {
      if (this.lastConnectOptions && !this.isUserCanceled) {
        this.connect(this.lastConnectOptions).catch((err) => {
          console.warn('[ConnectionManager] Reconnect attempt failed:', err);
        });
      }
    }, delay);
  }

  private cleanupActiveConnection(closeTransport: boolean): void {
    // Release Wi-Fi low-latency lock on disconnect or transport teardown
    WifiLockManager.release().catch(() => {});

    this.clearHandshakeTimer();
    this.stopSendLoop();
    this.stopPingLoop();

    if (closeTransport && this.activeTransport) {
      try {
        this.activeTransport.close();
      } catch {}
    }

    this.activeTransport = null;
    this.sessionCipher = null;
    this.currentPhoneSalt = null;
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private setupAppStateListener(): void {
    if (!AppState?.addEventListener) return;

    try {
      this.appStateSub = AppState.addEventListener('change', (nextState: string) => {
        if (nextState === 'background' || nextState === 'inactive') {
          // Release safety: zero all inputs when app goes into background
          if (this.state.status === 'connected') {
            this.sendReleaseSafetyPackets();
          }
        }
      });
    } catch {
      // Ignored in non-RN environments
    }
  }

  public destroy(): void {
    this.disconnect();
    if (this.appStateSub?.remove) {
      this.appStateSub.remove();
    }
  }

  // ==========================================================================
  // Sequence & Timestamp helpers
  // ==========================================================================

  private nextStateSeq(): number {
    this.stateSeq = (this.stateSeq + 1) & 0xffff;
    return this.stateSeq;
  }

  private nextGeneralSeq(): number {
    this.generalSeq = (this.generalSeq + 1) & 0xffff;
    return this.generalSeq;
  }

  private getTimestamp(): number {
    return Date.now() >>> 0;
  }
}

// Global singleton instance
export const connectionManager = new ConnectionManager();

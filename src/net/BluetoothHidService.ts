/**
 * Direct Bluetooth HID Service
 *
 * Emulates a standard Bluetooth Gamepad directly on Android 9+ (API 28+),
 * communicating directly with PC, Mac, Linux, or consoles without any Padly PC companion app.
 *
 * HID Report Structure:
 * - 14 Buttons (A, B, X, Y, LB, RB, Back, Start, Guide/Home, L3, R3, Share)
 * - 8-way Hat Switch (D-Pad)
 * - 16-bit Dual Sticks: Left Stick (X, Y), Right Stick (Rx, Ry)
 * - 8-bit Dual Triggers: Left Trigger (Z), Right Trigger (Rz)
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { ControllerState } from '../input/stateAggregator';
import { BUTTON_BITS } from '../protocol/buttons';

const { PadlyBluetoothHid } = NativeModules;

export interface HidHostDevice {
  name: string;
  address: string;
  type?: number;
}

export interface HidConnectionEvent {
  address: string;
  name: string;
  state: number; // 0=disconnected, 1=connecting, 2=connected, 3=disconnecting
  stateLabel: 'disconnected' | 'connecting' | 'connected' | 'disconnecting';
}

/**
 * Converts Padly ControllerState into the 14-button bitmask and 8-way hat switch
 * for standard USB/Bluetooth HID Gamepad reports.
 */
export function convertStateToHidReport(state: ControllerState): {
  buttons: number;
  hat: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
} {
  const b = state.buttons;

  // Map 14 buttons:
  // Button 1: A (bit 0)
  // Button 2: B (bit 1)
  // Button 3: X (bit 2)
  // Button 4: Y (bit 3)
  // Button 5: LB (bit 4)
  // Button 6: RB (bit 5)
  // Button 7: BACK (bit 6)
  // Button 8: START (bit 7)
  // Button 9: HOME (bit 8)
  // Button 10: L3 (bit 9)
  // Button 11: R3 (bit 10)
  // Button 12: SHARE (bit 15)
  // Button 13: 0 (reserved)
  // Button 14: 0 (reserved)
  let hidButtons = 0;
  if (b & BUTTON_BITS.A) hidButtons |= 1 << 0;
  if (b & BUTTON_BITS.B) hidButtons |= 1 << 1;
  if (b & BUTTON_BITS.X) hidButtons |= 1 << 2;
  if (b & BUTTON_BITS.Y) hidButtons |= 1 << 3;
  if (b & BUTTON_BITS.LB) hidButtons |= 1 << 4;
  if (b & BUTTON_BITS.RB) hidButtons |= 1 << 5;
  if (b & BUTTON_BITS.BACK) hidButtons |= 1 << 6;
  if (b & BUTTON_BITS.START) hidButtons |= 1 << 7;
  if (b & BUTTON_BITS.HOME) hidButtons |= 1 << 8;
  if (b & BUTTON_BITS.L3) hidButtons |= 1 << 9;
  if (b & BUTTON_BITS.R3) hidButtons |= 1 << 10;
  if (b & BUTTON_BITS.SHARE) hidButtons |= 1 << 11;

  // Map D-Pad to standard 8-way Hat Switch (1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W, 8=NW, 0=neutral)
  const rawUp = (b & BUTTON_BITS.UP) !== 0;
  const rawDown = (b & BUTTON_BITS.DOWN) !== 0;
  const rawLeft = (b & BUTTON_BITS.LEFT) !== 0;
  const rawRight = (b & BUTTON_BITS.RIGHT) !== 0;

  // Opposing directions cancel each other to neutral
  const up = rawUp && !rawDown;
  const down = rawDown && !rawUp;
  const left = rawLeft && !rawRight;
  const right = rawRight && !rawLeft;

  let hat = 0; // neutral
  if (up && right) hat = 2; // North-East
  else if (down && right) hat = 4; // South-East
  else if (down && left) hat = 6; // South-West
  else if (up && left) hat = 8; // North-West
  else if (up) hat = 1; // North
  else if (right) hat = 3; // East
  else if (down) hat = 5; // South
  else if (left) hat = 7; // West

  return {
    buttons: hidButtons,
    hat,
    lx: state.lx,
    ly: state.ly,
    rx: state.rx,
    ry: state.ry,
    lt: state.lt,
    rt: state.rt,
  };
}

class BluetoothHidService {
  private eventEmitter: NativeEventEmitter | null = null;
  private isRegistered = false;
  private connectedHost: HidHostDevice | null = null;
  private listeners: Set<(state: { isRegistered: boolean; connectedHost: HidHostDevice | null }) => void> = new Set();

  constructor() {
    if (Platform.OS === 'android' && PadlyBluetoothHid) {
      this.eventEmitter = new NativeEventEmitter(PadlyBluetoothHid);
      this.setupEventListeners();
    }
  }

  private setupEventListeners(): void {
    if (!this.eventEmitter) return;

    this.eventEmitter.addListener('onHidAppStatusChanged', (event: any) => {
      this.isRegistered = event?.registered ?? false;
      this.notifyListeners();
    });

    this.eventEmitter.addListener('onHidConnectionStateChanged', (event: any) => {
      if (event?.state === 2 /* CONNECTED */) {
        this.connectedHost = { name: event.name || 'Bluetooth Host', address: event.address };
      } else if (event?.state === 0 /* DISCONNECTED */) {
        if (this.connectedHost?.address === event.address) {
          this.connectedHost = null;
        }
      }
      this.notifyListeners();
    });
  }

  private notifyListeners(): void {
    const status = { isRegistered: this.isRegistered, connectedHost: this.connectedHost };
    this.listeners.forEach((listener) => {
      try {
        listener(status);
      } catch (err) {
        console.error('[BluetoothHidService] Error in listener callback:', err);
      }
    });
  }

  public subscribe(listener: (state: { isRegistered: boolean; connectedHost: HidHostDevice | null }) => void): () => void {
    this.listeners.add(listener);
    listener({ isRegistered: this.isRegistered, connectedHost: this.connectedHost });
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async isSupported(): Promise<boolean> {
    if (Platform.OS !== 'android' || !PadlyBluetoothHid) {
      return false;
    }
    try {
      return await PadlyBluetoothHid.isSupported();
    } catch {
      return false;
    }
  }

  public async registerApp(): Promise<boolean> {
    if (Platform.OS !== 'android' || !PadlyBluetoothHid) {
      throw new Error('Bluetooth HID Device emulation is only supported on Android 9+ (API 28+).');
    }
    try {
      const success = await PadlyBluetoothHid.registerApp();
      this.isRegistered = success;
      this.notifyListeners();
      return success;
    } catch (err: any) {
      this.isRegistered = false;
      this.notifyListeners();
      throw err;
    }
  }

  public async unregisterApp(): Promise<boolean> {
    if (Platform.OS !== 'android' || !PadlyBluetoothHid) return true;
    try {
      const ok = await PadlyBluetoothHid.unregisterApp();
      this.isRegistered = false;
      this.connectedHost = null;
      this.notifyListeners();
      return ok;
    } catch {
      return false;
    }
  }

  public async getBondedDevices(): Promise<HidHostDevice[]> {
    if (Platform.OS !== 'android' || !PadlyBluetoothHid) return [];
    try {
      return await PadlyBluetoothHid.getBondedDevices();
    } catch {
      return [];
    }
  }

  public async getConnectedDevices(): Promise<HidHostDevice[]> {
    if (Platform.OS !== 'android' || !PadlyBluetoothHid) return [];
    try {
      return await PadlyBluetoothHid.getConnectedDevices();
    } catch {
      return [];
    }
  }

  public async connectHost(address: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !PadlyBluetoothHid) return false;
    try {
      return await PadlyBluetoothHid.connectHost(address);
    } catch (err) {
      console.warn('[BluetoothHidService] Connect host error:', err);
      return false;
    }
  }

  public async disconnectHost(address?: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !PadlyBluetoothHid) return false;
    try {
      return await PadlyBluetoothHid.disconnectHost(address || null);
    } catch {
      return false;
    }
  }

  public async makeDiscoverable(durationSeconds: number = 120): Promise<boolean> {
    if (Platform.OS !== 'android' || !PadlyBluetoothHid) return false;
    try {
      return await PadlyBluetoothHid.makeDiscoverable(durationSeconds);
    } catch {
      return false;
    }
  }

  public sendGamepadReport(state: ControllerState): void {
    if (Platform.OS !== 'android' || !PadlyBluetoothHid || !this.isRegistered) return;

    const report = convertStateToHidReport(state);
    try {
      PadlyBluetoothHid.sendGamepadReport(
        report.buttons,
        report.hat,
        report.lx,
        report.ly,
        report.rx,
        report.ry,
        report.lt,
        report.rt,
        null // Fire-and-forget for minimal bridge latency
      );
    } catch (err) {
      console.warn('[BluetoothHidService] Failed to send report:', err);
    }
  }

  public getStatus(): { isRegistered: boolean; connectedHost: HidHostDevice | null } {
    return {
      isRegistered: this.isRegistered,
      connectedHost: this.connectedHost,
    };
  }
}

export const bluetoothHidService = new BluetoothHidService();

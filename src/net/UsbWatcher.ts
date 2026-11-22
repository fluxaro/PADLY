/**
 * USB Watcher & Auto-Detection Service
 *
 * Implements:
 * 1. Probes 127.0.0.1:<tcpPort> every 2s while in foreground and mode is 'usb' or 'auto'.
 * 2. Checks USB tethering (rndis0 / usb0) holding private IP as secondary USB transport.
 * 3. Enables auto-connect upon cable plug-in.
 * 4. In 'auto' mode: enables seamless upgrade to USB from Wi-Fi/Bluetooth without dropping held inputs.
 */

import { AppState, Platform } from 'react-native';
import { connectionManager, ConnectionMode } from './ConnectionManager';
import { TcpStreamTransport } from './transports/TcpStreamTransport';
import { UdpTransport } from './transports/UdpTransport';
import { detectUsbTethering } from './UsbTetherDetector';
import { pairingStore } from '../pairing/PairingStore';

// Safe require for react-native-tcp-socket
let TcpSocket: any = null;
try {
  TcpSocket = require('react-native-tcp-socket').default || require('react-native-tcp-socket');
} catch {
  // Test / non-native environment
}

/**
 * Fast non-blocking probe to verify if a TCP port is open.
 */
export function probeTcpPort(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    if (!TcpSocket || !TcpSocket.createConnection) {
      resolve(false);
      return;
    }

    let isSettled = false;
    let socket: any = null;

    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        try {
          socket?.destroy();
        } catch {}
        resolve(false);
      }
    }, timeoutMs);

    try {
      socket = TcpSocket.createConnection(
        {
          host,
          port,
        },
        () => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            try {
              socket.destroy();
            } catch {}
            resolve(true);
          }
        }
      );

      socket.on('error', () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          try {
            socket.destroy();
          } catch {}
          resolve(false);
        }
      });
    } catch {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        resolve(false);
      }
    }
  });
}

export class UsbWatcher {
  private timer: any = null;
  private isChecking: boolean = false;
  private isRunning: boolean = false;

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.timer = setInterval(() => {
      this.tick();
    }, 2000);

    // Initial check immediately
    this.tick();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Periodic check executed every 2s
   */
  public async tick(): Promise<void> {
    if (this.isChecking) return;

    // Only run when app is in the foreground
    if (AppState?.currentState && AppState.currentState !== 'active') {
      return;
    }

    const connState = connectionManager.getState();
    const mode = connState.connectionMode;

    // Only check when selected mode is 'usb' or 'auto'
    if (mode !== 'usb' && mode !== 'auto') {
      return;
    }

    // If already connected via lowest-latency adb reverse, nothing better to upgrade to
    if (connState.status === 'connected' && connState.transportKind === 'usb-adb') {
      return;
    }

    this.isChecking = true;

    try {
      const lastPaired = await pairingStore.getLastUsed();
      if (!lastPaired) {
        return;
      }

      const { pc, pairingKey } = lastPaired;
      const tcpPort = pc.tcpPort || 47821;

      // 1. Priority 1: Check adb-reverse TCP stream at 127.0.0.1:<tcpPort>
      const isTcpOpen = await probeTcpPort('127.0.0.1', tcpPort, 600);

      if (isTcpOpen) {
        // adb reverse is active!
        if (connState.status !== 'connected' || connState.transportKind !== 'usb-adb') {
          console.log('[UsbWatcher] Detected adb-reverse on 127.0.0.1:' + tcpPort);
          const transport = new TcpStreamTransport('usb-adb');
          await connectionManager.connectSeamless({
            transport,
            target: { host: '127.0.0.1', tcpPort },
            pairingKey,
            clientName: 'Padly Mobile (USB)',
            autoReconnect: false,
          });
          return;
        }
      }

      // 2. Priority 2: Check USB tethering (rndis0 / usb0) holding private IP
      const tetherInfo = await detectUsbTethering();
      if (tetherInfo.isActive) {
        if (connState.status !== 'connected' || (connState.transportKind !== 'usb-adb' && connState.transportKind !== 'usb-tether')) {
          console.log('[UsbWatcher] Detected USB tethering interface:', tetherInfo.interfaceName);
          const tetherHost = tetherInfo.gateway || pc.host;
          const transport = new UdpTransport('usb-tether');
          await connectionManager.connectSeamless({
            transport,
            target: { host: tetherHost, port: pc.udpPort || 47820 },
            pairingKey,
            clientName: 'Padly Mobile (USB Tether)',
            autoReconnect: false,
          });
          return;
        }
      }

      // If mode is strictly 'usb' and connection failed or is idle, signal USB setup help
      if (mode === 'usb' && connState.status !== 'connected' && connState.status !== 'connecting' && connState.status !== 'handshaking') {
        connectionManager.setUsbHelpVisible(true);
      }
    } catch (err) {
      console.warn('[UsbWatcher] Check error:', err);
    } finally {
      this.isChecking = false;
    }
  }
}

// Global singleton instance
export const usbWatcher = new UsbWatcher();

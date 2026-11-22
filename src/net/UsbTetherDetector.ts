/**
 * USB Tethering Detector
 *
 * Detects whether USB tethering (rndis0, usb0, ncm0) is active holding a private IP address,
 * using the Padly native Android module, @react-native-community/netinfo, and expo-network.
 *
 * PROTOCOL.md:
 * - "USB-tethering uses the UDP path (UdpTransport, kind = 'usb-tether')."
 */

import { NativeModules, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Network from 'expo-network';

export interface UsbTetherInfo {
  isActive: boolean;
  interfaceName?: string;
  ipAddress?: string;
  gateway?: string;
}

/**
 * Checks if a given IP address is in a private network range.
 */
function isPrivateIp(ip?: string | null): boolean {
  if (!ip) return false;
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n))) return false;

  // 10.0.0.0 – 10.255.255.255
  if (parts[0] === 10) return true;
  // 172.16.0.0 – 172.31.255.255
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0 – 192.168.255.255 (especially 192.168.42.x standard Android tethering)
  if (parts[0] === 192 && parts[1] === 168) return true;

  return false;
}

/**
 * Estimates default gateway / PC IP from a device IP by replacing the last octet with 1.
 */
function estimateGateway(ip?: string | null): string | undefined {
  if (!ip) return undefined;
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
  }
  return undefined;
}

/**
 * Detects USB tethering state and resolves the PC host address (gateway or fallback).
 */
export async function detectUsbTethering(): Promise<UsbTetherInfo> {
  // 1. Try Native Android module interface inspection (rndis0, usb0, ncm0)
  if (Platform.OS === 'android' && NativeModules?.PadlyWifiLock?.getUsbTetherInfo) {
    try {
      const nativeInfo = await NativeModules.PadlyWifiLock.getUsbTetherInfo();
      if (nativeInfo?.active && nativeInfo?.ip) {
        return {
          isActive: true,
          interfaceName: nativeInfo.interface || 'rndis0',
          ipAddress: nativeInfo.ip,
          gateway: nativeInfo.gateway || estimateGateway(nativeInfo.ip),
        };
      }
    } catch (err) {
      console.warn('[UsbTetherDetector] Native check error:', err);
    }
  }

  // 2. Try NetInfo: non-Wi-Fi interface like 'ethernet' or 'other' holding a private IP
  try {
    const netState = await NetInfo.fetch();
    const type = netState.type;

    if (type === 'ethernet' || type === 'other') {
      const details: any = netState.details;
      const ip = details?.ipAddress;

      if (isPrivateIp(ip)) {
        return {
          isActive: true,
          interfaceName: type,
          ipAddress: ip,
          gateway: details?.subnet ? estimateGateway(ip) : undefined,
        };
      }
    }
  } catch (err) {
    console.warn('[UsbTetherDetector] NetInfo check error:', err);
  }

  // 3. Fallback: expo-network check for standard Android tethering subnet (192.168.42.x)
  try {
    const ip = await Network.getIpAddressAsync();
    if (ip && ip.startsWith('192.168.42.')) {
      return {
        isActive: true,
        interfaceName: 'rndis0',
        ipAddress: ip,
        gateway: '192.168.42.1',
      };
    }
  } catch (err) {
    // Silently ignore
  }

  return {
    isActive: false,
  };
}

/**
 * Android Runtime Permissions Manager for Bluetooth Classic & RFCOMM.
 * Handles BLUETOOTH_CONNECT and BLUETOOTH_SCAN on Android 12+ (API 31+),
 * and legacy Bluetooth/Location permissions on earlier Android versions.
 */

import { PermissionsAndroid, Platform } from 'react-native';

export interface BluetoothPermissionResult {
  granted: boolean;
  canAskAgain: boolean;
  deniedPermissions: string[];
}

export async function checkBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(Platform.Version as string, 10);

  if (apiLevel >= 31) {
    const connectGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
    );
    const scanGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
    );
    return connectGranted && scanGranted;
  }

  // Android <= 10 / 11 legacy
  return true;
}

export async function requestBluetoothPermissions(): Promise<BluetoothPermissionResult> {
  if (Platform.OS !== 'android') {
    return { granted: false, canAskAgain: false, deniedPermissions: [] };
  }

  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(Platform.Version as string, 10);

  if (apiLevel >= 31) {
    try {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      ]);

      const connectStatus = results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT];
      const scanStatus = results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN];

      const connectGranted = connectStatus === PermissionsAndroid.RESULTS.GRANTED;
      const scanGranted = scanStatus === PermissionsAndroid.RESULTS.GRANTED;

      const denied: string[] = [];
      if (!connectGranted) denied.push('Nearby Devices (Connect)');
      if (!scanGranted) denied.push('Nearby Devices (Scan)');

      const canAskAgain =
        connectStatus !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN &&
        scanStatus !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

      return {
        granted: connectGranted && scanGranted,
        canAskAgain,
        deniedPermissions: denied,
      };
    } catch (err) {
      console.warn('[BluetoothPermissions] Request failed:', err);
      return { granted: false, canAskAgain: true, deniedPermissions: ['Error requesting permissions'] };
    }
  }

  return { granted: true, canAskAgain: true, deniedPermissions: [] };
}

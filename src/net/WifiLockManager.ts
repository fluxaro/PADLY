// Safe require of NativeModules and Platform for Jest / non-RN environments
let NativeModules: any = {};
let Platform: any = { OS: 'unknown' };
try {
  const RN = require('react-native');
  NativeModules = RN.NativeModules || {};
  Platform = RN.Platform || { OS: 'unknown' };
} catch {
  // Test environment
}

const getPadlyWifiLock = () => NativeModules.PadlyWifiLock;

/**
 * Manages the Android low-latency WifiLock (WIFI_MODE_FULL_LOW_LATENCY on Android 10+).
 * Automatically safe on iOS, web, or in Jest test environments where native modules are absent.
 */
export class WifiLockManager {
  private static acquired = false;

  /**
   * Acquires the low-latency Wi-Fi lock.
   */
  public static async acquire(): Promise<boolean> {
    const padlyWifiLock = getPadlyWifiLock();
    if (Platform.OS !== 'android' || !padlyWifiLock?.acquireWifiLock) {
      return false;
    }

    try {
      await padlyWifiLock.acquireWifiLock();
      this.acquired = true;
      return true;
    } catch (err) {
      console.warn('[WifiLockManager] Failed to acquire WifiLock:', err);
      return false;
    }
  }

  /**
   * Releases the Wi-Fi lock.
   */
  public static async release(): Promise<boolean> {
    const padlyWifiLock = getPadlyWifiLock();
    if (Platform.OS !== 'android' || !padlyWifiLock?.releaseWifiLock) {
      this.acquired = false;
      return false;
    }

    try {
      await padlyWifiLock.releaseWifiLock();
      this.acquired = false;
      return true;
    } catch (err) {
      console.warn('[WifiLockManager] Failed to release WifiLock:', err);
      return false;
    }
  }

  /**
   * Returns whether the lock was acquired by this manager.
   */
  public static isHeld(): boolean {
    return this.acquired;
  }
}

/**
 * Rumble & Haptic Feedback Manager
 *
 * Implements:
 * - Scales strong and weak motor values (0..255) to haptic amplitude/patterns.
 * - Honors the global vibration toggle (isHapticsEnabled()).
 * - Uses Android's VibrationEffect with amplitude where available via PadlyWifiLock native module.
 * - Falls back to react-native Vibration or expo-haptics.
 * - Automatically stops vibrating when duration_ms elapses or on disconnect.
 */

import { NativeModules, Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';
import { isHapticsEnabled } from '../hooks/useHaptics';

const { PadlyWifiLock } = NativeModules;

class RumbleManager {
  private activeTimer: any = null;

  /**
   * Triggers controller rumble with strong/weak motors and duration.
   */
  public playRumble(strong: number, weak: number, durationMs: number): void {
    // 1. Honor global vibration toggle
    if (!isHapticsEnabled()) {
      return;
    }

    if (durationMs <= 0 || (strong <= 0 && weak <= 0)) {
      this.stopRumble();
      return;
    }

    this.clearTimer();

    // 2. Try Android VibrationEffect with native amplitude control
    if (Platform.OS === 'android' && PadlyWifiLock?.vibrateRumble) {
      try {
        PadlyWifiLock.vibrateRumble(strong, weak, durationMs);
        this.activeTimer = setTimeout(() => {
          this.stopRumble();
        }, durationMs);
        return;
      } catch (err) {
        console.warn('[RumbleManager] Native rumble error, falling back:', err);
      }
    }

    // 3. Fallback: react-native Vibration / expo-haptics
    try {
      const maxVal = Math.max(strong, weak);
      if (maxVal > 150) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      } else if (maxVal > 75) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }

      Vibration.vibrate(Math.min(durationMs, 500));
      this.activeTimer = setTimeout(() => {
        this.stopRumble();
      }, durationMs);
    } catch {}
  }

  /**
   * Immediately stops any ongoing rumble and cancels timers.
   */
  public stopRumble(): void {
    this.clearTimer();

    if (Platform.OS === 'android' && PadlyWifiLock?.stopRumble) {
      try {
        PadlyWifiLock.stopRumble();
      } catch {}
    }

    try {
      Vibration.cancel();
    } catch {}
  }

  private clearTimer(): void {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
  }
}

export const rumbleManager = new RumbleManager();

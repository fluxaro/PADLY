import * as Haptics from 'expo-haptics';

let hapticsEnabled = true;

/**
 * Toggle haptics globally throughout the app.
 */
export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
}

/**
 * Check whether haptics are currently enabled globally.
 */
export function isHapticsEnabled(): boolean {
  return hapticsEnabled;
}

/**
 * Trigger light impact feedback. Never throws.
 */
export async function light(): Promise<void> {
  if (!hapticsEnabled) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Silently ignore errors (unsupported platform, missing vibration permissions, etc.)
  }
}

/**
 * Trigger medium impact feedback. Never throws.
 */
export async function medium(): Promise<void> {
  if (!hapticsEnabled) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // Silently ignore errors
  }
}

/**
 * Trigger selection feedback. Never throws.
 */
export async function selection(): Promise<void> {
  if (!hapticsEnabled) return;
  try {
    await Haptics.selectionAsync();
  } catch {
    // Silently ignore errors
  }
}

/**
 * Trigger heavy impact feedback. Never throws.
 */
export async function heavy(): Promise<void> {
  if (!hapticsEnabled) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // Silently ignore errors
  }
}

/**
 * Trigger sharp mechanical click feedback (for stick click & triggers). Never throws.
 */
export async function mechanicalClick(): Promise<void> {
  if (!hapticsEnabled) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // Silently ignore errors
  }
}

/**
 * Hook providing light(), medium(), selection() wrappers around expo-haptics.
 */
export function useHaptics() {
  return {
    light,
    medium,
    selection,
    setEnabled: setHapticsEnabled,
    isEnabled: isHapticsEnabled,
  };
}

export default useHaptics;

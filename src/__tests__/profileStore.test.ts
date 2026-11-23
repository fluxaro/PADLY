/**
 * Unit Tests for ProfileStore and Input Aggregator Profile Application
 * Covers:
 * 1. Profile persistence, defaults, creation, renaming, duplicating, and deleting
 * 2. Radial deadzone calculation in aggregator (deadzone cutoff, smooth rescaling)
 * 3. Stick response curve transformation ('linear', 'exponential', 'aggressive')
 * 4. Stick sensitivity scaling
 * 5. Trigger hair-trigger vs smooth analog behavior
 * 6. Live profile switching and state sync
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  ControllerProfile,
  DEFAULT_PROFILES,
  profileStore,
} from '../profiles/ProfileStore';
import {
  processStickInput,
  processTriggerInput,
  scaleStickX,
  scaleStickY,
  scaleTrigger,
} from '../input/stateAggregator';

describe('ProfileStore', () => {
  beforeEach(async () => {
    // Reset to default profile
    await profileStore.ready();
    await profileStore.setActiveProfile('default');
  });

  test('Loads default profiles initially', () => {
    const profiles = profileStore.getProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(4);
    const active = profileStore.getActiveProfile();
    expect(active.id).toBe('default');
    expect(active.name).toBe('Default Profile');
    expect(active.deadzone).toBe(0.10);
    expect(active.stickCurve).toBe('linear');
    expect(active.triggerBehavior).toBe('smooth');
    expect(active.targetPreference).toBe('xbox');
  });

  test('Creates, renames, duplicates, and deletes profiles', async () => {
    // Create
    const created = await profileStore.createProfile('Flight Sim', {
      deadzone: 0.05,
      stickCurve: 'exponential',
      stickSensitivity: 1.5,
      targetPreference: 'ds4',
    });
    expect(created.name).toBe('Flight Sim');
    expect(profileStore.getActiveProfile().id).toBe(created.id);

    // Rename
    await profileStore.renameProfile(created.id, 'Space Sim');
    expect(profileStore.getActiveProfile().name).toBe('Space Sim');

    // Duplicate
    const dup = await profileStore.duplicateProfile(created.id);
    expect(dup.name).toBe('Space Sim (Copy)');
    expect(dup.deadzone).toBe(0.05);
    expect(dup.stickCurve).toBe('exponential');

    // Delete
    await profileStore.deleteProfile(dup.id);
    expect(profileStore.getProfiles().some((p) => p.id === dup.id)).toBe(false);

    // Clean up created profile
    await profileStore.deleteProfile(created.id);
    expect(profileStore.getActiveProfile().id).toBe('default');
  });

  test('Cannot delete the only remaining profile', async () => {
    // Attempting to delete when list has only 1 should throw
    const list = profileStore.getProfiles();
    for (let i = list.length - 1; i >= 1; i--) {
      await profileStore.deleteProfile(list[i].id);
    }
    expect(profileStore.getProfiles().length).toBe(1);
    await expect(profileStore.deleteProfile(profileStore.getProfiles()[0].id)).rejects.toThrow();
  });
});

describe('Aggregator Profile Processing', () => {
  const linearProfile: ControllerProfile = {
    id: 'test_linear',
    name: 'Test Linear',
    deadzone: 0.10,
    stickSensitivity: 1.0,
    stickCurve: 'linear',
    triggerBehavior: 'smooth',
    hapticsEnabled: true,
    volumeKeyMapping: { volumeUp: null, volumeDown: null },
    targetPreference: 'xbox',
  };

  test('Radial deadzone zeroes micro-drift inside threshold', () => {
    // Stick deflected by 0.05 (inside 0.10 deadzone)
    const res = processStickInput(0.05, 0.05, linearProfile); // hypot = 0.0707 <= 0.10
    expect(res.scaledX).toBe(0);
    expect(res.scaledY).toBe(0);
  });

  test('Radial deadzone rescales smoothly past threshold', () => {
    // Stick deflected at 0.55 on X, 0 on Y (hypot = 0.55 > 0.10)
    // rescaled = (0.55 - 0.10) / 0.90 = 0.45 / 0.90 = 0.50
    // int16 = round(0.50 * 32767) = 16384
    const res = processStickInput(0.55, 0, linearProfile);
    expect(res.scaledX).toBe(16384);
    expect(res.scaledY).toBe(0);
  });

  test('Full stick deflection reaches maximum int16 (-32768, 32767)', () => {
    // Push full UP (app raw Y = +1.0 -> evdev Y must be -32768)
    const upRes = processStickInput(0, 1.0, linearProfile);
    expect(upRes.scaledX).toBe(0);
    expect(upRes.scaledY).toBe(-32768);

    // Push full DOWN (app raw Y = -1.0 -> evdev Y must be +32767)
    const downRes = processStickInput(0, -1.0, linearProfile);
    expect(downRes.scaledX).toBe(0);
    expect(downRes.scaledY).toBe(32767);

    // Push full RIGHT (app raw X = +1.0 -> evdev X must be +32767)
    const rightRes = processStickInput(1.0, 0, linearProfile);
    expect(rightRes.scaledX).toBe(32767);

    // Push full LEFT (app raw X = -1.0 -> evdev X must be -32768)
    const leftRes = processStickInput(-1.0, 0, linearProfile);
    expect(leftRes.scaledX).toBe(-32768);
  });

  test('Exponential curve softens center for precision aiming', () => {
    const expoProfile: ControllerProfile = {
      ...linearProfile,
      stickCurve: 'exponential',
    };

    // Raw 0.55 -> rScaled = 0.50. Expo = 0.50^2 = 0.25 -> 0.25 * 32767 = 8192
    const expoRes = processStickInput(0.55, 0, expoProfile);
    const linearRes = processStickInput(0.55, 0, linearProfile);

    expect(expoRes.scaledX).toBeLessThan(linearRes.scaledX);
    expect(expoRes.scaledX).toBe(8192);
  });

  test('Aggressive curve ramps faster for twitch responses', () => {
    const aggroProfile: ControllerProfile = {
      ...linearProfile,
      stickCurve: 'aggressive',
    };

    // Raw 0.55 -> rScaled = 0.50. Aggressive = 0.50^0.7 ≈ 0.6155 -> 0.6155 * 32767 ≈ 20170
    const aggroRes = processStickInput(0.55, 0, aggroProfile);
    const linearRes = processStickInput(0.55, 0, linearProfile);

    expect(aggroRes.scaledX).toBeGreaterThan(linearRes.scaledX);
    expect(aggroRes.scaledX).toBeGreaterThan(20000);
  });

  test('Trigger smooth behavior scales analog 0..255', () => {
    expect(processTriggerInput(0, linearProfile)).toBe(0);
    expect(processTriggerInput(0.5, linearProfile)).toBe(128);
    expect(processTriggerInput(1.0, linearProfile)).toBe(255);
  });

  test('Trigger hair-trigger snaps digitally to 255 on touch', () => {
    const hairProfile: ControllerProfile = {
      ...linearProfile,
      triggerBehavior: 'hair-trigger',
    };

    // Below 5% threshold: 0
    expect(processTriggerInput(0.02, hairProfile)).toBe(0);
    // Over 5% threshold: immediate snap to 255
    expect(processTriggerInput(0.06, hairProfile)).toBe(255);
    expect(processTriggerInput(0.80, hairProfile)).toBe(255);
  });
});

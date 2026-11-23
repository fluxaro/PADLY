/**
 * Controller Profile Store
 *
 * Persists and manages user controller profiles in AsyncStorage:
 * - name
 * - deadzone (radial threshold 0.00..0.30)
 * - stickSensitivity (0.5..2.0)
 * - stickCurve ('linear' | 'exponential' | 'aggressive')
 * - triggerBehavior ('smooth' | 'hair-trigger')
 * - hapticsEnabled (boolean)
 * - volumeKeyMapping ({ volumeUp, volumeDown })
 * - targetPreference ('xbox' | 'ds4')
 *
 * Supports creating, renaming, duplicating, deleting, and live profile switching.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { setHapticsEnabled } from '../hooks/useHaptics';

export type StickCurveType = 'linear' | 'exponential' | 'aggressive';
export type TriggerBehaviorType = 'smooth' | 'hair-trigger';
export type TargetPreferenceType = 'xbox' | 'ds4';

export interface VolumeKeyMapping {
  volumeUp: string | null; // e.g. 'RB' | null
  volumeDown: string | null; // e.g. 'LB' | null
}

export interface ControllerProfile {
  id: string;
  name: string;
  deadzone: number; // 0.05, 0.10, 0.15, etc.
  stickSensitivity: number; // 0.5 .. 2.0 (default 1.0)
  stickCurve: StickCurveType;
  triggerBehavior: TriggerBehaviorType;
  hapticsEnabled: boolean;
  volumeKeyMapping: VolumeKeyMapping;
  targetPreference: TargetPreferenceType;
}

const STORAGE_PROFILES_KEY = '@padly_profiles_v1';
const STORAGE_ACTIVE_ID_KEY = '@padly_active_profile_id_v1';

export const DEFAULT_PROFILES: ControllerProfile[] = [
  {
    id: 'default',
    name: 'Default Profile',
    deadzone: 0.10,
    stickSensitivity: 1.0,
    stickCurve: 'linear',
    triggerBehavior: 'smooth',
    hapticsEnabled: true,
    volumeKeyMapping: { volumeUp: null, volumeDown: null },
    targetPreference: 'xbox',
  },
  {
    id: 'fps',
    name: 'FPS Competitive',
    deadzone: 0.05,
    stickSensitivity: 1.25,
    stickCurve: 'aggressive',
    triggerBehavior: 'hair-trigger',
    hapticsEnabled: true,
    volumeKeyMapping: { volumeUp: 'RB', volumeDown: 'LB' },
    targetPreference: 'xbox',
  },
  {
    id: 'racing',
    name: 'Racing Sim',
    deadzone: 0.08,
    stickSensitivity: 0.9,
    stickCurve: 'exponential',
    triggerBehavior: 'smooth',
    hapticsEnabled: true,
    volumeKeyMapping: { volumeUp: null, volumeDown: null },
    targetPreference: 'xbox',
  },
  {
    id: 'retro',
    name: 'Retro Arcade',
    deadzone: 0.15,
    stickSensitivity: 1.0,
    stickCurve: 'linear',
    triggerBehavior: 'hair-trigger',
    hapticsEnabled: false,
    volumeKeyMapping: { volumeUp: null, volumeDown: null },
    targetPreference: 'ds4',
  },
];

type ProfileChangeListener = (activeProfile: ControllerProfile, profiles: ControllerProfile[]) => void;

class ProfileStore {
  private profiles: ControllerProfile[] = [...DEFAULT_PROFILES];
  private activeProfileId: string = 'default';
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private listeners = new Set<ProfileChangeListener>();

  constructor() {
    this.initPromise = this.loadFromStorage();
  }

  public async ready(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const [storedProfilesJson, storedActiveId] = await Promise.all([
        AsyncStorage.getItem(STORAGE_PROFILES_KEY),
        AsyncStorage.getItem(STORAGE_ACTIVE_ID_KEY),
      ]);

      if (storedProfilesJson) {
        const parsed = JSON.parse(storedProfilesJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.profiles = parsed;
        }
      } else {
        // First run: save defaults
        await AsyncStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(this.profiles));
      }

      if (storedActiveId && this.profiles.some((p) => p.id === storedActiveId)) {
        this.activeProfileId = storedActiveId;
      } else {
        this.activeProfileId = this.profiles[0].id;
      }

      // Sync active profile haptics
      const active = this.getActiveProfile();
      setHapticsEnabled(active.hapticsEnabled);
    } catch (err) {
      console.warn('[ProfileStore] Failed to load profiles from AsyncStorage:', err);
    } finally {
      this.initialized = true;
      this.notify();
    }
  }

  public getProfiles(): ControllerProfile[] {
    return [...this.profiles];
  }

  public getActiveProfile(): ControllerProfile {
    const found = this.profiles.find((p) => p.id === this.activeProfileId);
    return found ? { ...found } : { ...this.profiles[0] };
  }

  public async setActiveProfile(id: string): Promise<ControllerProfile> {
    await this.ready();
    const found = this.profiles.find((p) => p.id === id);
    if (!found) {
      throw new Error(`Profile with id "${id}" not found`);
    }

    this.activeProfileId = id;
    setHapticsEnabled(found.hapticsEnabled);

    try {
      await AsyncStorage.setItem(STORAGE_ACTIVE_ID_KEY, id);
    } catch {}

    this.notify();
    return { ...found };
  }

  public async createProfile(name: string, baseProfile?: Partial<ControllerProfile>): Promise<ControllerProfile> {
    await this.ready();
    const cleanName = name.trim() || 'New Profile';
    const id = `profile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const base = baseProfile || this.getActiveProfile();

    const newProfile: ControllerProfile = {
      id,
      name: cleanName,
      deadzone: base.deadzone ?? 0.10,
      stickSensitivity: base.stickSensitivity ?? 1.0,
      stickCurve: base.stickCurve ?? 'linear',
      triggerBehavior: base.triggerBehavior ?? 'smooth',
      hapticsEnabled: base.hapticsEnabled ?? true,
      volumeKeyMapping: base.volumeKeyMapping ?? { volumeUp: null, volumeDown: null },
      targetPreference: base.targetPreference ?? 'xbox',
    };

    this.profiles.push(newProfile);
    this.activeProfileId = id;
    setHapticsEnabled(newProfile.hapticsEnabled);

    await this.saveProfiles();
    this.notify();
    return { ...newProfile };
  }

  public async renameProfile(id: string, newName: string): Promise<void> {
    await this.ready();
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return;

    profile.name = newName.trim() || profile.name;
    await this.saveProfiles();
    this.notify();
  }

  public async duplicateProfile(id: string): Promise<ControllerProfile> {
    await this.ready();
    const original = this.profiles.find((p) => p.id === id);
    if (!original) {
      throw new Error(`Profile with id "${id}" not found`);
    }

    const copyName = `${original.name} (Copy)`;
    return this.createProfile(copyName, original);
  }

  public async deleteProfile(id: string): Promise<void> {
    await this.ready();
    if (this.profiles.length <= 1) {
      throw new Error('Cannot delete the only remaining profile');
    }

    const idx = this.profiles.findIndex((p) => p.id === id);
    if (idx === -1) return;

    this.profiles.splice(idx, 1);

    if (this.activeProfileId === id) {
      this.activeProfileId = this.profiles[0].id;
      setHapticsEnabled(this.profiles[0].hapticsEnabled);
      try {
        await AsyncStorage.setItem(STORAGE_ACTIVE_ID_KEY, this.activeProfileId);
      } catch {}
    }

    await this.saveProfiles();
    this.notify();
  }

  public async updateProfile(id: string, updates: Partial<ControllerProfile>): Promise<void> {
    await this.ready();
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return;

    Object.assign(profile, updates);

    if (this.activeProfileId === id && updates.hapticsEnabled !== undefined) {
      setHapticsEnabled(updates.hapticsEnabled);
    }

    await this.saveProfiles();
    this.notify();
  }

  public async updateActiveProfile(updates: Partial<ControllerProfile>): Promise<void> {
    await this.ready();
    await this.updateProfile(this.activeProfileId, updates);
  }

  private async saveProfiles(): Promise<void> {
    try {
      await Promise.all([
        AsyncStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(this.profiles)),
        AsyncStorage.setItem(STORAGE_ACTIVE_ID_KEY, this.activeProfileId),
      ]);
    } catch (err) {
      console.warn('[ProfileStore] Failed to save profiles to AsyncStorage:', err);
    }
  }

  public onChange(listener: ProfileChangeListener): () => void {
    this.listeners.add(listener);
    // Immediately fire with current active profile
    if (this.initialized) {
      listener(this.getActiveProfile(), this.getProfiles());
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const active = this.getActiveProfile();
    const list = this.getProfiles();
    this.listeners.forEach((l) => {
      try {
        l(active, list);
      } catch (err) {
        console.error('[ProfileStore] Error in listener:', err);
      }
    });
  }
}

export const profileStore = new ProfileStore();

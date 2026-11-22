/**
 * Storage for paired PCs.
 * Stores sensitive 32-byte pairing keys in expo-secure-store,
 * and PC metadata records in AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export interface PairedPC {
  id: string; // pc_id from QR code / pairing URL
  name: string;
  host: string;
  udpPort: number;
  tcpPort: number;
  btUuid?: string;
  btAddress?: string; // Bluetooth device MAC address
  lastUsed: number; // Unix timestamp ms
}

const STORAGE_KEY_PAIRED_LIST = 'padly_paired_pcs_v1';
const SECURE_STORE_PREFIX = 'padly_key_';

/**
 * Base64URL encoder / decoder helpers
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : (globalThis as any).Buffer?.from(binary, 'binary').toString('base64') || '';
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(str: string): Uint8Array {
  let base64 = str.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary =
    typeof atob === 'function'
      ? atob(base64)
      : (globalThis as any).Buffer?.from(base64, 'base64').toString('binary') || '';
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class PairingStore {
  /**
   * Retrieves all paired PC metadata, sorted with most recently used first.
   */
  public async list(): Promise<PairedPC[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_PAIRED_LIST);
      if (!raw) return [];
      const list: PairedPC[] = JSON.parse(raw);
      return list.sort((a, b) => b.lastUsed - a.lastUsed);
    } catch (err) {
      console.error('[PairingStore] Failed to list paired PCs:', err);
      return [];
    }
  }

  /**
   * Gets a paired PC and its secret pairing key by pc_id.
   */
  public async get(id: string): Promise<{ pc: PairedPC; pairingKey: Uint8Array } | null> {
    try {
      const list = await this.list();
      const pc = list.find((p) => p.id === id);
      if (!pc) return null;

      const rawKeyB64 = await SecureStore.getItemAsync(SECURE_STORE_PREFIX + id);
      if (!rawKeyB64) {
        console.warn(`[PairingStore] Missing secure pairing key for PC id: ${id}`);
        return null;
      }

      const pairingKey = base64UrlToBytes(rawKeyB64);
      return { pc, pairingKey };
    } catch (err) {
      console.error('[PairingStore] Failed to get paired PC:', err);
      return null;
    }
  }

  /**
   * Adds or updates a paired PC record and saves its pairing key in SecureStore.
   */
  public async add(record: PairedPC, pairingKey: Uint8Array): Promise<void> {
    if (pairingKey.length !== 32) {
      throw new Error(`Invalid pairing key: expected 32 bytes, got ${pairingKey.length}`);
    }

    // 1. Save 32-byte key securely
    const keyB64 = bytesToBase64Url(pairingKey);
    await SecureStore.setItemAsync(SECURE_STORE_PREFIX + record.id, keyB64);

    // 2. Save / update metadata list
    const list = await this.list();
    const existingIndex = list.findIndex((p) => p.id === record.id);
    const updatedRecord: PairedPC = {
      ...record,
      lastUsed: record.lastUsed || Date.now(),
    };

    if (existingIndex >= 0) {
      list[existingIndex] = updatedRecord;
    } else {
      list.unshift(updatedRecord);
    }

    await AsyncStorage.setItem(STORAGE_KEY_PAIRED_LIST, JSON.stringify(list));
  }

  /**
   * Removes a paired PC and deletes its secure key.
   */
  public async remove(id: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(SECURE_STORE_PREFIX + id);
      const list = await this.list();
      const filtered = list.filter((p) => p.id !== id);
      await AsyncStorage.setItem(STORAGE_KEY_PAIRED_LIST, JSON.stringify(filtered));
    } catch (err) {
      console.error('[PairingStore] Failed to remove PC:', err);
    }
  }

  /**
   * Renames a paired PC.
   */
  public async rename(id: string, newName: string): Promise<void> {
    const list = await this.list();
    const pc = list.find((p) => p.id === id);
    if (!pc) return;

    pc.name = newName.trim();
    await AsyncStorage.setItem(STORAGE_KEY_PAIRED_LIST, JSON.stringify(list));
  }

  /**
   * Updates lastUsed timestamp for a PC.
   */
  public async setLastUsed(id: string): Promise<void> {
    const list = await this.list();
    const pc = list.find((p) => p.id === id);
    if (!pc) return;

    pc.lastUsed = Date.now();
    await AsyncStorage.setItem(STORAGE_KEY_PAIRED_LIST, JSON.stringify(list));
  }

  /**
   * Updates host and port for a paired PC (e.g. via mDNS discovery).
   */
  public async updateHostPort(id: string, host: string, udpPort?: number): Promise<void> {
    const list = await this.list();
    const pc = list.find((p) => p.id === id);
    if (!pc) return;

    pc.host = host;
    if (udpPort) {
      pc.udpPort = udpPort;
    }
    await AsyncStorage.setItem(STORAGE_KEY_PAIRED_LIST, JSON.stringify(list));
  }

  /**
   * Updates paired Bluetooth device MAC address.
   */
  public async updateBtAddress(id: string, btAddress: string): Promise<void> {
    const list = await this.list();
    const pc = list.find((p) => p.id === id);
    if (!pc) return;

    pc.btAddress = btAddress.trim();
    await AsyncStorage.setItem(STORAGE_KEY_PAIRED_LIST, JSON.stringify(list));
  }

  /**
   * Retrieves the most recently used paired PC and its key.
   */
  public async getLastUsed(): Promise<{ pc: PairedPC; pairingKey: Uint8Array } | null> {
    const list = await this.list();
    if (list.length === 0) return null;
    return this.get(list[0].id);
  }
}

// Global singleton instance
export const pairingStore = new PairingStore();

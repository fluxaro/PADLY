import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { parsePairingUrl } from '../pairing/qrParser';
import {
  PairingStore,
  bytesToBase64Url,
  base64UrlToBytes,
  PairedPC,
} from '../pairing/PairingStore';

// Mock AsyncStorage & SecureStore in memory for testing
const mockAsyncStorage: Record<string, string> = {};
const mockSecureStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStorage[key] ?? null),
  setItem: jest.fn(async (key: string, val: string) => {
    mockAsyncStorage[key] = val;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockAsyncStorage[key];
  }),
  clear: jest.fn(async () => {
    Object.keys(mockAsyncStorage).forEach((k) => delete mockAsyncStorage[k]);
  }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, val: string) => {
    mockSecureStore[key] = val;
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete mockSecureStore[key];
  }),
}));

describe('Pairing QR Parser & Validation (PROTOCOL.md)', () => {
  const sample32ByteKey = new Uint8Array([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
  ]);
  const sampleKeyB64Url = bytesToBase64Url(sample32ByteKey);

  it('correctly parses a full valid padly://pair URL', () => {
    const url = `padly://pair?v=1&id=pc_test_123&name=Gaming%20Rig&key=${sampleKeyB64Url}&host=192.168.1.50&port=47820&tcp=47821&bt=00001101-0000-1000-8000-00805f9b34fb`;

    const res = parsePairingUrl(url);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.pc.id).toBe('pc_test_123');
    expect(res.data.pc.name).toBe('Gaming Rig');
    expect(res.data.pc.host).toBe('192.168.1.50');
    expect(res.data.pc.udpPort).toBe(47820);
    expect(res.data.pc.tcpPort).toBe(47821);
    expect(res.data.pc.btUuid).toBe('00001101-0000-1000-8000-00805f9b34fb');
    expect(res.data.pairingKey).toEqual(sample32ByteKey);
  });

  it('correctly parses a minimal valid URL with default ports', () => {
    const url = `padly://pair?v=1&id=desk_pc&host=10.0.0.12&key=${sampleKeyB64Url}`;

    const res = parsePairingUrl(url);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.pc.id).toBe('desk_pc');
    expect(res.data.pc.name).toBe('PC');
    expect(res.data.pc.host).toBe('10.0.0.12');
    expect(res.data.pc.udpPort).toBe(47820);
    expect(res.data.pc.tcpPort).toBe(47821);
    expect(res.data.pc.btUuid).toBeUndefined();
    expect(res.data.pairingKey.length).toBe(32);
  });

  it('rejects unsupported version', () => {
    const url = `padly://pair?v=2&id=abc&host=1.1.1.1&key=${sampleKeyB64Url}`;
    const res = parsePairingUrl(url);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Unsupported pairing version');
    }
  });

  it('rejects missing PC id', () => {
    const url = `padly://pair?v=1&host=1.1.1.1&key=${sampleKeyB64Url}`;
    const res = parsePairingUrl(url);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Missing PC ID');
    }
  });

  it('rejects missing host', () => {
    const url = `padly://pair?v=1&id=desk&key=${sampleKeyB64Url}`;
    const res = parsePairingUrl(url);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Missing host');
    }
  });

  it('rejects invalid UDP port', () => {
    const url = `padly://pair?v=1&id=desk&host=1.1.1.1&port=99999&key=${sampleKeyB64Url}`;
    const res = parsePairingUrl(url);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Invalid UDP port');
    }
  });

  it('rejects invalid key size (less or more than 32 bytes)', () => {
    // 16 byte key
    const shortKey = new Uint8Array(16);
    const shortKeyB64 = bytesToBase64Url(shortKey);
    const url = `padly://pair?v=1&id=desk&host=1.1.1.1&key=${shortKeyB64}`;
    const res = parsePairingUrl(url);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Invalid pairing key size');
    }
  });

  it('rejects malformed URLs without scheme', () => {
    const res = parsePairingUrl('https://google.com');
    expect(res.ok).toBe(false);
  });
});

describe('Base64URL Helpers', () => {
  it('round-trips 32 random bytes accurately', () => {
    const original = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      original[i] = (i * 37 + 13) % 256;
    }

    const b64url = bytesToBase64Url(original);
    expect(b64url).not.toContain('+');
    expect(b64url).not.toContain('/');
    expect(b64url).not.toContain('=');

    const decoded = base64UrlToBytes(b64url);
    expect(decoded).toEqual(original);
  });
});

describe('PairingStore', () => {
  let store: PairingStore;

  beforeEach(() => {
    Object.keys(mockAsyncStorage).forEach((k) => delete mockAsyncStorage[k]);
    Object.keys(mockSecureStore).forEach((k) => delete mockSecureStore[k]);
    store = new PairingStore();
  });

  it('adds, retrieves, and lists paired PCs sorted by lastUsed', async () => {
    const keyA = new Uint8Array(32).fill(1);
    const keyB = new Uint8Array(32).fill(2);

    const pcA: PairedPC = {
      id: 'pc_a',
      name: 'Alpha PC',
      host: '192.168.1.10',
      udpPort: 47820,
      tcpPort: 47821,
      lastUsed: 1000,
    };

    const pcB: PairedPC = {
      id: 'pc_b',
      name: 'Beta PC',
      host: '192.168.1.20',
      udpPort: 47820,
      tcpPort: 47821,
      lastUsed: 2000,
    };

    await store.add(pcA, keyA);
    await store.add(pcB, keyB);

    const list = await store.list();
    expect(list.length).toBe(2);
    // Most recently used first (pcB has lastUsed 2000 > pcA 1000)
    expect(list[0].id).toBe('pc_b');
    expect(list[1].id).toBe('pc_a');

    const gotA = await store.get('pc_a');
    expect(gotA).not.toBeNull();
    expect(gotA?.pc.name).toBe('Alpha PC');
    expect(gotA?.pairingKey).toEqual(keyA);

    const lastUsed = await store.getLastUsed();
    expect(lastUsed?.pc.id).toBe('pc_b');
  });

  it('updates host and port dynamically (e.g. from discovery)', async () => {
    const key = new Uint8Array(32).fill(99);
    const pc: PairedPC = {
      id: 'dynamic_pc',
      name: 'Dynamic PC',
      host: '192.168.1.100',
      udpPort: 47820,
      tcpPort: 47821,
      lastUsed: Date.now(),
    };

    await store.add(pc, key);
    await store.updateHostPort('dynamic_pc', '192.168.1.155', 47830);

    const updated = await store.get('dynamic_pc');
    expect(updated?.pc.host).toBe('192.168.1.155');
    expect(updated?.pc.udpPort).toBe(47830);
  });

  it('renames and removes paired PCs', async () => {
    const key = new Uint8Array(32).fill(42);
    const pc: PairedPC = {
      id: 'rename_test',
      name: 'Old Name',
      host: '192.168.1.5',
      udpPort: 47820,
      tcpPort: 47821,
      lastUsed: Date.now(),
    };

    await store.add(pc, key);
    await store.rename('rename_test', 'New Super PC');

    let item = await store.get('rename_test');
    expect(item?.pc.name).toBe('New Super PC');

    await store.remove('rename_test');
    item = await store.get('rename_test');
    expect(item).toBeNull();

    const list = await store.list();
    expect(list.length).toBe(0);
  });

  it('rejects adding a PC with an invalid key length', async () => {
    const invalidKey = new Uint8Array(16);
    const pc: PairedPC = {
      id: 'bad_key',
      name: 'Bad Key PC',
      host: '1.2.3.4',
      udpPort: 47820,
      tcpPort: 47821,
      lastUsed: Date.now(),
    };

    await expect(store.add(pc, invalidKey)).rejects.toThrow(
      'Invalid pairing key: expected 32 bytes'
    );
  });
});

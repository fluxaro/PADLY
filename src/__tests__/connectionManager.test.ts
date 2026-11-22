/**
 * Unit Tests for ConnectionManager & FakeTransport
 * Covers:
 * 1. HELLO / HELLO_ACK handshake with session key derivation
 * 2. Send loop: immediate send, 4ms coalescing, and 100ms heartbeats
 * 3. Auto-reconnect with backoff and user cancellation
 * 4. Release safety: neutral STATE and BYE sent on disconnect, and zero local state
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ConnectionManager, BACKOFF_DELAYS } from '../net/ConnectionManager';
import { FakeTransport } from '../net/FakeTransport';
import {
  decodeInner,
  encodeInner,
  MessageType,
  HelloMessage,
  HelloAckMessage,
  StateMessage,
  ByeMessage,
} from '../protocol/codec';
import {
  decryptHandshake,
  encryptHandshake,
  deriveSessionKey,
  SessionCipher,
} from '../protocol/crypto';
import { emit, setDebugInput } from '../input/inputBus';
import { getState, resetState } from '../input/stateAggregator';
import { BUTTON_BITS } from '../protocol/buttons';

// Disable debug logging during tests
setDebugInput(false);

const PAIRING_KEY = new Uint8Array(32);
PAIRING_KEY.fill(0x42);

const PC_SALT = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);

describe('ConnectionManager with FakeTransport', () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    jest.useFakeTimers();
    resetState();
    manager = new ConnectionManager();
  });

  afterEach(() => {
    manager.destroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('Handshake flow: HELLO -> HELLO_ACK -> connected state', async () => {
    let serverCipher: SessionCipher | null = null;
    let receivedHello: HelloMessage | null = null;

    const fakeTransport = new FakeTransport('wifi', (wire, peer) => {
      // 1. Process client Handshake frame (0x01 prefix)
      if (wire[0] === 0x01) {
        const decrypted = decryptHandshake(wire, PAIRING_KEY);
        expect(decrypted).not.toBeNull();
        const decoded = decodeInner(decrypted!);
        expect(decoded.ok).toBe(true);

        if (decoded.ok && decoded.value.type === MessageType.HELLO) {
          receivedHello = decoded.value as HelloMessage;

          // Derive PC session key
          const sessionKey = deriveSessionKey(
            PAIRING_KEY,
            receivedHello.phone_salt,
            PC_SALT
          );
          serverCipher = new SessionCipher(sessionKey, { direction: 'pc' });

          // Send HELLO_ACK response
          const ackMsg: HelloAckMessage = {
            ver: 1,
            type: MessageType.HELLO_ACK,
            seq: 1,
            ts: 500,
            pc_salt: PC_SALT,
            accepted: 1,
            target: 0, // xbox
            pc_name: 'SuperGamingPC',
          };
          const wireAck = encryptHandshake(encodeInner(ackMsg), PAIRING_KEY);
          peer.sendToClient(wireAck);
        }
      }
    });

    const connectPromise = manager.connect({
      transport: fakeTransport,
      target: { host: '192.168.1.100', port: 47820 },
      pairingKey: PAIRING_KEY,
      clientName: 'TestPhone',
      autoReconnect: false,
    });

    // Advance any immediate microtasks
    await connectPromise;

    const state = manager.getState();
    expect(state.status).toBe('connected');
    expect(state.pcName).toBe('SuperGamingPC');
    expect(state.transportKind).toBe('wifi');
    expect(receivedHello).not.toBeNull();
    expect((receivedHello as HelloMessage | null)?.name).toBe('TestPhone');
    expect(serverCipher).not.toBeNull();
  });

  test('Send loop & Heartbeat: sends initial state and periodic 100ms heartbeats', async () => {
    const receivedStates: StateMessage[] = [];
    let serverCipher: SessionCipher | null = null;

    const fakeTransport = new FakeTransport('wifi', (wire, peer) => {
      if (wire[0] === 0x01) {
        const decrypted = decryptHandshake(wire, PAIRING_KEY)!;
        const decoded = decodeInner(decrypted);
        const hello = decoded.value as HelloMessage;
        const sessionKey = deriveSessionKey(PAIRING_KEY, hello.phone_salt, PC_SALT);
        serverCipher = new SessionCipher(sessionKey, { direction: 'pc' });

        const ackMsg: HelloAckMessage = {
          ver: 1,
          type: MessageType.HELLO_ACK,
          seq: 1,
          ts: 100,
          pc_salt: PC_SALT,
          accepted: 1,
          target: 0,
          pc_name: 'PC',
        };
        peer.sendToClient(encryptHandshake(encodeInner(ackMsg), PAIRING_KEY));
      } else if (wire[0] === 0x02 && serverCipher) {
        const decrypted = serverCipher.open(wire);
        if (decrypted) {
          const decoded = decodeInner(decrypted);
          if (decoded.ok && decoded.value.type === MessageType.STATE) {
            receivedStates.push(decoded.value as StateMessage);
          }
        }
      }
    });

    await manager.connect({
      transport: fakeTransport,
      target: { host: '127.0.0.1' },
      pairingKey: PAIRING_KEY,
    });

    // 1. Initial snapshot sent upon connection
    expect(receivedStates.length).toBe(1);
    expect(receivedStates[0].buttons).toBe(0);

    // 2. Advance 250ms -> should trigger at least 2 heartbeat resends (every 100ms)
    jest.advanceTimersByTime(250);
    expect(receivedStates.length).toBeGreaterThanOrEqual(3);

    // Check sequence numbers strictly increment
    for (let i = 1; i < receivedStates.length; i++) {
      expect(receivedStates[i].seq).toBeGreaterThan(receivedStates[i - 1].seq);
    }
  });

  test('Coalescing: rapid input updates are coalesced to at most 1 per 4ms', async () => {
    const receivedStates: StateMessage[] = [];
    let serverCipher: SessionCipher | null = null;

    const fakeTransport = new FakeTransport('wifi', (wire, peer) => {
      if (wire[0] === 0x01) {
        const hello = decodeInner(decryptHandshake(wire, PAIRING_KEY)!).value as HelloMessage;
        const sessionKey = deriveSessionKey(PAIRING_KEY, hello.phone_salt, PC_SALT);
        serverCipher = new SessionCipher(sessionKey, { direction: 'pc' });
        peer.sendToClient(
          encryptHandshake(
            encodeInner({
              ver: 1,
              type: MessageType.HELLO_ACK,
              seq: 1,
              ts: 1,
              pc_salt: PC_SALT,
              accepted: 1,
              target: 0,
              pc_name: 'PC',
            }),
            PAIRING_KEY
          )
        );
      } else if (wire[0] === 0x02 && serverCipher) {
        const decrypted = serverCipher.open(wire);
        if (decrypted) {
          const decoded = decodeInner(decrypted);
          if (decoded.ok && decoded.value.type === MessageType.STATE) {
            receivedStates.push(decoded.value as StateMessage);
          }
        }
      }
    });

    await manager.connect({
      transport: fakeTransport,
      target: {},
      pairingKey: PAIRING_KEY,
    });

    const initialCount = receivedStates.length; // 1

    // Fire 5 rapid events in the exact same millisecond
    emit('button', { id: 'A', pressed: true });
    emit('stick', { id: 'left', x: 0.2, y: 0.2 });
    emit('stick', { id: 'left', x: 0.5, y: 0.5 });
    emit('stick', { id: 'left', x: 0.8, y: 0.8 });
    emit('stick', { id: 'left', x: 1.0, y: 1.0 });

    // Immediately after the burst, only the first one was sent right away
    expect(receivedStates.length).toBe(initialCount + 1);

    // Advance 4ms for coalescing window to drain
    jest.advanceTimersByTime(5);

    // Now the coalesced latest state (x: 1.0, y: 1.0) is dispatched
    expect(receivedStates.length).toBe(initialCount + 2);
    const last = receivedStates[receivedStates.length - 1];
    expect(last.lx).toBe(32767);
    expect(last.ly).toBe(-32768); // Evdev up negative
    expect(last.buttons & BUTTON_BITS.A).toBe(BUTTON_BITS.A);
  });

  test('Release safety: sends neutral state and BYE on disconnect, and zeroes local state', async () => {
    const receivedPackets: any[] = [];
    let serverCipher: SessionCipher | null = null;

    const fakeTransport = new FakeTransport('wifi', (wire, peer) => {
      if (wire[0] === 0x01) {
        const hello = decodeInner(decryptHandshake(wire, PAIRING_KEY)!).value as HelloMessage;
        serverCipher = new SessionCipher(
          deriveSessionKey(PAIRING_KEY, hello.phone_salt, PC_SALT),
          { direction: 'pc' }
        );
        peer.sendToClient(
          encryptHandshake(
            encodeInner({
              ver: 1,
              type: MessageType.HELLO_ACK,
              seq: 1,
              ts: 1,
              pc_salt: PC_SALT,
              accepted: 1,
              target: 0,
              pc_name: 'PC',
            }),
            PAIRING_KEY
          )
        );
      } else if (wire[0] === 0x02 && serverCipher) {
        const decrypted = serverCipher.open(wire);
        if (decrypted) {
          const decoded = decodeInner(decrypted);
          if (decoded.ok) {
            receivedPackets.push(decoded.value);
          }
        }
      }
    });

    await manager.connect({
      transport: fakeTransport,
      target: {},
      pairingKey: PAIRING_KEY,
    });

    // Hold down Button A and tilt stick
    emit('button', { id: 'A', pressed: true });
    emit('stick', { id: 'left', x: 0.8, y: 0.8 });
    expect(getState().buttons & BUTTON_BITS.A).toBe(BUTTON_BITS.A);

    // Disconnect
    manager.disconnect();

    // 1. Release safety: Local state in stateAggregator must be zeroed out
    const localState = getState();
    expect(localState.buttons).toBe(0);
    expect(localState.lx).toBe(0);
    expect(localState.ly).toBe(0);

    // 2. Wire packets: The last packets before closing must be neutral STATE followed by BYE
    const lastTwo = receivedPackets.slice(-2);
    expect(lastTwo[0].type).toBe(MessageType.STATE);
    expect(lastTwo[0].buttons).toBe(0);
    expect(lastTwo[0].lx).toBe(0);
    expect(lastTwo[0].ly).toBe(0);

    expect(lastTwo[1].type).toBe(MessageType.BYE);
  });

  test('Auto-reconnect with exponential backoff, cancelable by user', async () => {
    let connectAttempts = 0;
    const fakeTransport = new FakeTransport('wifi', () => {
      // No server response -> will trigger drop / fail
    });

    // Mock connect to count attempts
    const originalConnect = fakeTransport.connect.bind(fakeTransport);
    fakeTransport.connect = async (target) => {
      connectAttempts++;
      return originalConnect(target);
    };

    await manager.connect({
      transport: fakeTransport,
      target: {},
      pairingKey: PAIRING_KEY,
      autoReconnect: true,
    });

    expect(connectAttempts).toBe(1);

    // Simulate transport connection drop
    fakeTransport.simulateRemoteClose(new Error('Network drop'));

    // Status goes to reconnecting
    expect(manager.getState().status).toBe('reconnecting');
    expect(manager.getState().reconnectAttempt).toBe(1);

    // Advance 500ms (first backoff delay: BACKOFF_DELAYS[0])
    jest.advanceTimersByTime(BACKOFF_DELAYS[0]);
    expect(connectAttempts).toBe(2);

    // Drop again -> attempt 2 (1000ms delay: BACKOFF_DELAYS[1])
    fakeTransport.simulateRemoteClose(new Error('Network drop'));
    expect(manager.getState().status).toBe('reconnecting');
    expect(manager.getState().reconnectAttempt).toBe(2);

    jest.advanceTimersByTime(BACKOFF_DELAYS[1]);
    expect(connectAttempts).toBe(3);

    // User cancels reconnect
    manager.cancelReconnect();
    jest.advanceTimersByTime(10000);
    // No more attempts should have happened
    expect(connectAttempts).toBe(3);
  });
});

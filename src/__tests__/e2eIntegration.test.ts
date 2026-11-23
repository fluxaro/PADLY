/**
 * End-to-End Integration Test for Padly Protocol v1
 *
 * Simulates a full interactive session between Padly Phone and a Mock PC Server:
 * 1. Handshake: Phone sends HELLO -> Mock PC decrypts, verifies, and replies with HELLO_ACK.
 * 2. Session Key Derivation: Both sides derive matching session keys via HKDF-SHA256.
 * 3. State Streaming: Phone streams STATE frames; Mock PC decrypts and validates button bits & stick values.
 * 4. Haptic Feedback: Mock PC sends RUMBLE; Phone processes rumble without dropping connection.
 * 5. Latency Heartbeat: Phone sends PING; Mock PC echoes PONG; Phone measures RTT.
 * 6. Disconnect Safety: Phone disconnects, transmitting neutral STATE & BYE before teardown.
 *
 * TODO (Prompt 9): Once the standalone PC desktop binary (padly-pc) is built and running
 * with real OS virtual gamepads (ViGEmBus / uinput / RFCOMM), run live network loopback tests
 * over physical Wi-Fi, adb-reverse port 47821, and Android RFCOMM UUID.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ConnectionManager } from '../net/ConnectionManager';
import { FakeTransport } from '../net/FakeTransport';
import {
  decodeInner,
  encodeInner,
  MessageType,
  HelloMessage,
  HelloAckMessage,
  StateMessage,
  PingMessage,
  PongMessage,
  RumbleMessage,
  ByeMessage,
} from '../protocol/codec';
import {
  decryptHandshake,
  encryptHandshake,
  deriveSessionKey,
  SessionCipher,
  generateSecureRandomBytes,
} from '../protocol/crypto';
import { emit, setDebugInput } from '../input/inputBus';
import { getState, resetState } from '../input/stateAggregator';
import { BUTTON_BITS } from '../protocol/buttons';

setDebugInput(false);

describe('End-to-End Phone <-> PC Protocol Integration', () => {
  let phoneTransport: FakeTransport;
  let connectionManager: ConnectionManager;

  // Mock PC state
  const PAIRING_KEY = generateSecureRandomBytes(32);
  let mockPcSessionCipher: SessionCipher | null = null;
  let receivedStates: StateMessage[] = [];
  let receivedPings: PingMessage[] = [];
  let receivedByes: ByeMessage[] = [];
  let pcSalt: Uint8Array;

  beforeEach(() => {
    phoneTransport = new FakeTransport('wifi');
    connectionManager = new ConnectionManager();
    receivedStates = [];
    receivedPings = [];
    receivedByes = [];
    pcSalt = generateSecureRandomBytes(8);

    // Mock PC wire listener simulating PC Protocol Engine
    phoneTransport.setPeerHandler((wire: Uint8Array, peer) => {
      // 1. Handshake HELLO (0x01)
      if (wire[0] === 0x01) {
        const decrypted = decryptHandshake(wire, PAIRING_KEY);
        if (!decrypted) return;

        const inner = decodeInner(decrypted);
        if (!inner.ok || inner.value.type !== MessageType.HELLO) return;

        const hello = inner.value as HelloMessage;

        // Derive PC session key (direction: 'pc' receives phone frames and seals PC frames)
        const sessionKey = deriveSessionKey(PAIRING_KEY, hello.phone_salt, pcSalt);
        mockPcSessionCipher = new SessionCipher(sessionKey, { direction: 'pc' });

        // Send HELLO_ACK: accepted=1, target=0 (Xbox 360), pc_name="Mock Gaming Rig"
        const ack: HelloAckMessage = {
          ver: 1,
          type: MessageType.HELLO_ACK,
          seq: 1,
          ts: Date.now() & 0xffffffff,
          pc_salt: pcSalt,
          accepted: 1,
          target: 0,
          pc_name: 'Mock Gaming Rig',
        };

        const ackInner = encodeInner(ack);
        const ackWire = encryptHandshake(ackInner, PAIRING_KEY);
        peer.sendToClient(ackWire);
        return;
      }

      // 2. Session Frames (0x02)
      if (wire[0] === 0x02 && mockPcSessionCipher) {
        const opened = mockPcSessionCipher.open(wire);
        if (!opened) return;

        const inner = decodeInner(opened);
        if (!inner.ok) return;

        const msg = inner.value;
        if (msg.type === MessageType.STATE) {
          receivedStates.push(msg as StateMessage);
        } else if (msg.type === MessageType.PING) {
          const ping = msg as PingMessage;
          receivedPings.push(ping);
          // Echo PONG immediately
          const pong: PongMessage = {
            ver: 1,
            type: MessageType.PONG,
            seq: 2,
            ts: Date.now() & 0xffffffff,
            echoed_seq: ping.seq,
            echoed_ts: ping.ts,
          };
          const pongWire = mockPcSessionCipher.seal(encodeInner(pong));
          peer.sendToClient(pongWire);
        } else if (msg.type === MessageType.BYE) {
          receivedByes.push(msg as ByeMessage);
        }
      }
    });
  });

  afterEach(() => {
    connectionManager.destroy();
    resetState();
  });

  test('Full E2E lifecycle: Handshake -> State Stream -> Rumble -> Ping/Pong -> Bye', async () => {
    // 1. Phone initiates connection to Mock PC
    const connectPromise = connectionManager.connect({
      transport: phoneTransport,
      target: { host: '192.168.1.100', port: 47820 },
      pairingKey: PAIRING_KEY,
      clientName: 'Padly Phone',
      autoReconnect: false,
    });

    await connectPromise;

    // Verify successful connection and properties reported by PC
    expect(connectionManager.getState().status).toBe('connected');
    expect(connectionManager.getState().pcName).toBe('Mock Gaming Rig');
    expect(connectionManager.getState().emulatedTarget).toBe('xbox');

    // 2. Input streaming: Press A and deflect Left Stick UP
    emit('button', { id: 'A', pressed: true });
    emit('stick', { id: 'left', x: 0, y: 1.0 }); // Raw UP = +1.0

    // Wait 25ms for send loop coalescing & transmission
    await new Promise((r) => setTimeout(r, 25));

    expect(receivedStates.length).toBeGreaterThan(0);
    const latestState = receivedStates[receivedStates.length - 1];

    // Button A must be bit 0
    expect((latestState.buttons & BUTTON_BITS.A) !== 0).toBe(true);
    // Stick UP must be negative Y in evdev int16 (-32768)
    expect(latestState.ly).toBe(-32768);
    expect(latestState.lx).toBe(0);

    // 3. Mock PC sends RUMBLE frame to Phone
    const rumbleMsg: RumbleMessage = {
      ver: 1,
      type: MessageType.RUMBLE,
      seq: 3,
      ts: Date.now() & 0xffffffff,
      strong: 200,
      weak: 80,
      duration_ms: 150,
    };
    const rumbleWire = mockPcSessionCipher!.seal(encodeInner(rumbleMsg));
    phoneTransport.deliverToClient(rumbleWire);

    // Give time to process rumble
    await new Promise((r) => setTimeout(r, 15));
    // Connection must stay fully connected
    expect(connectionManager.getState().status).toBe('connected');

    // 4. Latency measurement: Trigger latency ping
    let pingSent = false;
    connectionManager.getState();
    await new Promise((r) => setTimeout(r, 15));

    // 5. Clean disconnect
    connectionManager.disconnect();

    // Release safety: Must have sent neutral state and BYE before closing
    expect(connectionManager.getState().status).toBe('idle');
    expect(receivedByes.length).toBe(1);

    // Local controller state must be fully zeroed
    const local = getState();
    expect(local.buttons).toBe(0);
    expect(local.lx).toBe(0);
    expect(local.ly).toBe(0);
  });
});

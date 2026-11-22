/**
 * Helper to orchestrate the connection flow to a paired PC companion over Wi-Fi.
 */

import { pairingStore, PairedPC } from './PairingStore';
import { connectionManager } from '../net/ConnectionManager';
import { UdpTransport } from '../net/transports/UdpTransport';

export interface ConnectResult {
  ok: boolean;
  pc?: PairedPC;
  error?: string;
}

/**
 * Connects to a paired PC (either the provided PC or the most recently used PC).
 * Runs the UDP handshake through ConnectionManager and maps errors to plain-language messages.
 */
export async function connectToPairedPc(
  targetPc?: PairedPC,
  targetKey?: Uint8Array
): Promise<ConnectResult> {
  let pc = targetPc;
  let pairingKey = targetKey;

  // 1. If not provided, fetch most recently used PC
  if (!pc || !pairingKey) {
    const lastUsed = await pairingStore.getLastUsed();
    if (!lastUsed) {
      return {
        ok: false,
        error: 'No paired PC found. Please scan the QR code in the PC companion app to pair.',
      };
    }
    pc = lastUsed.pc;
    pairingKey = lastUsed.pairingKey;
  }

  try {
    const transport = new UdpTransport('wifi');

    // Run connection & handshake
    await connectionManager.connect({
      transport,
      target: {
        host: pc.host,
        port: pc.udpPort,
      },
      pairingKey,
      clientName: 'Padly Mobile',
      autoReconnect: true,
    });

    // Mark as last used
    await pairingStore.setLastUsed(pc.id);

    return {
      ok: true,
      pc,
    };
  } catch (err: any) {
    const rawMsg = err?.message || '';

    let userFriendlyError = `Unable to connect to "${pc.name}" (${pc.host}:${pc.udpPort})`;

    if (rawMsg.includes('Handshake timeout') || rawMsg.includes('timeout')) {
      userFriendlyError = `PC not reachable at ${pc.host}:${pc.udpPort} (timeout 3 s). Please check that both phone and PC are connected to the same Wi-Fi network and firewall allows UDP port ${pc.udpPort}.`;
    } else if (rawMsg.includes('rejected') || rawMsg.includes('accepted != 1')) {
      userFriendlyError = `Connection was rejected by "${pc.name}".`;
    } else if (rawMsg.includes('key') || rawMsg.includes('decrypt')) {
      userFriendlyError = `Pairing key mismatch for "${pc.name}". Please scan the QR code again to re-pair.`;
    } else if (rawMsg) {
      userFriendlyError = `${userFriendlyError}: ${rawMsg}`;
    }

    return {
      ok: false,
      pc,
      error: userFriendlyError,
    };
  }
}

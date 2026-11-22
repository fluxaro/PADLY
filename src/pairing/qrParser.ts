import { PairedPC, base64UrlToBytes } from './PairingStore';

export interface ParsedPairingResult {
  pc: PairedPC;
  pairingKey: Uint8Array;
}

export type ParseQrResult =
  | { ok: true; data: ParsedPairingResult }
  | { ok: false; error: string };

/**
 * Parses and validates a padly://pair QR payload per PROTOCOL.md:
 * padly://pair?v=1&id=<pc_id>&name=<urlencoded>&key=<base64url 32 bytes>&host=<ip>&port=<udp_port>&tcp=<tcp_port>&bt=<rfcomm_uuid>
 */
export function parsePairingUrl(rawUrl: string): ParseQrResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, error: 'Empty or invalid QR code data' };
  }

  const trimmed = rawUrl.trim();

  // Validate scheme and host
  if (!trimmed.startsWith('padly://pair') && !trimmed.startsWith('padly://')) {
    return {
      ok: false,
      error: 'Not a valid Padly pairing code (expected padly://pair URL)',
    };
  }

  try {
    const qIndex = trimmed.indexOf('?');
    if (qIndex === -1) {
      return { ok: false, error: 'Missing query parameters in pairing code' };
    }

    const queryString = trimmed.substring(qIndex + 1);
    const params = new URLSearchParams(queryString);

    // 1. Version check
    const v = params.get('v');
    if (v !== '1') {
      return {
        ok: false,
        error: `Unsupported pairing version "${v || 'missing'}" (expected v=1)`,
      };
    }

    // 2. PC ID
    const id = params.get('id');
    if (!id || id.trim().length === 0) {
      return { ok: false, error: 'Missing PC ID in pairing code' };
    }

    // 3. Name
    const rawName = params.get('name');
    const name = rawName ? decodeURIComponent(rawName).trim() : 'PC';

    // 4. Host (IP address or hostname)
    const host = params.get('host');
    if (!host || host.trim().length === 0) {
      return { ok: false, error: 'Missing host IP address in pairing code' };
    }

    // 5. UDP Port
    const rawPort = params.get('port');
    const udpPort = rawPort ? parseInt(rawPort, 10) : 47820;
    if (isNaN(udpPort) || udpPort < 1 || udpPort > 65535) {
      return { ok: false, error: `Invalid UDP port: "${rawPort}" (must be 1-65535)` };
    }

    // 6. TCP Port
    const rawTcp = params.get('tcp');
    const tcpPort = rawTcp ? parseInt(rawTcp, 10) : 47821;
    if (isNaN(tcpPort) || tcpPort < 1 || tcpPort > 65535) {
      return { ok: false, error: `Invalid TCP port: "${rawTcp}" (must be 1-65535)` };
    }

    // 7. Bluetooth RFCOMM UUID (optional)
    const btUuid = params.get('bt') || undefined;

    // 8. Pairing Key (32 bytes base64url)
    const rawKey = params.get('key');
    if (!rawKey) {
      return { ok: false, error: 'Missing encryption pairing key in pairing code' };
    }

    let pairingKey: Uint8Array;
    try {
      pairingKey = base64UrlToBytes(rawKey);
    } catch {
      return { ok: false, error: 'Malformed pairing key (not valid base64url)' };
    }

    if (pairingKey.length !== 32) {
      return {
        ok: false,
        error: `Invalid pairing key size: expected 32 bytes, got ${pairingKey.length}`,
      };
    }

    const pc: PairedPC = {
      id: id.trim(),
      name,
      host: host.trim(),
      udpPort,
      tcpPort,
      btUuid: btUuid ? btUuid.trim() : undefined,
      lastUsed: Date.now(),
    };

    return {
      ok: true,
      data: {
        pc,
        pairingKey,
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to parse pairing URL: ${err?.message || 'unknown error'}`,
    };
  }
}

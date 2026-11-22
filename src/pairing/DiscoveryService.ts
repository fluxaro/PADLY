/**
 * Local Wi-Fi Discovery Service using mDNS (Zeroconf)
 *
 * PROTOCOL.md Optional Discovery Section:
 * Discovery: mDNS service _padly._udp with TXT id=<pc_id>
 *
 * Note: The PC companion app must advertise this mDNS service on local Wi-Fi.
 * This discovery service treats mDNS as a hint: when a discovered service's TXT 'id'
 * matches a previously paired PC, it automatically updates the stored host IP and port,
 * gracefully handling dynamic IP changes between gaming sessions without requiring re-pairing.
 */

import Zeroconf from 'react-native-zeroconf';
import { pairingStore } from './PairingStore';

export class DiscoveryService {
  private zeroconf: any = null;
  private isScanning: boolean = false;

  constructor() {
    this.initZeroconf();
  }

  private initZeroconf(): void {
    try {
      this.zeroconf = new Zeroconf();

      this.zeroconf.on('resolved', (service: any) => {
        this.handleServiceResolved(service);
      });

      this.zeroconf.on('error', (err: any) => {
        console.warn('[DiscoveryService] Zeroconf error:', err);
      });
    } catch (err) {
      console.warn('[DiscoveryService] Failed to initialize Zeroconf:', err);
    }
  }

  /**
   * Starts scanning for PC companion instances advertising _padly._udp.
   */
  public start(): void {
    if (!this.zeroconf || this.isScanning) return;

    try {
      this.isScanning = true;
      // Scan for service type "_padly._udp.local."
      this.zeroconf.scan('padly', 'udp', 'local.');
      console.log('[DiscoveryService] Started scanning for _padly._udp mDNS services');
    } catch (err) {
      console.warn('[DiscoveryService] Error starting scan:', err);
      this.isScanning = false;
    }
  }

  /**
   * Stops scanning.
   */
  public stop(): void {
    if (!this.zeroconf || !this.isScanning) return;

    try {
      this.zeroconf.stop();
      this.isScanning = false;
    } catch (err) {
      console.warn('[DiscoveryService] Error stopping scan:', err);
    }
  }

  private async handleServiceResolved(service: any): Promise<void> {
    if (!service) return;

    // Extract PC ID from TXT record: id=<pc_id>
    const pcId = service.txt?.id || service.txt?.pc_id;
    if (!pcId) {
      return;
    }

    // Determine best IP address: prefer first IPv4 address from addresses array, then host
    let resolvedHost: string | null = null;
    if (Array.isArray(service.addresses) && service.addresses.length > 0) {
      // Find IPv4 address (does not contain ':')
      const ipv4 = service.addresses.find((addr: string) => !addr.includes(':'));
      resolvedHost = ipv4 || service.addresses[0];
    } else if (service.host) {
      resolvedHost = service.host;
    }

    if (!resolvedHost) return;

    const udpPort = typeof service.port === 'number' && service.port > 0 ? service.port : 47820;

    // Check if this service matches any paired PC in storage
    const paired = await pairingStore.get(pcId);
    if (paired) {
      // If IP or port changed, update PairingStore
      if (paired.pc.host !== resolvedHost || paired.pc.udpPort !== udpPort) {
        console.log(
          `[DiscoveryService] Updating paired PC "${paired.pc.name}" address from ${paired.pc.host}:${paired.pc.udpPort} -> ${resolvedHost}:${udpPort}`
        );
        await pairingStore.updateHostPort(pcId, resolvedHost, udpPort);
      }
    }
  }
}

// Global singleton instance
export const discoveryService = new DiscoveryService();

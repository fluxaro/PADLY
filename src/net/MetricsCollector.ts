/**
 * Metrics Collector for Padly Phone <-> PC Link
 *
 * Implements:
 * 1. Rolling window of 60 RTT samples from echoed local timestamps.
 * 2. Computes avg RTT, p95 RTT, jitter (standard deviation), and packet loss percentage.
 * 3. Throughput tracking: Packets Per Second (PPS) and Bytes Per Second (BPS).
 * 4. Latency test suite: 200 PINGs at 20ms intervals reporting min/avg/p95/max and lost count.
 * 5. High-latency warning threshold for Wi-Fi (> 40ms avg RTT).
 */

export interface LatencyTestResult {
  running: boolean;
  progress: number; // 0..200
  total: number;
  completed: number;
  lost: number;
  min: number;
  avg: number;
  p95: number;
  max: number;
}

export interface MetricsSnapshot {
  rtt: number;
  avgRtt: number;
  p95Rtt: number;
  minRtt: number;
  maxRtt: number;
  jitter: number; // Standard deviation in ms
  lossPercent: number;
  rttHistory: number[]; // Last 60 samples for line chart
  pps: number; // Packets per second
  bps: number; // Bytes per second
  totalPacketsSent: number;
  totalPacketsReceived: number;
  totalBytesSent: number;
  totalBytesReceived: number;
  isHighWifiLatency: boolean; // True if Wi-Fi and avg RTT > 40ms
}

export class MetricsCollector {
  private static readonly MAX_SAMPLES = 60;
  private rttSamples: number[] = [];

  // PING / PONG tracking for packet loss
  private pendingPings = new Map<number, number>(); // seq -> sentTs
  private pingsSentInWindow: number = 0;
  private pongsReceivedInWindow: number = 0;
  private pingWindowCounter: number = 0;

  // Throughput counters (accumulated in 1-second buckets)
  private bytesSentBucket: number = 0;
  private bytesRecvBucket: number = 0;
  private packetsSentBucket: number = 0;
  private packetsRecvBucket: number = 0;

  private currentPps: number = 0;
  private currentBps: number = 0;
  private lastThroughputCalcTs: number = Date.now();

  // Lifetime totals
  private totalPacketsSent: number = 0;
  private totalPacketsReceived: number = 0;
  private totalBytesSent: number = 0;
  private totalBytesReceived: number = 0;

  // Active latency test state
  private activeLatencyTest: LatencyTestResult | null = null;
  private latencyTestResolve: ((res: LatencyTestResult) => void) | null = null;
  private latencyTestPending = new Map<number, number>();
  private latencyTestRtts: number[] = [];
  private latencyTestTimer: any = null;

  /**
   * Records outbound packet and byte transmission.
   */
  public recordSend(bytesCount: number): void {
    this.totalPacketsSent++;
    this.totalBytesSent += bytesCount;
    this.packetsSentBucket++;
    this.bytesSentBucket += bytesCount;
    this.updateThroughputIfNeeded();
  }

  /**
   * Records inbound packet and byte reception.
   */
  public recordReceive(bytesCount: number): void {
    this.totalPacketsReceived++;
    this.totalBytesReceived += bytesCount;
    this.packetsRecvBucket++;
    this.bytesRecvBucket += bytesCount;
    this.updateThroughputIfNeeded();
  }

  /**
   * Records a sent PING with its sequence number and local timestamp.
   */
  public recordPingSent(seq: number, localTs: number): void {
    this.pendingPings.set(seq, localTs);
    this.pingsSentInWindow++;
    this.pingWindowCounter++;

    // Prune stale un-echoed pings older than 2500ms
    const now = Date.now();
    for (const [s, ts] of this.pendingPings.entries()) {
      if (now - ts > 2500) {
        this.pendingPings.delete(s);
      }
    }
  }

  /**
   * Records an echoed PONG, calculating RTT using local clock only.
   */
  public recordPongReceived(echoedSeq: number, echoedTs: number, localNow: number): number {
    this.pendingPings.delete(echoedSeq);
    this.pongsReceivedInWindow++;

    // Compute RTT purely from local clock (echoedTs was set by this phone)
    const rtt = Math.max(0, localNow - echoedTs);

    // If active latency test is running, record for test
    if (this.activeLatencyTest && this.activeLatencyTest.running) {
      if (this.latencyTestPending.has(echoedSeq)) {
        const testSentTs = this.latencyTestPending.get(echoedSeq)!;
        this.latencyTestPending.delete(echoedSeq);
        const testRtt = Math.max(0, localNow - testSentTs);
        this.latencyTestRtts.push(testRtt);
        this.activeLatencyTest.completed++;
        this.updateLatencyTestStats();
      }
    }

    // Add to rolling window of 60 samples
    this.rttSamples.push(rtt);
    if (this.rttSamples.length > MetricsCollector.MAX_SAMPLES) {
      this.rttSamples.shift();
    }

    return rtt;
  }

  /**
   * Generates a complete current snapshot of all metrics.
   */
  public getSnapshot(transportKind?: string | null): MetricsSnapshot {
    this.updateThroughputIfNeeded();

    const count = this.rttSamples.length;
    const currentRtt = count > 0 ? this.rttSamples[count - 1] : 0;

    let avgRtt = 0;
    let minRtt = count > 0 ? this.rttSamples[0] : 0;
    let maxRtt = count > 0 ? this.rttSamples[0] : 0;
    let p95Rtt = 0;
    let jitter = 0;

    if (count > 0) {
      let sum = 0;
      for (let i = 0; i < count; i++) {
        const v = this.rttSamples[i];
        sum += v;
        if (v < minRtt) minRtt = v;
        if (v > maxRtt) maxRtt = v;
      }
      avgRtt = Math.round(sum / count);

      // p95 calculation
      const sorted = [...this.rttSamples].sort((a, b) => a - b);
      const p95Idx = Math.min(count - 1, Math.floor(count * 0.95));
      p95Rtt = sorted[p95Idx];

      // Jitter = Standard deviation of RTT samples
      let varianceSum = 0;
      for (let i = 0; i < count; i++) {
        varianceSum += Math.pow(this.rttSamples[i] - avgRtt, 2);
      }
      jitter = Math.round(Math.sqrt(varianceSum / count));
    }

    // Loss percent from missing PONGs in current window
    let lossPercent = 0;
    if (this.pingsSentInWindow > 0) {
      const lostCount = Math.max(0, this.pingsSentInWindow - this.pongsReceivedInWindow);
      lossPercent = Math.min(100, Math.round((lostCount / this.pingsSentInWindow) * 100));
    }

    // Reset loss window every 60 pings to keep loss metric responsive
    if (this.pingWindowCounter >= 60) {
      this.pingsSentInWindow = Math.round(this.pingsSentInWindow * 0.2);
      this.pongsReceivedInWindow = Math.round(this.pongsReceivedInWindow * 0.2);
      this.pingWindowCounter = 0;
    }

    const isHighWifiLatency = transportKind === 'wifi' && avgRtt > 40;

    return {
      rtt: currentRtt,
      avgRtt,
      p95Rtt,
      minRtt,
      maxRtt,
      jitter,
      lossPercent,
      rttHistory: [...this.rttSamples],
      pps: this.currentPps,
      bps: this.currentBps,
      totalPacketsSent: this.totalPacketsSent,
      totalPacketsReceived: this.totalPacketsReceived,
      totalBytesSent: this.totalBytesSent,
      totalBytesReceived: this.totalBytesReceived,
      isHighWifiLatency,
    };
  }

  private updateThroughputIfNeeded(): void {
    const now = Date.now();
    const elapsed = now - this.lastThroughputCalcTs;
    if (elapsed >= 1000) {
      this.currentPps = Math.round(((this.packetsSentBucket + this.packetsRecvBucket) * 1000) / elapsed);
      this.currentBps = Math.round(((this.bytesSentBucket + this.bytesRecvBucket) * 1000) / elapsed);

      this.packetsSentBucket = 0;
      this.packetsRecvBucket = 0;
      this.bytesSentBucket = 0;
      this.bytesRecvBucket = 0;
      this.lastThroughputCalcTs = now;
    }
  }

  // ==========================================================================
  // Latency Test (200 PINGs at 20ms intervals)
  // ==========================================================================

  /**
   * Starts a dedicated 200-ping latency test at 20ms intervals.
   */
  public startLatencyTest(
    sendPingFn: (seq: number, ts: number) => void
  ): Promise<LatencyTestResult> {
    if (this.activeLatencyTest?.running) {
      return Promise.resolve(this.activeLatencyTest);
    }

    return new Promise((resolve) => {
      this.latencyTestResolve = resolve;
      this.latencyTestRtts = [];
      this.latencyTestPending.clear();

      const testState: LatencyTestResult = {
        running: true,
        progress: 0,
        total: 200,
        completed: 0,
        lost: 0,
        min: 0,
        avg: 0,
        p95: 0,
        max: 0,
      };
      this.activeLatencyTest = testState;

      let sentCount = 0;
      const baseSeq = 0xf000; // Special seq range for latency test

      this.latencyTestTimer = setInterval(() => {
        if (sentCount >= 200) {
          clearInterval(this.latencyTestTimer);
          this.latencyTestTimer = null;

          // Wait 600ms for trailing responses
          setTimeout(() => {
            this.finishLatencyTest();
          }, 600);
          return;
        }

        const seq = (baseSeq + sentCount) & 0xffff;
        const now = Date.now() >>> 0;
        this.latencyTestPending.set(seq, now);
        testState.progress = sentCount + 1;

        try {
          sendPingFn(seq, now);
        } catch {}

        sentCount++;
      }, 20);
    });
  }

  private updateLatencyTestStats(): void {
    if (!this.activeLatencyTest) return;
    const rtts = this.latencyTestRtts;
    if (rtts.length === 0) return;

    let sum = 0;
    let min = rtts[0];
    let max = rtts[0];

    for (let i = 0; i < rtts.length; i++) {
      const v = rtts[i];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const sorted = [...rtts].sort((a, b) => a - b);
    const p95Idx = Math.min(rtts.length - 1, Math.floor(rtts.length * 0.95));

    this.activeLatencyTest.min = min;
    this.activeLatencyTest.avg = Math.round(sum / rtts.length);
    this.activeLatencyTest.p95 = sorted[p95Idx];
    this.activeLatencyTest.max = max;
    this.activeLatencyTest.lost = this.activeLatencyTest.progress - this.activeLatencyTest.completed;
  }

  private finishLatencyTest(): void {
    if (!this.activeLatencyTest) return;
    this.updateLatencyTestStats();
    this.activeLatencyTest.running = false;
    this.activeLatencyTest.lost = 200 - this.activeLatencyTest.completed;

    if (this.latencyTestResolve) {
      this.latencyTestResolve({ ...this.activeLatencyTest });
      this.latencyTestResolve = null;
    }
  }

  public getActiveLatencyTest(): LatencyTestResult | null {
    return this.activeLatencyTest ? { ...this.activeLatencyTest } : null;
  }

  /**
   * Generates a plain-text diagnostics report ready to be copied.
   */
  public generateDiagnosticsReport(
    transportKind?: string | null,
    connectionMode?: string | null,
    pcName?: string | null
  ): string {
    const snap = this.getSnapshot(transportKind);
    return [
      `=== Padly Diagnostics Report ===`,
      `Timestamp: ${new Date().toISOString()}`,
      `Connected PC: ${pcName || 'Not Connected'}`,
      `Mode: ${connectionMode || 'auto'}`,
      `Active Transport: ${transportKind || 'None'}`,
      `Latency: ${snap.rtt} ms (Avg: ${snap.avgRtt} ms, p95: ${snap.p95Rtt} ms, Min: ${snap.minRtt} ms, Max: ${snap.maxRtt} ms)`,
      `Jitter (Std Dev): ${snap.jitter} ms`,
      `Packet Loss: ${snap.lossPercent}%`,
      `Throughput: ${snap.pps} pkts/s (${(snap.bps / 1024).toFixed(2)} KB/s)`,
      `Total Sent: ${snap.totalPacketsSent} pkts (${(snap.totalBytesSent / 1024).toFixed(1)} KB)`,
      `Total Recv: ${snap.totalPacketsReceived} pkts (${(snap.totalBytesReceived / 1024).toFixed(1)} KB)`,
      snap.isHighWifiLatency ? `Warning: High latency detected on Wi-Fi (> 40ms). Consider 5 GHz or USB.` : `Link Quality: Good`,
      `================================`,
    ].join('\n');
  }

  public reset(): void {
    this.rttSamples = [];
    this.pendingPings.clear();
    this.pingsSentInWindow = 0;
    this.pongsReceivedInWindow = 0;
    this.currentPps = 0;
    this.currentBps = 0;
  }
}

export const metricsCollector = new MetricsCollector();

/**
2:  * Unit Tests for MetricsCollector
3:  * Covers:
4:  * 1. RTT computation strictly from local clock (now - echoed_ts)
5:  * 2. Rolling window of 60 samples: avg, min, max, p95, and jitter (standard deviation)
6:  * 3. Packet loss calculation from missing PONGs
7:  * 4. PPS and BPS throughput tracking
8:  * 5. 200-ping latency test runner and stats aggregation
9:  * 6. Wi-Fi > 40ms high latency detection
10:  * 7. Diagnostics report text generation
11:  */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { MetricsCollector } from '../net/MetricsCollector';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  test('RTT is computed exclusively using local clock (never phone vs PC clock)', () => {
    // Phone sent PING at local timestamp 10,000
    metrics.recordPingSent(1, 10000);

    // PONG received at local timestamp 10,024
    const rtt = metrics.recordPongReceived(1, 10000, 10024);

    expect(rtt).toBe(24);
    const snap = metrics.getSnapshot('wifi');
    expect(snap.rtt).toBe(24);
    expect(snap.avgRtt).toBe(24);
    expect(snap.minRtt).toBe(24);
    expect(snap.maxRtt).toBe(24);
  });

  test('Rolling window of 60 samples computes accurate avg, min, max, p95, and jitter', () => {
    // Feed 60 predictable RTT samples: 10, 11, 12, ... 69
    for (let i = 0; i < 60; i++) {
      const sentTs = 1000 + i * 100;
      const rttVal = 10 + i;
      metrics.recordPingSent(i, sentTs);
      metrics.recordPongReceived(i, sentTs, sentTs + rttVal);
    }

    const snap = metrics.getSnapshot('wifi');
    expect(snap.rttHistory.length).toBe(60);
    expect(snap.minRtt).toBe(10);
    expect(snap.maxRtt).toBe(69);

    // Sum from 10 to 69 is 60 * (10 + 69) / 2 = 2370. Avg = 2370 / 60 = 39.5 -> rounds to 40
    expect(snap.avgRtt).toBe(40);

    // p95 index in 60 samples: floor(60 * 0.95) = 57 -> sample 10 + 57 = 67
    expect(snap.p95Rtt).toBe(67);

    // Jitter (std dev) of uniform series 10..69:
    // variance = sum((x - 40)^2) / 60 = 300. std dev = sqrt(300) ≈ 17
    expect(snap.jitter).toBeGreaterThan(15);
    expect(snap.jitter).toBeLessThan(20);
  });

  test('Window caps at 60 samples and drops older samples (FIFO)', () => {
    // Feed 70 samples
    for (let i = 0; i < 70; i++) {
      const sentTs = 1000 + i * 50;
      metrics.recordPingSent(i, sentTs);
      metrics.recordPongReceived(i, sentTs, sentTs + (i < 10 ? 5 : 50));
    }

    const snap = metrics.getSnapshot('wifi');
    expect(snap.rttHistory.length).toBe(60);
    // The first 10 samples (5ms) must have been dropped
    expect(snap.minRtt).toBe(50);
    expect(snap.avgRtt).toBe(50);
  });

  test('Tracks packet loss when PONGs are missing', () => {
    // Send 10 pings, receive only 7 pongs (30% loss)
    for (let seq = 1; seq <= 10; seq++) {
      metrics.recordPingSent(seq, 5000 + seq * 20);
      if (seq <= 7) {
        metrics.recordPongReceived(seq, 5000 + seq * 20, 5000 + seq * 20 + 15);
      }
    }

    const snap = metrics.getSnapshot('wifi');
    expect(snap.lossPercent).toBe(30);
  });

  test('Throughput counters track packets and bytes', () => {
    metrics.recordSend(120);
    metrics.recordSend(180);
    metrics.recordReceive(80);

    const snap = metrics.getSnapshot('wifi');
    expect(snap.totalBytesSent).toBe(300);
    expect(snap.totalBytesReceived).toBe(80);
    expect(snap.totalPacketsSent).toBe(2);
    expect(snap.totalPacketsReceived).toBe(1);
  });

  test('Detects high latency on Wi-Fi (> 40ms avg)', () => {
    // Wi-Fi with 50ms RTT
    metrics.recordPingSent(1, 1000);
    metrics.recordPongReceived(1, 1000, 1050);

    const wifiSnap = metrics.getSnapshot('wifi');
    expect(wifiSnap.isHighWifiLatency).toBe(true);

    // USB Tether with same 50ms does not flag Wi-Fi warning
    const usbSnap = metrics.getSnapshot('usb-tether');
    expect(usbSnap.isHighWifiLatency).toBe(false);

    // Wi-Fi with 20ms RTT does not flag
    const freshMetrics = new MetricsCollector();
    freshMetrics.recordPingSent(1, 1000);
    freshMetrics.recordPongReceived(1, 1000, 1020);
    const lowWifiSnap = freshMetrics.getSnapshot('wifi');
    expect(lowWifiSnap.isHighWifiLatency).toBe(false);
  });

  test('Runs 200-ping latency test and computes min/avg/p95/max and lost count', async () => {
    let pingsSentCount = 0;

    const testPromise = metrics.startLatencyTest((seq, localTs) => {
      pingsSentCount++;
      // Simulate echoing 90% of pings immediately with 12ms RTT, and 10% lost
      if (seq % 10 !== 0) {
        setTimeout(() => {
          metrics.recordPongReceived(seq, localTs, localTs + (10 + (seq % 15)));
        }, 2);
      }
    });

    const result = await testPromise;

    expect(pingsSentCount).toBe(200);
    expect(result.total).toBe(200);
    expect(result.completed).toBeGreaterThan(150);
    expect(result.lost).toBeGreaterThan(0);
    expect(result.min).toBeGreaterThanOrEqual(10);
    expect(result.max).toBeLessThanOrEqual(30);
    expect(result.avg).toBeGreaterThanOrEqual(10);
  });

  test('Generates diagnostics plain text report', () => {
    metrics.recordPingSent(1, 1000);
    metrics.recordPongReceived(1, 1000, 1018);
    metrics.recordSend(256);
    metrics.recordReceive(128);

    const report = metrics.generateDiagnosticsReport('wifi');
    expect(report).toContain('Padly Diagnostics Report');
    expect(report).toContain('Active Transport: wifi');
    expect(report).toContain('Avg: 18 ms');
    expect(report).toContain('Total Sent: 1 pkts');
  });
});

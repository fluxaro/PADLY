import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Canvas, Path, Skia, Line } from '@shopify/react-native-skia';
import { useConnection } from '../net/useConnection';
import { connectionManager } from '../net/ConnectionManager';
import { metricsCollector, LatencyTestResult } from '../net/MetricsCollector';
import { COLORS } from '../theme/colors';
import { light, mechanicalClick, selection } from '../hooks/useHaptics';

export interface DiagnosticsPanelProps {
  onClose?: () => void;
}

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ onClose }) => {
  const conn = useConnection();
  const [latencyTest, setLatencyTest] = useState<LatencyTestResult | null>(null);
  const [isTestRunning, setIsTestRunning] = useState<boolean>(false);
  const [rttHistory, setRttHistory] = useState<number[]>([]);
  const [copiedNotification, setCopiedNotification] = useState<boolean>(false);

  // Poll metrics snapshot every 500ms for live chart & counters
  useEffect(() => {
    const timer = setInterval(() => {
      const snap = metricsCollector.getSnapshot(conn.transportKind);
      setRttHistory(snap.rttHistory);

      const activeTest = metricsCollector.getActiveLatencyTest();
      if (activeTest) {
        setLatencyTest(activeTest);
        setIsTestRunning(activeTest.running);
      }
    }, 500);

    // Initial snapshot
    const snap = metricsCollector.getSnapshot(conn.transportKind);
    setRttHistory(snap.rttHistory);

    return () => clearInterval(timer);
  }, [conn.transportKind]);

  const handleStartLatencyTest = async () => {
    if (conn.status !== 'connected') {
      Alert.alert('Not Connected', 'Please connect to a PC companion first to run the latency test.');
      return;
    }

    mechanicalClick();
    setIsTestRunning(true);

    try {
      const res = await connectionManager.runLatencyTest();
      setLatencyTest(res);
    } catch (err: any) {
      Alert.alert('Latency Test Error', err?.message || 'Failed to complete test');
    } finally {
      setIsTestRunning(false);
    }
  };

  const handleCopyReport = async () => {
    selection();
    const report = metricsCollector.generateDiagnosticsReport(
      conn.transportKind,
      conn.connectionMode,
      conn.pcName
    );

    try {
      await Share.share({
        message: report,
        title: 'Padly Diagnostics Report',
      });
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2000);
    } catch {
      Alert.alert('Report Generated', report);
    }
  };

  // Build Skia line chart path
  const chartWidth = 340;
  const chartHeight = 70;
  const history = rttHistory.length > 0 ? rttHistory : [0];
  const maxHistoryVal = Math.max(50, ...history);

  const stepX = chartWidth / Math.max(1, history.length - 1);
  let d = '';
  for (let i = 0; i < history.length; i++) {
    const x = Math.round(i * stepX);
    const y = Math.round(chartHeight - (history[i] / maxHistoryVal) * (chartHeight - 12) - 6);
    if (i === 0) {
      d += `M ${x} ${y}`;
    } else {
      d += ` L ${x} ${y}`;
    }
  }
  const skPath = Skia.Path.MakeFromSVGString(d) || Skia.Path.Make();

  const transportLabel =
    conn.connectionMode === 'bluetooth-hid'
      ? 'Direct Bluetooth HID (Gamepad)'
      : conn.transportKind
      ? conn.transportKind === 'wifi'
        ? 'Wi-Fi (UDP)'
        : conn.transportKind === 'usb-tether'
        ? 'USB Tether (UDP)'
        : conn.transportKind === 'usb-adb'
        ? 'USB ADB (TCP Stream)'
        : 'Bluetooth (higher latency)'
      : 'No Active Transport';

  return (
    <View style={styles.container}>
      {/* 0. Direct Bluetooth HID Notice */}
      {conn.connectionMode === 'bluetooth-hid' && (
        <View style={[styles.wifiAlert, { borderColor: '#2F8BFF40', backgroundColor: '#2F8BFF15' }]}>
          <Ionicons name="information-circle-outline" size={16} color="#2F8BFF" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.wifiAlertTitle, { color: '#2F8BFF' }]}>Direct Bluetooth HID Mode</Text>
            <Text style={styles.wifiAlertDesc}>
              Communicating directly with host as a driverless Bluetooth gamepad. Encryption pairing, rumble feedback, and telemetry statistics are not available in this mode.
            </Text>
          </View>
        </View>
      )}

      {/* 1. High Latency Wi-Fi Warning */}
      {conn.isHighWifiLatency && conn.connectionMode !== 'bluetooth-hid' && (
        <View style={styles.wifiAlert}>
          <Ionicons name="warning" size={16} color="#FF9500" />
          <View style={{ flex: 1 }}>
            <Text style={styles.wifiAlertTitle}>High Wi-Fi Latency (&gt; 40ms avg)</Text>
            <Text style={styles.wifiAlertDesc}>
              Consider switching to a 5 GHz Wi-Fi band, enabling a mobile hotspot, or connecting via
              USB for &lt;1ms lag.
            </Text>
          </View>
        </View>
      )}

      {/* 2. Live Skia RTT Line Chart */}
      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>Live RTT Line Chart (Last 60s)</Text>
          <Text style={styles.chartValue}>{conn.rttMs} ms</Text>
        </View>

        <Canvas style={{ width: chartWidth, height: chartHeight }}>
          {/* Baseline and midline */}
          <Line
            p1={{ x: 0, y: chartHeight - 6 }}
            p2={{ x: chartWidth, y: chartHeight - 6 }}
            color="rgba(255, 255, 255, 0.08)"
            strokeWidth={1}
          />
          <Line
            p1={{ x: 0, y: chartHeight / 2 }}
            p2={{ x: chartWidth, y: chartHeight / 2 }}
            color="rgba(255, 255, 255, 0.05)"
            strokeWidth={1}
          />
          {/* Live RTT Curve */}
          <Path
            path={skPath}
            color={conn.isHighWifiLatency ? '#FF9500' : '#2F8BFF'}
            style="stroke"
            strokeWidth={2}
          />
        </Canvas>

        <View style={styles.chartFooter}>
          <Text style={styles.chartFooterText}>Avg: {conn.avgRttMs || 0} ms</Text>
          <Text style={styles.chartFooterText}>p95: {conn.p95RttMs || 0} ms</Text>
          <Text style={styles.chartFooterText}>Max: {maxHistoryVal} ms</Text>
        </View>
      </View>

      {/* 3. Primary Metrics Grid */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Transport</Text>
          <Text style={styles.metricVal} numberOfLines={1}>
            {transportLabel}
          </Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Jitter (Std Dev)</Text>
          <Text style={styles.metricVal}>{conn.jitterMs || 0} ms</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Packet Loss</Text>
          <Text
            style={[
              styles.metricVal,
              conn.lossPercent > 0 && { color: '#FF453A' },
            ]}
          >
            {conn.lossPercent || 0}%
          </Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Throughput (PPS / BPS)</Text>
          <Text style={styles.metricVal}>
            {conn.pps || 0} pkts/s • {((conn.bps || 0) / 1024).toFixed(1)} KB/s
          </Text>
        </View>
      </View>

      {/* 4. Dedicated 200-Ping Latency Test */}
      <View style={styles.testCard}>
        <View style={styles.testHeader}>
          <View>
            <Text style={styles.testTitle}>200-Ping Latency Test</Text>
            <Text style={styles.testSub}>200 PINGs @ 20ms intervals</Text>
          </View>
          <TouchableOpacity
            style={[styles.testBtn, isTestRunning && styles.testBtnDisabled]}
            disabled={isTestRunning}
            onPress={handleStartLatencyTest}
          >
            {isTestRunning ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="speedometer-outline" size={14} color="#FFFFFF" />
                <Text style={styles.testBtnText}>Run Test</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {latencyTest && (
          <View style={styles.testResultBox}>
            <View style={styles.testResultRow}>
              <Text style={styles.testResultLabel}>Progress:</Text>
              <Text style={styles.testResultVal}>
                {latencyTest.completed} / {latencyTest.total} ({latencyTest.lost} lost)
              </Text>
            </View>
            <View style={styles.testStatsRow}>
              <Text style={styles.statPill}>Min: {latencyTest.min}ms</Text>
              <Text style={styles.statPill}>Avg: {latencyTest.avg}ms</Text>
              <Text style={styles.statPill}>p95: {latencyTest.p95}ms</Text>
              <Text style={styles.statPill}>Max: {latencyTest.max}ms</Text>
            </View>
          </View>
        )}
      </View>

      {/* 5. Copy Report Button */}
      <TouchableOpacity style={styles.copyBtn} onPress={handleCopyReport}>
        <Ionicons name="copy-outline" size={15} color="#FFFFFF" />
        <Text style={styles.copyBtnText}>
          {copiedNotification ? 'Report Copied!' : 'Copy Diagnostics Report'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  wifiAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.35)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  wifiAlertTitle: {
    color: '#FF9500',
    fontSize: 11,
    fontWeight: '800',
  },
  wifiAlertDesc: {
    color: '#D8DFEB',
    fontSize: 10,
    marginTop: 2,
    lineHeight: 14,
  },
  chartCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 4,
  },
  chartTitle: {
    color: '#8A98AC',
    fontSize: 11,
    fontWeight: '700',
  },
  chartValue: {
    color: '#2F8BFF',
    fontSize: 12,
    fontWeight: '800',
  },
  chartFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 4,
  },
  chartFooterText: {
    color: '#5A6678',
    fontSize: 10,
    fontWeight: '600',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  metricBox: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
    padding: 8,
  },
  metricLabel: {
    color: '#8A98AC',
    fontSize: 10,
    fontWeight: '600',
  },
  metricVal: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  testCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  testHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  testTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  testSub: {
    color: '#8A98AC',
    fontSize: 10,
    marginTop: 1,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  testBtnDisabled: {
    opacity: 0.6,
  },
  testBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11,
  },
  testResultBox: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  testResultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  testResultLabel: {
    color: '#8A98AC',
    fontSize: 10,
  },
  testResultVal: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  testStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  statPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    paddingVertical: 8,
  },
  copyBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
});

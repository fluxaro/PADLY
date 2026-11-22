import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Canvas, RoundedRect, BlurMask } from '@shopify/react-native-skia';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useFrame } from './ControllerFrame';
import { light, selection } from '../hooks/useHaptics';
import { COLORS } from '../theme/colors';
import { ModalType } from './ControllerModals';
import { useConnection } from '../net/useConnection';

export type ControllerMode = 'Controller' | 'Mouse' | 'Keyboard' | 'Touchpad';

export interface ConnectionStatus {
  status: 'Connected' | 'Disconnected' | 'Connecting' | 'Reconnecting';
  type: string;
}

export interface TopBarProps {
  mode: ControllerMode;
  onModeChange: (mode: ControllerMode) => void;
  connectionStatus?: ConnectionStatus;
  onOpenModal: (type: ModalType) => void;
}

interface ActionButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  scale: number;
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon, onPress, scale }) => {
  const pressed = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - 0.08 * pressed.value },
      { translateY: 1.5 * pressed.value },
    ],
  }));

  const btnSize = Math.max(28, 30 * scale);

  return (
    <Pressable
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 50 });
        light();
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { damping: 14 });
      }}
      onPress={onPress}
      style={{ marginLeft: 5 * scale }}
    >
      <Animated.View
        style={[
          styles.actionBtn,
          animStyle,
          {
            width: btnSize,
            height: btnSize,
            borderRadius: btnSize / 2,
          },
        ]}
      >
        <Ionicons name={icon} size={Math.max(12, 14 * scale)} color="#B0BDD0" />
      </Animated.View>
    </Pressable>
  );
};

export const TopBar: React.FC<TopBarProps> = ({
  mode,
  onModeChange,
  connectionStatus = { status: 'Connected', type: 'USB' },
  onOpenModal,
}) => {
  const { scale } = useFrame();

  const conn = useConnection();

  // Status dot color: green connected, amber connecting/handshaking/reconnecting, red failed/disconnected
  const isConnected = conn.status === 'connected';
  const isConnecting =
    conn.status === 'connecting' ||
    conn.status === 'handshaking' ||
    conn.status === 'reconnecting';

  const statusDotColor = isConnected
    ? '#30D158'
    : isConnecting
    ? '#FFD60A'
    : '#FF453A';

  // Primary label with RTT in ms
  const primaryStatusText = isConnected
    ? `Connected${conn.rttMs > 0 ? ` • ${conn.rttMs}ms` : ''}`
    : conn.status === 'connecting'
    ? 'Connecting...'
    : conn.status === 'handshaking'
    ? 'Handshaking...'
    : conn.status === 'reconnecting'
    ? `Reconnecting (${conn.reconnectAttempt})...`
    : connectionStatus?.status || 'Disconnected';

  // Transport & Mode label
  const isBluetooth = conn.transportKind === 'bluetooth';
  const activeTransportName = conn.transportKind
    ? conn.transportKind === 'wifi'
      ? 'Wi-Fi'
      : conn.transportKind === 'usb-tether'
      ? 'USB Tether'
      : conn.transportKind === 'usb-adb'
      ? 'USB (ADB)'
      : 'Bluetooth (higher latency)'
    : null;

  const modeDisplayName =
    conn.connectionMode === 'auto'
      ? 'Auto'
      : conn.connectionMode === 'usb'
      ? 'USB'
      : conn.connectionMode === 'wifi'
      ? 'Wi-Fi'
      : 'Bluetooth (higher latency)';

  const transportLabel = isConnected
    ? conn.connectionMode === 'auto'
      ? `Auto • ${activeTransportName || 'Linked'}`
      : activeTransportName || modeDisplayName
    : `${modeDisplayName} • ${conn.status === 'idle' ? 'Ready' : conn.status}`;

  // Icon based on transport / selected mode
  const activeIconKind = conn.transportKind || conn.connectionMode;
  const linkIcon: keyof typeof Ionicons.glyphMap =
    activeIconKind === 'wifi'
      ? 'wifi-outline'
      : activeIconKind === 'bluetooth'
      ? 'bluetooth-outline'
      : 'hardware-chip-outline';

  const modes: ControllerMode[] = ['Controller', 'Mouse', 'Keyboard', 'Touchpad'];

  return (
    <View style={[styles.container, { height: 38 * scale }]}>
      {/* 1. Left Pill: Connection Status (Opens Connection Details Dropdown) */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => onOpenModal('connection')}
        style={[
          styles.pill,
          {
            paddingHorizontal: 10 * scale,
            paddingVertical: 5 * scale,
            borderRadius: 16 * scale,
          },
        ]}
      >
        <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
        <View style={styles.statusTextGroup}>
          <Text style={[styles.statusPrimary, { fontSize: Math.max(9, 10.5 * scale) }]}>
            {primaryStatusText}
          </Text>
          <Text style={[styles.statusSecondary, { fontSize: Math.max(7, 8 * scale) }]}>
            {transportLabel}
          </Text>
        </View>
        <Ionicons
          name={linkIcon}
          size={Math.max(10, 12 * scale)}
          color="#8A98AC"
          style={{ marginLeft: 4 * scale }}
        />
      </TouchableOpacity>

      {/* 2. Center Pill: Mode Switcher Tabs */}
      <View
        style={[
          styles.pill,
          styles.tabsPill,
          {
            paddingHorizontal: 4 * scale,
            paddingVertical: 3 * scale,
            borderRadius: 18 * scale,
          },
        ]}
      >
        {modes.map((tab) => {
          const isSelected = mode === tab;
          return (
            <TouchableOpacity
              key={tab}
              activeOpacity={0.7}
              onPress={() => {
                selection();
                onModeChange(tab);
              }}
              style={[
                styles.tabBtn,
                {
                  paddingHorizontal: 11 * scale,
                  paddingVertical: 5 * scale,
                  borderRadius: 14 * scale,
                  backgroundColor: isSelected ? COLORS.accent : 'transparent',
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    fontSize: Math.max(8.5, 10.5 * scale),
                    fontWeight: isSelected ? '800' : '600',
                    color: isSelected ? '#FFFFFF' : '#7E8DA5',
                  },
                ]}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 3. Right Action Buttons */}
      <View style={styles.actionsRow}>
        <ActionButton
          icon="settings-outline"
          onPress={() => onOpenModal('settings')}
          scale={scale}
        />
        <ActionButton
          icon="options-outline"
          onPress={() => onOpenModal('tuning')}
          scale={scale}
        />
        <ActionButton
          icon="person-circle-outline"
          onPress={() => onOpenModal('user')}
          scale={scale}
        />
        <ActionButton
          icon="ellipsis-horizontal"
          onPress={() => onOpenModal('more')}
          scale={scale}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12, 16, 24, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 7,
  },
  statusTextGroup: {
    justifyContent: 'center',
  },
  statusPrimary: {
    color: '#FFFFFF',
    fontWeight: '700',
    lineHeight: 12,
  },
  statusSecondary: {
    color: '#7E8DA5',
    fontWeight: '500',
    lineHeight: 10,
  },
  tabsPill: {
    gap: 2,
  },
  tabBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    letterSpacing: 0.2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    backgroundColor: 'rgba(14, 18, 26, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
});

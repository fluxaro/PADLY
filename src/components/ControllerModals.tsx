import React from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { COLORS } from '../theme/colors';
import { light, mechanicalClick, selection, setHapticsEnabled } from '../hooks/useHaptics';
import { useConnection } from '../net/useConnection';
import { connectionManager, ConnectionMode } from '../net/ConnectionManager';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ControllerProfile, profileStore } from '../profiles/ProfileStore';
import { bluetoothHidService, HidHostDevice } from '../net/BluetoothHidService';

export type ModalType =
  | 'connection'
  | 'settings'
  | 'tuning'
  | 'user'
  | 'more'
  | 'profile'
  | 'vibration'
  | 'brightness'
  | 'theme'
  | 'layout'
  | 'pairing'
  | null;

interface ControllerModalsProps {
  activeModal: ModalType;
  onClose: () => void;
  onOpenPairing?: () => void;
  onOpenBluetoothPicker?: () => void;
  // Shared state
  buttonStyle: 'xbox' | 'playstation';
  onToggleButtonStyle: (style: 'xbox' | 'playstation') => void;
  hapticsOn: boolean;
  onToggleHaptics: (on: boolean) => void;
  brightness: number;
  onSelectBrightness: (b: number) => void;
  themeColor: string;
  onSelectTheme: (color: string) => void;
  activeProfile: string;
  onSelectProfile: (profile: string) => void;
  isDebugActive: boolean;
  onToggleDebug: () => void;
}

export const ControllerModals: React.FC<ControllerModalsProps> = ({
  activeModal,
  onClose,
  onOpenPairing,
  onOpenBluetoothPicker,
  buttonStyle,
  onToggleButtonStyle,
  hapticsOn,
  onToggleHaptics,
  brightness,
  onSelectBrightness,
  themeColor,
  onSelectTheme,
  activeProfile,
  onSelectProfile,
  isDebugActive,
  onToggleDebug,
}) => {
  const conn = useConnection();
  const [tuningTab, setTuningTab] = React.useState<'diagnostics' | 'calibration'>('diagnostics');
  const [profiles, setProfiles] = React.useState<ControllerProfile[]>(profileStore.getProfiles());
  const [currentProfile, setCurrentProfile] = React.useState<ControllerProfile>(profileStore.getActiveProfile());
  const [editingProfileId, setEditingProfileId] = React.useState<string | null>(null);
  const [editNameText, setEditNameText] = React.useState<string>('');
  const [hidDevices, setHidDevices] = React.useState<HidHostDevice[]>([]);
  const [showHidGuide, setShowHidGuide] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (activeModal === 'settings' && conn.connectionMode === 'bluetooth-hid') {
      bluetoothHidService.getBondedDevices().then(setHidDevices).catch(() => {});
    }
  }, [activeModal, conn.connectionMode]);

  React.useEffect(() => {
    return profileStore.onChange((active, list) => {
      setCurrentProfile(active);
      setProfiles(list);
    });
  }, []);

  if (!activeModal) return null;

  const renderModalContent = () => {
    switch (activeModal) {
      case 'connection': {
        const isConn = conn.status === 'connected';
        const isConnecting =
          conn.status === 'connecting' ||
          conn.status === 'handshaking' ||
          conn.status === 'reconnecting';
        const dotColor = isConn ? '#30D158' : isConnecting ? '#FFD60A' : '#FF453A';

        const transportLabel =
          conn.connectionMode === 'bluetooth-hid'
            ? 'Direct Bluetooth HID'
            : conn.transportKind
            ? conn.transportKind === 'wifi'
              ? 'Wi-Fi (UDP)'
              : conn.transportKind === 'usb-tether'
              ? 'USB Tether (UDP)'
              : conn.transportKind === 'usb-adb'
              ? 'USB ADB (TCP Stream)'
              : 'Bluetooth (RFCOMM)'
            : 'No Active Transport';

        const targetReported =
          conn.emulatedTarget === 'ds4' ? 'DualShock 4' : 'Xbox 360 Controller';

        return (
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="hardware-chip-outline" size={18} color={dotColor} />
                <Text style={styles.modalTitle}>Device Connection</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            {/* Status Badge */}
            <View style={styles.statusBadge}>
              <View style={[styles.dot, { backgroundColor: dotColor }]} />
              <Text style={styles.statusBadgeText}>
                {isConn
                  ? `Connected: ${conn.pcName || 'PC'} via ${transportLabel}`
                  : isConnecting
                  ? `Connecting to ${conn.pcName || 'PC'}...`
                  : conn.status === 'failed'
                  ? 'Connection Failed'
                  : 'Idle / Disconnected'}
              </Text>
            </View>

            {/* Human Error Card with actionable guidance */}
            {conn.humanError && (
              <View style={styles.humanErrorCard}>
                <Ionicons name="alert-circle-outline" size={18} color="#FF453A" />
                <Text style={styles.humanErrorText}>{conn.humanError}</Text>
              </View>
            )}

            {/* Live Link Stats */}
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Target Gamepad</Text>
                <Text style={styles.statVal}>{isConn ? targetReported : 'XInput / DS4'}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Latency (RTT)</Text>
                <Text style={styles.statVal}>{conn.rttMs > 0 ? `${conn.rttMs} ms` : '—'}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Jitter (Std Dev)</Text>
                <Text style={styles.statVal}>{conn.jitterMs > 0 ? `${conn.jitterMs} ms` : '—'}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Packet Loss</Text>
                <Text style={styles.statVal}>{isConn ? `${conn.lossPercent}%` : '0%'}</Text>
              </View>
            </View>

            {/* Action 1: Pairing & Saved Devices */}
            <TouchableOpacity
              style={styles.actionPrimaryBtn}
              onPress={() => {
                selection();
                onClose();
                onOpenPairing?.();
              }}
            >
              <Text style={styles.actionPrimaryBtnText}>Pairing & Saved Devices</Text>
            </TouchableOpacity>

            {/* Action 2: Forget this PC */}
            <TouchableOpacity
              style={[
                styles.actionPrimaryBtn,
                {
                  marginTop: 8,
                  backgroundColor: 'rgba(255, 69, 58, 0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(255, 69, 58, 0.4)',
                },
              ]}
              onPress={() => {
                selection();
                Alert.alert(
                  'Forget this PC',
                  'Are you sure you want to forget this paired PC? You will need to scan its QR code again to reconnect.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Forget PC',
                      style: 'destructive',
                      onPress: async () => {
                        await connectionManager.forgetCurrentPC();
                        onClose();
                      },
                    },
                  ]
                );
              }}
            >
              <Text style={[styles.actionPrimaryBtnText, { color: '#FF453A' }]}>
                Forget this PC
              </Text>
            </TouchableOpacity>
          </View>
        );
      }

      case 'settings':
        return (
          <View style={[styles.modalCard, styles.modalCardWide]}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="settings-outline" size={18} color={COLORS.accent} />
                <Text style={styles.modalTitle}>Controller Settings</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
              {/* Option 0: Connection Mode Selector (Auto, USB, Wi-Fi, BT, Direct HID) */}
              <View style={styles.settingRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.settingLabel}>Connection Mode</Text>
                  <Text style={styles.settingSub}>
                    {conn.connectionMode === 'auto'
                      ? 'Auto (prefer USB, then Wi-Fi, then Bluetooth)'
                      : conn.connectionMode === 'usb'
                      ? 'USB only (adb reverse & tethering)'
                      : conn.connectionMode === 'wifi'
                      ? 'Wi-Fi only (UDP)'
                      : conn.connectionMode === 'bluetooth-hid'
                      ? 'Direct Bluetooth HID (driverless gamepad; no PC app)'
                      : 'Bluetooth only (RFCOMM with PC app)'}
                  </Text>
                </View>
                <View style={styles.pillToggleGroup}>
                  {(
                    (Platform.OS === 'android'
                      ? ['auto', 'usb', 'wifi', 'bluetooth', 'bluetooth-hid']
                      : ['auto', 'usb', 'wifi']) as ConnectionMode[]
                  ).map((mode) => {
                    const isSelected = conn.connectionMode === mode;
                    const label =
                      mode === 'auto'
                        ? 'Auto'
                        : mode === 'usb'
                        ? 'USB'
                        : mode === 'wifi'
                        ? 'Wi-Fi'
                        : mode === 'bluetooth-hid'
                        ? 'Direct HID'
                        : 'BT (PC)';
                    return (
                      <TouchableOpacity
                        key={mode}
                        style={[styles.pillOption, isSelected && styles.pillOptionActive]}
                        onPress={() => {
                          selection();
                          connectionManager.setConnectionMode(mode);
                        }}
                      >
                        <Text
                          style={[styles.pillOptionText, isSelected && styles.pillOptionTextActive]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Note for Direct Bluetooth HID Mode */}
              {conn.connectionMode === 'bluetooth-hid' && (
                <View style={styles.hidNoticeCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Ionicons name="information-circle-outline" size={16} color="#FFB020" />
                    <Text style={styles.hidNoticeTitle}>Direct Bluetooth HID Mode (Driverless)</Text>
                  </View>
                  <Text style={styles.hidNoticeText}>
                    The phone appears to a PC or console as a standard Bluetooth gamepad with no PC app required.
                  </Text>
                  <Text style={[styles.hidNoticeText, { marginTop: 4, color: '#FFD580' }]}>
                    Note: It cannot use encryption pairing from PROTOCOL.md and has no rumble or latency stats.
                  </Text>

                  {/* Bluetooth HID Host Controls */}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <TouchableOpacity
                      style={styles.hidActionBtn}
                      onPress={async () => {
                        selection();
                        try {
                          await bluetoothHidService.makeDiscoverable(120);
                          Alert.alert(
                            'Phone Discoverable',
                            'Your phone is now discoverable as "Padly Gamepad" for 120 seconds in your PC or console Bluetooth settings.'
                          );
                        } catch (e: any) {
                          Alert.alert('Discoverable Error', e?.message || 'Could not start discoverable mode.');
                        }
                      }}
                    >
                      <Ionicons name="radio-outline" size={14} color="#FFF" />
                      <Text style={styles.hidActionBtnText}>Make Discoverable</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.hidActionBtn, { backgroundColor: '#1A293E' }]}
                      onPress={() => setShowHidGuide((prev) => !prev)}
                    >
                      <Ionicons name="help-circle-outline" size={14} color="#2F8BFF" />
                      <Text style={[styles.hidActionBtnText, { color: '#2F8BFF' }]}>
                        {showHidGuide ? 'Hide Guide' : 'Pairing Guide'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Paired Host Devices List */}
                  <View style={{ marginTop: 10 }}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: '#8A98AC',
                        textTransform: 'uppercase',
                        marginBottom: 4,
                      }}
                    >
                      Paired Hosts / Consoles:
                    </Text>
                    {hidDevices.length === 0 ? (
                      <Text style={{ fontSize: 11, color: '#5A6E85' }}>
                        No paired Bluetooth hosts found. Tap "Make Discoverable" to pair with your PC or console.
                      </Text>
                    ) : (
                      hidDevices.map((dev) => {
                        const isHostConnected =
                          conn.pcName === dev.name && conn.status === 'connected';
                        return (
                          <TouchableOpacity
                            key={dev.address}
                            style={styles.hidDeviceRow}
                            onPress={async () => {
                              selection();
                              if (isHostConnected) {
                                await bluetoothHidService.disconnectHost(dev.address);
                              } else {
                                await bluetoothHidService.connectHost(dev.address);
                              }
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 12, fontWeight: '600', color: '#FFF' }}>
                                {dev.name}
                              </Text>
                              <Text style={{ fontSize: 10, color: '#5A6E85' }}>{dev.address}</Text>
                            </View>
                            <View
                              style={[
                                styles.hidDeviceBadge,
                                isHostConnected && { backgroundColor: '#00E67620' },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.hidDeviceBadgeText,
                                  isHostConnected && { color: '#00E676' },
                                ]}
                              >
                                {isHostConnected ? 'Connected' : 'Connect'}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>

                  {/* Pairing Guide & Blocked Devices Info */}
                  {showHidGuide && (
                    <View style={styles.hidGuideBox}>
                      <Text style={styles.hidGuideTitle}>Pairing Steps:</Text>
                      <Text style={styles.hidGuideStep}>1. Tap "Make Discoverable" above.</Text>
                      <Text style={styles.hidGuideStep}>2. Open Bluetooth Settings on PC/Mac/Linux/Switch.</Text>
                      <Text style={styles.hidGuideStep}>
                        3. Select "Padly Gamepad" to pair. Once paired, inputs send automatically.
                      </Text>

                      <Text style={[styles.hidGuideTitle, { marginTop: 8 }]}>
                        Device Compatibility & Blocked Profiles:
                      </Text>
                      <Text style={styles.hidGuideNote}>
                        • <Text style={{ fontWeight: '700', color: '#FFF' }}>PC (Windows 10/11, macOS, Linux):</Text>{' '}
                        Fully supported as a standard DirectInput / evdev HID Gamepad.
                      </Text>
                      <Text style={styles.hidGuideNote}>
                        • <Text style={{ fontWeight: '700', color: '#FFF' }}>Nintendo Switch:</Text> Supports
                        standard Bluetooth controllers via Change Grip/Order.
                      </Text>
                      <Text style={styles.hidGuideNote}>
                        • <Text style={{ fontWeight: '700', color: '#FF7070' }}>Xbox Series X|S / Xbox One:</Text>{' '}
                        BLOCKED. Xbox consoles require proprietary Microsoft Xbox Wireless or licensed security hardware.
                      </Text>
                      <Text style={styles.hidGuideNote}>
                        • <Text style={{ fontWeight: '700', color: '#FF7070' }}>PS4 / PS5:</Text> RESTRICTED.
                        PlayStation pairs as a generic controller, but disconnects after ~8-10 minutes unless
                        authenticated by a DualShock/DualSense security IC handshake.
                      </Text>
                      <Text style={styles.hidGuideNote}>
                        • <Text style={{ fontWeight: '700', color: '#FF7070' }}>iOS / iPadOS:</Text> BLOCKED.
                        Apple restricts incoming Bluetooth HID device connections to MFi or standard console accessories.
                      </Text>
                      <Text style={styles.hidGuideNote}>
                        • <Text style={{ fontWeight: '700', color: '#FFB020' }}>Certain Samsung / Custom Android ROMs:</Text>{' '}
                        Some vendors disable the Bluetooth HID Device profile in their Bluetooth stack.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Option 0.3: Bluetooth RFCOMM Devices (Android Only) */}
              {Platform.OS === 'android' && (
                <TouchableOpacity
                  style={styles.settingRow}
                  onPress={() => {
                    selection();
                    onClose();
                    onOpenBluetoothPicker?.();
                  }}
                >
                  <View>
                    <Text style={styles.settingLabel}>Bluetooth RFCOMM Devices</Text>
                    <Text style={styles.settingSub}>
                      Pair or select bonded PC for Bluetooth transport
                    </Text>
                  </View>
                  <Ionicons name="bluetooth-outline" size={20} color="#2F8BFF" />
                </TouchableOpacity>
              )}

              {/* Option 0.5: Pairing & Devices */}
              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => {
                  selection();
                  onClose();
                  onOpenPairing?.();
                }}
              >
                <View>
                  <Text style={[styles.settingLabel, { color: COLORS.accent }]}>
                    PC Pairing & Wi-Fi Link
                  </Text>
                  <Text style={styles.settingSub}>Scan QR code or manage paired computers</Text>
                </View>
                <Ionicons name="qr-code-outline" size={20} color={COLORS.accent} />
              </TouchableOpacity>
              {/* Option 1: Button Labels Format */}
              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Button Labels Format</Text>
                  <Text style={styles.settingSub}>Switch between Xbox and PlayStation</Text>
                </View>
                <View style={styles.pillToggleGroup}>
                  <TouchableOpacity
                    style={[
                      styles.pillOption,
                      buttonStyle === 'playstation' && styles.pillOptionActive,
                    ]}
                    onPress={() => {
                      selection();
                      onToggleButtonStyle('playstation');
                    }}
                  >
                    <Text
                      style={[
                        styles.pillOptionText,
                        buttonStyle === 'playstation' && styles.pillOptionTextActive,
                      ]}
                    >
                      PS (△ ○ ✕ □)
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pillOption, buttonStyle === 'xbox' && styles.pillOptionActive]}
                    onPress={() => {
                      selection();
                      onToggleButtonStyle('xbox');
                    }}
                  >
                    <Text
                      style={[
                        styles.pillOptionText,
                        buttonStyle === 'xbox' && styles.pillOptionTextActive,
                      ]}
                    >
                      Xbox (Y B A X)
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Option 2: Haptic Feedback */}
              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Haptic Feedback</Text>
                  <Text style={styles.settingSub}>Vibrate on trigger pulls and stick clicks</Text>
                </View>
                <Switch
                  value={hapticsOn}
                  onValueChange={(val) => {
                    onToggleHaptics(val);
                    setHapticsEnabled(val);
                    if (val) mechanicalClick();
                  }}
                  trackColor={{ false: '#252B36', true: COLORS.accent }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Option 3: Invert Y-Axis */}
              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Invert Y-Axis</Text>
                  <Text style={styles.settingSub}>Pushing stick up aims upward (+1)</Text>
                </View>
                <Switch
                  value={true}
                  disabled={true}
                  trackColor={{ false: '#252B36', true: '#30D158' }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Option 4: Keep Awake */}
              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Keep Screen Awake</Text>
                  <Text style={styles.settingSub}>Prevent display sleep during gameplay</Text>
                </View>
                <Switch
                  value={true}
                  disabled={true}
                  trackColor={{ false: '#252B36', true: '#30D158' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </ScrollView>
          </View>
        );

      case 'tuning':
        return (
          <View style={[styles.modalCard, styles.modalCardWide]}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="options-outline" size={18} color={COLORS.accent} />
                <Text style={styles.modalTitle}>Tuning & Diagnostics</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            {/* Tab selector between Diagnostics & Input Calibration */}
            <View style={styles.tuningTabSelector}>
              <TouchableOpacity
                style={[
                  styles.tuningTabBtn,
                  tuningTab === 'diagnostics' && styles.tuningTabBtnActive,
                ]}
                onPress={() => {
                  selection();
                  setTuningTab('diagnostics');
                }}
              >
                <Ionicons
                  name="pulse-outline"
                  size={14}
                  color={tuningTab === 'diagnostics' ? '#FFFFFF' : '#8A98AC'}
                />
                <Text
                  style={[
                    styles.tuningTabText,
                    tuningTab === 'diagnostics' && styles.tuningTabTextActive,
                  ]}
                >
                  Diagnostics & Latency
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tuningTabBtn,
                  tuningTab === 'calibration' && styles.tuningTabBtnActive,
                ]}
                onPress={() => {
                  selection();
                  setTuningTab('calibration');
                }}
              >
                <Ionicons
                  name="game-controller-outline"
                  size={14}
                  color={tuningTab === 'calibration' ? '#FFFFFF' : '#8A98AC'}
                />
                <Text
                  style={[
                    styles.tuningTabText,
                    tuningTab === 'calibration' && styles.tuningTabTextActive,
                  ]}
                >
                  Input Calibration
                </Text>
              </TouchableOpacity>
            </View>

            {tuningTab === 'diagnostics' ? (
              <DiagnosticsPanel onClose={onClose} />
            ) : (
              <ScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
                <View style={styles.settingRow}>
                  <View>
                    <Text style={styles.settingLabel}>Stick Deadzones</Text>
                    <Text style={styles.settingSub}>
                      Radial deadzone threshold: {Math.round(currentProfile.deadzone * 100)}%
                    </Text>
                  </View>
                  <View style={styles.pillToggleGroup}>
                    {[
                      { label: '5%', val: 0.05 },
                      { label: '10%', val: 0.10 },
                      { label: '15%', val: 0.15 },
                    ].map(({ label, val }) => {
                      const isSel = Math.abs(currentProfile.deadzone - val) < 0.01;
                      return (
                        <TouchableOpacity
                          key={label}
                          style={[styles.pillOption, isSel && styles.pillOptionActive]}
                          onPress={async () => {
                            selection();
                            await profileStore.updateActiveProfile({ deadzone: val });
                          }}
                        >
                          <Text
                            style={[
                              styles.pillOptionText,
                              isSel && styles.pillOptionTextActive,
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.settingRow}>
                  <View>
                    <Text style={styles.settingLabel}>Trigger Response Curve</Text>
                    <Text style={styles.settingSub}>Hair-trigger digital snap vs smooth analog</Text>
                  </View>
                  <View style={styles.pillToggleGroup}>
                    {[
                      { label: 'Smooth', val: 'smooth' as const },
                      { label: 'Hair-Trigger', val: 'hair-trigger' as const },
                    ].map(({ label, val }) => {
                      const isSel = currentProfile.triggerBehavior === val;
                      return (
                        <TouchableOpacity
                          key={label}
                          style={[styles.pillOption, isSel && styles.pillOptionActive]}
                          onPress={async () => {
                            selection();
                            await profileStore.updateActiveProfile({ triggerBehavior: val });
                          }}
                        >
                          <Text
                            style={[
                              styles.pillOptionText,
                              isSel && styles.pillOptionTextActive,
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.settingRow}>
                  <View>
                    <Text style={styles.settingLabel}>Stick Response Profile</Text>
                    <Text style={styles.settingSub}>Linear, Exponential, or Aggressive curve</Text>
                  </View>
                  <View style={styles.pillToggleGroup}>
                    {[
                      { label: 'Linear', val: 'linear' as const },
                      { label: 'Exponential', val: 'exponential' as const },
                      { label: 'Aggressive', val: 'aggressive' as const },
                    ].map(({ label, val }) => {
                      const isSel = currentProfile.stickCurve === val;
                      return (
                        <TouchableOpacity
                          key={label}
                          style={[styles.pillOption, isSel && styles.pillOptionActive]}
                          onPress={async () => {
                            selection();
                            await profileStore.updateActiveProfile({ stickCurve: val });
                          }}
                        >
                          <Text
                            style={[
                              styles.pillOptionText,
                              isSel && styles.pillOptionTextActive,
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>
            )}
          </View>
        );

      case 'user':
        return (
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="person-circle-outline" size={20} color={COLORS.accent} />
                <Text style={styles.modalTitle}>User Profile</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <View style={styles.userCard}>
              <View style={styles.userAvatar}>
                <Ionicons name="game-controller" size={24} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.userName}>Player 1</Text>
                <Text style={styles.userTag}>Padly Pro Gamer • Level 42</Text>
              </View>
            </View>

            <View style={styles.accountRow}>
              <Text style={styles.accountKey}>Cloud Profile Sync</Text>
              <Text style={styles.accountVal}>Active (Synced)</Text>
            </View>
            <View style={styles.accountRow}>
              <Text style={styles.accountKey}>Total Playtime</Text>
              <Text style={styles.accountVal}>84h 12m</Text>
            </View>

            <TouchableOpacity
              style={styles.actionPrimaryBtn}
              onPress={() => {
                selection();
                onClose();
              }}
            >
              <Text style={styles.actionPrimaryBtnText}>Manage Mappings</Text>
            </TouchableOpacity>
          </View>
        );

      case 'more':
        return (
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="ellipsis-horizontal-circle-outline" size={18} color={COLORS.accent} />
                <Text style={styles.modalTitle}>More Options</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                onToggleDebug();
                selection();
              }}
            >
              <Ionicons
                name={isDebugActive ? 'checkbox' : 'square-outline'}
                size={18}
                color={COLORS.accent}
              />
              <Text style={styles.menuItemText}>
                {isDebugActive ? 'Hide Socket Outlines' : 'Show Socket Outlines'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                selection();
                onClose();
              }}
            >
              <Ionicons name="refresh-outline" size={18} color="#8A98AC" />
              <Text style={styles.menuItemText}>Reset Calibration to Factory</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                selection();
                onClose();
              }}
            >
              <Ionicons name="information-circle-outline" size={18} color="#8A98AC" />
              <Text style={styles.menuItemText}>About Padly (v1.0.0 Engine)</Text>
            </TouchableOpacity>
          </View>
        );

      case 'profile':
        return (
          <View style={[styles.modalCard, styles.modalCardWide]}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="game-controller-outline" size={18} color={COLORS.accent} />
                <Text style={styles.modalTitle}>Controller Profiles</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
              {profiles.map((prof) => {
                const isActive = prof.id === currentProfile.id;
                const isEditing = editingProfileId === prof.id;

                return (
                  <View
                    key={prof.id}
                    style={[styles.profileCard, isActive && styles.profileCardActive]}
                  >
                    <TouchableOpacity
                      style={styles.profileCardHeader}
                      activeOpacity={0.7}
                      onPress={async () => {
                        selection();
                        await profileStore.setActiveProfile(prof.id);
                        onSelectProfile(prof.name);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        {isEditing ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <TextInput
                              style={styles.profileInput}
                              value={editNameText}
                              onChangeText={setEditNameText}
                              autoFocus
                              placeholder="Profile Name"
                              placeholderTextColor="#667"
                            />
                            <TouchableOpacity
                              onPress={async () => {
                                selection();
                                await profileStore.renameProfile(prof.id, editNameText);
                                setEditingProfileId(null);
                              }}
                              style={styles.profileSaveBtn}
                            >
                              <Ionicons name="checkmark" size={16} color="#FFF" />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text
                              style={[
                                styles.profileNameText,
                                isActive && styles.profileNameTextActive,
                              ]}
                            >
                              {prof.name}
                            </Text>
                            {isActive && (
                              <View style={styles.activePillBadge}>
                                <Text style={styles.activePillBadgeText}>ACTIVE</Text>
                              </View>
                            )}
                          </View>
                        )}
                        <Text style={styles.profileMetaText}>
                          DZ: {Math.round(prof.deadzone * 100)}% • {prof.stickCurve} •{' '}
                          {prof.triggerBehavior} • Target:{' '}
                          {prof.targetPreference === 'ds4' ? 'DualShock 4' : 'Xbox 360'}
                        </Text>
                      </View>

                      {/* Action Icons: Duplicate, Rename, Delete */}
                      <View style={styles.profileActionIcons}>
                        <TouchableOpacity
                          style={styles.iconActionBtn}
                          onPress={async () => {
                            selection();
                            const dup = await profileStore.duplicateProfile(prof.id);
                            onSelectProfile(dup.name);
                          }}
                        >
                          <Ionicons name="copy-outline" size={16} color="#8A98AC" />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.iconActionBtn}
                          onPress={() => {
                            selection();
                            setEditingProfileId(prof.id);
                            setEditNameText(prof.name);
                          }}
                        >
                          <Ionicons name="pencil-outline" size={16} color="#8A98AC" />
                        </TouchableOpacity>

                        {profiles.length > 1 && (
                          <TouchableOpacity
                            style={styles.iconActionBtn}
                            onPress={() => {
                              selection();
                              Alert.alert(
                                'Delete Profile',
                                `Delete "${prof.name}"? This action cannot be undone.`,
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Delete',
                                    style: 'destructive',
                                    onPress: async () => {
                                      await profileStore.deleteProfile(prof.id);
                                    },
                                  },
                                ]
                              );
                            }}
                          >
                            <Ionicons name="trash-outline" size={16} color="#FF453A" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}

              {/* Create New Profile Button */}
              <TouchableOpacity
                style={styles.createProfileBtn}
                onPress={async () => {
                  selection();
                  const newProf = await profileStore.createProfile('Custom Profile');
                  onSelectProfile(newProf.name);
                  setEditingProfileId(newProf.id);
                  setEditNameText(newProf.name);
                }}
              >
                <Ionicons name="add-circle-outline" size={18} color={COLORS.accent} />
                <Text style={styles.createProfileBtnText}>Create New Profile</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        );

      case 'vibration':
        return (
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <MaterialCommunityIcons name="vibrate" size={18} color={COLORS.accent} />
                <Text style={styles.modalTitle}>Vibration & Haptics</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Master Haptics Toggle</Text>
              <Switch
                value={hapticsOn}
                onValueChange={(val) => {
                  onToggleHaptics(val);
                  setHapticsEnabled(val);
                  if (val) mechanicalClick();
                }}
                trackColor={{ false: '#252B36', true: COLORS.accent }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={styles.pillToggleGroup}>
              {['Soft', 'Medium', 'Heavy'].map((lvl) => (
                <TouchableOpacity
                  key={lvl}
                  style={[styles.pillOption, lvl === 'Heavy' && styles.pillOptionActive]}
                  onPress={() => {
                    mechanicalClick();
                    onClose();
                  }}
                >
                  <Text
                    style={[styles.pillOptionText, lvl === 'Heavy' && styles.pillOptionTextActive]}
                  >
                    {lvl}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );

      case 'brightness':
        return (
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="sunny-outline" size={18} color="#FFD60A" />
                <Text style={styles.modalTitle}>Ambient LED Brightness</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <View style={styles.pillToggleGroup}>
              {[0.3, 0.6, 1.0].map((b) => (
                <TouchableOpacity
                  key={b}
                  style={[styles.pillOption, brightness === b && styles.pillOptionActive]}
                  onPress={() => {
                    selection();
                    onSelectBrightness(b);
                    onClose();
                  }}
                >
                  <Text
                    style={[styles.pillOptionText, brightness === b && styles.pillOptionTextActive]}
                  >
                    {Math.round(b * 100)}%
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );

      case 'theme':
        return (
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="color-palette-outline" size={18} color="#A682FF" />
                <Text style={styles.modalTitle}>Accent Theme</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <View style={styles.themeRow}>
              {[
                { name: 'Electric Blue', color: '#2F8BFF' },
                { name: 'Cyber Neon', color: '#00E5FF' },
                { name: 'Emerald', color: '#30D158' },
                { name: 'Sunset', color: '#FF9500' },
                { name: 'Crimson', color: '#FF3B30' },
              ].map((t) => (
                <TouchableOpacity
                  key={t.color}
                  style={[styles.themeCircle, { backgroundColor: t.color }]}
                  onPress={() => {
                    selection();
                    onSelectTheme(t.color);
                    onClose();
                  }}
                >
                  {themeColor === t.color && (
                    <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );

      case 'layout':
        return (
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="grid-outline" size={18} color={COLORS.accent} />
                <Text style={styles.modalTitle}>Chassis & Layout Options</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                onToggleDebug();
                selection();
              }}
            >
              <Ionicons
                name={isDebugActive ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={COLORS.accent}
              />
              <Text style={styles.menuItemText}>
                {isDebugActive ? 'Hide Socket Outlines' : 'Show Socket Outlines'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                onToggleButtonStyle(buttonStyle === 'xbox' ? 'playstation' : 'xbox');
                selection();
              }}
            >
              <Ionicons name="swap-horizontal-outline" size={18} color="#8A98AC" />
              <Text style={styles.menuItemText}>
                Toggle Style: {buttonStyle === 'playstation' ? 'PS (△○✕□)' : 'Xbox (YBAX)'}
              </Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  return (
    <Modal visible={activeModal !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()}>{renderModalContent()}</Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: 380,
    backgroundColor: '#0F141E',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 20,
  },
  modalCardWide: {
    width: 440,
    maxHeight: 280,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 10,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  closeBtn: {
    padding: 4,
  },
  scrollBody: {
    maxHeight: 200,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.3)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusBadgeText: {
    color: '#30D158',
    fontWeight: '700',
    fontSize: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  statBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: 8,
  },
  statLabel: {
    color: '#8A98AC',
    fontSize: 10,
    fontWeight: '600',
  },
  statVal: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  settingLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  settingSub: {
    color: '#8A98AC',
    fontSize: 11,
    marginTop: 2,
  },
  pillToggleGroup: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    padding: 2,
    gap: 4,
  },
  pillOption: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  pillOptionActive: {
    backgroundColor: COLORS.accent,
  },
  pillOptionText: {
    color: '#8A98AC',
    fontSize: 11,
    fontWeight: '700',
  },
  pillOptionTextActive: {
    color: '#FFFFFF',
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  userTag: {
    color: '#8A98AC',
    fontSize: 11,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  accountKey: {
    color: '#8A98AC',
    fontSize: 12,
  },
  accountVal: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  actionPrimaryBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 12,
  },
  actionPrimaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  menuItemText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  profileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  profileItemActive: {
    backgroundColor: 'rgba(47, 139, 255, 0.14)',
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  profileItemText: {
    color: '#8A98AC',
    fontWeight: '600',
    fontSize: 13,
  },
  profileItemTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  themeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
  },
  themeCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tuningTabSelector: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 3,
    marginBottom: 10,
    gap: 4,
  },
  tuningTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    borderRadius: 6,
  },
  tuningTabBtnActive: {
    backgroundColor: COLORS.accent,
  },
  tuningTabText: {
    color: '#8A98AC',
    fontSize: 11,
    fontWeight: '600',
  },
  tuningTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  humanErrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.35)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  humanErrorText: {
    flex: 1,
    color: '#FF6961',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  profileCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  profileCardActive: {
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(47, 139, 255, 0.12)',
  },
  profileCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  profileNameText: {
    color: '#D8DFEB',
    fontSize: 13,
    fontWeight: '700',
  },
  profileNameTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  activePillBadge: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activePillBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  profileMetaText: {
    color: '#7E8DA5',
    fontSize: 10,
    marginTop: 3,
  },
  profileActionIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 8,
  },
  iconActionBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  profileInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 6,
    color: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    minWidth: 140,
  },
  profileSaveBtn: {
    backgroundColor: COLORS.accent,
    padding: 6,
    borderRadius: 6,
  },
  createProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(47, 139, 255, 0.4)',
    borderStyle: 'dashed',
    borderRadius: 8,
    backgroundColor: 'rgba(47, 139, 255, 0.06)',
  },
  createProfileBtnText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  hidNoticeCard: {
    backgroundColor: '#1E1B14',
    borderWidth: 1,
    borderColor: '#FFB02050',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  hidNoticeTitle: {
    color: '#FFB020',
    fontSize: 13,
    fontWeight: '700',
  },
  hidNoticeText: {
    color: '#D8D4CF',
    fontSize: 11,
    lineHeight: 16,
  },
  hidActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2F8BFF',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  hidActionBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  hidDeviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginTop: 4,
  },
  hidDeviceBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  hidDeviceBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8A98AC',
  },
  hidGuideBox: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  hidGuideTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2F8BFF',
    marginBottom: 4,
  },
  hidGuideStep: {
    fontSize: 11,
    color: '#C0D0E0',
    lineHeight: 16,
  },
  hidGuideNote: {
    fontSize: 10,
    color: '#A0B0C0',
    lineHeight: 15,
    marginTop: 3,
  },
});

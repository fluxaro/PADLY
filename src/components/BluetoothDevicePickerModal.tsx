import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { light, mechanicalClick, selection } from '../hooks/useHaptics';
import {
  checkBluetoothPermissions,
  requestBluetoothPermissions,
  BluetoothPermissionResult,
} from '../pairing/BluetoothPermissions';
import { pairingStore, PairedPC } from '../pairing/PairingStore';
import { connectionManager } from '../net/ConnectionManager';
import { BluetoothTransport } from '../net/transports/BluetoothTransport';
import { useConnection } from '../net/useConnection';

// Safe require for react-native-bluetooth-classic
let RNBluetoothClassic: any = null;
try {
  RNBluetoothClassic =
    require('react-native-bluetooth-classic').default ||
    require('react-native-bluetooth-classic');
} catch {}

interface BluetoothDevicePickerModalProps {
  visible: boolean;
  onClose: () => void;
}

interface DeviceItem {
  name: string;
  address: string;
  bonded?: boolean;
}

export const BluetoothDevicePickerModal: React.FC<BluetoothDevicePickerModalProps> = ({
  visible,
  onClose,
}) => {
  const [permissionState, setPermissionState] = useState<BluetoothPermissionResult>({
    granted: false,
    canAskAgain: true,
    deniedPermissions: [],
  });
  const [hasCheckedPermission, setHasCheckedPermission] = useState<boolean>(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  const conn = useConnection();

  useEffect(() => {
    if (visible && Platform.OS === 'android') {
      checkAndLoad();
    }
  }, [visible]);

  const checkAndLoad = async () => {
    setIsLoading(true);
    const hasPerms = await checkBluetoothPermissions();
    if (!hasPerms) {
      const res = await requestBluetoothPermissions();
      setPermissionState(res);
      setHasCheckedPermission(true);
      if (!res.granted) {
        setIsLoading(false);
        return;
      }
    } else {
      setPermissionState({ granted: true, canAskAgain: true, deniedPermissions: [] });
      setHasCheckedPermission(true);
    }

    await loadBondedDevices();
    setIsLoading(false);
  };

  const loadBondedDevices = async () => {
    if (!RNBluetoothClassic?.getBondedDevices) {
      return;
    }

    try {
      const bonded = await RNBluetoothClassic.getBondedDevices();
      setDevices(
        bonded.map((d: any) => ({
          name: d.name || 'Unknown Device',
          address: d.address,
          bonded: d.bonded ?? true,
        }))
      );

      // Check current paired PC's saved Bluetooth address
      const last = await pairingStore.getLastUsed();
      if (last?.pc?.btAddress) {
        setSelectedAddress(last.pc.btAddress);
      }
    } catch (err) {
      console.warn('[BluetoothDevicePicker] Failed to load bonded devices:', err);
    }
  };

  const handleSelectDevice = async (device: DeviceItem) => {
    mechanicalClick();
    setSelectedAddress(device.address);
    setIsConnecting(true);

    try {
      const last = await pairingStore.getLastUsed();
      if (!last) {
        Alert.alert(
          'No Paired PC Record',
          'Please scan your PC QR code first to establish cryptographic pairing credentials.'
        );
        setIsConnecting(false);
        return;
      }

      // 1. Save chosen Bluetooth MAC address into PairingStore
      await pairingStore.updateBtAddress(last.pc.id, device.address);

      // 2. Initiate Bluetooth RFCOMM connection
      const transport = new BluetoothTransport('bluetooth');
      await connectionManager.connectSeamless({
        transport,
        target: {
          btAddress: device.address,
          rfcommUuid: last.pc.btUuid,
        },
        pairingKey: last.pairingKey,
        clientName: 'Padly Mobile (Bluetooth)',
        autoReconnect: true,
      });

      onClose();
    } catch (err: any) {
      Alert.alert(
        'Bluetooth Link Failed',
        `Could not connect to "${device.name}" (${device.address}) via RFCOMM: ${err?.message || err}`
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleOpenSettings = () => {
    selection();
    if (RNBluetoothClassic?.openBluetoothSettings) {
      try {
        RNBluetoothClassic.openBluetoothSettings();
        return;
      } catch {}
    }

    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => {
        Linking.openSettings();
      });
    } else {
      Linking.openSettings();
    }
  };

  if (!visible || Platform.OS !== 'android') return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleGroup}>
              <Ionicons name="bluetooth" size={20} color="#2F8BFF" />
              <Text style={styles.title}>Bluetooth RFCOMM Devices</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#8A98AC" />
            </TouchableOpacity>
          </View>

          {/* Permissions Denied Screen */}
          {hasCheckedPermission && !permissionState.granted ? (
            <View style={styles.permissionBody}>
              <View style={styles.permIconCircle}>
                <Ionicons name="shield-outline" size={32} color="#FF9500" />
              </View>
              <Text style={styles.permTitle}>Bluetooth Permission Required</Text>
              <Text style={styles.permDesc}>
                Android 12+ requires Nearby Devices permission (BLUETOOTH_CONNECT &amp;
                BLUETOOTH_SCAN) to connect to your PC's RFCOMM gamepad service.
              </Text>

              {permissionState.canAskAgain ? (
                <TouchableOpacity style={styles.permActionBtn} onPress={checkAndLoad}>
                  <Text style={styles.permActionBtnText}>Grant Permissions</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.permActionBtn}
                  onPress={() => Linking.openSettings()}
                >
                  <Text style={styles.permActionBtnText}>Open App Settings</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              {/* Note on latency */}
              <View style={styles.latencyNote}>
                <Ionicons name="information-circle-outline" size={16} color="#FFD60A" />
                <Text style={styles.latencyNoteText}>
                  Bluetooth RFCOMM operates with higher latency (~20-50ms) than Wi-Fi or USB.
                </Text>
              </View>

              {/* Devices Section */}
              <Text style={styles.sectionHeader}>
                Bonded Devices ({devices.length})
              </Text>

              {isLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="small" color="#2F8BFF" />
                  <Text style={styles.loadingText}>Loading bonded devices...</Text>
                </View>
              ) : devices.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="bluetooth-outline" size={30} color="#4A5568" />
                  <Text style={styles.emptyTitle}>No Bonded Bluetooth Devices</Text>
                  <Text style={styles.emptySub}>
                    Pair your PC with your phone in Android Bluetooth Settings first.
                  </Text>
                </View>
              ) : (
                devices.map((device) => {
                  const isSelected = selectedAddress === device.address;
                  const isCurrentlyActive =
                    conn.status === 'connected' && conn.transportKind === 'bluetooth';

                  return (
                    <TouchableOpacity
                      key={device.address}
                      style={[styles.deviceItem, isSelected && styles.deviceItemActive]}
                      onPress={() => handleSelectDevice(device)}
                      disabled={isConnecting}
                    >
                      <View style={styles.deviceAvatar}>
                        <Ionicons
                          name="desktop-outline"
                          size={18}
                          color={isSelected ? '#2F8BFF' : '#8A98AC'}
                        />
                      </View>
                      <View style={styles.deviceInfo}>
                        <Text style={styles.deviceName}>{device.name}</Text>
                        <Text style={styles.deviceAddress}>{device.address}</Text>
                      </View>
                      {isSelected && (
                        <View style={styles.activePill}>
                          <Text style={styles.activePillText}>
                            {isCurrentlyActive ? 'CONNECTED' : 'PAIRED'}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}

              {/* Pair New Device / Settings Help */}
              <View style={styles.settingsHelpCard}>
                <Text style={styles.settingsHelpTitle}>PC Not Listed?</Text>
                <Text style={styles.settingsHelpText}>
                  1. Turn on Bluetooth on your PC.{'\n'}
                  2. Open Bluetooth Settings and pair your PC with this phone.{'\n'}
                  3. Return to Padly and select your PC above.
                </Text>
                <TouchableOpacity
                  style={styles.openSettingsBtn}
                  onPress={handleOpenSettings}
                >
                  <Ionicons name="open-outline" size={15} color="#FFFFFF" />
                  <Text style={styles.openSettingsBtnText}>Open Bluetooth Settings</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </Pressable>
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
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#0F141E',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 18,
    padding: 16,
    maxHeight: '90%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 12,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    maxHeight: 320,
  },
  latencyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 214, 10, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 214, 10, 0.3)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  latencyNoteText: {
    color: '#FFD60A',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  sectionHeader: {
    color: '#8A98AC',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 20,
  },
  loadingText: {
    color: '#8A98AC',
    fontSize: 12,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
    padding: 20,
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    marginTop: 6,
  },
  emptySub: {
    color: '#8A98AC',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  deviceItemActive: {
    borderColor: '#2F8BFF',
    backgroundColor: 'rgba(47, 139, 255, 0.12)',
  },
  deviceAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  deviceAddress: {
    color: '#8A98AC',
    fontSize: 10,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  activePill: {
    backgroundColor: 'rgba(47, 139, 255, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activePillText: {
    color: '#2F8BFF',
    fontSize: 9,
    fontWeight: '800',
  },
  settingsHelpCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    padding: 12,
    marginTop: 6,
    marginBottom: 10,
  },
  settingsHelpTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 4,
  },
  settingsHelpText: {
    color: '#8A98AC',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
  },
  openSettingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2F8BFF',
    borderRadius: 8,
    paddingVertical: 8,
  },
  openSettingsBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  permissionBody: {
    alignItems: 'center',
    padding: 16,
  },
  permIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  permTitle: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 6,
  },
  permDesc: {
    color: '#8A98AC',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  permActionBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  permActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});

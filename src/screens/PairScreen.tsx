import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { pairingStore, PairedPC, base64UrlToBytes, bytesToBase64Url } from '../pairing/PairingStore';
import { parsePairingUrl } from '../pairing/qrParser';
import { connectToPairedPc } from '../pairing/connectHelper';
import { useConnection } from '../net/useConnection';
import { COLORS } from '../theme/colors';
import { light, mechanicalClick, selection } from '../hooks/useHaptics';

export interface PairScreenProps {
  visible: boolean;
  onClose: () => void;
}

export const PairScreen: React.FC<PairScreenProps> = ({ visible, onClose }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [pairedList, setPairedList] = useState<PairedPC[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connectingPcId, setConnectingPcId] = useState<string | null>(null);
  const [scanCooldown, setScanCooldown] = useState<boolean>(false);

  // Manual entry state
  const [manualName, setManualName] = useState<string>('My Gaming PC');
  const [manualHost, setManualHost] = useState<string>('');
  const [manualPort, setManualPort] = useState<string>('47820');
  const [manualKey, setManualKey] = useState<string>('');
  const [manualError, setManualError] = useState<string | null>(null);

  const conn = useConnection();

  // Load paired PCs on mount and when modal opens
  useEffect(() => {
    if (visible) {
      loadPairedList();
    } else {
      setIsScanning(false);
      setIsManualModalOpen(false);
    }
  }, [visible]);

  const loadPairedList = async () => {
    const list = await pairingStore.list();
    setPairedList(list);
  };

  const handleStartScan = async () => {
    selection();
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Camera access is needed to scan the pairing QR code displayed in the Padly PC companion app.'
        );
        return;
      }
    }
    setIsScanning(true);
  };

  const handleBarcodeScanned = async (scanningResult: { data: string }) => {
    if (scanCooldown) return;
    setScanCooldown(true);

    const rawData = scanningResult.data;
    const parsed = parsePairingUrl(rawData);

    if (!parsed.ok) {
      light();
      Alert.alert('Invalid QR Code', parsed.error, [
        {
          text: 'OK',
          onPress: () => {
            setTimeout(() => setScanCooldown(false), 1500);
          },
        },
      ]);
      return;
    }

    // Success: save to store
    mechanicalClick();
    setIsScanning(false);
    const { pc, pairingKey } = parsed.data;

    try {
      await pairingStore.add(pc, pairingKey);
      await loadPairedList();

      Alert.alert(
        'PC Paired Successfully',
        `Paired with "${pc.name}" (${pc.host}:${pc.udpPort}). Would you like to connect now?`,
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Connect Now',
            onPress: () => {
              triggerConnect(pc, pairingKey);
            },
          },
        ]
      );
    } catch (err: any) {
      Alert.alert('Storage Error', `Failed to save pairing credentials: ${err?.message}`);
    } finally {
      setTimeout(() => setScanCooldown(false), 1000);
    }
  };

  const handleManualSave = async () => {
    selection();
    setManualError(null);

    const name = manualName.trim() || 'PC';
    const host = manualHost.trim();
    const portNum = parseInt(manualPort.trim(), 10);
    const keyStr = manualKey.trim();

    if (!host) {
      setManualError('Host IP address cannot be empty.');
      return;
    }

    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setManualError('Port must be a valid number between 1 and 65535.');
      return;
    }

    let keyBytes: Uint8Array;
    try {
      keyBytes = base64UrlToBytes(keyStr);
    } catch {
      setManualError('Pairing key is not valid base64url.');
      return;
    }

    if (keyBytes.length !== 32) {
      setManualError(`Invalid pairing key length: expected 32 bytes, got ${keyBytes.length}.`);
      return;
    }

    const pcId = `manual_${Date.now()}`;
    const newPc: PairedPC = {
      id: pcId,
      name,
      host,
      udpPort: portNum,
      tcpPort: 47821,
      lastUsed: Date.now(),
    };

    try {
      await pairingStore.add(newPc, keyBytes);
      setIsManualModalOpen(false);
      await loadPairedList();

      Alert.alert('Manual Pair Saved', `Successfully added "${name}". Connect now?`, [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Connect Now',
          onPress: () => {
            triggerConnect(newPc, keyBytes);
          },
        },
      ]);
    } catch (err: any) {
      setManualError(`Failed to save: ${err?.message}`);
    }
  };

  const triggerConnect = async (pc: PairedPC, pairingKey?: Uint8Array) => {
    setIsConnecting(true);
    setConnectingPcId(pc.id);

    let key = pairingKey;
    if (!key) {
      const record = await pairingStore.get(pc.id);
      if (!record) {
        setIsConnecting(false);
        setConnectingPcId(null);
        Alert.alert('Error', 'Missing pairing key. Please re-pair this PC.');
        return;
      }
      key = record.pairingKey;
    }

    const res = await connectToPairedPc(pc, key);
    setIsConnecting(false);
    setConnectingPcId(null);

    if (!res.ok) {
      Alert.alert('Connection Failed', res.error || 'Failed to connect to PC.');
    } else {
      // Success: close pairing screen
      onClose();
    }
  };

  const handleDelete = (pc: PairedPC) => {
    selection();
    Alert.alert(
      'Remove PC',
      `Are you sure you want to remove "${pc.name}"? You will need to scan its QR code again to reconnect.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await pairingStore.remove(pc.id);
            await loadPairedList();
          },
        },
      ]
    );
  };

  const handleRename = (pc: PairedPC) => {
    selection();
    Alert.prompt
      ? Alert.prompt(
          'Rename PC',
          'Enter a new display name for this computer:',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Save',
              onPress: async (newName?: string) => {
                if (newName && newName.trim()) {
                  await pairingStore.rename(pc.id, newName.trim());
                  await loadPairedList();
                }
              },
            },
          ],
          'plain-text',
          pc.name
        )
      : Alert.alert('Rename', 'Edit name is supported on device prompt.');
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleGroup}>
              <Ionicons name="qr-code-outline" size={20} color={COLORS.accent} />
              <Text style={styles.title}>PC Pairing & Devices</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#8A98AC" />
            </TouchableOpacity>
          </View>

          {/* Active Connection Status Pill */}
          {conn.status === 'connected' && (
            <View style={styles.activeBanner}>
              <View style={styles.activeDot} />
              <Text style={styles.activeBannerText}>
                Active session with <Text style={styles.bold}>{conn.pcName || 'PC'}</Text> (
                {conn.rttMs}ms)
              </Text>
            </View>
          )}

          {/* Camera Scanner View */}
          {isScanning ? (
            <View style={styles.scannerWrapper}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ['qr'],
                }}
                onBarcodeScanned={handleBarcodeScanned}
              />
              <View style={styles.scannerOverlay}>
                <View style={styles.scannerBox}>
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
                <Text style={styles.scannerPrompt}>
                  Scan the Padly QR code shown in the PC companion app
                </Text>
                <TouchableOpacity
                  style={styles.cancelScanBtn}
                  onPress={() => {
                    selection();
                    setIsScanning(false);
                  }}
                >
                  <Text style={styles.cancelScanBtnText}>Cancel Camera Scan</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
              {/* Action Buttons: Scan QR and Manual Entry */}
              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.primaryActionBtn} onPress={handleStartScan}>
                  <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryActionBtnText}>Scan QR Code</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryActionBtn}
                  onPress={() => {
                    selection();
                    setManualError(null);
                    setIsManualModalOpen(true);
                  }}
                >
                  <Ionicons name="create-outline" size={18} color="#B0BDD0" />
                  <Text style={styles.secondaryActionBtnText}>Manual Entry</Text>
                </TouchableOpacity>
              </View>

              {/* Paired Devices List */}
              <Text style={styles.sectionTitle}>
                Paired Computers ({pairedList.length})
              </Text>

              {pairedList.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="laptop-outline" size={36} color="#4A5568" />
                  <Text style={styles.emptyCardTitle}>No Paired Computers</Text>
                  <Text style={styles.emptyCardSub}>
                    Start the Padly PC companion app on your computer, click "Show Pairing Code",
                    and tap "Scan QR Code" above.
                  </Text>
                </View>
              ) : (
                pairedList.map((pc) => {
                  const isCurrentTarget = connectingPcId === pc.id;
                  const isCurrentlyActive =
                    conn.status === 'connected' && conn.pcName === pc.name;

                  return (
                    <View key={pc.id} style={styles.pcCard}>
                      <View style={styles.pcHeader}>
                        <View style={styles.pcAvatar}>
                          <Ionicons
                            name="desktop-outline"
                            size={20}
                            color={isCurrentlyActive ? '#30D158' : COLORS.accent}
                          />
                        </View>
                        <View style={styles.pcInfo}>
                          <View style={styles.nameRow}>
                            <Text style={styles.pcName}>{pc.name}</Text>
                            {isCurrentlyActive && (
                              <View style={styles.connectedBadge}>
                                <Text style={styles.connectedBadgeText}>ONLINE</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.pcAddress}>
                            {pc.host}:{pc.udpPort} (UDP)
                          </Text>
                        </View>
                      </View>

                      {/* PC Actions */}
                      <View style={styles.pcActionsRow}>
                        <TouchableOpacity
                          style={[
                            styles.connectBtn,
                            isCurrentlyActive && styles.connectBtnActive,
                          ]}
                          disabled={isConnecting || isCurrentlyActive}
                          onPress={() => triggerConnect(pc)}
                        >
                          {isCurrentTarget ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <>
                              <Ionicons
                                name={isCurrentlyActive ? 'checkmark-circle' : 'play'}
                                size={14}
                                color="#FFFFFF"
                              />
                              <Text style={styles.connectBtnText}>
                                {isCurrentlyActive
                                  ? 'Connected'
                                  : isConnecting
                                  ? 'Connecting...'
                                  : 'Connect'}
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.iconActionBtn}
                          onPress={() => handleRename(pc)}
                        >
                          <Ionicons name="pencil-outline" size={15} color="#8A98AC" />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.iconActionBtn}
                          onPress={() => handleDelete(pc)}
                        >
                          <Ionicons name="trash-outline" size={15} color="#FF453A" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* Manual Entry Modal */}
          <Modal
            visible={isManualModalOpen}
            transparent
            animationType="slide"
            onRequestClose={() => setIsManualModalOpen(false)}
          >
            <View style={styles.manualBackdrop}>
              <View style={styles.manualModalCard}>
                <View style={styles.headerRow}>
                  <View style={styles.titleGroup}>
                    <Ionicons name="construct-outline" size={18} color={COLORS.accent} />
                    <Text style={styles.title}>Manual PC Connection</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setIsManualModalOpen(false)}
                    style={styles.closeBtn}
                  >
                    <Ionicons name="close" size={18} color="#8A98AC" />
                  </TouchableOpacity>
                </View>

                {manualError && (
                  <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={15} color="#FF453A" />
                    <Text style={styles.errorBannerText}>{manualError}</Text>
                  </View>
                )}

                <ScrollView style={{ maxHeight: 220 }}>
                  <Text style={styles.inputLabel}>PC Name</Text>
                  <TextInput
                    style={styles.inputField}
                    value={manualName}
                    onChangeText={setManualName}
                    placeholder="e.g. Living Room PC"
                    placeholderTextColor="#5A6678"
                  />

                  <Text style={styles.inputLabel}>IP Address / Host</Text>
                  <TextInput
                    style={styles.inputField}
                    value={manualHost}
                    onChangeText={setManualHost}
                    placeholder="192.168.1.100"
                    placeholderTextColor="#5A6678"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.inputLabel}>UDP Port</Text>
                  <TextInput
                    style={styles.inputField}
                    value={manualPort}
                    onChangeText={setManualPort}
                    placeholder="47820"
                    placeholderTextColor="#5A6678"
                    keyboardType="number-pad"
                  />

                  <Text style={styles.inputLabel}>Pairing Key (32 bytes base64url)</Text>
                  <TextInput
                    style={[styles.inputField, { height: 50 }]}
                    value={manualKey}
                    onChangeText={setManualKey}
                    placeholder="Paste the 43-44 char key from PC app"
                    placeholderTextColor="#5A6678"
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                  />
                </ScrollView>

                <View style={styles.manualActionsRow}>
                  <TouchableOpacity
                    style={styles.cancelManualBtn}
                    onPress={() => setIsManualModalOpen(false)}
                  >
                    <Text style={styles.cancelManualBtnText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.saveManualBtn} onPress={handleManualSave}>
                    <Text style={styles.saveManualBtnText}>Save & Pair</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '92%',
    backgroundColor: '#0F141E',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 25,
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
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.3)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#30D158',
  },
  activeBannerText: {
    color: '#30D158',
    fontSize: 12,
  },
  bold: {
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  primaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingVertical: 10,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    paddingVertical: 10,
  },
  secondaryActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  sectionTitle: {
    color: '#8A98AC',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  scrollArea: {
    maxHeight: 280,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    padding: 24,
    marginTop: 4,
  },
  emptyCardTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    marginTop: 8,
  },
  emptyCardSub: {
    color: '#8A98AC',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
  pcCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  pcHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  pcAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pcInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pcName: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  connectedBadge: {
    backgroundColor: 'rgba(48, 209, 88, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  connectedBadgeText: {
    color: '#30D158',
    fontSize: 9,
    fontWeight: '800',
  },
  pcAddress: {
    color: '#8A98AC',
    fontSize: 11,
    marginTop: 2,
  },
  pcActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingVertical: 7,
  },
  connectBtnActive: {
    backgroundColor: '#30D158',
  },
  connectBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  iconActionBtn: {
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerWrapper: {
    height: 260,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  scannerBox: {
    width: 160,
    height: 160,
    position: 'relative',
    marginBottom: 12,
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: COLORS.accent,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  scannerPrompt: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 14,
  },
  cancelScanBtn: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  cancelScanBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  manualBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  manualModalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#121722',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 16,
    padding: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  errorBannerText: {
    color: '#FF453A',
    fontSize: 11,
    flex: 1,
  },
  inputLabel: {
    color: '#8A98AC',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
  },
  inputField: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: '#FFFFFF',
    fontSize: 12,
  },
  manualActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 14,
  },
  cancelManualBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  cancelManualBtnText: {
    color: '#8A98AC',
    fontWeight: '700',
    fontSize: 12,
  },
  saveManualBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.accent,
  },
  saveManualBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
});

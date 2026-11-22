import React from 'react';
import {
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
import { selection, mechanicalClick } from '../hooks/useHaptics';
import { connectionManager } from '../net/ConnectionManager';
import { usbWatcher } from '../net/UsbWatcher';

interface UsbHelpBottomSheetProps {
  visible: boolean;
  onClose: () => void;
}

export const UsbHelpBottomSheet: React.FC<UsbHelpBottomSheetProps> = ({
  visible,
  onClose,
}) => {
  if (!visible) return null;

  const handleRetry = () => {
    mechanicalClick();
    usbWatcher.tick();
    onClose();
  };

  const handleSwitchWifi = () => {
    selection();
    connectionManager.setConnectionMode('wifi');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheetCard} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleGroup}>
              <Ionicons name="hardware-chip-outline" size={20} color="#FFD60A" />
              <Text style={styles.title}>USB Connection Setup</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#8A98AC" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Status Alert */}
            <View style={styles.alertBanner}>
              <Ionicons name="alert-circle-outline" size={18} color="#FF9500" />
              <Text style={styles.alertText}>
                USB link not detected on 127.0.0.1:47821 or tethering interface.
              </Text>
            </View>

            {/* Path 1: ADB Reverse */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>PATH 1</Text>
                </View>
                <Text style={styles.sectionTitle}>ADB Reverse (Ultra Low-Latency)</Text>
              </View>

              <Text style={styles.stepText}>
                1. Enable USB debugging on your Android phone.
              </Text>
              <Text style={styles.stepText}>
                2. Connect your phone to your PC with a USB data cable.
              </Text>
              <Text style={styles.stepText}>
                3. Open a terminal or command prompt on your PC and run:
              </Text>

              <View style={styles.codeBox}>
                <Text style={styles.codeText} selectable>
                  adb reverse tcp:47821 tcp:47821
                </Text>
              </View>
            </View>

            {/* Path 2: USB Tethering */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={[styles.badge, { backgroundColor: 'rgba(47, 139, 255, 0.2)' }]}>
                  <Text style={[styles.badgeText, { color: '#2F8BFF' }]}>PATH 2</Text>
                </View>
                <Text style={styles.sectionTitle}>USB Tethering (Plug & Play)</Text>
              </View>

              <Text style={styles.stepText}>
                Turn on USB tethering in phone settings:
              </Text>
              <Text style={styles.subText}>
                Settings &gt; Network &amp; Internet &gt; Hotspot &amp; tethering &gt; USB tethering
              </Text>
              <Text style={styles.subText}>
                Padly automatically routes UDP datagrams through the tethered network interface.
              </Text>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleSwitchWifi}>
              <Ionicons name="wifi-outline" size={16} color="#B0BDD0" />
              <Text style={styles.secondaryBtnText}>Switch to Wi-Fi</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>
              <Ionicons name="refresh" size={16} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Retry USB</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheetCard: {
    width: '100%',
    maxWidth: 540,
    backgroundColor: '#0F141E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    padding: 18,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
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
  body: {
    maxHeight: 280,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 149, 0, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.3)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  alertText: {
    color: '#FF9500',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  sectionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  badge: {
    backgroundColor: 'rgba(255, 214, 10, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    color: '#FFD60A',
    fontSize: 9,
    fontWeight: '800',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  stepText: {
    color: '#E0E6F0',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  subText: {
    color: '#8A98AC',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  codeBox: {
    backgroundColor: '#05070B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 6,
  },
  codeText: {
    color: '#30D158',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    paddingVertical: 10,
  },
  secondaryBtnText: {
    color: '#B0BDD0',
    fontWeight: '700',
    fontSize: 13,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingVertical: 10,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});

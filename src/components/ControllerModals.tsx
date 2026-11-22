import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { COLORS } from '../theme/colors';
import { light, mechanicalClick, selection, setHapticsEnabled } from '../hooks/useHaptics';

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
  | null;

interface ControllerModalsProps {
  activeModal: ModalType;
  onClose: () => void;
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
  if (!activeModal) return null;

  const renderModalContent = () => {
    switch (activeModal) {
      case 'connection':
        return (
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="hardware-chip-outline" size={18} color="#30D158" />
                <Text style={styles.modalTitle}>Device Connection</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <View style={styles.statusBadge}>
              <View style={[styles.dot, { backgroundColor: '#30D158' }]} />
              <Text style={styles.statusBadgeText}>Connected via USB 3.0 (Low-Latency)</Text>
            </View>

            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Polling Rate</Text>
                <Text style={styles.statVal}>1000 Hz (1ms)</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Battery Level</Text>
                <Text style={styles.statVal}>98% Charging</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Input Protocol</Text>
                <Text style={styles.statVal}>XInput / DualSense</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Packets Dropped</Text>
                <Text style={styles.statVal}>0 (0.00%)</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.actionPrimaryBtn}
              onPress={() => {
                selection();
                onClose();
              }}
            >
              <Text style={styles.actionPrimaryBtnText}>Refresh Connection</Text>
            </TouchableOpacity>
          </View>
        );

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
                <Text style={styles.modalTitle}>Tuning & Calibration</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Stick Deadzones</Text>
                  <Text style={styles.settingSub}>Radial deadzone threshold: 10%</Text>
                </View>
                <View style={styles.pillToggleGroup}>
                  {['5%', '10%', '15%'].map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[styles.pillOption, d === '10%' && styles.pillOptionActive]}
                      onPress={() => selection()}
                    >
                      <Text
                        style={[
                          styles.pillOptionText,
                          d === '10%' && styles.pillOptionTextActive,
                        ]}
                      >
                        {d}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Trigger Response Curve</Text>
                  <Text style={styles.settingSub}>Hair-trigger digital snap vs smooth analog</Text>
                </View>
                <View style={styles.pillToggleGroup}>
                  {['Smooth', 'Hair-Trigger'].map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.pillOption, m === 'Smooth' && styles.pillOptionActive]}
                      onPress={() => selection()}
                    >
                      <Text
                        style={[
                          styles.pillOptionText,
                          m === 'Smooth' && styles.pillOptionTextActive,
                        ]}
                      >
                        {m}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Stick Response Profile</Text>
                  <Text style={styles.settingSub}>Linear, Exponential, or Aggressive curve</Text>
                </View>
                <View style={styles.pillToggleGroup}>
                  {['Linear', 'Exponential'].map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.pillOption, p === 'Linear' && styles.pillOptionActive]}
                      onPress={() => selection()}
                    >
                      <Text
                        style={[
                          styles.pillOptionText,
                          p === 'Linear' && styles.pillOptionTextActive,
                        ]}
                      >
                        {p}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>
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
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="game-controller-outline" size={18} color={COLORS.accent} />
                <Text style={styles.modalTitle}>Switch Profile</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#8A98AC" />
              </TouchableOpacity>
            </View>

            {['Default Profile', 'FPS Competitive', 'Racing Sim', 'Retro Arcade'].map((prof) => (
              <TouchableOpacity
                key={prof}
                style={[styles.profileItem, activeProfile === prof && styles.profileItemActive]}
                onPress={() => {
                  selection();
                  onSelectProfile(prof);
                  onClose();
                }}
              >
                <Text
                  style={[
                    styles.profileItemText,
                    activeProfile === prof && styles.profileItemTextActive,
                  ]}
                >
                  {prof}
                </Text>
                {activeProfile === prof && (
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
                )}
              </TouchableOpacity>
            ))}
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
});

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { emit } from '../input/inputBus';
import { light, selection } from '../hooks/useHaptics';
import { COLORS } from '../theme/colors';
import { useFrame } from '../components/ControllerFrame';

export const KeyboardMode: React.FC = () => {
  const { scale } = useFrame();

  const [activeModifiers, setActiveModifiers] = useState<{
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
  }>({
    shift: false,
    ctrl: false,
    alt: false,
  });

  const [lastKeyPressed, setLastKeyPressed] = useState<string>('Ready');

  const handleKeyPress = (key: string) => {
    light();
    setLastKeyPressed(key);
    emit('button', { id: 'A', pressed: true });
    setTimeout(() => {
      emit('button', { id: 'A', pressed: false });
    }, 50);
  };

  const toggleModifier = (mod: 'shift' | 'ctrl' | 'alt') => {
    selection();
    setActiveModifiers((prev) => ({ ...prev, [mod]: !prev[mod] }));
  };

  const row1 = ['ESC', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'BACKSPACE'];
  const row2 = ['TAB', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'];
  const row3 = ['CAPS', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'ENTER'];
  const row4 = ['SHIFT', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'UP'];
  const row5 = ['CTRL', 'ALT', 'SPACE', 'LEFT', 'DOWN', 'RIGHT'];

  const isWASD = (k: string) => k === 'W' || k === 'A' || k === 'S' || k === 'D';

  return (
    <View style={styles.container}>
      {/* Keyboard Status Bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          <Ionicons name="game-controller-outline" size={14 * scale} color={COLORS.accent} />
          <Text style={[styles.statusText, { fontSize: Math.max(9, 11 * scale) }]}>
            Active Key: <Text style={styles.activeKeyHighlight}>{lastKeyPressed}</Text>
          </Text>
        </View>

        <View style={styles.statusRight}>
          <TouchableOpacity
            style={[styles.modPill, activeModifiers.ctrl && styles.modPillActive]}
            onPress={() => toggleModifier('ctrl')}
          >
            <Text style={[styles.modText, activeModifiers.ctrl && styles.modTextActive]}>CTRL</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modPill, activeModifiers.alt && styles.modPillActive]}
            onPress={() => toggleModifier('alt')}
          >
            <Text style={[styles.modText, activeModifiers.alt && styles.modTextActive]}>ALT</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modPill, activeModifiers.shift && styles.modPillActive]}
            onPress={() => toggleModifier('shift')}
          >
            <Text style={[styles.modText, activeModifiers.shift && styles.modTextActive]}>
              SHIFT
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Keyboard Grid */}
      <View style={styles.keyboardBody}>
        {/* Row 1 */}
        <View style={styles.keyRow}>
          {row1.map((k) => (
            <TouchableOpacity
              key={k}
              activeOpacity={0.6}
              onPress={() => handleKeyPress(k)}
              style={[
                styles.key,
                k === 'BACKSPACE' && styles.keyFlex2,
                k === 'ESC' && styles.keyFlex1_2,
              ]}
            >
              <Text style={[styles.keyText, { fontSize: Math.max(8, 10 * scale) }]}>{k}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Row 2 */}
        <View style={styles.keyRow}>
          {row2.map((k) => (
            <TouchableOpacity
              key={k}
              activeOpacity={0.6}
              onPress={() => handleKeyPress(k)}
              style={[styles.key, k === 'TAB' && styles.keyFlex1_5, isWASD(k) && styles.keyWASD]}
            >
              <Text
                style={[
                  styles.keyText,
                  isWASD(k) && styles.keyWASDText,
                  { fontSize: Math.max(9, 11 * scale) },
                ]}
              >
                {k}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Row 3 */}
        <View style={styles.keyRow}>
          {row3.map((k) => (
            <TouchableOpacity
              key={k}
              activeOpacity={0.6}
              onPress={() => handleKeyPress(k)}
              style={[
                styles.key,
                k === 'CAPS' && styles.keyFlex1_5,
                k === 'ENTER' && styles.keyEnter,
                isWASD(k) && styles.keyWASD,
              ]}
            >
              <Text
                style={[
                  styles.keyText,
                  isWASD(k) && styles.keyWASDText,
                  k === 'ENTER' && styles.keyEnterText,
                  { fontSize: Math.max(9, 11 * scale) },
                ]}
              >
                {k}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Row 4 */}
        <View style={styles.keyRow}>
          {row4.map((k) => (
            <TouchableOpacity
              key={k}
              activeOpacity={0.6}
              onPress={() => handleKeyPress(k)}
              style={[styles.key, k === 'SHIFT' && styles.keyFlex2, k === 'UP' && styles.keyNav]}
            >
              {k === 'UP' ? (
                <Ionicons name="arrow-up" size={13 * scale} color="#FFFFFF" />
              ) : (
                <Text style={[styles.keyText, { fontSize: Math.max(9, 11 * scale) }]}>{k}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Row 5 */}
        <View style={styles.keyRow}>
          {row5.map((k) => (
            <TouchableOpacity
              key={k}
              activeOpacity={0.6}
              onPress={() => handleKeyPress(k)}
              style={[
                styles.key,
                k === 'SPACE' && styles.keySpace,
                (k === 'LEFT' || k === 'DOWN' || k === 'RIGHT') && styles.keyNav,
              ]}
            >
              {k === 'LEFT' ? (
                <Ionicons name="arrow-back" size={13 * scale} color="#FFFFFF" />
              ) : k === 'DOWN' ? (
                <Ionicons name="arrow-down" size={13 * scale} color="#FFFFFF" />
              ) : k === 'RIGHT' ? (
                <Ionicons name="arrow-forward" size={13 * scale} color="#FFFFFF" />
              ) : (
                <Text style={[styles.keyText, { fontSize: Math.max(9, 11 * scale) }]}>{k}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 54,
    justifyContent: 'space-between',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(13, 17, 24, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 8,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    color: '#8A98AC',
    fontWeight: '600',
  },
  activeKeyHighlight: {
    color: COLORS.accent,
    fontWeight: '800',
  },
  statusRight: {
    flexDirection: 'row',
    gap: 6,
  },
  modPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  modPillActive: {
    backgroundColor: COLORS.accent,
  },
  modText: {
    color: '#8A98AC',
    fontWeight: '700',
    fontSize: 10,
  },
  modTextActive: {
    color: '#FFFFFF',
  },
  keyboardBody: {
    flex: 1,
    gap: 5,
    justifyContent: 'center',
  },
  keyRow: {
    flexDirection: 'row',
    gap: 4,
    flex: 1,
  },
  key: {
    flex: 1,
    backgroundColor: '#121722',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyFlex1_2: {
    flex: 1.2,
  },
  keyFlex1_5: {
    flex: 1.5,
  },
  keyFlex2: {
    flex: 2,
  },
  keySpace: {
    flex: 5,
    backgroundColor: '#161D2B',
  },
  keyEnter: {
    flex: 1.8,
    backgroundColor: '#19355A',
    borderColor: COLORS.accent,
  },
  keyEnterText: {
    color: '#8FC0FF',
    fontWeight: '800',
  },
  keyNav: {
    backgroundColor: '#181F2D',
  },
  keyWASD: {
    backgroundColor: '#182E4E',
    borderColor: COLORS.accent,
  },
  keyWASDText: {
    color: '#70B0FF',
    fontWeight: '900',
  },
  keyText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});

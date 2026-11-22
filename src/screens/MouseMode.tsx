import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { emit } from '../input/inputBus';
import { light, mechanicalClick, selection } from '../hooks/useHaptics';
import { COLORS } from '../theme/colors';
import { useFrame } from '../components/ControllerFrame';

export const MouseMode: React.FC = () => {
  const { scale } = useFrame();

  const [dpi, setDpi] = useState<number>(1200);
  const [isDragLocked, setIsDragLocked] = useState<boolean>(false);
  const [leftPressed, setLeftPressed] = useState<boolean>(false);
  const [rightPressed, setRightPressed] = useState<boolean>(false);

  // Reanimated values for trackpad touch feedback
  const isTouching = useSharedValue(false);
  const cursorX = useSharedValue(0);
  const cursorY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const dpiMultiplier = dpi / 1200;

  const emitMouseMove = (dx: number, dy: number) => {
    emit('touchpad', {
      type: 'move',
      dx: Math.round(dx * dpiMultiplier * 10) / 10,
      dy: Math.round(dy * dpiMultiplier * 10) / 10,
    });
  };

  const emitScroll = (dy: number) => {
    emit('touchpad', {
      type: 'scroll',
      dx: 0,
      dy: Math.round(dy * 10) / 10,
    });
  };

  const trackpadPan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      'worklet';
      isTouching.value = true;
      cursorX.value = event.x;
      cursorY.value = event.y;
      startX.value = event.x;
      startY.value = event.y;
    })
    .onUpdate((event) => {
      'worklet';
      const dx = event.translationX;
      const dy = event.translationY;
      cursorX.value = event.x;
      cursorY.value = event.y;

      runOnJS(emitMouseMove)(dx * 0.4, dy * 0.4);
    })
    .onFinalize(() => {
      'worklet';
      isTouching.value = false;
    });

  const scrollPan = Gesture.Pan()
    .minDistance(0)
    .onUpdate((event) => {
      'worklet';
      runOnJS(emitScroll)(event.translationY * 0.15);
      runOnJS(selection)();
    });

  const handleLeftClickPress = () => {
    mechanicalClick();
    setLeftPressed(true);
    emit('button', { id: 'A', pressed: true });
  };

  const handleLeftClickRelease = () => {
    if (!isDragLocked) {
      setLeftPressed(false);
      emit('button', { id: 'A', pressed: false });
    }
  };

  const handleRightClickPress = () => {
    mechanicalClick();
    setRightPressed(true);
    emit('button', { id: 'B', pressed: true });
  };

  const handleRightClickRelease = () => {
    setRightPressed(false);
    emit('button', { id: 'B', pressed: false });
  };

  const handleMiddleClick = () => {
    mechanicalClick();
    emit('button', { id: 'START', pressed: true });
    setTimeout(() => {
      emit('button', { id: 'START', pressed: false });
    }, 80);
  };

  const toggleDragLock = () => {
    light();
    setIsDragLocked((prev) => {
      const next = !prev;
      if (!next) {
        setLeftPressed(false);
        emit('button', { id: 'A', pressed: false });
      }
      return next;
    });
  };

  return (
    <View style={styles.container}>
      {/* Top Toolbar: DPI & Utility */}
      <View style={styles.topToolbar}>
        <View style={styles.dpiGroup}>
          <Text style={[styles.toolbarLabel, { fontSize: Math.max(9, 11 * scale) }]}>DPI:</Text>
          {[800, 1200, 1600, 2400].map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.dpiBtn, dpi === d && styles.dpiBtnActive]}
              onPress={() => {
                selection();
                setDpi(d);
              }}
            >
              <Text
                style={[
                  styles.dpiBtnText,
                  dpi === d && styles.dpiBtnTextActive,
                  { fontSize: Math.max(8, 10 * scale) },
                ]}
              >
                {d}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.toolBtn, isDragLocked && styles.toolBtnActive]}
          onPress={toggleDragLock}
        >
          <Ionicons
            name={isDragLocked ? 'lock-closed' : 'lock-open-outline'}
            size={Math.max(12, 14 * scale)}
            color={isDragLocked ? '#FFFFFF' : '#8A98AC'}
          />
          <Text
            style={[
              styles.toolBtnText,
              isDragLocked && styles.toolBtnTextActive,
              { fontSize: Math.max(9, 11 * scale) },
            ]}
          >
            {isDragLocked ? 'Drag Locked' : 'Drag Lock'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Trackpad Area */}
      <View style={styles.trackpadWrapper}>
        <GestureDetector gesture={trackpadPan}>
          <View style={styles.trackpadSurface}>
            <View style={styles.trackpadCrosshair}>
              <Ionicons name="scan-outline" size={32 * scale} color="rgba(47, 139, 255, 0.25)" />
              <Text style={[styles.trackpadHint, { fontSize: Math.max(9, 11 * scale) }]}>
                Trackpad Surface • Move Finger to Steer Cursor
              </Text>
            </View>
          </View>
        </GestureDetector>

        {/* Vertical Scroll Wheel Strip */}
        <GestureDetector gesture={scrollPan}>
          <View style={styles.scrollStrip}>
            <Ionicons name="chevron-up" size={14 * scale} color="#8A98AC" />
            <Ionicons name="swap-vertical" size={18 * scale} color={COLORS.accent} />
            <Text style={[styles.scrollText, { fontSize: Math.max(8, 9 * scale) }]}>SCROLL</Text>
            <Ionicons name="chevron-down" size={14 * scale} color="#8A98AC" />
          </View>
        </GestureDetector>
      </View>

      {/* Physical Mouse Buttons (Left, Middle, Right) */}
      <View style={styles.mouseButtonsRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPressIn={handleLeftClickPress}
          onPressOut={handleLeftClickRelease}
          style={[styles.mouseBtn, styles.leftClickBtn, leftPressed && styles.mouseBtnPressed]}
        >
          <Text style={[styles.mouseBtnText, { fontSize: Math.max(11, 13 * scale) }]}>
            LEFT CLICK
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handleMiddleClick}
          style={[styles.mouseBtn, styles.midClickBtn]}
        >
          <Ionicons name="radio-button-on" size={16 * scale} color="#8A98AC" />
          <Text style={[styles.mouseBtnSubText, { fontSize: Math.max(8, 9 * scale) }]}>MIDDLE</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPressIn={handleRightClickPress}
          onPressOut={handleRightClickRelease}
          style={[styles.mouseBtn, styles.rightClickBtn, rightPressed && styles.mouseBtnPressed]}
        >
          <Text style={[styles.mouseBtnText, { fontSize: Math.max(11, 13 * scale) }]}>
            RIGHT CLICK
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 54,
    justifyContent: 'space-between',
  },
  topToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(13, 17, 24, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dpiGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolbarLabel: {
    color: '#8A98AC',
    fontWeight: '700',
    marginRight: 4,
  },
  dpiBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  dpiBtnActive: {
    backgroundColor: COLORS.accent,
  },
  dpiBtnText: {
    color: '#8A98AC',
    fontWeight: '700',
  },
  dpiBtnTextActive: {
    color: '#FFFFFF',
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  toolBtnActive: {
    backgroundColor: '#E53935',
  },
  toolBtnText: {
    color: '#8A98AC',
    fontWeight: '700',
  },
  toolBtnTextActive: {
    color: '#FFFFFF',
  },
  trackpadWrapper: {
    flex: 1,
    flexDirection: 'row',
    marginVertical: 10,
    gap: 12,
  },
  trackpadSurface: {
    flex: 1,
    backgroundColor: 'rgba(9, 13, 20, 0.92)',
    borderWidth: 1.5,
    borderColor: 'rgba(47, 139, 255, 0.28)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackpadCrosshair: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  trackpadHint: {
    color: 'rgba(140, 165, 195, 0.65)',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  scrollStrip: {
    width: 52,
    backgroundColor: 'rgba(13, 17, 24, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(47, 139, 255, 0.25)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  scrollText: {
    color: '#8A98AC',
    fontWeight: '800',
    letterSpacing: 1,
  },
  mouseButtonsRow: {
    flexDirection: 'row',
    height: 54,
    gap: 10,
  },
  mouseBtn: {
    flex: 1,
    backgroundColor: '#121722',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftClickBtn: {
    flex: 1.5,
  },
  midClickBtn: {
    flex: 0.8,
    gap: 2,
  },
  rightClickBtn: {
    flex: 1.5,
  },
  mouseBtnPressed: {
    backgroundColor: COLORS.accent,
    borderColor: '#78B3FF',
  },
  mouseBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  mouseBtnSubText: {
    color: '#8A98AC',
    fontWeight: '700',
  },
});

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

export const TouchpadMode: React.FC = () => {
  const { scale } = useFrame();

  const [activeGesture, setActiveGesture] = useState<string>('Ready');

  // Shared values for touch ripples
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const isTouching = useSharedValue(false);
  const rippleScale = useSharedValue(0);
  const rippleOpacity = useSharedValue(0);

  const startTime = useSharedValue(0);
  const totalMovement = useSharedValue(0);

  const emitMove = (dx: number, dy: number) => {
    emit('touchpad', {
      type: 'move',
      dx: Math.round(dx * 10) / 10,
      dy: Math.round(dy * 10) / 10,
    });
  };

  const emitScroll = (dy: number) => {
    emit('touchpad', {
      type: 'scroll',
      dx: 0,
      dy: Math.round(dy * 10) / 10,
    });
  };

  const emitTap = () => {
    mechanicalClick();
    emit('touchpad', { type: 'tap', dx: 0, dy: 0 });
    setActiveGesture('Tap (Left Click)');
  };

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      'worklet';
      touchX.value = event.x;
      touchY.value = event.y;
      isTouching.value = true;
      startTime.value = Date.now();
      totalMovement.value = 0;

      rippleScale.value = 0.5;
      rippleOpacity.value = withTiming(0.8, { duration: 60 });
    })
    .onUpdate((event) => {
      'worklet';
      touchX.value = event.x;
      touchY.value = event.y;

      const dist = Math.hypot(event.translationX, event.translationY);
      totalMovement.value = dist;

      if (event.numberOfPointers === 2) {
        // Two-finger scroll
        runOnJS(setActiveGesture)('Two-Finger Scroll');
        runOnJS(emitScroll)(event.translationY * 0.2);
      } else {
        // One-finger move
        runOnJS(setActiveGesture)('Cursor Move');
        runOnJS(emitMove)(event.translationX * 0.35, event.translationY * 0.35);
      }
    })
    .onFinalize((event) => {
      'worklet';
      isTouching.value = false;
      rippleOpacity.value = withTiming(0, { duration: 150 });

      const duration = Date.now() - startTime.value;
      if (duration < 220 && totalMovement.value < 8) {
        runOnJS(emitTap)();
      }
    });

  const rippleAnimatedStyle = useAnimatedStyle(() => {
    return {
      left: touchX.value - 30,
      top: touchY.value - 30,
      opacity: rippleOpacity.value,
      transform: [{ scale: withSpring(isTouching.value ? 1.4 : 0.8) }],
    };
  });

  const handleShortcut = (name: string, buttonId: any) => {
    light();
    setActiveGesture(`Action: ${name}`);
    emit('button', { id: buttonId, pressed: true });
    setTimeout(() => {
      emit('button', { id: buttonId, pressed: false });
    }, 60);
  };

  return (
    <View style={styles.container}>
      {/* Top Header info */}
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          <Ionicons name="finger-print-outline" size={16 * scale} color={COLORS.accent} />
          <Text style={[styles.headerTitle, { fontSize: Math.max(10, 12 * scale) }]}>
            Precision Touchpad Mode
          </Text>
        </View>
        <Text style={[styles.gestureIndicator, { fontSize: Math.max(9, 11 * scale) }]}>
          {activeGesture}
        </Text>
      </View>

      {/* Main Touch Area */}
      <View style={styles.surfaceContainer}>
        <GestureDetector gesture={panGesture}>
          <View style={styles.surface}>
            {/* Visual Touch Ripple */}
            <Animated.View style={[styles.touchRipple, rippleAnimatedStyle]} />

            {/* Center Grid and Guide */}
            <View style={styles.centerGuide}>
              <Ionicons name="scan" size={36 * scale} color="rgba(47, 139, 255, 0.35)" />
              <Text style={[styles.guideText, { fontSize: Math.max(10, 12 * scale) }]}>
                Full-Screen High Precision Surface
              </Text>
              <Text style={[styles.subGuideText, { fontSize: Math.max(8, 10 * scale) }]}>
                1 Finger: Move Cursor • Tap: Click • 2 Fingers: Scroll
              </Text>
            </View>
          </View>
        </GestureDetector>
      </View>

      {/* Quick Actions & Navigation Bar */}
      <View style={styles.shortcutsBar}>
        <TouchableOpacity
          style={styles.shortcutBtn}
          onPress={() => handleShortcut('Desktop', 'HOME')}
        >
          <Ionicons name="desktop-outline" size={14 * scale} color="#8FC0FF" />
          <Text style={[styles.shortcutText, { fontSize: Math.max(8, 10 * scale) }]}>DESKTOP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.shortcutBtn}
          onPress={() => handleShortcut('Task View', 'BACK')}
        >
          <Ionicons name="copy-outline" size={14 * scale} color="#8FC0FF" />
          <Text style={[styles.shortcutText, { fontSize: Math.max(8, 10 * scale) }]}>TASKS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.shortcutBtn}
          onPress={() => handleShortcut('Left Click', 'A')}
        >
          <Ionicons name="hand-left-outline" size={14 * scale} color="#FFFFFF" />
          <Text style={[styles.shortcutText, { fontSize: Math.max(8, 10 * scale) }]}>L-CLICK</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.shortcutBtn}
          onPress={() => handleShortcut('Right Click', 'B')}
        >
          <Ionicons name="hand-right-outline" size={14 * scale} color="#FFFFFF" />
          <Text style={[styles.shortcutText, { fontSize: Math.max(8, 10 * scale) }]}>R-CLICK</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.shortcutBtn}
          onPress={() => handleShortcut('Menu', 'START')}
        >
          <Ionicons name="menu-outline" size={14 * scale} color="#8FC0FF" />
          <Text style={[styles.shortcutText, { fontSize: Math.max(8, 10 * scale) }]}>MENU</Text>
        </TouchableOpacity>
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
  headerBar: {
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  gestureIndicator: {
    color: COLORS.accent,
    fontWeight: '800',
  },
  surfaceContainer: {
    flex: 1,
    marginVertical: 4,
  },
  surface: {
    flex: 1,
    backgroundColor: 'rgba(9, 13, 20, 0.92)',
    borderWidth: 1.5,
    borderColor: 'rgba(47, 139, 255, 0.35)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  touchRipple: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(47, 139, 255, 0.25)',
    borderWidth: 1.5,
    borderColor: COLORS.accent,
  },
  centerGuide: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  guideText: {
    color: '#8FC0FF',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subGuideText: {
    color: '#8A98AC',
    fontWeight: '600',
  },
  shortcutsBar: {
    flexDirection: 'row',
    height: 48,
    gap: 8,
    marginTop: 6,
  },
  shortcutBtn: {
    flex: 1,
    backgroundColor: '#121722',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  shortcutText: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

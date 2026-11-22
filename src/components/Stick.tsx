import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  RadialGradient,
  vec,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useFrame } from './ControllerFrame';
import { emit, ButtonId } from '../input/inputBus';
import { light, mechanicalClick } from '../hooks/useHaptics';
import { COLORS } from '../theme/colors';

export interface StickSocket {
  cx: number;
  cy: number;
  r: number;
}

export interface StickProps {
  id: 'left' | 'right';
  socket: StickSocket;
}

export const Stick: React.FC<StickProps> = ({ id, socket }) => {
  const { toDevice, scale, breathe } = useFrame();

  const center = toDevice(socket.cx, socket.cy);
  const radius = socket.r * scale;

  // Canvas bounds including extra room for glow and outer blur
  const canvasPadding = radius * 0.45;
  const canvasSize = (radius + canvasPadding) * 2;
  const origin = canvasSize / 2;

  // Cap geometry
  const capRadius = radius * 0.72;
  const maxTravel = radius * 0.55;

  // Reanimated shared values
  const capX = useSharedValue(0);
  const capY = useSharedValue(0);
  const capScale = useSharedValue(1);
  const glowProgress = useSharedValue(0);

  // 3D Mechanical Stick-Click (L3/R3) Depression
  const clickDepression = useSharedValue(0);
  const isClickHeld = useSharedValue(false);

  // Gesture tracking
  const startTime = useSharedValue(0);
  const lastTapTime = useSharedValue(0);
  const maxMovement = useSharedValue(0);
  const lastEmitTime = useSharedValue(0);

  const clickButtonId: ButtonId = id === 'left' ? 'L3' : 'R3';

  // JS helper to emit stick coordinates
  const emitStick = (x: number, y: number) => {
    emit('stick', { id, x, y });
  };

  // JS helper to fire realistic mechanical stick click
  const triggerMechanicalClick = () => {
    mechanicalClick();
    emit('button', { id: clickButtonId, pressed: true });
    setTimeout(() => {
      emit('button', { id: clickButtonId, pressed: false });
    }, 90);
  };

  const handleStickClickPressIn = () => {
    clickDepression.value = withTiming(1, { duration: 40 });
    mechanicalClick();
    emit('button', { id: clickButtonId, pressed: true });
  };

  const handleStickClickPressOut = () => {
    clickDepression.value = withSpring(0, { damping: 10, stiffness: 220 });
    emit('button', { id: clickButtonId, pressed: false });
  };

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      'worklet';
      const now = Date.now();
      const timeSinceLastTap = now - lastTapTime.value;

      startTime.value = now;
      maxMovement.value = 0;
      lastEmitTime.value = 0;

      // Double-tap stick cap for instant mechanical stick click (L3/R3)
      if (timeSinceLastTap > 40 && timeSinceLastTap < 320) {
        clickDepression.value = withSequence(
          withTiming(1, { duration: 50 }),
          withSpring(0, { damping: 10, stiffness: 240 })
        );
        runOnJS(triggerMechanicalClick)();
        lastTapTime.value = 0;
      } else {
        lastTapTime.value = now;
      }

      // Animate while held
      capScale.value = withTiming(0.96, { duration: 70 });
      glowProgress.value = withTiming(1, { duration: 80 });

      // Light haptic on touch start
      runOnJS(light)();
    })
    .onUpdate((event) => {
      'worklet';
      const tx = event.translationX;
      const ty = event.translationY;

      const dist = Math.hypot(tx, ty);
      if (dist > maxMovement.value) {
        maxMovement.value = dist;
      }

      // Clamp cap position to max travel
      if (dist > maxTravel) {
        capX.value = (tx / dist) * maxTravel;
        capY.value = (ty / dist) * maxTravel;
      } else {
        capX.value = tx;
        capY.value = ty;
      }

      // Normalized coordinates (-1..1)
      const nx = capX.value / maxTravel;
      const ny = capY.value / maxTravel;
      const mag = Math.hypot(nx, ny);

      const deadzone = 0.1;
      let outX = 0;
      let outY = 0;
      if (mag > deadzone) {
        const rescaledMag = Math.min(1, (mag - deadzone) / (1 - deadzone));
        outX = (nx / mag) * rescaledMag;
        outY = (ny / mag) * rescaledMag;
      }

      outX = Math.max(-1, Math.min(1, outX));
      outY = Math.max(-1, Math.min(1, outY));

      const finalX = Math.round(outX * 1000) / 1000;
      const finalY = Math.round(-outY * 1000) / 1000;

      const now = Date.now();
      if (now - lastEmitTime.value >= 16) {
        lastEmitTime.value = now;
        runOnJS(emitStick)(finalX, finalY);
      }
    })
    .onFinalize(() => {
      'worklet';
      // Release animations: spring back to center
      capX.value = withSpring(0, { damping: 12, stiffness: 180, mass: 0.6 });
      capY.value = withSpring(0, { damping: 12, stiffness: 180, mass: 0.6 });
      capScale.value = withSpring(1, { damping: 12, stiffness: 180 });
      glowProgress.value = withSpring(0, { damping: 12, stiffness: 180 });

      // Always emit a final 0,0 on release
      runOnJS(emitStick)(0, 0);

      // Single quick tap (under 180ms and < 6px movement) triggers mechanical stick click
      const duration = Date.now() - startTime.value;
      if (duration < 180 && maxMovement.value < 6) {
        clickDepression.value = withSequence(
          withTiming(1, { duration: 45 }),
          withSpring(0, { damping: 10, stiffness: 220 })
        );
        runOnJS(triggerMechanicalClick)();
      }
    });

  // Skia animated derived values
  const ringGlowStrokeWidth = useDerivedValue(
    () => 2.5 + 2.5 * glowProgress.value + 2.0 * clickDepression.value
  );
  const ringGlowBlur = useDerivedValue(
    () => 5 + 6 * glowProgress.value + 4 * clickDepression.value
  );
  const ringGlowOpacity = useDerivedValue(() => {
    // Breathing opacity: 0.85 to 1.0 when idle, smoothly rises to 1.0 when touched, flashes on click
    return Math.min(1, breathe.value + (1 - breathe.value) * glowProgress.value + 0.3 * clickDepression.value);
  });
  const innerStrokeOpacity = useDerivedValue(
    () => (0.6 + 0.4 * glowProgress.value) * (0.9 + 0.1 * breathe.value)
  );

  // 3D Realistic Cap Transform: shrinks and sinks downwards into socket on mechanical click
  const capTransform = useDerivedValue(() => [
    { translateX: capX.value },
    { translateY: capY.value + clickDepression.value * (4 * scale) },
    { scale: capScale.value * (1 - 0.12 * clickDepression.value) },
  ]);

  // Center vector for gradients
  const gradientCenter = vec(origin - capRadius * 0.28, origin - capRadius * 0.28);
  const highlightCenter = vec(origin - capRadius * 0.35, origin - capRadius * 0.35);

  const btnWidth = Math.max(28, 38 * scale);
  const btnHeight = Math.max(16, 20 * scale);

  return (
    <View
      style={[
        styles.wrapper,
        {
          left: center.x - radius,
          top: center.y - radius,
          width: radius * 2,
          height: radius * 2,
          borderRadius: radius,
        },
      ]}
    >
      <GestureDetector gesture={panGesture}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas
            style={[
              styles.canvas,
              {
                left: -canvasPadding,
                top: -canvasPadding,
                width: canvasSize,
                height: canvasSize,
              },
            ]}
            pointerEvents="none"
          >
            {/* 1. Glowing blue ring around the socket with outer BlurMask */}
            <Circle
              cx={origin}
              cy={origin}
              r={radius}
              style="stroke"
              strokeWidth={ringGlowStrokeWidth}
              color={COLORS.accent}
              opacity={ringGlowOpacity}
            >
              <BlurMask blur={ringGlowBlur} style="outer" />
            </Circle>

            {/* 2. Thin bright inner stroke on the ring */}
            <Circle
              cx={origin}
              cy={origin}
              r={radius}
              style="stroke"
              strokeWidth={1}
              color="#A8D4FF"
              opacity={innerStrokeOpacity}
            />

            {/* 3. Deep socket well shadow */}
            <Circle cx={origin} cy={origin} r={radius - 1} color="#05080E" />

            {/* 4. Dark domed stick cap group (moves with finger and depresses on mechanical click) */}
            <Group origin={vec(origin, origin)} transform={capTransform}>
              {/* Domed cap body with radial gradient: lighter top-left to near-black bottom-right */}
              <Circle cx={origin} cy={origin} r={capRadius}>
                <RadialGradient
                  c={gradientCenter}
                  r={capRadius * 1.35}
                  colors={['#424E60', '#252B36', '#141820', '#07090C']}
                />
              </Circle>

              {/* Concentric grip ring */}
              <Circle
                cx={origin}
                cy={origin}
                r={capRadius * 0.62}
                style="stroke"
                strokeWidth={2}
                color="#0A0D12"
              />
              <Circle
                cx={origin}
                cy={origin}
                r={capRadius * 0.62 + 1}
                style="stroke"
                strokeWidth={0.8}
                color="rgba(110, 135, 170, 0.28)"
              />

              {/* Small specular highlight at top-left */}
              <Circle
                cx={origin - capRadius * 0.35}
                cy={origin - capRadius * 0.35}
                r={capRadius * 0.16}
              >
                <RadialGradient
                  c={highlightCenter}
                  r={capRadius * 0.16}
                  colors={['rgba(255, 255, 255, 0.42)', 'rgba(255, 255, 255, 0)']}
                />
              </Circle>

              {/* Center thumb depression cup */}
              <Circle cx={origin} cy={origin} r={capRadius * 0.32} color="#080A0E" />
              <Circle
                cx={origin}
                cy={origin}
                r={capRadius * 0.32}
                style="stroke"
                strokeWidth={0.8}
                color="rgba(255, 255, 255, 0.08)"
              />

              {/* Outer rim border on the cap */}
              <Circle
                cx={origin}
                cy={origin}
                r={capRadius}
                style="stroke"
                strokeWidth={1.2}
                color="rgba(70, 85, 110, 0.55)"
              />
            </Group>
          </Canvas>
        </View>
      </GestureDetector>

      {/* Dedicated Tactile L3/R3 Button at the lower edge of the stick well */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPressIn={handleStickClickPressIn}
        onPressOut={handleStickClickPressOut}
        style={[
          styles.clickBadge,
          {
            bottom: -btnHeight * 0.35,
            width: btnWidth,
            height: btnHeight,
            borderRadius: btnHeight / 2,
          },
        ]}
      >
        <Text style={[styles.clickBadgeText, { fontSize: Math.max(8, 9 * scale) }]}>
          {clickButtonId}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvas: {
    position: 'absolute',
  },
  clickBadge: {
    position: 'absolute',
    backgroundColor: '#0E131C',
    borderWidth: 1,
    borderColor: 'rgba(47, 139, 255, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  clickBadgeText: {
    color: '#9CC5FF',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

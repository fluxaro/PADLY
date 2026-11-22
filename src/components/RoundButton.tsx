import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Line,
  Path,
  RadialGradient,
  Rect,
  RoundedRect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';

import { useFrame } from './ControllerFrame';
import { emit, ButtonId } from '../input/inputBus';
import { light } from '../hooks/useHaptics';
import { usePressFeedback } from '../hooks/usePressFeedback';
import { COLORS } from '../theme/colors';

export type RoundButtonIcon = 'back' | 'start' | 'screens' | 'share' | 'home';

export interface RoundButtonSocket {
  cx: number;
  cy: number;
  r: number;
}

export interface RoundButtonProps {
  id: ButtonId;
  icon: RoundButtonIcon;
  socket: RoundButtonSocket;
  glowRing?: boolean;
}

/**
 * Draws the icon inside the round button in Skia.
 */
const ButtonGlyph: React.FC<{
  icon: RoundButtonIcon;
  origin: number;
  r: number;
  isHome: boolean;
}> = ({ icon, origin, r, isHome }) => {
  const iconSize = r * 0.48;
  const strokeColor = isHome ? '#FFFFFF' : '#B8C2D0';

  switch (icon) {
    case 'back': {
      // Windows/overlay icon: two overlapping rectangles
      const rw = iconSize * 0.9;
      const rh = iconSize * 0.65;
      const offset = iconSize * 0.22;
      return (
        <>
          {/* Back window */}
          <Rect
            x={origin - rw / 2 - offset}
            y={origin - rh / 2 - offset}
            width={rw}
            height={rh}
            style="stroke"
            strokeWidth={1.2}
            color={strokeColor}
          />
          {/* Front window */}
          <Rect
            x={origin - rw / 2 + offset}
            y={origin - rh / 2 + offset}
            width={rw}
            height={rh}
            style="stroke"
            strokeWidth={1.2}
            color={strokeColor}
          />
        </>
      );
    }

    case 'start': {
      // Menu icon: three horizontal lines
      const lineLen = iconSize * 1.05;
      const spacing = iconSize * 0.38;
      return (
        <>
          <Line
            p1={vec(origin - lineLen / 2, origin - spacing)}
            p2={vec(origin + lineLen / 2, origin - spacing)}
            style="stroke"
            strokeWidth={1.5}
            strokeCap="round"
            color={strokeColor}
          />
          <Line
            p1={vec(origin - lineLen / 2, origin)}
            p2={vec(origin + lineLen / 2, origin)}
            style="stroke"
            strokeWidth={1.5}
            strokeCap="round"
            color={strokeColor}
          />
          <Line
            p1={vec(origin - lineLen / 2, origin + spacing)}
            p2={vec(origin + lineLen / 2, origin + spacing)}
            style="stroke"
            strokeWidth={1.5}
            strokeCap="round"
            color={strokeColor}
          />
        </>
      );
    }

    case 'screens': {
      // Screens icon: two overlapping display frames
      const sw = iconSize * 0.85;
      const sh = iconSize * 0.85;
      const offset = iconSize * 0.22;
      return (
        <>
          <RoundedRect
            x={origin - sw / 2 - offset}
            y={origin - sh / 2 - offset}
            width={sw}
            height={sh}
            r={2}
            style="stroke"
            strokeWidth={1.2}
            color={strokeColor}
          />
          <RoundedRect
            x={origin - sw / 2 + offset}
            y={origin - sh / 2 + offset}
            width={sw}
            height={sh}
            r={2}
            style="stroke"
            strokeWidth={1.2}
            color={strokeColor}
          />
        </>
      );
    }

    case 'share': {
      // Share/export icon: open tray box with an upward-pointing arrow
      const bw = iconSize * 0.95;
      const bh = iconSize * 0.6;
      const arrowLen = iconSize * 0.8;
      return (
        <>
          {/* Open tray */}
          <Path
            path={`M ${origin - bw / 2} ${origin} L ${origin - bw / 2} ${origin + bh / 2} L ${
              origin + bw / 2
            } ${origin + bh / 2} L ${origin + bw / 2} ${origin}`}
            style="stroke"
            strokeWidth={1.3}
            strokeCap="round"
            color={strokeColor}
          />
          {/* Upward arrow stem */}
          <Line
            p1={vec(origin, origin + bh * 0.2)}
            p2={vec(origin, origin - arrowLen / 2)}
            style="stroke"
            strokeWidth={1.4}
            strokeCap="round"
            color={strokeColor}
          />
          {/* Arrow head */}
          <Path
            path={`M ${origin - iconSize * 0.25} ${origin - arrowLen / 2 + iconSize * 0.25} L ${origin} ${
              origin - arrowLen / 2
            } L ${origin + iconSize * 0.25} ${origin - arrowLen / 2 + iconSize * 0.25}`}
            style="stroke"
            strokeWidth={1.4}
            strokeCap="round"
            color={strokeColor}
          />
        </>
      );
    }

    case 'home': {
      // Neutral custom Home glyph: stylized circular power ring with an open top and vertical stem
      const pr = iconSize * 0.72;
      return (
        <>
          {/* Circular ring with opening at top */}
          <Path
            path={`M ${origin - pr * 0.5} ${origin - pr * 0.86} A ${pr} ${pr} 0 1 0 ${
              origin + pr * 0.5
            } ${origin - pr * 0.86}`}
            style="stroke"
            strokeWidth={2}
            strokeCap="round"
            color="#FFFFFF"
          />
          {/* Power vertical stem */}
          <Line
            p1={vec(origin, origin - pr * 0.95)}
            p2={vec(origin, origin - pr * 0.15)}
            style="stroke"
            strokeWidth={2.2}
            strokeCap="round"
            color="#FFFFFF"
          />
        </>
      );
    }
  }
};

export const RoundButton: React.FC<RoundButtonProps> = ({
  id,
  icon,
  socket,
  glowRing = false,
}) => {
  const { toDevice, scale, breathe } = useFrame();

  const isHome = id === 'HOME' || icon === 'home';
  const hasRing = glowRing || isHome;

  const center = toDevice(socket.cx, socket.cy);
  const radius = socket.r * scale;

  const padding = radius * 0.4;
  const canvasSize = (radius + padding) * 2;
  const origin = canvasSize / 2;

  // Press animation
  const pressed = useSharedValue(0);
  const hasReleased = useSharedValue(false);

  const animatedStyle = usePressFeedback(pressed);

  // JS event helpers
  const emitPress = () => {
    emit('button', { id, pressed: true });
  };

  const emitRelease = () => {
    emit('button', { id, pressed: false });
  };

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      'worklet';
      pressed.value = 1;
      hasReleased.value = false;
      runOnJS(emitPress)();
      runOnJS(light)();
    })
    .onUpdate((event) => {
      'worklet';
      // Release if finger slides off the circular button
      const dist = Math.hypot(event.x - radius, event.y - radius);
      if (dist > radius * 1.2 && !hasReleased.value) {
        pressed.value = 0;
        hasReleased.value = true;
        runOnJS(emitRelease)();
      }
    })
    .onFinalize(() => {
      'worklet';
      if (!hasReleased.value) {
        pressed.value = 0;
        hasReleased.value = true;
        runOnJS(emitRelease)();
      }
    });

  // Top highlight arc on the cap
  const highlightArc = useMemo(() => {
    const r = radius - 2.5;
    const startAngle = -150 * (Math.PI / 180);
    const endAngle = -30 * (Math.PI / 180);
    const x1 = origin + r * Math.cos(startAngle);
    const y1 = origin + r * Math.sin(startAngle);
    const x2 = origin + r * Math.cos(endAngle);
    const y2 = origin + r * Math.sin(endAngle);

    const d = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
    return Skia.Path.MakeFromSVGString(d);
  }, [origin, radius]);

  // Derived animation for Home glowing ring
  const homeRingGlowBlur = useDerivedValue(() => 4 + 7 * pressed.value);
  const homeRingOpacity = useDerivedValue(() => (0.45 + 0.55 * pressed.value) * breathe.value);
  const homeRingStrokeWidth = useDerivedValue(() => 2 + 1.8 * pressed.value);

  // Gradient center offset for 3D depth
  const gradientCenter = vec(origin - (radius - 1.5) * 0.25, origin - (radius - 1.5) * 0.25);

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
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
          <Canvas
            style={[
              styles.canvas,
              {
                left: -padding,
                top: -padding,
                width: canvasSize,
                height: canvasSize,
              },
            ]}
            pointerEvents="none"
          >
            {/* Blue glowing ring for HOME button (BlurMask) */}
            {hasRing && (
              <>
                <Circle
                  cx={origin}
                  cy={origin}
                  r={radius}
                  style="stroke"
                  strokeWidth={homeRingStrokeWidth}
                  color={COLORS.accent}
                  opacity={homeRingOpacity}
                >
                  <BlurMask blur={homeRingGlowBlur} style="outer" />
                </Circle>
                <Circle
                  cx={origin}
                  cy={origin}
                  r={radius}
                  style="stroke"
                  strokeWidth={1.2}
                  color="#A6D4FF"
                  opacity={homeRingOpacity}
                />
              </>
            )}

            {/* Dark glossy circular cap: radial gradient from #1B1F27 to #07090D */}
            <Circle cx={origin} cy={origin} r={radius - 1.5}>
              <RadialGradient
                c={gradientCenter}
                r={(radius - 1.5) * 1.3}
                colors={['#1B1F27', '#11151C', '#07090D']}
              />
            </Circle>

            {/* Thin darker bezel ring */}
            <Circle
              cx={origin}
              cy={origin}
              r={radius - 0.5}
              style="stroke"
              strokeWidth={1}
              color="#07090C"
            />

            {/* Inner rim highlight */}
            <Circle
              cx={origin}
              cy={origin}
              r={radius - 2}
              style="stroke"
              strokeWidth={0.8}
              color="rgba(255, 255, 255, 0.08)"
            />

            {/* Faint top highlight arc */}
            {highlightArc && (
              <Path
                path={highlightArc}
                style="stroke"
                strokeWidth={1}
                color="rgba(255, 255, 255, 0.2)"
                strokeCap="round"
              />
            )}

            {/* Centered vector icon */}
            <ButtonGlyph
              icon={icon}
              origin={origin}
              r={radius}
              isHome={isHome}
            />
          </Canvas>
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

export const HomeButton: React.FC<{ socket: RoundButtonSocket }> = ({ socket }) => (
  <RoundButton id="HOME" icon="home" socket={socket} glowRing={true} />
);

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvas: {
    position: 'absolute',
  },
});

export default RoundButton;

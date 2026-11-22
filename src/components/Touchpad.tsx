import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Line,
  LinearGradient,
  matchFont,
  Points,
  RadialGradient,
  RoundedRect,
  Text as SkiaText,
  vec,
  type SkPoint,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useFrame } from './ControllerFrame';
import { emit } from '../input/inputBus';
import { light } from '../hooks/useHaptics';
import { COLORS } from '../theme/colors';

export interface TouchpadSocket {
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: number;
}

export interface TouchpadProps {
  socket: TouchpadSocket;
}

export const Touchpad: React.FC<TouchpadProps> = ({ socket }) => {
  const { toDevice, scale, breathe } = useFrame();

  const pos = toDevice(socket.x, socket.y);
  const width = socket.w * scale;
  const height = socket.h * scale;
  const radius = (socket.radius ?? 18) * scale;

  const padding = 14 * scale;
  const canvasW = width + padding * 2;
  const canvasH = height + padding * 2;
  const centerX = padding + width / 2;
  const centerY = padding + height / 2;

  // Touch and ripple shared values
  const isTouched = useSharedValue(0);
  const fingerX = useSharedValue(centerX);
  const fingerY = useSharedValue(centerY);
  const rippleRadius = useSharedValue(28 * scale);
  const rippleOpacity = useSharedValue(0);

  // Gesture tracking
  const startTime = useSharedValue(0);
  const lastX = useSharedValue(0);
  const lastY = useSharedValue(0);
  const totalMovement = useSharedValue(0);

  // JS emission helpers
  const emitMove = (dx: number, dy: number) => {
    emit('touchpad', {
      type: 'move',
      dx: Math.round(dx * 10) / 10,
      dy: Math.round(dy * 10) / 10,
    });
  };

  const emitScroll = (dx: number, dy: number) => {
    emit('touchpad', {
      type: 'scroll',
      dx: Math.round(dx * 10) / 10,
      dy: Math.round(dy * 10) / 10,
    });
  };

  const emitTap = () => {
    emit('touchpad', { type: 'tap', dx: 0, dy: 0 });
  };

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      'worklet';
      isTouched.value = withTiming(1, { duration: 80 });
      startTime.value = Date.now();
      lastX.value = event.x;
      lastY.value = event.y;
      totalMovement.value = 0;

      fingerX.value = event.x + padding;
      fingerY.value = event.y + padding;
      rippleRadius.value = 28 * scale;
      rippleOpacity.value = withTiming(1, { duration: 60 });
    })
    .onUpdate((event) => {
      'worklet';
      fingerX.value = event.x + padding;
      fingerY.value = event.y + padding;

      const dx = event.x - lastX.value;
      const dy = event.y - lastY.value;
      lastX.value = event.x;
      lastY.value = event.y;

      totalMovement.value += Math.hypot(dx, dy);
      const pointers = event.numberOfPointers;

      if (Math.hypot(dx, dy) > 0.2) {
        if (pointers >= 2) {
          // Two-finger drag -> scroll
          runOnJS(emitScroll)(dx, dy);
        } else {
          // One-finger drag -> move
          runOnJS(emitMove)(dx, dy);
        }
      }
    })
    .onFinalize(() => {
      'worklet';
      isTouched.value = withSpring(0, { damping: 14 });
      const duration = Date.now() - startTime.value;

      if (duration < 200 && totalMovement.value < 8) {
        // Quick tap: under 200ms and under 8px movement
        runOnJS(emitTap)();
        runOnJS(light)();

        // Expanding tap ripple animation
        rippleRadius.value = withTiming(52 * scale, { duration: 320 });
        rippleOpacity.value = withTiming(0, { duration: 320 });
      } else {
        rippleOpacity.value = withTiming(0, { duration: 150 });
      }
    });

  // Precompute dotted grid texture points
  const gridPoints = useMemo<SkPoint[]>(() => {
    const pts: SkPoint[] = [];
    const step = 16 * scale;
    const insetX = padding + 22 * scale;
    const insetY = padding + 20 * scale;
    const endX = padding + width - 22 * scale;
    const endY = padding + height - 20 * scale;

    for (let x = insetX; x <= endX; x += step) {
      for (let y = insetY; y <= endY; y += step) {
        pts.push(vec(x, y));
      }
    }
    return pts;
  }, [padding, width, height, scale]);

  // Typography for Touchpad text
  const fontTitle = useMemo(() => {
    return matchFont({
      fontFamily: Platform.select({
        ios: 'System',
        android: 'sans-serif',
        default: 'sans-serif',
      }),
      fontSize: Math.max(9, 11 * scale),
      fontWeight: 'bold',
    });
  }, [scale]);

  const fontSubtitle = useMemo(() => {
    return matchFont({
      fontFamily: Platform.select({
        ios: 'System',
        android: 'sans-serif',
        default: 'sans-serif',
      }),
      fontSize: Math.max(7, 8.5 * scale),
      fontWeight: 'normal',
    });
  }, [scale]);

  const titleText = 'Touchpad';
  const subtitleText = 'Swipe • Scroll • Click';

  const titlePos = useMemo(() => {
    if (!fontTitle) return { x: centerX, y: centerY + 6 * scale };
    const b = fontTitle.measureText(titleText);
    return {
      x: centerX - b.width / 2 - b.x,
      y: centerY + 4 * scale,
    };
  }, [fontTitle, centerX, centerY, scale]);

  const subPos = useMemo(() => {
    if (!fontSubtitle) return { x: centerX, y: centerY + 18 * scale };
    const b = fontSubtitle.measureText(subtitleText);
    return {
      x: centerX - b.width / 2 - b.x,
      y: centerY + 18 * scale,
    };
  }, [fontSubtitle, centerX, centerY, scale]);

  // Animated border glow derived values
  const borderGlowBlur = useDerivedValue(() => 3 + 6 * isTouched.value);
  const borderGlowOpacity = useDerivedValue(() => (0.3 + 0.65 * isTouched.value) * breathe.value);
  const borderGlowWidth = useDerivedValue(() => 1.2 + 1.6 * isTouched.value);

  // Ripple vector
  const rippleCenter = useDerivedValue(() => vec(fingerX.value, fingerY.value));

  // Crosshair icon geometry
  const crosshairY = centerY - 14 * scale;
  const chR = 7 * scale;

  return (
    <View
      style={[
        styles.wrapper,
        {
          left: pos.x,
          top: pos.y,
          width,
          height,
        },
      ]}
    >
      <GestureDetector gesture={panGesture}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas
            style={[
              styles.canvas,
              {
                left: -padding,
                top: -padding,
                width: canvasW,
                height: canvasH,
              },
            ]}
            pointerEvents="none"
          >
            {/* 1. Main dark gradient panel */}
            <RoundedRect
              x={padding}
              y={padding}
              width={width}
              height={height}
              r={radius}
            >
              <LinearGradient
                start={vec(padding, padding)}
                end={vec(padding, padding + height)}
                colors={['#171C24', '#0E1117', '#07090C']}
              />
            </RoundedRect>

            {/* 2. Dotted grid texture */}
            {gridPoints.length > 0 && (
              <Points
                points={gridPoints}
                mode="points"
                style="stroke"
                strokeWidth={1.5}
                color="rgba(255, 255, 255, 0.08)"
                strokeCap="round"
              />
            )}

            {/* 3. Glowing blue border (brightens on touch) */}
            <RoundedRect
              x={padding}
              y={padding}
              width={width}
              height={height}
              r={radius}
              style="stroke"
              strokeWidth={borderGlowWidth}
              color={COLORS.accent}
              opacity={borderGlowOpacity}
            >
              <BlurMask blur={borderGlowBlur} style="normal" />
            </RoundedRect>

            {/* Crisp inner border line */}
            <RoundedRect
              x={padding}
              y={padding}
              width={width}
              height={height}
              r={radius}
              style="stroke"
              strokeWidth={1}
              color="#78B3FF"
              opacity={borderGlowOpacity}
            />

            {/* 4. Centered crosshair icon */}
            <Circle
              cx={centerX}
              cy={crosshairY}
              r={chR}
              style="stroke"
              strokeWidth={1}
              color="rgba(120, 145, 175, 0.45)"
            />
            <Circle cx={centerX} cy={crosshairY} r={1.5} color={COLORS.accent} />
            <Line
              p1={vec(centerX - chR * 1.5, crosshairY)}
              p2={vec(centerX - chR * 0.4, crosshairY)}
              style="stroke"
              strokeWidth={1}
              color="rgba(120, 145, 175, 0.45)"
            />
            <Line
              p1={vec(centerX + chR * 0.4, crosshairY)}
              p2={vec(centerX + chR * 1.5, crosshairY)}
              style="stroke"
              strokeWidth={1}
              color="rgba(120, 145, 175, 0.45)"
            />
            <Line
              p1={vec(centerX, crosshairY - chR * 1.5)}
              p2={vec(centerX, crosshairY - chR * 0.4)}
              style="stroke"
              strokeWidth={1}
              color="rgba(120, 145, 175, 0.45)"
            />
            <Line
              p1={vec(centerX, crosshairY + chR * 0.4)}
              p2={vec(centerX, crosshairY + chR * 1.5)}
              style="stroke"
              strokeWidth={1}
              color="rgba(120, 145, 175, 0.45)"
            />

            {/* 5. Center typography */}
            {fontTitle && (
              <SkiaText
                x={titlePos.x}
                y={titlePos.y}
                text={titleText}
                font={fontTitle}
                color="#A6B4C8"
              />
            )}
            {fontSubtitle && (
              <SkiaText
                x={subPos.x}
                y={subPos.y}
                text={subtitleText}
                font={fontSubtitle}
                color="#5C6B80"
              />
            )}

            {/* 6. Ripple glow under the finger */}
            <Circle c={rippleCenter} r={rippleRadius} opacity={rippleOpacity}>
              <RadialGradient
                c={rippleCenter}
                r={rippleRadius}
                colors={['rgba(47, 139, 255, 0.55)', 'rgba(47, 139, 255, 0)']}
              />
            </Circle>
          </Canvas>
        </View>
      </GestureDetector>
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
});

export default Touchpad;

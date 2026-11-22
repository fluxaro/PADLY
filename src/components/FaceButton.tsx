import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Line,
  matchFont,
  Path,
  RadialGradient,
  RoundedRect,
  Skia,
  Text as SkiaText,
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

export interface FaceButtonSocket {
  cx: number;
  cy: number;
  r: number;
}

export interface FaceButtonProps {
  id: ButtonId;
  label: string;
  color: string;
  socket: FaceButtonSocket;
  symbolOverride?: string;
}

export const FaceButton: React.FC<FaceButtonProps> = ({
  id,
  label,
  color,
  socket,
  symbolOverride,
}) => {
  const { toDevice, scale, breathe } = useFrame();
  const effectiveLabel = symbolOverride || label;

  const center = toDevice(socket.cx, socket.cy);
  const radius = socket.r * scale;

  // Extra padding for outer glow / blur filters
  const padding = radius * 0.4;
  const canvasSize = (radius + padding) * 2;
  const origin = canvasSize / 2;

  // Press animation value (0..1)
  const pressed = useSharedValue(0);
  const hasReleased = useSharedValue(false);

  const animatedStyle = usePressFeedback(pressed);

  // JS event emission helpers
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

  // Skia font for letter labels (Y, X, B, A)
  const font = useMemo(() => {
    return matchFont({
      fontFamily: Platform.select({
        ios: 'System',
        android: 'sans-serif',
        default: 'sans-serif',
      }),
      fontSize: radius * 0.9,
      fontWeight: 'bold',
    });
  }, [radius]);

  // Center letters
  const { textX, textY } = useMemo(() => {
    if (!font) return { textX: origin, textY: origin };
    const bounds = font.measureText(effectiveLabel);
    return {
      textX: origin - bounds.width / 2 - bounds.x,
      textY: origin - bounds.height / 2 - bounds.y,
    };
  }, [font, effectiveLabel, origin]);

  // Faint top highlight arc on the cap
  const highlightArc = useMemo(() => {
    const r = radius - 3;
    const startAngle = -150 * (Math.PI / 180);
    const endAngle = -30 * (Math.PI / 180);
    const x1 = origin + r * Math.cos(startAngle);
    const y1 = origin + r * Math.sin(startAngle);
    const x2 = origin + r * Math.cos(endAngle);
    const y2 = origin + r * Math.sin(endAngle);

    const d = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
    return Skia.Path.MakeFromSVGString(d);
  }, [origin, radius]);

  // Triangle path for PlayStation Triangle
  const trianglePath = useMemo(() => {
    const s = radius * 0.44;
    return Skia.Path.MakeFromSVGString(
      `M ${origin} ${origin - s} L ${origin + s * 0.92} ${origin + s * 0.62} L ${origin - s * 0.92} ${origin + s * 0.62} Z`
    );
  }, [origin, radius]);

  // Derived animation values for glow & ring
  const letterGlowBlur = useDerivedValue(() => 3 + 4 * pressed.value);
  const letterGlowOpacity = useDerivedValue(() => (0.45 + 0.45 * pressed.value) * breathe.value);
  const ringStrokeOpacity = useDerivedValue(() => (0.15 + 0.7 * pressed.value) * breathe.value);
  const ringGlowBlur = useDerivedValue(() => 3 + 5 * pressed.value);

  const gradientCenter = vec(origin - (radius - 2) * 0.25, origin - (radius - 2) * 0.25);

  const symSize = radius * 0.42;

  // Check if we should render geometric PlayStation shapes
  const isPlayStationSymbol =
    effectiveLabel === '△' ||
    effectiveLabel === '□' ||
    effectiveLabel === '○' ||
    effectiveLabel === '✕';

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
            {/* 1. Outer Bezel Ring */}
            <Circle
              cx={origin}
              cy={origin}
              r={radius}
              style="stroke"
              strokeWidth={1.5}
              color="#07090C"
            />

            {/* 2. Glowing Ring around button cap */}
            <Circle
              cx={origin}
              cy={origin}
              r={radius - 0.5}
              style="stroke"
              strokeWidth={1.5}
              color={color}
              opacity={ringStrokeOpacity}
            >
              <BlurMask blur={ringGlowBlur} style="outer" />
            </Circle>

            {/* 3. Dark Glossy Dome Cap */}
            <Circle cx={origin} cy={origin} r={radius - 1.5}>
              <RadialGradient
                c={gradientCenter}
                r={(radius - 1.5) * 1.3}
                colors={['#1E242E', '#11151C', '#07090D']}
              />
            </Circle>

            {/* 4. Subtle Inner Bevel Rim */}
            <Circle
              cx={origin}
              cy={origin}
              r={radius - 2}
              style="stroke"
              strokeWidth={0.8}
              color="rgba(255, 255, 255, 0.08)"
            />

            {/* 5. Top Highlight Arc */}
            {highlightArc && (
              <Path
                path={highlightArc}
                style="stroke"
                strokeWidth={1.2}
                color="rgba(255, 255, 255, 0.22)"
                strokeCap="round"
              />
            )}

            {/* 6. Button Center Content: Geometric Vector Shapes or Letters */}
            {isPlayStationSymbol ? (
              <Group>
                {effectiveLabel === '△' && trianglePath && (
                  <Path
                    path={trianglePath}
                    style="stroke"
                    strokeWidth={2.4}
                    strokeCap="round"
                    strokeJoin="round"
                    color={color}
                  />
                )}
                {effectiveLabel === '□' && (
                  <RoundedRect
                    x={origin - symSize}
                    y={origin - symSize}
                    width={symSize * 2}
                    height={symSize * 2}
                    r={3}
                    style="stroke"
                    strokeWidth={2.4}
                    color={color}
                  />
                )}
                {effectiveLabel === '○' && (
                  <Circle
                    cx={origin}
                    cy={origin}
                    r={symSize}
                    style="stroke"
                    strokeWidth={2.4}
                    color={color}
                  />
                )}
                {effectiveLabel === '✕' && (
                  <>
                    <Line
                      p1={vec(origin - symSize, origin - symSize)}
                      p2={vec(origin + symSize, origin + symSize)}
                      style="stroke"
                      strokeWidth={2.6}
                      strokeCap="round"
                      color={color}
                    />
                    <Line
                      p1={vec(origin + symSize, origin - symSize)}
                      p2={vec(origin - symSize, origin + symSize)}
                      style="stroke"
                      strokeWidth={2.6}
                      strokeCap="round"
                      color={color}
                    />
                  </>
                )}
              </Group>
            ) : (
              font && (
                <>
                  <SkiaText
                    x={textX}
                    y={textY}
                    text={effectiveLabel}
                    font={font}
                    color={color}
                    opacity={letterGlowOpacity}
                  >
                    <BlurMask blur={letterGlowBlur} style="normal" />
                  </SkiaText>
                  <SkiaText
                    x={textX}
                    y={textY}
                    text={effectiveLabel}
                    font={font}
                    color={color}
                  />
                </>
              )
            )}
          </Canvas>
        </Animated.View>
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

export default FaceButton;

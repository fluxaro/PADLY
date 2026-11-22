import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Group,
  LinearGradient,
  matchFont,
  Path,
  Skia,
  Text as SkiaText,
  vec,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useFrame } from './ControllerFrame';
import { emit, ButtonId } from '../input/inputBus';
import { light, mechanicalClick } from '../hooks/useHaptics';
import { usePressFeedback } from '../hooks/usePressFeedback';
import { COLORS } from '../theme/colors';
import { exactShoulderPaths } from '../theme/shoulderData';

export type BumperId = 'LT' | 'LB' | 'RT' | 'RB';

export interface BumperSocket {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BumperProps {
  id: BumperId;
  socket: BumperSocket;
  labelOverride?: string;
}

export const Bumper: React.FC<BumperProps> = ({ id, socket, labelOverride }) => {
  const { toDevice, scale, breathe } = useFrame();

  const isTrigger = id === 'LT' || id === 'RT';

  // Display label: default to PlayStation L2/L1/R2/R1
  const displayLabel = useMemo(() => {
    if (labelOverride) return labelOverride;
    switch (id) {
      case 'LT':
        return 'L2';
      case 'LB':
        return 'L1';
      case 'RT':
        return 'R2';
      case 'RB':
        return 'R1';
    }
  }, [id, labelOverride]);

  const subLabel = id; // Secondary label (LT, LB, RT, RB)

  const pos = toDevice(socket.x, socket.y);
  const width = socket.w * scale;
  const height = socket.h * scale;

  // Extra padding for glow effect
  const padding = 4 * scale;
  const canvasW = width + padding * 2;
  const canvasH = height + padding * 2;

  // Shared Values
  const pressed = useSharedValue(0);
  const triggerVal = useSharedValue(0);
  const startY = useSharedValue(0);
  const lastEmitTime = useSharedValue(0);

  const pressStyle = usePressFeedback(pressed);

  // JS event emitters
  const emitTrigger = (val: number) => {
    emit('trigger', { id: id as 'LT' | 'RT', value: val });
  };

  const emitBumper = (p: boolean) => {
    emit('button', { id: id as ButtonId, pressed: p });
  };

  // Drag height for analog triggers
  const maxDragDistance = 40 * scale;

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      'worklet';
      pressed.value = 1;
      startY.value = event.y;

      if (isTrigger) {
        triggerVal.value = 1;
        runOnJS(mechanicalClick)();
        runOnJS(emitTrigger)(1);
      } else {
        runOnJS(light)();
        runOnJS(emitBumper)(true);
      }
    })
    .onUpdate((event) => {
      'worklet';
      if (isTrigger) {
        const dy = event.y - startY.value;
        const mapped = Math.max(0.15, Math.min(1, 0.5 + dy / maxDragDistance));
        triggerVal.value = mapped;

        const now = Date.now();
        if (now - lastEmitTime.value >= 16) {
          lastEmitTime.value = now;
          const rounded = Math.round(mapped * 100) / 100;
          runOnJS(emitTrigger)(rounded);
        }
      }
    })
    .onFinalize(() => {
      'worklet';
      pressed.value = 0;

      if (isTrigger) {
        triggerVal.value = withSpring(0, { damping: 14, stiffness: 200 });
        runOnJS(emitTrigger)(0);
      } else {
        runOnJS(emitBumper)(false);
      }
    });

  // Select exact cavity SVG path from the chassis scan
  const rawSvgPath = useMemo(() => {
    switch (id) {
      case 'LT':
        return exactShoulderPaths.L2;
      case 'LB':
        return exactShoulderPaths.L1;
      case 'RT':
        return exactShoulderPaths.R2;
      case 'RB':
        return exactShoulderPaths.R1;
    }
  }, [id]);

  // Exact cavity SVG path from the chassis scan
  const shoulderPath = useMemo(() => {
    if (!rawSvgPath) return null;
    return Skia.Path.MakeFromSVGString(rawSvgPath);
  }, [rawSvgPath]);

  // Label Fonts in design-space (scaled via canvas Group transform)
  const fontMain = useMemo(() => {
    return matchFont({
      fontFamily: Platform.select({
        ios: 'System',
        android: 'sans-serif',
        default: 'sans-serif',
      }),
      fontSize: Math.max(11, socket.h * 0.4),
      fontWeight: 'bold',
    });
  }, [socket.h]);

  const fontSub = useMemo(() => {
    return matchFont({
      fontFamily: Platform.select({
        ios: 'System',
        android: 'sans-serif',
        default: 'sans-serif',
      }),
      fontSize: Math.max(7, socket.h * 0.22),
      fontWeight: 'normal',
    });
  }, [socket.h]);

  const { textX, textY, subX, subY } = useMemo(() => {
    const cx = socket.w * 0.52;
    const cy = socket.h * 0.45;
    let mainX = cx;
    let mainY = cy;
    let sx = cx;
    let sy = cy;

    if (fontMain) {
      const b = fontMain.measureText(displayLabel);
      mainX = cx - b.width / 2 - b.x;
      mainY = cy - b.height / 2 - b.y - (fontSub ? 3 : 0);
    }

    if (fontSub) {
      const b2 = fontSub.measureText(subLabel);
      sx = cx - b2.width / 2 - b2.x;
      sy = mainY + 9;
    }

    return { textX: mainX, textY: mainY, subX: sx, subY: sy };
  }, [fontMain, fontSub, displayLabel, subLabel, socket.w, socket.h]);

  // Animated glow derived values
  const edgeGlowOpacity = useDerivedValue(() => {
    if (isTrigger) {
      return (0.35 + 0.65 * triggerVal.value) * breathe.value;
    }
    return (0.3 + 0.7 * pressed.value) * breathe.value;
  });

  const edgeGlowBlur = useDerivedValue(() => {
    if (isTrigger) {
      return 3 + 6 * triggerVal.value;
    }
    return 3 + 5 * pressed.value;
  });

  const edgeStrokeWidth = useDerivedValue(() => {
    if (isTrigger) {
      return 1.4 + 2.0 * triggerVal.value;
    }
    return 1.4 + 1.2 * pressed.value;
  });

  const triggerFillOpacity = useDerivedValue(() => {
    if (!isTrigger) return 0;
    return triggerVal.value * 0.45;
  });

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
        <Animated.View style={[StyleSheet.absoluteFill, !isTrigger && pressStyle]}>
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
            {shoulderPath && (
              <Group transform={[{ translateX: padding }, { translateY: padding }, { scale }]}>
                {/* 1. Deep Socket Cavity Shadow */}
                <Path path={shoulderPath} color="#05070A" />

                {/* 2. Outer Glow around the button contour */}
                <Path
                  path={shoulderPath}
                  style="stroke"
                  strokeWidth={edgeStrokeWidth}
                  color={COLORS.accent}
                  opacity={edgeGlowOpacity}
                >
                  <BlurMask blur={edgeGlowBlur} style="outer" />
                </Path>

                {/* 3. Main Bumper Body with Metallic Gunmetal Gradient */}
                <Path path={shoulderPath}>
                  <LinearGradient
                    start={vec(0, 0)}
                    end={vec(socket.w, socket.h)}
                    colors={['#2D3543', '#1A202A', '#0D1016', '#05070B']}
                  />
                </Path>

                {/* 4. Dynamic Analog Trigger Fill Gauge */}
                {isTrigger && (
                  <Path path={shoulderPath} opacity={triggerFillOpacity}>
                    <LinearGradient
                      start={vec(0, 0)}
                      end={vec(0, socket.h)}
                      colors={['#2F8BFF', '#1A5BBB', 'rgba(47, 139, 255, 0.1)']}
                    />
                  </Path>
                )}

                {/* 5. Fine beveled inner rim stroke */}
                <Path
                  path={shoulderPath}
                  style="stroke"
                  strokeWidth={1}
                  color="rgba(255, 255, 255, 0.16)"
                />

                {/* 6. Primary Label (L2, L1, R2, R1) */}
                {fontMain && (
                  <SkiaText
                    x={textX}
                    y={textY}
                    text={displayLabel}
                    font={fontMain}
                    color="#FFFFFF"
                  />
                )}

                {/* 7. Secondary Sub-Label (LT, LB, RT, RB) */}
                {fontSub && (
                  <SkiaText
                    x={subX}
                    y={subY}
                    text={subLabel}
                    font={fontSub}
                    color="rgba(160, 185, 220, 0.65)"
                  />
                )}
              </Group>
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
  },
  canvas: {
    position: 'absolute',
  },
});

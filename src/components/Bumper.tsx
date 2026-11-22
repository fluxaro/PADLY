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
  withTiming,
} from 'react-native-reanimated';

import { useFrame } from './ControllerFrame';
import { emit, ButtonId } from '../input/inputBus';
import { light, mechanicalClick } from '../hooks/useHaptics';
import { usePressFeedback } from '../hooks/usePressFeedback';
import { COLORS } from '../theme/colors';

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

/**
 * Creates custom sculpted SVG paths matching the chassis shoulders.
 * Triggers (L2/R2) have a swept shoulder arch.
 * Bumpers (L1/R1) have an ergonomic curved pill contour.
 */
function createShoulderSvg(w: number, h: number, isRight: boolean, isTrigger: boolean): string {
  const rCorner = Math.max(6, h * 0.3);

  if (isTrigger) {
    // Ergonomic top trigger with swept shoulder taper
    if (!isRight) {
      // Left Trigger (L2) - sweeps downward to the outer left
      return `
        M ${rCorner * 1.5} 0
        L ${w - 4} 2
        A 6 6 0 0 1 ${w} 8
        L ${w} ${h - 5}
        A 6 6 0 0 1 ${w - 5} ${h}
        L ${rCorner} ${h}
        A ${rCorner} ${rCorner} 0 0 1 0 ${h - rCorner}
        L 2 ${rCorner * 1.6}
        A ${rCorner} ${rCorner} 0 0 1 ${rCorner * 1.5} 0
        Z
      `.replace(/\s+/g, ' ').trim();
    } else {
      // Right Trigger (R2) - sweeps downward to the outer right
      return `
        M 4 2
        L ${w - rCorner * 1.5} 0
        A ${rCorner} ${rCorner} 0 0 1 ${w - 2} ${rCorner * 1.6}
        L ${w} ${h - rCorner}
        A ${rCorner} ${rCorner} 0 0 1 ${w - rCorner} ${h}
        L 5 ${h}
        A 6 6 0 0 1 0 ${h - 5}
        L 0 8
        A 6 6 0 0 1 4 2
        Z
      `.replace(/\s+/g, ' ').trim();
    }
  } else {
    // Shoulder Bumper (L1 / R1) - ergonomic contoured capsule
    if (!isRight) {
      // Left Bumper (L1)
      return `
        M ${rCorner * 1.8} 0
        L ${w - 5} 0
        A 5 5 0 0 1 ${w} 5
        L ${w} ${h - 5}
        A 5 5 0 0 1 ${w - 5} ${h}
        L ${rCorner * 1.4} ${h}
        A ${rCorner} ${rCorner} 0 0 1 0 ${h - rCorner}
        L 0 ${rCorner * 1.2}
        A ${rCorner} ${rCorner} 0 0 1 ${rCorner * 1.8} 0
        Z
      `.replace(/\s+/g, ' ').trim();
    } else {
      // Right Bumper (R1)
      return `
        M 5 0
        L ${w - rCorner * 1.8} 0
        A ${rCorner} ${rCorner} 0 0 1 ${w} ${rCorner * 1.2}
        L ${w} ${h - rCorner}
        A ${rCorner} ${rCorner} 0 0 1 ${w - rCorner * 1.4} ${h}
        L 5 ${h}
        A 5 5 0 0 1 0 ${h - 5}
        L 0 5
        A 5 5 0 0 1 5 0
        Z
      `.replace(/\s+/g, ' ').trim();
    }
  }
}

/**
 * Creates outer accent glow stroke path along the bumper contour.
 */
function createOuterGlowStroke(w: number, h: number, isRight: boolean, isTrigger: boolean): string {
  const r = Math.max(6, h * 0.3);
  if (!isRight) {
    return `
      M ${r * 1.5} 1
      A ${r} ${r} 0 0 0 1 ${r * 1.6}
      L 1 ${h - r}
      A ${r} ${r} 0 0 0 ${r} ${h - 1}
    `.replace(/\s+/g, ' ').trim();
  } else {
    return `
      M ${w - r * 1.5} 1
      A ${r} ${r} 0 0 1 ${w - 1} ${r * 1.6}
      L ${w - 1} ${h - r}
      A ${r} ${r} 0 0 1 ${w - r} ${h - 1}
    `.replace(/\s+/g, ' ').trim();
  }
}

export const Bumper: React.FC<BumperProps> = ({ id, socket, labelOverride }) => {
  const { toDevice, scale, breathe } = useFrame();

  const isTrigger = id === 'LT' || id === 'RT';
  const isRight = id === 'RT' || id === 'RB';

  // Display label: default to PlayStation terminology L2/L1/R2/R1 as requested by user
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

  const padding = 10 * scale;
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
  const maxDragDistance = 45 * scale;

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      'worklet';
      pressed.value = 1;
      startY.value = event.y;

      if (isTrigger) {
        // Immediate engagement on touch
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
        // Vertical drag maps downward to 0..1
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

  // Skia Path generation
  const shoulderPath = useMemo(() => {
    const d = createShoulderSvg(width, height, isRight, isTrigger);
    return Skia.Path.MakeFromSVGString(d);
  }, [width, height, isRight, isTrigger]);

  const outerGlowPath = useMemo(() => {
    const d = createOuterGlowStroke(width, height, isRight, isTrigger);
    return Skia.Path.MakeFromSVGString(d);
  }, [width, height, isRight, isTrigger]);

  // Label Fonts
  const fontMain = useMemo(() => {
    return matchFont({
      fontFamily: Platform.select({
        ios: 'System',
        android: 'sans-serif',
        default: 'sans-serif',
      }),
      fontSize: Math.max(11, height * 0.44),
      fontWeight: 'bold',
    });
  }, [height]);

  const fontSub = useMemo(() => {
    return matchFont({
      fontFamily: Platform.select({
        ios: 'System',
        android: 'sans-serif',
        default: 'sans-serif',
      }),
      fontSize: Math.max(7, height * 0.22),
      fontWeight: 'normal',
    });
  }, [height]);

  const { textX, textY, subX, subY } = useMemo(() => {
    const cx = padding + width / 2;
    const cy = padding + height / 2;
    let mainX = cx;
    let mainY = cy + 4;
    let sx = cx;
    let sy = cy;

    if (fontMain) {
      const b = fontMain.measureText(displayLabel);
      mainX = cx - b.width / 2 - b.x;
      mainY = cy - b.height / 2 - b.y - (fontSub ? 2 : 0);
    }

    if (fontSub) {
      const b2 = fontSub.measureText(subLabel);
      sx = cx - b2.width / 2 - b2.x;
      sy = mainY + 11 * scale;
    }

    return { textX: mainX, textY: mainY, subX: sx, subY: sy };
  }, [fontMain, fontSub, displayLabel, subLabel, width, height, padding, scale]);

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
    return triggerVal.value * 0.42;
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
              <Group>
                {/* 1. Outer Glow along the curved shoulder seam */}
                {outerGlowPath && (
                  <Path
                    path={outerGlowPath}
                    style="stroke"
                    strokeWidth={edgeStrokeWidth}
                    color={COLORS.accent}
                    opacity={edgeGlowOpacity}
                  >
                    <BlurMask blur={edgeGlowBlur} style="normal" />
                  </Path>
                )}

                {/* 2. Main Bumper Body with Metallic Gunmetal Gradient */}
                <Path path={shoulderPath}>
                  <LinearGradient
                    start={vec(padding, padding)}
                    end={vec(padding + width, padding + height)}
                    colors={['#2D3543', '#1A202A', '#0D1016', '#05070B']}
                  />
                </Path>

                {/* 3. Dynamic Analog Trigger Fill Gauge */}
                {isTrigger && (
                  <Path path={shoulderPath} opacity={triggerFillOpacity}>
                    <LinearGradient
                      start={vec(padding, padding)}
                      end={vec(padding, padding + height)}
                      colors={['#2F8BFF', '#1A5BBB', 'rgba(47, 139, 255, 0.1)']}
                    />
                  </Path>
                )}

                {/* 4. Fine beveled inner rim stroke */}
                <Path
                  path={shoulderPath}
                  style="stroke"
                  strokeWidth={1}
                  color="rgba(255, 255, 255, 0.14)"
                />

                {/* 5. Glowing outer rim highlight */}
                {outerGlowPath && (
                  <Path
                    path={outerGlowPath}
                    style="stroke"
                    strokeWidth={1.2}
                    color="#88C0FF"
                    opacity={edgeGlowOpacity}
                  />
                )}

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

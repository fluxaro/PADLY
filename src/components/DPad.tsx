import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  LinearGradient,
  Path,
  RadialGradient,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useFrame } from './ControllerFrame';
import { emit, ButtonId } from '../input/inputBus';
import { selection } from '../hooks/useHaptics';
import { COLORS } from '../theme/colors';

export interface DPadSocket {
  cx: number;
  cy: number;
  size: number;
}

export interface DPadProps {
  socket: DPadSocket;
}

interface DPadState {
  UP: boolean;
  DOWN: boolean;
  LEFT: boolean;
  RIGHT: boolean;
}

/**
 * Builds an SVG path string for a symmetrical rounded cross.
 */
function createCrossSvgPath(cx: number, cy: number, w: number, arm: number, r: number): string {
  const hw = w / 2;
  const harm = arm / 2;

  const d = [
    `M ${cx - harm + r} ${cy - hw}`,
    `L ${cx + harm - r} ${cy - hw}`,
    `A ${r} ${r} 0 0 1 ${cx + harm} ${cy - hw + r}`,
    `L ${cx + harm} ${cy - harm - r}`,
    `A ${r} ${r} 0 0 0 ${cx + harm + r} ${cy - harm}`,
    `L ${cx + hw - r} ${cy - harm}`,
    `A ${r} ${r} 0 0 1 ${cx + hw} ${cy - harm + r}`,
    `L ${cx + hw} ${cy + harm - r}`,
    `A ${r} ${r} 0 0 1 ${cx + hw - r} ${cy + harm}`,
    `L ${cx + harm + r} ${cy + harm}`,
    `A ${r} ${r} 0 0 0 ${cx + harm} ${cy + harm + r}`,
    `L ${cx + harm} ${cy + hw - r}`,
    `A ${r} ${r} 0 0 1 ${cx + harm - r} ${cy + hw}`,
    `L ${cx - harm + r} ${cy + hw}`,
    `A ${r} ${r} 0 0 1 ${cx - harm} ${cy + hw - r}`,
    `L ${cx - harm} ${cy + harm + r}`,
    `A ${r} ${r} 0 0 0 ${cx - harm - r} ${cy + harm}`,
    `L ${cx - hw + r} ${cy + harm}`,
    `A ${r} ${r} 0 0 1 ${cx - hw} ${cy + harm - r}`,
    `L ${cx - hw} ${cy - harm + r}`,
    `A ${r} ${r} 0 0 1 ${cx - hw + r} ${cy - harm}`,
    `L ${cx - harm - r} ${cy - harm}`,
    `A ${r} ${r} 0 0 0 ${cx - harm} ${cy - harm - r}`,
    `L ${cx - harm} ${cy - hw + r}`,
    `A ${r} ${r} 0 0 1 ${cx - harm + r} ${cy - hw}`,
    'Z',
  ];

  return d.join(' ');
}

/**
 * Builds a triangle path for directional arrow indicators.
 */
function createArrowPath(
  direction: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT',
  cx: number,
  cy: number,
  size: number
) {
  const half = size * 0.6;
  const len = size * 0.65;
  let d = '';

  switch (direction) {
    case 'UP':
      d = `M ${cx} ${cy - len} L ${cx - half} ${cy + len * 0.6} L ${cx + half} ${cy + len * 0.6} Z`;
      break;
    case 'DOWN':
      d = `M ${cx} ${cy + len} L ${cx - half} ${cy - len * 0.6} L ${cx + half} ${cy - len * 0.6} Z`;
      break;
    case 'LEFT':
      d = `M ${cx - len} ${cy} L ${cx + len * 0.6} ${cy - half} L ${cx + len * 0.6} ${cy + half} Z`;
      break;
    case 'RIGHT':
      d = `M ${cx + len} ${cy} L ${cx - len * 0.6} ${cy - half} L ${cx - len * 0.6} ${cy + half} Z`;
      break;
  }

  return Skia.Path.MakeFromSVGString(d);
}

export const DPad: React.FC<DPadProps> = ({ socket }) => {
  const { toDevice, scale, breathe } = useFrame();

  const center = toDevice(socket.cx, socket.cy);
  const size = socket.size * scale;
  const padding = size * 0.15;
  const canvasSize = size + padding * 2;
  const origin = canvasSize / 2;

  const crossW = size * 0.94;
  const armW = crossW * 0.35;
  const cornerR = 5 * scale;
  const centerRecessR = armW * 0.44;

  // Active state for each direction
  const upActive = useSharedValue(0);
  const downActive = useSharedValue(0);
  const leftActive = useSharedValue(0);
  const rightActive = useSharedValue(0);

  // 3D tilt tracking
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  const pressDepth = useSharedValue(0);

  // Ref tracking current direction state on JS thread
  const activeState = React.useRef<DPadState>({
    UP: false,
    DOWN: false,
    LEFT: false,
    RIGHT: false,
  });

  const syncDirectionState = (newState: DPadState) => {
    let changed = false;
    const prev = activeState.current;

    (['UP', 'DOWN', 'LEFT', 'RIGHT'] as const).forEach((dir) => {
      if (prev[dir] !== newState[dir]) {
        changed = true;
        prev[dir] = newState[dir];
        emit('button', { id: dir as ButtonId, pressed: newState[dir] });
      }
    });

    if (changed) {
      const anyActive = newState.UP || newState.DOWN || newState.LEFT || newState.RIGHT;
      if (anyActive) {
        selection();
      }
    }
  };

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      'worklet';
      const dx = event.x - origin;
      const dy = event.y - origin;
      const dist = Math.hypot(dx, dy);

      const deadzone = size * 0.12;
      const maxRadius = size * 0.56;

      let up = false;
      let down = false;
      let left = false;
      let right = false;

      if (dist >= deadzone && dist <= maxRadius) {
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const deg = (angle + 360) % 360;

        up = deg >= 202.5 && deg <= 337.5;
        down = deg >= 22.5 && deg <= 157.5;
        left = deg >= 112.5 && deg <= 247.5;
        right = deg >= 292.5 || deg <= 67.5;
      }

      upActive.value = withTiming(up ? 1 : 0, { duration: 50 });
      downActive.value = withTiming(down ? 1 : 0, { duration: 50 });
      leftActive.value = withTiming(left ? 1 : 0, { duration: 50 });
      rightActive.value = withTiming(right ? 1 : 0, { duration: 50 });

      const tx = (right ? 1 : 0) - (left ? 1 : 0);
      const ty = (down ? 1 : 0) - (up ? 1 : 0);
      const isAny = up || down || left || right;

      tiltX.value = withTiming(tx, { duration: 60 });
      tiltY.value = withTiming(ty, { duration: 60 });
      pressDepth.value = withTiming(isAny ? 1 : 0, { duration: 60 });

      runOnJS(syncDirectionState)({ UP: up, DOWN: down, LEFT: left, RIGHT: right });
    })
    .onUpdate((event) => {
      'worklet';
      const dx = event.x - origin;
      const dy = event.y - origin;
      const dist = Math.hypot(dx, dy);

      const deadzone = size * 0.12;
      const maxRadius = size * 0.56;

      let up = false;
      let down = false;
      let left = false;
      let right = false;

      if (dist >= deadzone && dist <= maxRadius) {
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const deg = (angle + 360) % 360;

        up = deg >= 202.5 && deg <= 337.5;
        down = deg >= 22.5 && deg <= 157.5;
        left = deg >= 112.5 && deg <= 247.5;
        right = deg >= 292.5 || deg <= 67.5;
      }

      upActive.value = withTiming(up ? 1 : 0, { duration: 50 });
      downActive.value = withTiming(down ? 1 : 0, { duration: 50 });
      leftActive.value = withTiming(left ? 1 : 0, { duration: 50 });
      rightActive.value = withTiming(right ? 1 : 0, { duration: 50 });

      const tx = (right ? 1 : 0) - (left ? 1 : 0);
      const ty = (down ? 1 : 0) - (up ? 1 : 0);
      const isAny = up || down || left || right;

      tiltX.value = withTiming(tx, { duration: 60 });
      tiltY.value = withTiming(ty, { duration: 60 });
      pressDepth.value = withTiming(isAny ? 1 : 0, { duration: 60 });

      runOnJS(syncDirectionState)({ UP: up, DOWN: down, LEFT: left, RIGHT: right });
    })
    .onFinalize(() => {
      'worklet';
      upActive.value = withSpring(0, { damping: 14 });
      downActive.value = withSpring(0, { damping: 14 });
      leftActive.value = withSpring(0, { damping: 14 });
      rightActive.value = withSpring(0, { damping: 14 });

      tiltX.value = withSpring(0, { damping: 14 });
      tiltY.value = withSpring(0, { damping: 14 });
      pressDepth.value = withSpring(0, { damping: 14 });

      runOnJS(syncDirectionState)({ UP: false, DOWN: false, LEFT: false, RIGHT: false });
    });

  // Tilt animation style for 3D tactile feel
  const animatedTiltStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: tiltX.value * 2.5 },
        { translateY: tiltY.value * 2.5 + pressDepth.value * 1.5 },
        { skewX: `${-tiltY.value * 2.2}deg` },
        { skewY: `${tiltX.value * 2.2}deg` },
        { scale: 1 - 0.025 * pressDepth.value },
      ],
    };
  });

  // Pre-generate Skia paths
  const outerBevelPath = useMemo(() => {
    const svgStr = createCrossSvgPath(origin, origin, crossW + 3, armW + 3, cornerR + 1);
    return Skia.Path.MakeFromSVGString(svgStr);
  }, [origin, crossW, armW, cornerR]);

  const mainCrossPath = useMemo(() => {
    const svgStr = createCrossSvgPath(origin, origin, crossW, armW, cornerR);
    return Skia.Path.MakeFromSVGString(svgStr);
  }, [origin, crossW, armW, cornerR]);

  // Directional arrow paths
  const arrowDist = (crossW / 2 + armW / 2) / 2;
  const arrowSize = armW * 0.28;

  const upArrowPath = useMemo(
    () => createArrowPath('UP', origin, origin - arrowDist, arrowSize),
    [origin, arrowDist, arrowSize]
  );
  const downArrowPath = useMemo(
    () => createArrowPath('DOWN', origin, origin + arrowDist, arrowSize),
    [origin, arrowDist, arrowSize]
  );
  const leftArrowPath = useMemo(
    () => createArrowPath('LEFT', origin - arrowDist, origin, arrowSize),
    [origin, arrowDist, arrowSize]
  );
  const rightArrowPath = useMemo(
    () => createArrowPath('RIGHT', origin + arrowDist, origin, arrowSize),
    [origin, arrowDist, arrowSize]
  );

  // Animated glow derived values
  const upGlowBlur = useDerivedValue(() => 2.5 + 4.5 * upActive.value);
  const upGlowOpacity = useDerivedValue(() => (0.4 + 0.55 * upActive.value) * breathe.value);

  const downGlowBlur = useDerivedValue(() => 2.5 + 4.5 * downActive.value);
  const downGlowOpacity = useDerivedValue(() => (0.4 + 0.55 * downActive.value) * breathe.value);

  const leftGlowBlur = useDerivedValue(() => 2.5 + 4.5 * leftActive.value);
  const leftGlowOpacity = useDerivedValue(() => (0.4 + 0.55 * leftActive.value) * breathe.value);

  const rightGlowBlur = useDerivedValue(() => 2.5 + 4.5 * rightActive.value);
  const rightGlowOpacity = useDerivedValue(() => (0.4 + 0.55 * rightActive.value) * breathe.value);

  return (
    <View
      style={[
        styles.wrapper,
        {
          left: center.x - size / 2,
          top: center.y - size / 2,
          width: size,
          height: size,
        },
      ]}
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[StyleSheet.absoluteFill, animatedTiltStyle]}>
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
            {/* 1. Outer beveled edge with linear gradient */}
            {outerBevelPath && (
              <Path path={outerBevelPath}>
                <LinearGradient
                  start={vec(origin, origin - crossW / 2)}
                  end={vec(origin, origin + crossW / 2)}
                  colors={['#2D3542', '#1A1E26', '#090B0F']}
                />
              </Path>
            )}

            {/* 2. Main cross body */}
            {mainCrossPath && (
              <Path path={mainCrossPath}>
                <LinearGradient
                  start={vec(origin, origin - crossW / 2)}
                  end={vec(origin, origin + crossW / 2)}
                  colors={['#1E232C', '#12161D', '#0A0C10']}
                />
              </Path>
            )}

            {/* 3. Cross inner rim stroke */}
            {mainCrossPath && (
              <Path
                path={mainCrossPath}
                style="stroke"
                strokeWidth={0.9}
                color="rgba(255, 255, 255, 0.08)"
              />
            )}

            {/* 4. Recessed center circle */}
            <Circle cx={origin} cy={origin} r={centerRecessR}>
              <RadialGradient
                c={vec(origin, origin)}
                r={centerRecessR}
                colors={['#06080B', '#0E1117', '#1A202A']}
              />
            </Circle>
            <Circle
              cx={origin}
              cy={origin}
              r={centerRecessR}
              style="stroke"
              strokeWidth={1}
              color="rgba(0, 0, 0, 0.7)"
            />
            <Circle
              cx={origin}
              cy={origin}
              r={centerRecessR + 1}
              style="stroke"
              strokeWidth={0.8}
              color="rgba(255, 255, 255, 0.06)"
            />

            {/* 5. Four small blue triangle arrows with soft glow */}
            {/* UP Arrow */}
            {upArrowPath && (
              <>
                <Path path={upArrowPath} color={COLORS.accent} opacity={upGlowOpacity}>
                  <BlurMask blur={upGlowBlur} style="normal" />
                </Path>
                <Path path={upArrowPath} color={COLORS.accent} />
              </>
            )}

            {/* DOWN Arrow */}
            {downArrowPath && (
              <>
                <Path path={downArrowPath} color={COLORS.accent} opacity={downGlowOpacity}>
                  <BlurMask blur={downGlowBlur} style="normal" />
                </Path>
                <Path path={downArrowPath} color={COLORS.accent} />
              </>
            )}

            {/* LEFT Arrow */}
            {leftArrowPath && (
              <>
                <Path path={leftArrowPath} color={COLORS.accent} opacity={leftGlowOpacity}>
                  <BlurMask blur={leftGlowBlur} style="normal" />
                </Path>
                <Path path={leftArrowPath} color={COLORS.accent} />
              </>
            )}

            {/* RIGHT Arrow */}
            {rightArrowPath && (
              <>
                <Path path={rightArrowPath} color={COLORS.accent} opacity={rightGlowOpacity}>
                  <BlurMask blur={rightGlowBlur} style="normal" />
                </Path>
                <Path path={rightArrowPath} color={COLORS.accent} />
              </>
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

export default DPad;

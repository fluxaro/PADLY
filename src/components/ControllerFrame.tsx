import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  DEBUG_LAYOUT,
  DESIGN_H,
  DESIGN_W,
  FRAME_IMAGE,
  SOCKETS,
} from '../theme/layout';
import {
  calculateResponsiveDisplacement,
  ResponsiveFrameMetrics,
} from '../utils/responsiveLayout';

export interface FrameOffset {
  x: number;
  y: number;
}

export interface FrameContextValue {
  scale: number;
  offset: FrameOffset;
  offsetX: number;
  offsetY: number;
  toDevice: (x: number, y: number) => { x: number; y: number };
  breathe: SharedValue<number>;
}

const defaultBreathe: SharedValue<number> = { value: 1.0 } as SharedValue<number>;

const FrameContext = createContext<FrameContextValue>({
  scale: 1,
  offset: { x: 0, y: 0 },
  offsetX: 0,
  offsetY: 0,
  toDevice: (x, y) => ({ x, y }),
  breathe: defaultBreathe,
});

export function useFrame(): FrameContextValue {
  return useContext(FrameContext);
}

// Module-level state so the standalone toDevice helper can reference the active layout
let currentFrameState = {
  scale: 1,
  offset: { x: 0, y: 0 },
};

/**
 * Converts design canvas coordinates (923x426 space) into actual device coordinates.
 * Formula: position = design value * scale + offset
 */
export function toDevice(
  x: number,
  y: number,
  scale: number = currentFrameState.scale,
  offset: FrameOffset = currentFrameState.offset
): { x: number; y: number } {
  return {
    x: x * scale + offset.x,
    y: y * scale + offset.y,
  };
}

export {
  calculateResponsiveDisplacement,
  getButtonDisplacement,
  calculateAllButtonLocations,
} from '../utils/responsiveLayout';

interface ControllerFrameProps {
  children?: React.ReactNode;
  debugLayout?: boolean;
}

export const ControllerFrame: React.FC<ControllerFrameProps> = ({ children, debugLayout }) => {
  const windowDims = useWindowDimensions();
  const [layoutDims, setLayoutDims] = useState<{ width: number; height: number } | null>(null);

  const containerW = layoutDims?.width || windowDims.width;
  const containerH = layoutDims?.height || windowDims.height;

  // Global idle breathing animation: opacity breathes between 0.85 and 1.0 over 3 seconds
  const breathe = useSharedValue(0.85);

  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1.0, {
        duration: 3000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
  }, [breathe]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setLayoutDims({ width, height });
    }
  };

  const responsiveMetrics = useMemo(() => {
    const metrics = calculateResponsiveDisplacement(containerW, containerH);
    currentFrameState = {
      scale: metrics.scale,
      offset: { x: metrics.offsetX, y: metrics.offsetY },
    };
    return metrics;
  }, [containerW, containerH]);

  const { scale, offsetX, offsetY, offset } = useMemo(() => {
    return {
      scale: responsiveMetrics.scale,
      offsetX: responsiveMetrics.offsetX,
      offsetY: responsiveMetrics.offsetY,
      offset: { x: responsiveMetrics.offsetX, y: responsiveMetrics.offsetY },
    };
  }, [responsiveMetrics]);

  const contextValue = useMemo<FrameContextValue>(
    () => ({
      scale,
      offset,
      offsetX,
      offsetY,
      toDevice: (x: number, y: number) => {
        const pt = responsiveMetrics.moveToRightLocation(x, y);
        return { x: pt.x, y: pt.y };
      },
      breathe,
    }),
    [scale, offset, offsetX, offsetY, responsiveMetrics, breathe]
  );

  return (
    <FrameContext.Provider value={contextValue}>
      <View style={styles.container} onLayout={handleLayout}>
        <Image
          source={FRAME_IMAGE}
          resizeMode="contain"
          style={[
            styles.frameImage,
            {
              left: offsetX,
              top: offsetY,
              width: DESIGN_W * scale,
              height: DESIGN_H * scale,
            },
          ]}
        />

        {(debugLayout !== undefined ? debugLayout : DEBUG_LAYOUT) && (
          <DebugOutlines scale={scale} offsetX={offsetX} offsetY={offsetY} />
        )}

        {children}
      </View>
    </FrameContext.Provider>
  );
};

interface DebugOutlinesProps {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const DebugOutlines: React.FC<DebugOutlinesProps> = ({ scale, offsetX, offsetY }) => {
  // Render circles
  const circles = [
    { key: 'leftStick', cx: SOCKETS.leftStick.cx, cy: SOCKETS.leftStick.cy, r: SOCKETS.leftStick.r },
    { key: 'rightStick', cx: SOCKETS.rightStick.cx, cy: SOCKETS.rightStick.cy, r: SOCKETS.rightStick.r },
    { key: 'faceY', cx: SOCKETS.faceY.cx, cy: SOCKETS.faceY.cy, r: SOCKETS.faceY.r },
    { key: 'faceX', cx: SOCKETS.faceX.cx, cy: SOCKETS.faceX.cy, r: SOCKETS.faceX.r },
    { key: 'faceB', cx: SOCKETS.faceB.cx, cy: SOCKETS.faceB.cy, r: SOCKETS.faceB.r },
    { key: 'faceA', cx: SOCKETS.faceA.cx, cy: SOCKETS.faceA.cy, r: SOCKETS.faceA.r },
    { key: 'home', cx: SOCKETS.home.cx, cy: SOCKETS.home.cy, r: SOCKETS.home.r },
    { key: 'smallLeft', cx: SOCKETS.smallLeft.cx, cy: SOCKETS.smallLeft.cy, r: SOCKETS.smallLeft.r },
    { key: 'smallRight', cx: SOCKETS.smallRight.cx, cy: SOCKETS.smallRight.cy, r: SOCKETS.smallRight.r },
    { key: 'topLeftSmall', cx: SOCKETS.topLeftSmall.cx, cy: SOCKETS.topLeftSmall.cy, r: SOCKETS.topLeftSmall.r },
    { key: 'topRightSmall', cx: SOCKETS.topRightSmall.cx, cy: SOCKETS.topRightSmall.cy, r: SOCKETS.topRightSmall.r },
  ];

  // Render rects
  const rects = [
    { key: 'touchpad', x: SOCKETS.touchpad.x, y: SOCKETS.touchpad.y, w: SOCKETS.touchpad.w, h: SOCKETS.touchpad.h, radius: SOCKETS.touchpad.radius },
    { key: 'LT', x: SOCKETS.LT.x, y: SOCKETS.LT.y, w: SOCKETS.LT.w, h: SOCKETS.LT.h, radius: 6 },
    { key: 'LB', x: SOCKETS.LB.x, y: SOCKETS.LB.y, w: SOCKETS.LB.w, h: SOCKETS.LB.h, radius: 6 },
    { key: 'RT', x: SOCKETS.RT.x, y: SOCKETS.RT.y, w: SOCKETS.RT.w, h: SOCKETS.RT.h, radius: 6 },
    { key: 'RB', x: SOCKETS.RB.x, y: SOCKETS.RB.y, w: SOCKETS.RB.w, h: SOCKETS.RB.h, radius: 6 },
  ];

  const dpad = SOCKETS.dpad;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {circles.map((c) => {
        const left = (c.cx - c.r) * scale + offsetX;
        const top = (c.cy - c.r) * scale + offsetY;
        const diameter = c.r * 2 * scale;
        return (
          <View
            key={c.key}
            style={[
              styles.debugCircle,
              {
                left,
                top,
                width: diameter,
                height: diameter,
                borderRadius: diameter / 2,
              },
            ]}
          />
        );
      })}

      {/* D-Pad outline */}
      <View
        style={[
          styles.debugDpad,
          {
            left: (dpad.cx - dpad.size / 2) * scale + offsetX,
            top: (dpad.cy - dpad.size / 2) * scale + offsetY,
            width: dpad.size * scale,
            height: dpad.size * scale,
            borderRadius: (dpad.size / 2) * scale,
          },
        ]}
      />

      {/* Rectangles */}
      {rects.map((r) => {
        const left = r.x * scale + offsetX;
        const top = r.y * scale + offsetY;
        const width = r.w * scale;
        const height = r.h * scale;
        return (
          <View
            key={r.key}
            style={[
              styles.debugRect,
              {
                left,
                top,
                width,
                height,
                borderRadius: (r.radius ?? 4) * scale,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  frameImage: {
    position: 'absolute',
  },
  debugCircle: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 229, 255, 0.75)',
    backgroundColor: 'rgba(0, 229, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  debugDpad: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 170, 0, 0.8)',
    backgroundColor: 'rgba(255, 170, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  debugRect: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 136, 0.75)',
    backgroundColor: 'rgba(0, 255, 136, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  debugLabel: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default ControllerFrame;

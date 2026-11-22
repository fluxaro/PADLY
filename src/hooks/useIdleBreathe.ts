import { useEffect } from 'react';
import {
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Hook providing a synchronized 3-second breathing cycle (opacity 0.85 -> 1.0).
 * Used for idle ambient glows across controller sockets.
 */
export function useIdleBreathe(): SharedValue<number> {
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

  return breathe;
}

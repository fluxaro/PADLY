import {
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Given a Reanimated shared value `pressed` (0..1), returns an animated style with:
 * - scale: 1 -> 0.93
 * - translateY: 0 -> 2
 * - fast withTiming (60ms) on press
 * - springy release on depress
 */
export function usePressFeedback(pressed: SharedValue<number>) {
  const animProgress = useDerivedValue(() => {
    return pressed.value > 0.01
      ? withTiming(1, { duration: 60 })
      : withSpring(0, {
          damping: 14,
          stiffness: 200,
          mass: 0.6,
        });
  });

  return useAnimatedStyle(() => {
    const p = animProgress.value;
    return {
      transform: [
        { scale: 1 - 0.07 * p },
        { translateY: 2 * p },
      ],
    };
  });
}

export default usePressFeedback;

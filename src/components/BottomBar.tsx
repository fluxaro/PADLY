import React, { useState } from 'react';
import {
  GestureResponderEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useFrame } from './ControllerFrame';
import { light, selection } from '../hooks/useHaptics';
import { COLORS } from '../theme/colors';
import { ModalType } from './ControllerModals';

export interface BottomBarProps {
  onOpenModal: (type: ModalType) => void;
  activeProfile?: string;
  hapticsOn?: boolean;
}

interface BottomRoundButtonProps {
  icon: React.ReactNode;
  active?: boolean;
  onPress: () => void;
  scale: number;
}

const BottomRoundButton: React.FC<BottomRoundButtonProps> = ({
  icon,
  active = false,
  onPress,
  scale,
}) => {
  const pressed = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - 0.08 * pressed.value },
      { translateY: 1.5 * pressed.value },
    ],
  }));

  const btnSize = Math.max(28, 30 * scale);

  return (
    <Pressable
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 50 });
        light();
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { damping: 14 });
      }}
      onPress={onPress}
      style={{ marginLeft: 5 * scale }}
    >
      <Animated.View
        style={[
          styles.actionBtn,
          active && styles.actionBtnActive,
          animStyle,
          {
            width: btnSize,
            height: btnSize,
            borderRadius: btnSize / 2,
          },
        ]}
      >
        {icon}
      </Animated.View>
    </Pressable>
  );
};

export const BottomBar: React.FC<BottomBarProps> = ({
  onOpenModal,
  activeProfile = 'Default Profile',
  hapticsOn = true,
}) => {
  const { scale } = useFrame();

  // Volume slider state
  const [volume, setVolume] = useState<number>(0.75);
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);

  const sliderWidth = 60 * scale;

  const updateVolumeFromX = (locationX: number) => {
    const clamped = Math.max(0, Math.min(1, locationX / sliderWidth));
    setVolume(clamped);
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt: GestureResponderEvent) => {
      updateVolumeFromX(evt.nativeEvent.locationX);
      light();
    },
    onPanResponderMove: (evt: GestureResponderEvent) => {
      updateVolumeFromX(evt.nativeEvent.locationX);
    },
  });

  return (
    <View style={[styles.container, { height: 38 * scale }]}>
      {/* 1. Left Pill: Audio Slider & Mic */}
      <View
        style={[
          styles.pill,
          {
            paddingHorizontal: 9 * scale,
            paddingVertical: 5 * scale,
            borderRadius: 16 * scale,
          },
        ]}
      >
        <Ionicons
          name={volume === 0 ? 'volume-mute-outline' : 'volume-medium-outline'}
          size={Math.max(12, 14 * scale)}
          color="#8DA0BA"
          style={{ marginRight: 6 * scale }}
        />

        {/* Draggable volume slider */}
        <View
          style={[styles.sliderTrackWrapper, { width: sliderWidth, height: 18 * scale }]}
          {...panResponder.panHandlers}
        >
          <View style={[styles.sliderTrack, { width: sliderWidth, height: 4.5 * scale }]}>
            <View style={[styles.sliderFill, { width: sliderWidth * volume, height: 4.5 * scale }]} />
          </View>
          <View
            style={[
              styles.sliderThumb,
              {
                left: Math.max(0, sliderWidth * volume - 6 * scale),
                width: 12 * scale,
                height: 12 * scale,
                borderRadius: 6 * scale,
              },
            ]}
          />
        </View>

        {/* Mic toggle */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            setIsMicMuted((prev) => !prev);
            light();
          }}
          style={[styles.micBtn, { marginLeft: 8 * scale }]}
        >
          <Ionicons
            name={isMicMuted ? 'mic-off' : 'mic'}
            size={Math.max(12, 14 * scale)}
            color={isMicMuted ? '#FF453A' : '#30D158'}
          />
        </TouchableOpacity>
      </View>

      {/* 2. Center Pill: Profile Selector (Opens Profile Switcher Dropdown) */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => onOpenModal('profile')}
        style={[
          styles.pill,
          styles.profilePill,
          {
            paddingHorizontal: 12 * scale,
            paddingVertical: 6 * scale,
            borderRadius: 16 * scale,
          },
        ]}
      >
        <Ionicons
          name="game-controller"
          size={Math.max(12, 14 * scale)}
          color={COLORS.accent}
          style={{ marginRight: 6 * scale }}
        />
        <Text style={[styles.profileText, { fontSize: Math.max(9, 11 * scale) }]}>
          {activeProfile}
        </Text>
        <Ionicons
          name="chevron-down"
          size={Math.max(10, 12 * scale)}
          color="#8DA0BA"
          style={{ marginLeft: 6 * scale }}
        />
      </TouchableOpacity>

      {/* 3. Right Action Buttons: Vibration, Brightness, Palette, Grid */}
      <View style={styles.actionsRow}>
        <BottomRoundButton
          icon={
            <MaterialCommunityIcons
              name={hapticsOn ? 'vibrate' : 'vibrate-off'}
              size={Math.max(12, 14 * scale)}
              color={hapticsOn ? COLORS.accent : '#5A687D'}
            />
          }
          active={hapticsOn}
          onPress={() => onOpenModal('vibration')}
          scale={scale}
        />

        <BottomRoundButton
          icon={<Ionicons name="sunny-outline" size={Math.max(12, 14 * scale)} color="#FFD60A" />}
          onPress={() => onOpenModal('brightness')}
          scale={scale}
        />

        <BottomRoundButton
          icon={
            <Ionicons name="color-palette-outline" size={Math.max(12, 14 * scale)} color="#A682FF" />
          }
          onPress={() => onOpenModal('theme')}
          scale={scale}
        />

        <BottomRoundButton
          icon={<Ionicons name="grid-outline" size={Math.max(12, 14 * scale)} color={COLORS.accent} />}
          onPress={() => onOpenModal('layout')}
          scale={scale}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12, 16, 24, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  profilePill: {
    gap: 2,
  },
  profileText: {
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sliderTrackWrapper: {
    justifyContent: 'center',
  },
  sliderTrack: {
    backgroundColor: '#1E2532',
    borderRadius: 3,
    overflow: 'hidden',
  },
  sliderFill: {
    backgroundColor: COLORS.accent,
    borderRadius: 3,
  },
  sliderThumb: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
    elevation: 3,
  },
  micBtn: {
    padding: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    backgroundColor: 'rgba(14, 18, 26, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  actionBtnActive: {
    borderColor: 'rgba(47, 139, 255, 0.5)',
  },
});

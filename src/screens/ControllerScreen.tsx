import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';

import { ControllerFrame } from '../components/ControllerFrame';
import { Stick } from '../components/Stick';
import { FaceButton } from '../components/FaceButton';
import { DPad } from '../components/DPad';
import { Bumper } from '../components/Bumper';
import { RoundButton, HomeButton } from '../components/RoundButton';
import { Touchpad } from '../components/Touchpad';
import { TopBar, ControllerMode } from '../components/TopBar';
import { BottomBar } from '../components/BottomBar';
import { ControllerModals, ModalType } from '../components/ControllerModals';
import { MouseMode } from './MouseMode';
import { KeyboardMode } from './KeyboardMode';
import { TouchpadMode } from './TouchpadMode';
import { PairScreen } from './PairScreen';
import { UsbHelpBottomSheet } from '../components/UsbHelpBottomSheet';
import { discoveryService } from '../pairing/DiscoveryService';
import { usbWatcher } from '../net/UsbWatcher';
import { useConnection } from '../net/useConnection';
import { connectionManager } from '../net/ConnectionManager';
import { DEBUG_LAYOUT, SOCKETS } from '../theme/layout';
import { COLORS } from '../theme/colors';
import { isHapticsEnabled } from '../hooks/useHaptics';

export const ControllerScreen: React.FC = () => {
  useKeepAwake();

  const conn = useConnection();

  // Mode state: 'Controller' | 'Mouse' | 'Keyboard' | 'Touchpad'
  const [mode, setMode] = useState<ControllerMode>('Controller');

  // Modal State for interactive dropdowns/popovers
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [isPairingOpen, setIsPairingOpen] = useState<boolean>(false);

  // Button Style Preference: 'playstation' (△, □, ○, ✕) vs 'xbox' (Y, X, B, A)
  const [buttonStyle, setButtonStyle] = useState<'playstation' | 'xbox'>('playstation');

  // Global Settings state
  const [hapticsOn, setHapticsOn] = useState<boolean>(isHapticsEnabled());
  const [brightness, setBrightness] = useState<number>(1.0);
  const [themeColor, setThemeColor] = useState<string>(COLORS.accent);
  const [activeProfile, setActiveProfile] = useState<string>('Default Profile');
  const [isDebugLayoutActive, setIsDebugLayoutActive] = useState<boolean>(DEBUG_LAYOUT);

  // Lock orientation to landscape while mounted
  useEffect(() => {
    async function lockLandscape() {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } catch (err) {
        // Silently ignore on unsupported platforms
      }
    }

    lockLandscape();

    // Start background mDNS discovery service for paired PCs
    discoveryService.start();

    // Start background USB auto-detection watcher (checks 127.0.0.1:47821 every 2s)
    usbWatcher.start();

    return () => {
      usbWatcher.stop();
      discoveryService.stop();
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  // Symbol overrides based on selected button style
  const faceSymbols = {
    Y: buttonStyle === 'playstation' ? '△' : 'Y',
    X: buttonStyle === 'playstation' ? '□' : 'X',
    B: buttonStyle === 'playstation' ? '○' : 'B',
    A: buttonStyle === 'playstation' ? '✕' : 'A',
  };

  const shoulderLabels = {
    LT: buttonStyle === 'playstation' ? 'L2' : 'LT',
    LB: buttonStyle === 'playstation' ? 'L1' : 'LB',
    RT: buttonStyle === 'playstation' ? 'R2' : 'RT',
    RB: buttonStyle === 'playstation' ? 'R1' : 'RB',
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />

      {/* 1. Top Outside Bar: anchored cleanly above the gamepad */}
      <View style={styles.topBarWrapper} pointerEvents="box-none">
        <TopBar
          mode={mode}
          onModeChange={setMode}
          onOpenModal={setActiveModal}
        />
      </View>

      {/* 2. Center Controller Canvas */}
      <View style={styles.frameWrapper}>
        <ControllerFrame debugLayout={isDebugLayoutActive}>
          {mode === 'Controller' && (
            <>
              {/* Central Touchpad */}
              <Touchpad socket={SOCKETS.touchpad} />

              {/* Small Central Functional Buttons */}
              {/* Top-Left Small: View/Overlay (BACK) */}
              <RoundButton id="BACK" icon="back" socket={SOCKETS.topLeftSmall} />

              {/* Top-Right Small: Menu (START) */}
              <RoundButton id="START" icon="start" socket={SOCKETS.topRightSmall} />

              {/* Small Left: Capture/Screens (SHARE-LEFT) */}
              <RoundButton id="SHARE-LEFT" icon="screens" socket={SOCKETS.smallLeft} />

              {/* Small Right: Share/Export (SHARE) */}
              <RoundButton id="SHARE" icon="share" socket={SOCKETS.smallRight} />

              {/* Main Center Home Button with halo glow */}
              <HomeButton socket={SOCKETS.home} />

              {/* Left Analog Stick (with 3D mechanical click + dedicated L3 button) */}
              <Stick id="left" socket={SOCKETS.leftStick} />

              {/* Right Analog Stick (with 3D mechanical click + dedicated R3 button) */}
              <Stick id="right" socket={SOCKETS.rightStick} />

              {/* D-Pad (8-way directional with 3D tactile tilt illusion) */}
              <DPad socket={SOCKETS.dpad} />

              {/* Face Buttons with realistic jewel dome gloss and authentic symbols */}
              <FaceButton
                id="Y"
                label="Y"
                symbolOverride={faceSymbols.Y}
                color={COLORS.Y}
                socket={SOCKETS.faceY}
              />
              <FaceButton
                id="X"
                label="X"
                symbolOverride={faceSymbols.X}
                color={COLORS.X}
                socket={SOCKETS.faceX}
              />
              <FaceButton
                id="B"
                label="B"
                symbolOverride={faceSymbols.B}
                color={COLORS.B}
                socket={SOCKETS.faceB}
              />
              <FaceButton
                id="A"
                label="A"
                symbolOverride={faceSymbols.A}
                color={COLORS.A}
                socket={SOCKETS.faceA}
              />

              {/* Sculpted Shoulder Bumpers & Analog Triggers */}
              {/* Left Shoulder: L2 (LT Trigger) & L1 (LB Bumper) */}
              <Bumper
                id="LT"
                socket={SOCKETS.LT}
                labelOverride={shoulderLabels.LT}
              />
              <Bumper
                id="LB"
                socket={SOCKETS.LB}
                labelOverride={shoulderLabels.LB}
              />

              {/* Right Shoulder: R2 (RT Trigger) & R1 (RB Bumper) */}
              <Bumper
                id="RT"
                socket={SOCKETS.RT}
                labelOverride={shoulderLabels.RT}
              />
              <Bumper
                id="RB"
                socket={SOCKETS.RB}
                labelOverride={shoulderLabels.RB}
              />
            </>
          )}

          {mode === 'Mouse' && <MouseMode />}
          {mode === 'Keyboard' && <KeyboardMode />}
          {mode === 'Touchpad' && <TouchpadMode />}
        </ControllerFrame>
      </View>

      {/* 3. Bottom Outside Bar: anchored cleanly below the gamepad */}
      <View style={styles.bottomBarWrapper} pointerEvents="box-none">
        <BottomBar
          onOpenModal={setActiveModal}
          activeProfile={activeProfile}
          hapticsOn={hapticsOn}
        />
      </View>

      {/* Global Interactive Modals & Dropdown Popovers */}
      <ControllerModals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        onOpenPairing={() => setIsPairingOpen(true)}
        buttonStyle={buttonStyle}
        onToggleButtonStyle={setButtonStyle}
        hapticsOn={hapticsOn}
        onToggleHaptics={setHapticsOn}
        brightness={brightness}
        onSelectBrightness={setBrightness}
        themeColor={themeColor}
        onSelectTheme={setThemeColor}
        activeProfile={activeProfile}
        onSelectProfile={setActiveProfile}
        isDebugActive={isDebugLayoutActive}
        onToggleDebug={() => setIsDebugLayoutActive((prev) => !prev)}
      />

      {/* PC Pairing & Camera QR Scanner Screen */}
      <PairScreen
        visible={isPairingOpen}
        onClose={() => setIsPairingOpen(false)}
      />

      {/* USB Setup Help Bottom Sheet */}
      <UsbHelpBottomSheet
        visible={!!conn.isUsbHelpVisible}
        onClose={() => connectionManager.setUsbHelpVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
  },
  topBarWrapper: {
    position: 'absolute',
    top: 6,
    left: 12,
    right: 12,
    zIndex: 25,
  },
  frameWrapper: {
    flex: 1,
    marginVertical: 40,
  },
  bottomBarWrapper: {
    position: 'absolute',
    bottom: 6,
    left: 12,
    right: 12,
    zIndex: 25,
  },
});

export default ControllerScreen;

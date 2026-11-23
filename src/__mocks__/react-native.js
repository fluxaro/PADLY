module.exports = {
  Platform: {
    OS: 'android',
    select: (objs) => objs.android || objs.default,
  },
  NativeModules: {
    PadlyWifiLock: {
      acquireWifiLock: jest.fn(),
      releaseWifiLock: jest.fn(),
      vibrateRumble: jest.fn(),
      stopRumble: jest.fn(),
    },
  },
  Vibration: {
    vibrate: jest.fn(),
    cancel: jest.fn(),
  },
  StyleSheet: {
    create: (styles) => styles,
    absoluteFill: {},
  },
};

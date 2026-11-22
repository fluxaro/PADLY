const { withAndroidManifest, createRunOncePlugin } = require('@expo/config-plugins');

/**
 * Config plugin to configure exact Android network, camera, and Bluetooth permissions.
 * Applies android:maxSdkVersion="30" to legacy BLUETOOTH and BLUETOOTH_ADMIN permissions,
 * and configures modern Android 12+ BLUETOOTH_SCAN and BLUETOOTH_CONNECT.
 */
const withPadlyPermissions = (config) => {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest.$) {
      manifest.$ = {};
    }
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const permissions = [
      { name: 'android.permission.INTERNET' },
      { name: 'android.permission.ACCESS_NETWORK_STATE' },
      { name: 'android.permission.ACCESS_WIFI_STATE' },
      { name: 'android.permission.CHANGE_WIFI_STATE' },
      { name: 'android.permission.CHANGE_WIFI_MULTICAST_STATE' },
      { name: 'android.permission.CAMERA' },
      { name: 'android.permission.BLUETOOTH_CONNECT' },
      { name: 'android.permission.BLUETOOTH_SCAN' },
      {
        name: 'android.permission.BLUETOOTH',
        attributes: {
          'android:maxSdkVersion': '30',
          'tools:replace': 'android:maxSdkVersion',
        },
      },
      {
        name: 'android.permission.BLUETOOTH_ADMIN',
        attributes: {
          'android:maxSdkVersion': '30',
          'tools:replace': 'android:maxSdkVersion',
        },
      },
    ];

    permissions.forEach(({ name, attributes }) => {
      const existing = manifest['uses-permission'].find(
        (item) => item.$ && item.$['android:name'] === name
      );

      if (existing) {
        if (attributes) {
          existing.$ = { ...existing.$, ...attributes };
        }
      } else {
        manifest['uses-permission'].push({
          $: {
            'android:name': name,
            ...(attributes || {}),
          },
        });
      }
    });

    return config;
  });
};

module.exports = createRunOncePlugin(withPadlyPermissions, 'withPadlyPermissions', '1.0.0');

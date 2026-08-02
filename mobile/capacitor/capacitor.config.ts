import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Wasteland Commons Capacitor scaffold.
 *
 * This file intentionally lives under mobile/capacitor so the current web
 * project is not changed. When native packaging is explicitly activated,
 * this directory becomes the Capacitor project root and the native projects
 * live beside this file.
 *
 * `webDir` is relative to this directory:
 * mobile/capacitor/../../dist -> repository dist/
 */
const config: CapacitorConfig = {
  appId: 'com.wastelandcommons.game',
  appName: 'Wasteland Commons',
  webDir: '../../dist',
  loggingBehavior: 'none',
  initialFocus: true,
  zoomEnabled: false,
  backgroundColor: '#090b10',

  // The packaged app loads local, bundled assets. There is deliberately no
  // server.url here: a live-reload URL must never enter a release build.
  server: {
    hostname: 'localhost',
    iosScheme: 'capacitor',
    androidScheme: 'https',
  },

  ios: {
    loggingBehavior: 'none',
    webContentsDebuggingEnabled: false,
    preferredContentMode: 'mobile',
    scrollEnabled: false,
    contentInset: 'never',
  },

  android: {
    loggingBehavior: 'none',
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
};

export default config;

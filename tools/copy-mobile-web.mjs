import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const expectedRelay = String(process.env.VITE_RELAY_URL ?? 'wss://wasteland-commons.vercel.app/api/ws').trim();
const targets = [
  path.join(root, 'mobile', 'capacitor', 'android', 'app', 'src', 'main', 'assets', 'public'),
  path.join(root, 'mobile', 'capacitor', 'ios', 'App', 'App', 'public'),
];
const nativeConfig = {
  appId: 'com.wastelandcommons.game',
  appName: 'Wasteland Commons',
  webDir: '../../dist',
  loggingBehavior: 'none',
  initialFocus: true,
  zoomEnabled: false,
  backgroundColor: '#090b10',
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

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('Mobile web copy failed: dist/index.html is missing; run npm run build:web first.');
  process.exit(1);
}

const javascriptFiles = fs.readdirSync(path.join(dist, 'assets'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => path.join(dist, 'assets', entry.name));
if (!javascriptFiles.some((filePath) => fs.readFileSync(filePath, 'utf8').includes(expectedRelay))) {
  console.error(`Mobile web copy failed: the release bundle does not contain ${expectedRelay}.`);
  process.exit(1);
}

for (const target of targets) {
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(dist, target, { recursive: true, force: true });
  fs.writeFileSync(path.join(path.dirname(target), 'capacitor.config.json'), `${JSON.stringify(nativeConfig, null, 2)}\n`);
}

const indexHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, 'index.html'))).digest('hex');
console.log(`Copied mobile web release to Android and iOS; index SHA-256 ${indexHash}.`);

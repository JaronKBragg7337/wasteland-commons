import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const expectedRelay = String(process.env.VITE_RELAY_URL ?? 'wss://wasteland-commons.vercel.app/api/ws').trim();
const appPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  const filePath = absolute(relativePath);
  if (!fs.existsSync(filePath)) {
    errors.push(`missing ${relativePath}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function requireNonEmpty(relativePath) {
  const filePath = absolute(relativePath);
  if (!fs.existsSync(filePath)) {
    errors.push(`missing ${relativePath}`);
    return;
  }
  if (fs.statSync(filePath).size === 0) errors.push(`empty ${relativePath}`);
}

function assertContains(text, fragment, label) {
  if (!text.includes(fragment)) errors.push(`${label} does not contain ${fragment}`);
}

function assertJsonConfig(relativePath) {
  try {
    const config = JSON.parse(read(relativePath));
    if (config.appId !== 'com.wastelandcommons.game') errors.push(`${relativePath} has an unexpected appId`);
    if (config.appName !== 'Wasteland Commons') errors.push(`${relativePath} has an unexpected appName`);
    if (config.server?.url) errors.push(`${relativePath} contains a server.url`);
    if (config.android?.allowMixedContent === true) errors.push(`${relativePath} enables mixed content`);
  } catch {
    errors.push(`${relativePath} is not valid JSON`);
  }
}

const androidGradle = read('mobile/capacitor/android/app/build.gradle');
assertContains(androidGradle, 'namespace = "com.wastelandcommons.game"', 'Android Gradle config');
assertContains(androidGradle, 'applicationId "com.wastelandcommons.game"', 'Android Gradle config');
assertContains(androidGradle, `versionName "${appPackage.version}"`, 'Android Gradle config');
if (/usesCleartextTraffic\s*=\s*['"]true['"]/i.test(read('mobile/capacitor/android/app/src/main/AndroidManifest.xml'))) {
  errors.push('Android manifest enables cleartext traffic');
}
const androidManifest = read('mobile/capacitor/android/app/src/main/AndroidManifest.xml');
const permissions = [...androidManifest.matchAll(/<uses-permission[^>]+android:name="([^"]+)"/gi)].map((match) => match[1]);
const unexpectedPermissions = permissions.filter((permission) => permission !== 'android.permission.INTERNET');
if (unexpectedPermissions.length) errors.push(`Android manifest declares unreviewed permissions: ${unexpectedPermissions.join(', ')}`);

const iosProject = read('mobile/capacitor/ios/App/App.xcodeproj/project.pbxproj');
assertContains(iosProject, 'PRODUCT_BUNDLE_IDENTIFIER = com.wastelandcommons.game;', 'iOS project');
assertContains(iosProject, `MARKETING_VERSION = ${appPackage.version};`, 'iOS project');

const capacitorSource = read('mobile/capacitor/capacitor.config.ts');
if (/server\s*:\s*\{[^}]*\burl\s*:/s.test(capacitorSource)) errors.push('Capacitor source config contains server.url');
if (/allowMixedContent\s*:\s*true/.test(capacitorSource)) errors.push('Capacitor source config enables mixed content');
assertJsonConfig('mobile/capacitor/android/app/src/main/assets/capacitor.config.json');
assertJsonConfig('mobile/capacitor/ios/App/App/capacitor.config.json');

for (const relativePath of [
  'mobile/capacitor/android/app/src/main/assets/public/index.html',
  'mobile/capacitor/ios/App/App/public/index.html',
  'mobile/capacitor/ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json',
  'mobile/capacitor/ios/App/App/Assets.xcassets/Splash.imageset/Contents.json',
]) {
  requireNonEmpty(relativePath);
}

for (const contentsPath of [
  'mobile/capacitor/ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json',
  'mobile/capacitor/ios/App/App/Assets.xcassets/Splash.imageset/Contents.json',
]) {
  try {
    const contents = JSON.parse(read(contentsPath));
    for (const image of contents.images ?? []) {
      if (image.filename) requireNonEmpty(path.join(path.dirname(contentsPath), image.filename));
    }
  } catch {
    // The non-empty check above reports the useful failure.
  }
}

const distIndexPath = absolute('dist/index.html');
if (fs.existsSync(distIndexPath)) {
  const distHash = crypto.createHash('sha256').update(fs.readFileSync(distIndexPath)).digest('hex');
  for (const relativePath of [
    'mobile/capacitor/android/app/src/main/assets/public/index.html',
    'mobile/capacitor/ios/App/App/public/index.html',
  ]) {
    const filePath = absolute(relativePath);
    if (fs.existsSync(filePath)) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
      if (hash !== distHash) errors.push(`${relativePath} is not the current dist/index.html`);
    }
  }
} else {
  errors.push('missing dist/index.html; run the release web build first');
}

function collectFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const ignoredDirectories = new Set(['build', '.gradle', 'DerivedData', 'Pods']);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  });
}

const packagedScripts = [
  ...collectFiles(absolute('mobile/capacitor/android/app/src/main/assets/public/assets')),
  ...collectFiles(absolute('mobile/capacitor/ios/App/App/public/assets')),
].filter((filePath) => filePath.endsWith('.js'));
if (!packagedScripts.some((filePath) => fs.readFileSync(filePath, 'utf8').includes(expectedRelay))) {
  errors.push(`packaged client does not contain the explicit relay ${expectedRelay}`);
}

for (const platformRoot of ['mobile/capacitor/android', 'mobile/capacitor/ios']) {
  for (const filePath of collectFiles(absolute(platformRoot))) {
    const name = path.basename(filePath);
    if (fs.statSync(filePath).size === 0 && !['.gitkeep', '.npmkeep', 'cordova.js', 'cordova_plugins.js'].includes(name)) {
      errors.push(`empty native source file ${path.relative(root, filePath)}`);
    }
  }
}

if (errors.length) {
  console.error('Native release validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Native release validation passed: Capacitor ${appPackage.version}, explicit relay ${expectedRelay}`);

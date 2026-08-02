import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const relayUrl = String(process.env.VITE_RELAY_URL ?? 'wss://wasteland-commons.vercel.app/api/ws').trim();

if (!/^wss:\/\//i.test(relayUrl)) {
  console.error(`A mobile release requires a WSS relay URL; received: ${relayUrl || '(empty)'}`);
  process.exit(1);
}

const result = spawnSync(npmCommand, ['run', 'build'], {
  cwd: repositoryRoot,
  env: { ...process.env, VITE_RELAY_URL: relayUrl },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);

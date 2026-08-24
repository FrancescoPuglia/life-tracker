import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  resolveDesktopBuildProfile,
  toNextDesktopEnvironment,
} from './desktop-build-profile.mjs';

const require = createRequire(import.meta.url);
const tauriCliEntry = require.resolve('@tauri-apps/cli/tauri.js');

export function resolveTauriCliInvocation({
  command,
  profileName,
  nodeExecutable = process.execPath,
  cliEntry = tauriCliEntry,
}) {
  if (command !== 'dev' && command !== 'build') {
    throw new Error('Tauri runner command must be exactly dev or build.');
  }
  if (profileName !== 'staging' && profileName !== 'production') {
    throw new Error('Tauri runner profile must be exactly staging or production.');
  }
  const args = [cliEntry, command];
  if (profileName === 'production') {
    args.push('--config', 'src-tauri/tauri.production.conf.json');
  }
  return { executable: nodeExecutable, args };
}

function assertWindowsTauriBinary() {
  if (process.platform !== 'win32' || process.arch !== 'x64') return;
  try {
    require.resolve('@tauri-apps/cli-win32-x64-msvc');
  } catch {
    throw new Error('Pinned Windows Tauri CLI binary 2.11.4 is not installed.');
  }
}

function main() {
  const [command, profileName] = process.argv.slice(2);
  const invocation = resolveTauriCliInvocation({ command, profileName });
  const profile = resolveDesktopBuildProfile(profileName, process.env);
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const environment = toNextDesktopEnvironment(profile, sourceCommit, process.env);
  environment.LIFE_TRACKER_DESKTOP_PROFILE = profileName;

  if (command === 'dev') {
    environment.TAURI_DESKTOP = 'false';
    environment.TAURI_DEV_HOST = '127.0.0.1';
  }

  assertWindowsTauriBinary();
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw new Error('The pinned Tauri CLI could not start.');
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}

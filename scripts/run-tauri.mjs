import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  resolveDesktopBuildProfile,
  toNextDesktopEnvironment,
} from './desktop-build-profile.mjs';

const [command, profileName] = process.argv.slice(2);
if (command !== 'dev' && command !== 'build') {
  throw new Error('Tauri runner command must be exactly dev or build.');
}

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

const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri',
);
const args = [command];
if (profileName === 'production') {
  args.push('--config', 'src-tauri/tauri.production.conf.json');
}

const result = spawnSync(executable, args, {
  cwd: process.cwd(),
  env: environment,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

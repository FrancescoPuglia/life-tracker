import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  resolveDesktopBuildProfile,
  toNextDesktopEnvironment,
} from './desktop-build-profile.mjs';

const commit = git(['rev-parse', 'HEAD']);
if (!/^[a-f0-9]{40}$/.test(commit)) {
  throw new Error('Desktop export requires an exact Git source commit.');
}
if (git(['status', '--porcelain', '--untracked-files=normal']) !== '') {
  throw new Error('Desktop export verification requires a clean committed source tree.');
}

const profile = resolveDesktopBuildProfile(
  process.env.LIFE_TRACKER_DESKTOP_PROFILE,
  process.env,
);
const buildEnvironment = toNextDesktopEnvironment(profile, commit, process.env);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

run(process.execPath, ['scripts/check-desktop-security.mjs'], buildEnvironment);
run(npmCommand, ['run', 'build'], buildEnvironment);
run(process.execPath, ['scripts/check-static-security.mjs', '--include-output'], buildEnvironment);

const exportedHtml = readFileSync('out/index.html', 'utf8');
const requiredMarkers = [
  `data-life-tracker-build="${commit}"`,
  `data-life-tracker-ai-backend="${profile.aiApiBaseUrl}"`,
  `data-life-tracker-environment="${profile.profileName}"`,
  'data-life-tracker-runtime="desktop"',
];
for (const marker of requiredMarkers) {
  if (!exportedHtml.includes(marker)) {
    throw new Error(`Desktop export is missing required public attestation: ${marker}`);
  }
}

console.log(
  `Desktop ${profile.profileName} export passed for ${commit} (${profile.productName}).`,
);

function git(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function run(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

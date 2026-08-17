import { execFileSync, spawnSync } from 'node:child_process';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
}).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) {
  throw new Error('Static export requires an exact Git source commit.');
}
const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
}).trim();
if (status !== '') {
  throw new Error('Static export verification requires a clean committed source tree.');
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['run', 'build'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    GITHUB_PAGES: 'true',
    NEXT_PUBLIC_BUILD_COMMIT: commit,
    OPENAI_API_KEY: '',
    NEXT_PUBLIC_OPENAI_API_KEY: '',
  },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

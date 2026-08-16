import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const includeOutput = process.argv.includes('--include-output');
const findings = [];

const browserSourcePatterns = [
  {
    label: 'legacy same-origin AI route',
    pattern: /\/api\/ai(?:\/|\b)/,
  },
  {
    label: 'legacy same-origin cloud voice route',
    pattern: /\/api\/voice\//,
  },
  {
    label: 'same-origin server route used by static browser source',
    pattern: /(?:fetch\s*\(\s*|["'`])\/?api\//,
  },
  {
    label: 'server provider secret name in browser source',
    pattern: /\b(?:OPENAI|ELEVENLABS)_API_KEY\b/,
  },
  {
    label: 'public provider-key environment variable',
    pattern: /\bNEXT_PUBLIC_(?:OPENAI|ELEVENLABS)[A-Z0-9_]*KEY\b/,
  },
  {
    label: 'provider key-shaped literal',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  },
  {
    label: 'OpenAI SDK runtime in browser source',
    pattern: /(?:\bfrom\s+['"]openai['"]|\brequire\(['"]openai['"]\)|\bnew\s+OpenAI\s*\()/,
  },
  {
    label: 'direct OpenAI API use in browser source',
    pattern: /(?:\bchat\.completions\b|\bresponses\.create\b|api\.openai\.com)/,
  },
];

const outputPatterns = [
  ...browserSourcePatterns,
  {
    label: 'private-key material in static output',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
];

scanTree(join(root, 'src'), browserSourcePatterns, {
  exclude: (path) => path.includes(`${join('src', 'app', 'api')}`),
  extensions: new Set(['.js', '.jsx', '.ts', '.tsx']),
});

const nextApiRoot = join(root, 'src', 'app', 'api');
if (existsSync(nextApiRoot)) {
  for (const path of listFiles(nextApiRoot)) {
    if (/\/route\.(?:js|jsx|ts|tsx)$/.test(path.replaceAll('\\', '/'))) {
      findings.push({
        file: relative(root, path),
        label: 'Next.js route handler remains in the static frontend',
      });
    }
  }
}

const workflowPath = join(root, '.github', 'workflows', 'deploy.yml');
if (existsSync(workflowPath)) {
  scanFile(workflowPath, [
    {
      label: 'server provider secret injected into static build workflow',
      pattern: /\bOPENAI_API_KEY\b/,
    },
  ]);
}

const legacyRoutePath = join(root, 'src', 'app', 'api', 'ai');
if (existsSync(legacyRoutePath) && listFiles(legacyRoutePath).length > 0) {
  findings.push({
    file: relative(root, legacyRoutePath),
    label: 'Next.js AI route remains in the static frontend',
  });
}

const legacyVoiceRoutePath = join(root, 'src', 'app', 'api', 'voice');
if (existsSync(legacyVoiceRoutePath) && listFiles(legacyVoiceRoutePath).length > 0) {
  findings.push({
    file: relative(root, legacyVoiceRoutePath),
    label: 'unauthenticated cloud voice route remains in the static frontend',
  });
}

validateRootDependencies();

validateConfiguredBackend();

scanTrackedSecrets();

if (includeOutput) {
  const outputPath = join(root, 'out');
  if (!existsSync(outputPath)) {
    findings.push({ file: 'out', label: 'static output directory is missing' });
  } else {
    scanTree(outputPath, outputPatterns, {
      extensions: new Set(['.html', '.js', '.json', '.map', '.txt']),
    });
  }
}

if (findings.length > 0) {
  console.error('Static frontend security check failed:');
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.label}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Static frontend security check passed${includeOutput ? ' (including out/)' : ''}.`);
}

function validateConfiguredBackend() {
  const configured = process.env.NEXT_PUBLIC_AI_API_BASE_URL?.trim();
  if (!configured) return;

  try {
    const url = new URL(configured);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
    if (url.username || url.password || url.search || url.hash) throw new Error();
    const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
    if (url.protocol === 'http:' && !loopback) {
      findings.push({
        file: 'NEXT_PUBLIC_AI_API_BASE_URL',
        label: 'non-loopback backend URLs must use HTTPS',
      });
    }
    if (
      process.env.GITHUB_PAGES === 'true'
      && (url.protocol !== 'https:' || loopback)
    ) {
      findings.push({
        file: 'NEXT_PUBLIC_AI_API_BASE_URL',
        label: 'GitHub Pages backend URL must be a public HTTPS URL',
      });
    }
  } catch {
    findings.push({
      file: 'NEXT_PUBLIC_AI_API_BASE_URL',
      label: 'backend URL must be an absolute HTTP(S) URL without credentials, query, or fragment',
    });
  }
}

function validateRootDependencies() {
  const packagePath = join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (manifest.dependencies?.openai || manifest.devDependencies?.openai) {
    findings.push({
      file: 'package.json',
      label: 'OpenAI SDK belongs in the backend Functions package, not the static frontend package',
    });
  }
}

/**
 * Scan only Git-tracked files. This deliberately never opens ignored local
 * secret files such as .env.local. Patterns are intentionally high confidence;
 * normal Firebase Web configuration is public product configuration and is not
 * treated as a credential.
 */
function scanTrackedSecrets() {
  let trackedOutput = '';
  try {
    trackedOutput = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
    });
  } catch (error) {
    // Some managed sandboxes deny the spawn after Git has returned successful
    // stdout. Preserve that read-only result instead of weakening the scan.
    if (typeof error?.stdout !== 'string' || !error.stdout) throw error;
    trackedOutput = error.stdout;
  }
  const tracked = trackedOutput.split('\0').filter(Boolean);
  const secretPatterns = [
    {
      label: 'OpenAI API key-shaped credential in tracked content',
      pattern: /\bsk-(?:proj-)?(?!(?:YOUR_KEY_HERE|test-|fake-|example-))[A-Za-z0-9_-]{20,}\b/i,
    },
    {
      label: 'private-key material in tracked content',
      pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    },
    {
      label: 'Firebase/Google service-account credential in tracked content',
      pattern: /["']type["']\s*:\s*["']service_account["']/,
    },
    {
      label: 'literal bearer JWT in tracked content',
      pattern: /\bBearer\s+eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    },
    {
      label: 'GitHub token-shaped credential in tracked content',
      pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    },
    {
      label: 'Slack token-shaped credential in tracked content',
      pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    },
    {
      label: 'AWS access-key-shaped credential in tracked content',
      pattern: /\bAKIA[0-9A-Z]{16}\b/,
    },
  ];

  for (const trackedPath of tracked) {
    const absolute = join(root, trackedPath);
    if (!existsSync(absolute) || statSync(absolute).size > 5_000_000) continue;
    const contents = readFileSync(absolute);
    if (contents.includes(0)) continue;
    const text = contents.toString('utf8');
    for (const { label, pattern } of secretPatterns) {
      if (pattern.test(text)) findings.push({ file: trackedPath, label });
    }
  }
}

function scanTree(directory, patterns, options = {}) {
  if (!existsSync(directory)) return;
  for (const path of listFiles(directory)) {
    if (options.exclude?.(path)) continue;
    if (options.extensions && !options.extensions.has(extname(path))) continue;
    scanFile(path, patterns);
  }
}

function scanFile(path, patterns) {
  const contents = readFileSync(path, 'utf8');
  for (const { label, pattern } of patterns) {
    if (pattern.test(contents)) {
      findings.push({ file: relative(root, path), label });
    }
  }
}

function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) files.push(...listFiles(path));
    else if (stats.isFile()) files.push(path);
  }
  return files;
}

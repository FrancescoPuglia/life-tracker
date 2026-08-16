import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtures = [
  {
    path: resolve(root, 'functions/.env.local'),
    contents: [
      'OPENAI_MODEL=e2e-model',
      'OPENAI_REASONING_EFFORT=none',
      'OPENAI_BASE_URL=http://127.0.0.1:8787/v1',
      'AI_ALLOWED_ORIGINS=http://127.0.0.1:3100',
      '',
    ].join('\n'),
  },
  {
    path: resolve(root, 'functions/.secret.local'),
    contents: [
      'OPENAI_API_KEY=e2e-fake-provider-key',
      'AI_CAPABILITY_SIGNING_SECRET=e2e-capability-signing-secret-at-least-thirty-two-bytes',
      '',
    ].join('\n'),
  },
];

for (const fixture of fixtures) {
  let current;
  try {
    current = await readFile(fixture.path, 'utf8');
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    await writeFile(fixture.path, fixture.contents, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    continue;
  }
  if (current !== fixture.contents) {
    throw new Error(
      'Refusing to overwrite existing local Functions configuration. '
      + 'Use an isolated checkout or replace it manually with the documented fake emulator-only values.',
    );
  }
}

console.log('Fake-only Functions emulator configuration is ready.');

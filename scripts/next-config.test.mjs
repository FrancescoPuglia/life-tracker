import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { normalize } from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const nextConfig = require('../next.config.js');

describe('cross-platform Next configuration', () => {
  it('resolves the private AI contract from reviewed repository source', () => {
    const config = nextConfig.webpack({
      resolve: { alias: { existing: '/existing-entry.js' } },
    });
    const entry = config.resolve.alias['@life-tracker/ai-contract'];

    assert.equal(config.resolve.alias.existing, '/existing-entry.js');
    assert.equal(
      normalize(entry).endsWith(normalize('packages/ai-contract/index.js')),
      true,
    );
    assert.equal(normalize(entry).includes(normalize('node_modules/@life-tracker')), false);
    assert.equal(existsSync(entry), true);
  });
});

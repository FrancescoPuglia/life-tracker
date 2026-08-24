import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveNpmCliInvocation } from './node-cli.mjs';

describe('Node CLI launcher', () => {
  it('runs npm through Node without a Windows command shim', () => {
    const invocation = resolveNpmCliInvocation(
      ['run', 'build'],
      { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' },
      'C:\\Program Files\\nodejs\\node.exe',
    );
    assert.equal(invocation.executable, 'C:\\Program Files\\nodejs\\node.exe');
    assert.deepEqual(invocation.args, [
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      'run',
      'build',
    ]);
    assert.equal(invocation.args.some((arg) => /\.(?:cmd|bat)$/i.test(arg)), false);
  });

  it('rejects missing, shim, newline, and non-string inputs', () => {
    assert.throws(() => resolveNpmCliInvocation([], {}), /unavailable or invalid/);
    assert.throws(
      () => resolveNpmCliInvocation([], { npm_execpath: 'C:\\npm.cmd' }),
      /unavailable or invalid/,
    );
    assert.throws(
      () => resolveNpmCliInvocation([], { npm_execpath: '/tmp/npm-cli.js\nextra' }),
      /unavailable or invalid/,
    );
    assert.throws(
      () => resolveNpmCliInvocation(['run', 7], { npm_execpath: '/usr/bin/npm-cli.js' }),
      /explicit strings/,
    );
  });
});

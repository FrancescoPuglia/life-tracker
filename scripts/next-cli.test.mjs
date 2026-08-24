import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveNextCliInvocation } from './next-cli.mjs';

describe('Next.js CLI launcher', () => {
  it('runs the pinned JavaScript entry through Node without a command shim', () => {
    const invocation = resolveNextCliInvocation(
      ['build'],
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\workspace\\node_modules\\next\\dist\\bin\\next',
    );
    assert.deepEqual(invocation, {
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\workspace\\node_modules\\next\\dist\\bin\\next', 'build'],
    });
    assert.equal(invocation.args.some((arg) => /\.(?:cmd|bat)$/i.test(arg)), false);
  });

  it('rejects non-string arguments', () => {
    assert.throws(
      () => resolveNextCliInvocation(['build', 7]),
      /explicit strings/,
    );
  });
});

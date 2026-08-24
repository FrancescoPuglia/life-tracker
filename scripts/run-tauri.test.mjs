import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveTauriCliInvocation } from './run-tauri.mjs';

const WINDOWS_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const CLI_ENTRY = 'C:\\workspace\\node_modules\\@tauri-apps\\cli\\tauri.js';

describe('Tauri CLI launcher', () => {
  it('runs the JavaScript entry with Node and never executes a command shim', () => {
    const invocation = resolveTauriCliInvocation({
      command: 'build',
      profileName: 'staging',
      nodeExecutable: WINDOWS_NODE,
      cliEntry: CLI_ENTRY,
    });

    assert.equal(invocation.executable, WINDOWS_NODE);
    assert.deepEqual(invocation.args, [CLI_ENTRY, 'build']);
    assert.equal(invocation.args.some((arg) => /\.(?:cmd|bat)$/i.test(arg)), false);
  });

  it('keeps production config arguments discrete and rejects ambiguous input', () => {
    const invocation = resolveTauriCliInvocation({
      command: 'build',
      profileName: 'production',
      nodeExecutable: WINDOWS_NODE,
      cliEntry: CLI_ENTRY,
    });
    assert.deepEqual(invocation.args, [
      CLI_ENTRY,
      'build',
      '--config',
      'src-tauri/tauri.production.conf.json',
    ]);
    assert.throws(
      () => resolveTauriCliInvocation({ command: 'shell', profileName: 'staging' }),
      /exactly dev or build/,
    );
    assert.throws(
      () => resolveTauriCliInvocation({ command: 'build', profileName: 'preview' }),
      /exactly staging or production/,
    );
  });
});

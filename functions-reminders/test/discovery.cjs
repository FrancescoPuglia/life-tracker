'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

async function main() {
  const functionsRoot = path.resolve(__dirname, '..');
  const sdkEntry = require.resolve('firebase-functions');
  const loaderPath = path.resolve(path.dirname(sdkEntry), '..', 'runtime', 'loader.js');
  const { loadStack } = require(loaderPath);
  const stack = await loadStack(functionsRoot);
  const expected = [
    'desktopReminderApi',
    'reconcileNotificationPreferenceReminders',
    'reconcileTimeBlockReminders',
    'reconcileUserProfileReminders',
  ];
  const names = Object.keys(stack.endpoints ?? {}).sort();
  assert.deepEqual(names, [...expected].sort(), 'native reminder endpoint surface changed');
  assert.equal((stack.params ?? []).length, 0, 'native reminder codebase declared a runtime parameter');
  assert.equal((stack.requiredRoles ?? []).length, 0, 'native reminder codebase declared a custom role');

  for (const name of expected) {
    const endpoint = stack.endpoints[name];
    assert.ok(endpoint, `${name} is missing`);
    assert.deepEqual(endpoint.secretEnvironmentVariables ?? [], [], `${name} binds a secret`);
    assert.equal(endpoint.taskQueueTrigger, undefined, `${name} exposes a task queue`);
    assert.equal(endpoint.scheduleTrigger, undefined, `${name} exposes a scheduler`);
  }

  const requiredApis = (stack.requiredAPIs ?? []).map((entry) => entry.api).sort();
  assert.ok(!requiredApis.includes('cloudtasks.googleapis.com'), 'Cloud Tasks API is required');
  assert.ok(!requiredApis.includes('cloudscheduler.googleapis.com'), 'Cloud Scheduler API is required');

  const bundle = readFileSync(path.resolve(functionsRoot, 'lib/index.js'));
  const bundleSha256 = createHash('sha256').update(bundle).digest('hex');
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    endpoints: names,
    params: 0,
    secrets: 0,
    taskQueues: 0,
    schedulers: 0,
    requiredApis,
    bundleBytes: bundle.byteLength,
    bundleSha256,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Native reminder discovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

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
  const endpointNames = Object.keys(stack.endpoints ?? {}).sort();
  assert.deepEqual(endpointNames, ['lifeTrackerMcp'], 'MCP endpoint surface changed');
  assert.equal((stack.requiredRoles ?? []).length, 0, 'MCP codebase declared a custom role');

  const endpoint = stack.endpoints.lifeTrackerMcp;
  assert.ok(endpoint, 'MCP endpoint is missing');
  assert.equal(endpoint.platform, 'gcfv2', 'MCP platform changed');
  assert.equal(endpoint.httpsTrigger?.invoker?.includes('public'), true, 'MCP public invoker changed');
  assert.deepEqual(endpoint.secretEnvironmentVariables ?? [], [], 'MCP endpoint binds a secret');
  assert.equal(endpoint.taskQueueTrigger, undefined, 'MCP endpoint exposes a task queue');
  assert.equal(endpoint.scheduleTrigger, undefined, 'MCP endpoint exposes a scheduler');
  assert.equal(endpoint.eventTrigger, undefined, 'MCP endpoint exposes an event trigger');

  const params = (stack.params ?? []).map((entry) => entry.name).sort();
  const expectedParams = [
    'MCP_CANONICAL_BASE_URL',
    'MCP_FIREBASE_WEB_CONFIG',
    'MCP_OWNER_UID',
    'MCP_READ_RUNTIME_ENABLED',
  ];
  assert.deepEqual(params, expectedParams, 'MCP runtime parameter surface changed');

  const requiredApis = (stack.requiredAPIs ?? []).map((entry) => entry.api).sort();
  assert.deepEqual(requiredApis, [], 'MCP codebase required API surface changed');

  const bundle = readFileSync(path.resolve(functionsRoot, 'lib/index.js'));
  const bundleText = bundle.toString('utf8');
  for (const excluded of [
    'AI_ALLOWED_ORIGINS',
    'AI_CAPABILITY_SIGNING_SECRET',
    'deliverScheduledScientificReports',
    'desktopReminderApi',
    'lifeTrackerAiApi',
    'OPENAI_API_KEY',
    'reconcileScientificReportSchedules',
    'REMINDER_WHATSAPP_ENABLED',
    'RESEND_API_KEY',
    'TWILIO_AUTH_TOKEN',
  ]) {
    assert.equal(bundleText.includes(excluded), false, `MCP bundle contains excluded symbol ${excluded}`);
  }
  const bundleSha256 = createHash('sha256').update(bundle).digest('hex');
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    endpoints: endpointNames,
    params,
    secrets: 0,
    taskQueues: 0,
    schedulers: 0,
    requiredApis,
    bundleBytes: bundle.byteLength,
    bundleSha256,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`MCP discovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

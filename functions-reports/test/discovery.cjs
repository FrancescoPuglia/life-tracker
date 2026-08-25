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
  const expectedEndpoints = [
    'deliverScheduledScientificReports',
    'reconcileScientificReportSchedules',
  ];
  const endpointNames = Object.keys(stack.endpoints ?? {}).sort();
  assert.deepEqual(endpointNames, expectedEndpoints, 'report endpoint surface changed');
  assert.equal((stack.requiredRoles ?? []).length, 0, 'report codebase declared a custom role');

  const preference = stack.endpoints.reconcileScientificReportSchedules;
  assert.ok(preference, 'report preference trigger is missing');
  assert.equal(
    preference.eventTrigger?.eventType,
    'google.cloud.firestore.document.v1.written',
    'report preference trigger type changed',
  );
  assert.deepEqual(preference.secretEnvironmentVariables ?? [], [], 'preference trigger binds a secret');
  assert.equal(preference.taskQueueTrigger, undefined, 'preference trigger exposes a task queue');
  assert.equal(preference.scheduleTrigger, undefined, 'preference trigger exposes a scheduler');

  const scheduled = stack.endpoints.deliverScheduledScientificReports;
  assert.ok(scheduled, 'scheduled report endpoint is missing');
  assert.equal(scheduled.scheduleTrigger?.schedule, '*/5 * * * *', 'report cadence changed');
  assert.deepEqual(
    scheduled.secretEnvironmentVariables ?? [],
    [{ key: 'RESEND_API_KEY' }, { key: 'OPENAI_API_KEY' }],
    'scheduled report secret bindings changed',
  );
  assert.equal(scheduled.taskQueueTrigger, undefined, 'scheduled report endpoint exposes a task queue');
  assert.equal(scheduled.eventTrigger, undefined, 'scheduled report endpoint exposes an event trigger');

  const params = (stack.params ?? []).map((entry) => entry.name).sort();
  const expectedParams = [
    'AI_MODEL_ROUTING_CONFIG',
    'AI_MODEL_ROUTING_ENABLED',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'REPORT_EMAIL_FROM_ADDRESS',
    'REPORT_EMAIL_FROM_NAME',
    'REPORT_EMAIL_OWNER_UID',
    'REPORT_EMAIL_RUNTIME_ENABLED',
    'RESEND_API_KEY',
  ].sort();
  assert.deepEqual(params, expectedParams, 'report runtime parameter surface changed');

  const requiredApis = (stack.requiredAPIs ?? []).map((entry) => entry.api).sort();
  assert.deepEqual(
    requiredApis,
    ['cloudscheduler.googleapis.com'],
    'report codebase required API surface changed',
  );

  const bundle = readFileSync(path.resolve(functionsRoot, 'lib/index.js'));
  const bundleText = bundle.toString('utf8');
  for (const excluded of [
    'AI_ALLOWED_ORIGINS',
    'AI_CAPABILITY_SIGNING_SECRET',
    'lifeTrackerAiApi',
    'lifeTrackerMcp',
    'MCP_READ_RUNTIME_ENABLED',
    'OPENAI_MODEL',
    'OPENAI_REASONING_EFFORT',
    'REMINDER_WHATSAPP_ENABLED',
    'TWILIO_AUTH_TOKEN',
    'cloudtasks.googleapis.com',
  ]) {
    assert.equal(bundleText.includes(excluded), false, `report bundle contains excluded symbol ${excluded}`);
  }
  const bundleSha256 = createHash('sha256').update(bundle).digest('hex');
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    endpoints: endpointNames,
    params,
    secrets: {
      deliverScheduledScientificReports: ['RESEND_API_KEY', 'OPENAI_API_KEY'],
      reconcileScientificReportSchedules: [],
    },
    taskQueues: 0,
    schedulers: 1,
    requiredApis,
    bundleBytes: bundle.byteLength,
    bundleSha256,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Report discovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

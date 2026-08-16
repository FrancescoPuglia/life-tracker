'use strict';

const LIFE_PLAN_ACTIONS = Object.freeze(['create', 'update', 'move', 'delete']);
const LIFE_PLAN_STATUSES = Object.freeze(['previewed', 'applied', 'rolled_back']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENTITY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const CAPABILITY = /^[A-Za-z0-9_-]{32,512}$/;

function parseLifePlanPreview(value) {
  assertPayloadSize(value, 'plan');
  const plan = record(value, 'plan');
  exact(plan, [
    'id', 'tool', 'createdAt', 'expiresAt', 'baseStateHash', 'hash', 'status',
    'operations', 'diff', 'reason', 'warnings', 'conflicts', 'assumptions',
    'expectedImpact', 'destructiveOperationCount', 'approval',
  ], 'plan');
  const operations = array(plan.operations, 'plan.operations', 100).map(parseOperation);
  const diff = array(plan.diff, 'plan.diff', 100).map(parseDiff);
  if (operations.length !== diff.length || operations.length < 1) invalid('plan operations');
  const approval = record(plan.approval, 'plan.approval');
  exact(approval, ['required', 'capability', 'expiresAt'], 'plan.approval');
  if (approval.required !== true || !CAPABILITY.test(approval.capability)) invalid('plan approval');
  const result = {
    id: id(plan.id, 'plan.id'),
    tool: text(plan.tool, 'plan.tool', 100),
    createdAt: instant(plan.createdAt, 'plan.createdAt'),
    expiresAt: instant(plan.expiresAt, 'plan.expiresAt'),
    baseStateHash: hash(plan.baseStateHash, 'plan.baseStateHash'),
    hash: hash(plan.hash, 'plan.hash'),
    status: enumValue(plan.status, LIFE_PLAN_STATUSES, 'plan.status'),
    operations,
    diff,
    reason: text(plan.reason, 'plan.reason', 500),
    warnings: notices(plan.warnings, 'plan.warnings'),
    conflicts: notices(plan.conflicts, 'plan.conflicts'),
    assumptions: notices(plan.assumptions, 'plan.assumptions'),
    expectedImpact: notices(plan.expectedImpact, 'plan.expectedImpact'),
    destructiveOperationCount: integer(plan.destructiveOperationCount, 0, 100, 'plan.destructiveOperationCount'),
    approval: {
      required: true,
      capability: approval.capability,
      expiresAt: instant(approval.expiresAt, 'plan.approval.expiresAt'),
    },
  };
  if (result.approval.expiresAt !== result.expiresAt) invalid('plan.approval.expiresAt');
  if (result.destructiveOperationCount !== operations.filter((item) => item.action === 'delete').length) {
    invalid('plan.destructiveOperationCount');
  }
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const change = diff[index];
    if (
      !operation || !change
      || operation.action !== change.action
      || operation.entityType !== change.entityType
      || operation.entityId !== change.entityId
    ) invalid(`plan.diff[${index}]`);
  }
  return result;
}

function parseLifePlanActionResponse(value) {
  assertPayloadSize(value, 'response');
  const response = record(value, 'response');
  exact(response, [
    'message', 'executionId', 'planId', 'hash', 'status', 'idempotentReplay',
    'verified', 'receipt', 'rollback', 'requestId',
  ], 'response');
  const receipt = parseReceipt(response.receipt);
  const rollback = response.rollback === undefined
    ? undefined
    : parseRollback(response.rollback);
  const result = {
    message: text(response.message, 'response.message', 20000),
    executionId: id(response.executionId, 'response.executionId'),
    planId: id(response.planId, 'response.planId'),
    hash: hash(response.hash, 'response.hash'),
    status: enumValue(response.status, ['applied', 'rolled_back'], 'response.status'),
    idempotentReplay: boolean(response.idempotentReplay, 'response.idempotentReplay'),
    verified: boolean(response.verified, 'response.verified'),
    receipt,
    ...(response.requestId === undefined ? {} : { requestId: id(response.requestId, 'response.requestId') }),
    ...(rollback ? { rollback } : {}),
  };
  if (
    result.executionId !== receipt.executionId
    || result.planId !== receipt.planId
    || result.hash !== receipt.changesetHash
    || result.status !== receipt.status
    || result.verified !== receipt.verified
  ) invalid('response receipt consistency');
  if (result.status === 'applied' && receipt.rollbackAvailable !== Boolean(rollback)) {
    invalid('response.rollback');
  }
  if (result.status === 'rolled_back' && rollback) invalid('response.rollback');
  return result;
}

function parseOperation(value) {
  const operation = record(value, 'operation');
  exact(operation, ['action', 'entityType', 'entityId'], 'operation');
  return {
    action: enumValue(operation.action, LIFE_PLAN_ACTIONS, 'operation.action'),
    entityType: entity(operation.entityType, 'operation.entityType'),
    entityId: id(operation.entityId, 'operation.entityId'),
  };
}

function parseDiff(value) {
  const diff = record(value, 'diff');
  exact(diff, [
    'action', 'entityType', 'entityId', 'summary', 'title', 'changedFields',
    'before', 'after',
  ], 'diff');
  return {
    action: enumValue(diff.action, LIFE_PLAN_ACTIONS, 'diff.action'),
    entityType: entity(diff.entityType, 'diff.entityType'),
    entityId: id(diff.entityId, 'diff.entityId'),
    summary: text(diff.summary, 'diff.summary', 500),
    title: diff.title === null ? null : text(diff.title, 'diff.title', 120),
    changedFields: array(diff.changedFields, 'diff.changedFields', 30)
      .map((field) => fieldName(field, 'diff.changedFields')),
    before: nullableRecord(diff.before, 'diff.before'),
    after: nullableRecord(diff.after, 'diff.after'),
  };
}

function parseReceipt(value) {
  const receipt = record(value, 'receipt');
  exact(receipt, [
    'executionId', 'planId', 'changesetHash', 'status', 'verified', 'timestamp',
    'affected', 'rollbackAvailable', 'rollbackExpiresAt',
  ], 'receipt');
  return {
    executionId: id(receipt.executionId, 'receipt.executionId'),
    planId: id(receipt.planId, 'receipt.planId'),
    changesetHash: hash(receipt.changesetHash, 'receipt.changesetHash'),
    status: enumValue(receipt.status, ['applied', 'rolled_back'], 'receipt.status'),
    verified: boolean(receipt.verified, 'receipt.verified'),
    timestamp: instant(receipt.timestamp, 'receipt.timestamp'),
    affected: array(receipt.affected, 'receipt.affected', 100).map((value) => {
      const reference = record(value, 'receipt.affected[]');
      exact(reference, ['collection', 'id'], 'receipt.affected[]');
      return {
        collection: entity(reference.collection, 'receipt.affected.collection'),
        id: id(reference.id, 'receipt.affected.id'),
      };
    }),
    rollbackAvailable: boolean(receipt.rollbackAvailable, 'receipt.rollbackAvailable'),
    rollbackExpiresAt: receipt.rollbackExpiresAt === null
      ? null
      : instant(receipt.rollbackExpiresAt, 'receipt.rollbackExpiresAt'),
  };
}

function parseRollback(value) {
  const rollback = record(value, 'rollback');
  exact(rollback, ['capability', 'expiresAt'], 'rollback');
  if (!CAPABILITY.test(rollback.capability)) invalid('rollback.capability');
  return {
    capability: rollback.capability,
    expiresAt: instant(rollback.expiresAt, 'rollback.expiresAt'),
  };
}

function notices(value, path) {
  return array(value, path, 20).map((item) => text(item, `${path}[]`, 500));
}

function nullableRecord(value, path) {
  if (value === null) return null;
  const result = record(value, path);
  validateJsonValue(result, path, 0);
  return result;
}

function assertPayloadSize(value, path) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    invalid(`${path} serialization`);
  }
  if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > 512 * 1024) {
    invalid(`${path} size`);
  }
}

function validateJsonValue(value, path, depth) {
  if (depth > 8) invalid(`${path} depth`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 8_000) invalid(`${path} string`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) invalid(`${path} array`);
    value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  const object = record(value, path);
  const entries = Object.entries(object);
  if (entries.length > 100) invalid(`${path} properties`);
  for (const [key, nested] of entries) {
    if (!key || key.length > 100 || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      invalid(`${path} key`);
    }
    validateJsonValue(nested, `${path}.${key}`, depth + 1);
  }
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid(path);
  return value;
}

function exact(value, allowed, path) {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) invalid(`${path} properties`);
}

function array(value, path, max) {
  if (!Array.isArray(value) || value.length > max) invalid(path);
  return value;
}

function text(value, path, max) {
  if (typeof value !== 'string') invalid(path);
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!normalized || normalized.length > max) invalid(path);
  return normalized;
}

function id(value, path) {
  if (typeof value !== 'string' || !ID.test(value)) invalid(path);
  return value;
}

function entity(value, path) {
  if (typeof value !== 'string' || !ENTITY.test(value)) invalid(path);
  return value;
}

function fieldName(value, path) {
  if (typeof value !== 'string' || !FIELD.test(value)) invalid(path);
  return value;
}

function hash(value, path) {
  if (typeof value !== 'string' || !HASH.test(value)) invalid(path);
  return value;
}

function instant(value, path) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(path);
  return value;
}

function integer(value, min, max, path) {
  if (!Number.isInteger(value) || value < min || value > max) invalid(path);
  return value;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') invalid(path);
  return value;
}

function enumValue(value, allowed, path) {
  if (!allowed.includes(value)) invalid(path);
  return value;
}

function invalid(path) {
  throw new TypeError(`Invalid Life Tracker AI contract at ${path}.`);
}

module.exports = {
  LIFE_PLAN_ACTIONS,
  LIFE_PLAN_STATUSES,
  parseLifePlanPreview,
  parseLifePlanActionResponse,
};

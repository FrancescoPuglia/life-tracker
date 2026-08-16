import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'demo-life-tracker-rules';
const DEFAULT_EMULATOR_HOST = '127.0.0.1';
const DEFAULT_EMULATOR_PORT = 8080;

const CLIENT_COLLECTIONS = [
  'domains',
  'goals',
  'keyResults',
  'projects',
  'tasks',
  'timeBlocks',
  'sessions',
  'habits',
  'habitLogs',
  'metrics',
  'calendarEvents',
  'deadlines',
  'journalEntries',
  'insights',
  'achievements',
  'notes',
  'noteTemplates',
  'goalRoadmaps',
  'visionBoards',
  'visionItems',
  'mediaAssets',
  'pages',
] as const;

const SERVER_ONLY_COLLECTIONS = [
  'aiChangePlans',
  'aiSnapshots',
  'aiAuditLogs',
  'aiIdempotency',
  'aiRateLimits',
] as const;

const FORBIDDEN_CLIENT_FIELDS = [
  'ownerId',
  'ownerUid',
  'actorUid',
  '_version',
  '_aiPlanId',
  '_aiVersion',
  'serverVersion',
] as const;

function emulatorAddress(): { host: string; port: number } {
  const configured = process.env.FIRESTORE_EMULATOR_HOST;
  if (!configured) {
    return { host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT };
  }

  const separator = configured.lastIndexOf(':');
  if (separator === -1) {
    return { host: configured, port: DEFAULT_EMULATOR_PORT };
  }

  return {
    host: configured.slice(0, separator),
    port: Number(configured.slice(separator + 1)),
  };
}

function ownedEntity(uid: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId: uid,
    title: `Entity ${id}`,
    createdAt: new Date('2026-08-10T08:00:00.000Z'),
    updatedAt: new Date('2026-08-10T08:00:00.000Z'),
    ...extra,
  };
}

function entityForCollection(name: string, uid: string, id: string) {
  if (name === 'timeBlocks') {
    return ownedEntity(uid, id, {
      startTime: new Date('2026-08-10T08:00:00.000Z'),
      endTime: new Date('2026-08-10T09:00:00.000Z'),
      status: 'planned',
      type: 'work',
    });
  }

  return ownedEntity(uid, id);
}

describe('Firestore user isolation rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    const { host, port } = emulatorAddress();
    const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { host, port, rules },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  it('denies unauthenticated reads and writes', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const goal = doc(db, 'users/alice/goals/goal-1');

    await assertFails(getDoc(goal));
    await assertFails(setDoc(goal, ownedEntity('alice', 'goal-1')));
  });

  it('allows an authenticated user to complete a representative CRUD flow', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    const goal = doc(db, 'users/alice/goals/goal-1');

    await assertSucceeds(setDoc(goal, ownedEntity('alice', 'goal-1')));
    await assertSucceeds(getDoc(goal));
    await assertSucceeds(getDocs(collection(db, 'users/alice/goals')));
    await assertSucceeds(updateDoc(goal, {
      title: 'Updated goal',
      updatedAt: new Date('2026-08-10T09:00:00.000Z'),
    }));

    const updated = await getDoc(goal);
    expect(updated.data()?.title).toBe('Updated goal');
    await assertSucceeds(deleteDoc(goal));
  });

  it.each(CLIENT_COLLECTIONS)('allows owned documents in the %s allowlist', async (name) => {
    const db = testEnv.authenticatedContext('alice').firestore();
    const id = `${name}-1`;
    const entity = doc(db, 'users', 'alice', name, id);

    await assertSucceeds(setDoc(entity, entityForCollection(name, 'alice', id)));
    await assertSucceeds(getDoc(entity));
  });

  it('denies unknown collections and nested documents', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();

    await assertFails(setDoc(
      doc(db, 'users/alice/arbitrary/document-1'),
      ownedEntity('alice', 'document-1'),
    ));
    await assertFails(setDoc(
      doc(db, 'users/alice/users/profile-1'),
      ownedEntity('alice', 'profile-1'),
    ));
    await assertFails(setDoc(
      doc(db, 'users/alice/goals/goal-1/private/document-1'),
      ownedEntity('alice', 'document-1'),
    ));
    await assertFails(setDoc(
      doc(db, 'unscoped/document-1'),
      ownedEntity('alice', 'document-1'),
    ));
  });

  it('isolates data from a different authenticated user', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users/alice/tasks/task-1'),
        ownedEntity('alice', 'task-1'),
      );
    });

    const bobDb = testEnv.authenticatedContext('bob').firestore();
    const aliceTask = doc(bobDb, 'users/alice/tasks/task-1');

    await assertFails(getDoc(aliceTask));
    await assertFails(updateDoc(aliceTask, { title: 'Taken over' }));
    await assertFails(deleteDoc(aliceTask));
    await assertFails(setDoc(
      doc(bobDb, 'users/alice/tasks/task-2'),
      ownedEntity('bob', 'task-2'),
    ));
  });

  it('does not expose a path-local document with a mismatched embedded owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users/alice/tasks/misowned-task'),
        ownedEntity('bob', 'misowned-task'),
      );
    });

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(aliceDb, 'users/alice/tasks/misowned-task')));
    await assertFails(getDocs(collection(aliceDb, 'users/alice/tasks')));
  });

  it('rejects spoofed owner fields and a mismatched document id', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();

    await assertFails(setDoc(
      doc(db, 'users/alice/tasks/task-without-owner'),
      { id: 'task-without-owner', title: 'Missing owner' },
    ));
    await assertFails(setDoc(
      doc(db, 'users/alice/tasks/task-1'),
      ownedEntity('bob', 'task-1'),
    ));
    await assertFails(setDoc(
      doc(db, 'users/alice/tasks/task-2'),
      ownedEntity('alice', 'task-2', { uid: 'bob' }),
    ));
    await assertFails(setDoc(
      doc(db, 'users/alice/tasks/task-3'),
      ownedEntity('alice', 'different-id'),
    ));
  });

  it.each(FORBIDDEN_CLIENT_FIELDS)(
    'rejects client-controlled sensitive field %s on create and update',
    async (field) => {
      const db = testEnv.authenticatedContext('alice').firestore();
      const id = `task-${field}`;
      const task = doc(db, 'users', 'alice', 'tasks', id);

      await assertFails(setDoc(task, ownedEntity('alice', id, {
        [field]: field.includes('Version') ? 1 : 'alice',
      })));

      await assertSucceeds(setDoc(task, ownedEntity('alice', id)));
      await assertFails(updateDoc(task, {
        [field]: field.includes('Version') ? 1 : 'alice',
      }));
    },
  );

  it('keeps ownership, identity, and creation time immutable', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    const task = doc(db, 'users/alice/tasks/task-1');
    await setDoc(task, ownedEntity('alice', 'task-1', { uid: 'alice' }));

    await assertFails(updateDoc(task, { userId: 'bob' }));
    await assertFails(updateDoc(task, { uid: 'bob' }));
    await assertFails(updateDoc(task, { id: 'task-2' }));
    await assertFails(updateDoc(task, {
      createdAt: new Date('2026-08-11T08:00:00.000Z'),
    }));
    await assertSucceeds(updateDoc(task, {
      title: 'Safe update',
      updatedAt: new Date('2026-08-10T10:00:00.000Z'),
    }));
  });

  it('validates time block intervals and scheduling enums on create and update', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    const timeBlock = doc(db, 'users/alice/timeBlocks/time-block-1');
    const valid = entityForCollection('timeBlocks', 'alice', 'time-block-1');

    await assertSucceeds(setDoc(timeBlock, valid));
    await assertFails(updateDoc(timeBlock, {
      endTime: new Date('2026-08-10T07:59:00.000Z'),
    }));
    await assertFails(updateDoc(timeBlock, { status: 'draft' }));
    await assertFails(updateDoc(timeBlock, { type: 'deep_work' }));
    await assertFails(setDoc(
      doc(db, 'users/alice/timeBlocks/time-block-2'),
      ownedEntity('alice', 'time-block-2', {
        startTime: new Date('2026-08-10T09:00:00.000Z'),
        endTime: new Date('2026-08-10T08:00:00.000Z'),
        status: 'planned',
        type: 'work',
      }),
    ));
    await assertSucceeds(updateDoc(timeBlock, {
      endTime: new Date('2026-08-10T09:30:00.000Z'),
      status: 'in_progress',
      type: 'focus',
    }));
  });

  it('rejects malformed or negative critical numeric fields', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    const task = doc(db, 'users/alice/tasks/task-1');

    await assertFails(setDoc(task, ownedEntity('alice', 'task-1', {
      estimatedMinutes: -1,
    })));
    await assertSucceeds(setDoc(task, ownedEntity('alice', 'task-1', {
      estimatedMinutes: 30,
    })));
    await assertFails(updateDoc(task, { actualMinutes: -10 }));
    await assertFails(updateDoc(task, { estimatedMinutes: 'thirty' }));
    await assertSucceeds(updateDoc(task, { actualMinutes: 10 }));
  });

  it('supports legacy ownerless documents without allowing ownership claims', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice/notes/legacy-note'), {
        id: 'legacy-note',
        title: 'Legacy note',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const legacyNote = doc(aliceDb, 'users/alice/notes/legacy-note');
    await assertSucceeds(getDoc(legacyNote));
    await assertSucceeds(updateDoc(legacyNote, {
      title: 'Still ownerless',
      updatedAt: new Date('2026-08-10T10:00:00.000Z'),
    }));
    await assertFails(updateDoc(legacyNote, { userId: 'alice' }));

    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertFails(getDoc(doc(bobDb, 'users/alice/notes/legacy-note')));
  });

  it('allows exactly one login streak document whose id is the owner uid', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    const ownStreak = doc(db, 'users/alice/login_streaks/alice');

    await assertSucceeds(setDoc(ownStreak, ownedEntity('alice', 'alice', {
      currentStreak: 1,
      lastLoginDate: '2026-08-10',
    })));
    await assertSucceeds(updateDoc(ownStreak, {
      currentStreak: 2,
      updatedAt: new Date('2026-08-11T08:00:00.000Z'),
    }));
    await assertFails(setDoc(
      doc(db, 'users/alice/login_streaks/extra-streak'),
      ownedEntity('alice', 'extra-streak'),
    ));
  });

  it.each(SERVER_ONLY_COLLECTIONS)(
    'denies all client access to the server-only %s namespace',
    async (name) => {
      const db = testEnv.authenticatedContext('alice').firestore();
      const rootDocument = doc(db, name, 'server-document');
      const nestedDocument = doc(db, 'users', 'alice', name, 'server-document');

      await assertFails(getDoc(rootDocument));
      await assertFails(setDoc(rootDocument, { actorUid: 'alice' }));
      await assertFails(getDoc(nestedDocument));
      await assertFails(setDoc(
        nestedDocument,
        ownedEntity('alice', 'server-document'),
      ));
    },
  );
});

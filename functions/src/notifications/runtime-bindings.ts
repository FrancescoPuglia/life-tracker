import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import * as functionsLogger from 'firebase-functions/logger';
import {
  CLOUD_TASK_SAFE_SCHEDULE_HORIZON_MS,
  createFirebaseReminderTaskQueue,
} from './cloud-tasks-queue';
import type {
  ReminderDeliveryRepository,
  MessagingProvider,
  ProviderDeliveryStatusRepository,
} from './delivery';
import { ReminderDeliveryService } from './delivery-service';
import { FirestoreReminderRepository } from './firestore-repository';
import { ReminderReconciliationService } from './reconciliation-service';
import {
  createDeferredReminderRefillFunction,
  createNotificationPreferencesReminderReconciliationFunction,
  createTimeBlockReminderReconciliationFunction,
  createUserProfileReminderReconciliationFunction,
} from './reconciliation-trigger';
import type { ReminderReconciliationExecutor } from './reconciliation-trigger';
import {
  createPrivateReminderTaskFunction,
  type ReminderDeliveryExecutor,
} from './task-worker';
import {
  createTwilioSdkMessageCreator,
  createTwilioSignatureValidator,
  TwilioWhatsAppProvider,
  type TwilioMessageCreator,
  type TwilioWhatsAppContentMode,
  type TwilioWhatsAppProviderConfig,
} from './twilio-provider';
import {
  createLazyTwilioStatusCallbackFunction,
  type TwilioStatusCallbackDependencies,
} from './twilio-status-callback';

export interface RuntimeStringValue {
  value(): string;
}

export interface TwilioReminderRuntimeParameters {
  readonly enabled: RuntimeStringValue;
  readonly ownerUid: RuntimeStringValue;
  readonly accountSid: RuntimeStringValue;
  readonly authToken: RuntimeStringValue;
  readonly fromE164: RuntimeStringValue;
  readonly toE164: RuntimeStringValue;
  readonly statusCallbackBaseUrl: RuntimeStringValue;
  readonly contentMode: RuntimeStringValue;
  readonly contentSid: RuntimeStringValue;
}

export type TwilioMessageCreatorFactory = (
  accountSid: string,
  authToken: string,
) => TwilioMessageCreator;

const REMINDER_WHATSAPP_ENABLED = defineString('REMINDER_WHATSAPP_ENABLED', {
  default: 'false',
  description: 'Explicit kill switch. Only the exact value true permits WhatsApp runtime use.',
});
const REMINDER_OWNER_UID = defineString('REMINDER_OWNER_UID', {
  default: 'not-configured',
  description: 'Server-allowed Firebase UID for this private personal reminder deployment.',
});
const TWILIO_ACCOUNT_SID = defineString('TWILIO_ACCOUNT_SID', {
  default: 'not-configured',
  description: 'Non-secret Twilio Account SID used to bind sends and signed callbacks.',
});
const TWILIO_WHATSAPP_FROM_E164 = defineString('TWILIO_WHATSAPP_FROM_E164', {
  default: 'not-configured',
  description: 'Server-owned Twilio WhatsApp sender in E.164 form.',
});
const TWILIO_WHATSAPP_TO_E164 = defineString('TWILIO_WHATSAPP_TO_E164', {
  default: 'not-configured',
  description: 'Server-owned personal WhatsApp recipient in E.164 form.',
});
const TWILIO_STATUS_CALLBACK_BASE_URL = defineString('TWILIO_STATUS_CALLBACK_BASE_URL', {
  default: 'https://invalid.example/reminder-callback-not-configured',
  description: 'Exact canonical HTTPS URL of the deployed Twilio status callback.',
});
const TWILIO_WHATSAPP_CONTENT_MODE = defineString('TWILIO_WHATSAPP_CONTENT_MODE', {
  default: 'session_text',
  description: 'WhatsApp content mode: session_text for Sandbox or content_template after approval.',
});
const TWILIO_WHATSAPP_CONTENT_SID = defineString('TWILIO_WHATSAPP_CONTENT_SID', {
  default: 'not-configured',
  description: 'Approved Twilio Content SID; read only when content_template mode is selected.',
});
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN', {
  description: 'Backend-only Twilio auth token for API calls and webhook signature validation.',
});

const runtimeParameters: TwilioReminderRuntimeParameters = Object.freeze({
  enabled: REMINDER_WHATSAPP_ENABLED,
  ownerUid: REMINDER_OWNER_UID,
  accountSid: TWILIO_ACCOUNT_SID,
  authToken: TWILIO_AUTH_TOKEN,
  fromE164: TWILIO_WHATSAPP_FROM_E164,
  toE164: TWILIO_WHATSAPP_TO_E164,
  statusCallbackBaseUrl: TWILIO_STATUS_CALLBACK_BASE_URL,
  contentMode: TWILIO_WHATSAPP_CONTENT_MODE,
  contentSid: TWILIO_WHATSAPP_CONTENT_SID,
});

/** Reads and validates runtime/provider configuration only on first delivery. */
export function createLazyTwilioReminderDeliveryExecutor(
  repository: ReminderDeliveryRepository,
  parameters: TwilioReminderRuntimeParameters,
  createMessageCreator: TwilioMessageCreatorFactory = createTwilioSdkMessageCreator,
): ReminderDeliveryExecutor {
  let delivery: ReminderDeliveryService | undefined;
  return Object.freeze({
    deliver: async (input: Parameters<ReminderDeliveryExecutor['deliver']>[0]) => {
      if (!delivery) {
        const resolved = resolveTwilioRuntime(parameters);
        const client = createMessageCreator(resolved.accountSid, resolved.authToken);
        const provider: MessagingProvider = new TwilioWhatsAppProvider(client, resolved.provider);
        delivery = new ReminderDeliveryService(repository, provider);
      }
      return delivery.deliver(input);
    },
  });
}

/** Reads callback parameters/secrets only from inside an actual HTTP invocation. */
export function resolveTwilioStatusCallbackDependencies(
  repository: ProviderDeliveryStatusRepository,
  parameters: TwilioReminderRuntimeParameters,
): TwilioStatusCallbackDependencies {
  assertWhatsAppEnabled(parameters.enabled);
  const accountSid = runtimeValue(parameters.accountSid, 'Twilio Account SID', 64);
  const callbackBaseUrl = runtimeValue(
    parameters.statusCallbackBaseUrl,
    'Twilio callback base URL',
    2_048,
  );
  const authToken = runtimeValue(parameters.authToken, 'Twilio auth token', 256);
  return Object.freeze({
    validator: createTwilioSignatureValidator(authToken),
    repository,
    expectedAccountSid: accountSid,
    callbackBaseUrl,
    logger: functionsLogger,
  });
}

function resolveTwilioRuntime(parameters: TwilioReminderRuntimeParameters): Readonly<{
  accountSid: string;
  authToken: string;
  provider: TwilioWhatsAppProviderConfig;
}> {
  assertWhatsAppEnabled(parameters.enabled);
  const content = contentMode(parameters);
  const accountSid = runtimeValue(parameters.accountSid, 'Twilio Account SID', 64);
  const provider = Object.freeze({
    allowedUid: runtimeValue(parameters.ownerUid, 'reminder owner UID', 128),
    fromE164: runtimeValue(parameters.fromE164, 'Twilio sender', 32),
    toE164: runtimeValue(parameters.toE164, 'Twilio recipient', 32),
    statusCallbackBaseUrl: runtimeValue(
      parameters.statusCallbackBaseUrl,
      'Twilio callback base URL',
      2_048,
    ),
    content,
  });
  const authToken = runtimeValue(parameters.authToken, 'Twilio auth token', 256);
  return Object.freeze({ accountSid, authToken, provider });
}

function assertWhatsAppEnabled(parameter: RuntimeStringValue): void {
  const value = runtimeValue(parameter, 'WhatsApp enabled state', 16);
  if (value !== 'true') throw new Error('WhatsApp reminder delivery is disabled.');
}

function contentMode(parameters: TwilioReminderRuntimeParameters): TwilioWhatsAppContentMode {
  const mode = runtimeValue(parameters.contentMode, 'Twilio content mode', 64);
  if (mode === 'session_text') return Object.freeze({ kind: 'session_text' });
  if (mode === 'content_template') {
    return Object.freeze({
      kind: 'content_template',
      contentSid: runtimeValue(parameters.contentSid, 'Twilio Content SID', 64),
    });
  }
  throw new Error('Twilio content mode is invalid.');
}

function runtimeValue(parameter: RuntimeStringValue, label: string, maximum: number): string {
  const value = parameter.value();
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} runtime parameter is invalid.`);
  }
  return value;
}

interface NotificationRuntime {
  readonly app: App;
  readonly repository: FirestoreReminderRepository;
}

function createNotificationRuntime(): NotificationRuntime {
  const app = getApps()[0] ?? initializeApp();
  const firestore = getFirestore(app);
  const repository = new FirestoreReminderRepository(firestore);
  return Object.freeze({
    app,
    repository,
  });
}

function createLazyReminderReconciliationExecutor(
  app: App,
  repository: FirestoreReminderRepository,
): ReminderReconciliationExecutor {
  let reconciliation: ReminderReconciliationService | undefined;
  return Object.freeze({
    reconcile: async (input: Parameters<ReminderReconciliationExecutor['reconcile']>[0]) => {
      if (!reconciliation) {
        reconciliation = new ReminderReconciliationService(
          repository,
          createFirebaseReminderTaskQueue(app),
        );
      }
      return reconciliation.reconcile(input);
    },
  });
}

const runtime = createNotificationRuntime();
const reconciliationDependencies = Object.freeze({
  source: runtime.repository,
  reconciliation: createLazyReminderReconciliationExecutor(
    runtime.app,
    runtime.repository,
  ),
  logger: functionsLogger,
});
const lazyDelivery = createLazyTwilioReminderDeliveryExecutor(
  runtime.repository,
  runtimeParameters,
);

export const deliverReminderTask = createPrivateReminderTaskFunction({
  delivery: lazyDelivery,
  logger: functionsLogger,
  secrets: [TWILIO_AUTH_TOKEN],
});

export const reconcileTimeBlockReminders =
  createTimeBlockReminderReconciliationFunction(reconciliationDependencies);

export const reconcileNotificationPreferenceReminders =
  createNotificationPreferencesReminderReconciliationFunction(reconciliationDependencies);

export const reconcileUserProfileReminders =
  createUserProfileReminderReconciliationFunction(reconciliationDependencies);

export const refillDeferredReminders = createDeferredReminderRefillFunction({
  ...reconciliationDependencies,
  maximumScheduleHorizonMs: CLOUD_TASK_SAFE_SCHEDULE_HORIZON_MS,
});

export const twilioWhatsAppStatusCallback = createLazyTwilioStatusCallbackFunction({
  resolve: () => resolveTwilioStatusCallbackDependencies(
    runtime.repository,
    runtimeParameters,
  ),
  secrets: [TWILIO_AUTH_TOKEN],
  logger: functionsLogger,
});

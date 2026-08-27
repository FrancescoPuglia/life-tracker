import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import * as functionsLogger from 'firebase-functions/logger';
import { Resend } from 'resend';
import { createProductionResponsesClient } from '../ai/production-client';
import {
  resolveAiRoutingRuntimePolicy,
  routedExecutionProfile,
  type LifeTrackerAiExecutionProfile,
} from '../ai/model-routing';
import type { ResponsesClientLike } from '../ai/responses-adapter';
import { FirestoreRepository } from '../domain/firestore-repository';
import {
  ScientificReportEmailDeliveryService,
  type ScientificReportEmailDeliveryRepository,
} from './email-delivery';
import { validateEmailMailbox, type EmailMailbox } from './email-provider';
import { FirestoreScientificReportEmailDeliveryRepository } from './firestore-email-delivery-repository';
import { FirestoreScientificReportRunRepository } from './firestore-report-run-repository';
import { FirestoreScientificReportScheduleManifestRepository } from './firestore-schedule-manifest-repository';
import { FirestoreWeeklyInterpretationRepository } from './firestore-weekly-interpretation-repository';
import { FirestoreWeeklyReviewApiService } from './firestore-weekly-review-api-service';
import { OpenAiWeeklyInterpretationGenerator } from './openai-weekly-interpretation';
import {
  ScientificReportRunService,
  type ScientificReportRunEmailDeliveryService,
} from './report-run';
import { ResendEmailProvider, type ResendEmailClient } from './resend-email-provider';
import { ScientificReportScheduleManifestService } from './schedule-manifest';
import {
  createScheduledScientificReportFunction,
  createScientificReportPreferenceFunction,
  type ScientificReportRuntimeGate,
} from './schedule-trigger';
import { ScientificReportSourceLoader } from './source-loader';
import {
  WeeklyStrategicInterpretationService,
  type WeeklyInterpretationGenerator,
  type WeeklyInterpretationRepository,
} from './weekly-interpretation';
import { createWeeklyReviewCallableFunction } from './weekly-review-api';

export interface ScientificReportRuntimeStringValue {
  value(): string;
}

export interface ScientificReportRuntimeParameters {
  readonly enabled: ScientificReportRuntimeStringValue;
  readonly ownerUid: ScientificReportRuntimeStringValue;
  readonly fromEmail: ScientificReportRuntimeStringValue;
  readonly fromName: ScientificReportRuntimeStringValue;
  readonly resendApiKey: ScientificReportRuntimeStringValue;
}

export type ResendEmailClientFactory = (apiKey: string) => ResendEmailClient;
export interface ScientificReportAiRuntimeParameters {
  readonly routingEnabled: ScientificReportRuntimeStringValue;
  readonly routingConfig: ScientificReportRuntimeStringValue;
  readonly openAiApiKey: ScientificReportRuntimeStringValue;
  readonly openAiBaseUrl: ScientificReportRuntimeStringValue;
}
export type ReportResponsesClientFactory = (
  apiKey: string,
  options: Readonly<{ baseURL: string; allowLoopback: boolean; maxRetries: 0 }>,
) => ResponsesClientLike;

const REPORT_EMAIL_RUNTIME_ENABLED = defineString('REPORT_EMAIL_RUNTIME_ENABLED', {
  default: 'false',
  description: 'Explicit kill switch. Only exact true permits scheduled report processing.',
});
const REPORT_EMAIL_OWNER_UID = defineString('REPORT_EMAIL_OWNER_UID', {
  default: 'not-configured',
  description: 'Server-allowed Firebase UID for this private personal report deployment.',
});
const REPORT_EMAIL_FROM_ADDRESS = defineString('REPORT_EMAIL_FROM_ADDRESS', {
  default: 'not-configured',
  description: 'Verified non-secret Resend sender mailbox for scientific reports.',
});
const REPORT_EMAIL_FROM_NAME = defineString('REPORT_EMAIL_FROM_NAME', {
  default: 'Life Tracker Reports',
  description: 'Validated display name used for scientific report email.',
});
const RESEND_API_KEY = defineSecret('RESEND_API_KEY', {
  description: 'Backend-only Resend credential for the scheduled report delivery endpoint.',
});
const REPORT_OPENAI_API_KEY = defineSecret('OPENAI_API_KEY', {
  description: 'Backend-only OpenAI credential for optional Weekly report interpretation.',
});
const REPORT_AI_MODEL_ROUTING_ENABLED = defineString('AI_MODEL_ROUTING_ENABLED', {
  default: 'false',
  description: 'Exact opt-in switch for evaluated report interpretation routing.',
});
const REPORT_AI_MODEL_ROUTING_CONFIG = defineString('AI_MODEL_ROUTING_CONFIG', {
  default: 'not-configured',
  description: 'Versioned evaluated report-route manifest; ignored while routing is false.',
});
const REPORT_OPENAI_BASE_URL = defineString('OPENAI_BASE_URL', {
  default: 'https://api.openai.com/v1',
  description: 'Official OpenAI base URL; loopback is accepted only by the Functions emulator.',
});

const runtimeParameters: ScientificReportRuntimeParameters = Object.freeze({
  enabled: REPORT_EMAIL_RUNTIME_ENABLED,
  ownerUid: REPORT_EMAIL_OWNER_UID,
  fromEmail: REPORT_EMAIL_FROM_ADDRESS,
  fromName: REPORT_EMAIL_FROM_NAME,
  resendApiKey: RESEND_API_KEY,
});
const aiRuntimeParameters: ScientificReportAiRuntimeParameters = Object.freeze({
  routingEnabled: REPORT_AI_MODEL_ROUTING_ENABLED,
  routingConfig: REPORT_AI_MODEL_ROUTING_CONFIG,
  openAiApiKey: REPORT_OPENAI_API_KEY,
  openAiBaseUrl: REPORT_OPENAI_BASE_URL,
});

/** Default-off gate reads no owner identity until the exact true switch is present. */
export function createScientificReportRuntimeGate(
  parameters: Pick<ScientificReportRuntimeParameters, 'enabled' | 'ownerUid'>,
): ScientificReportRuntimeGate {
  return Object.freeze({
    allowedOwnerUid: () => runtimeOwner(parameters),
  });
}

/** Secret and provider construction occur only at the first authorized delivery. */
export function createLazyResendScientificReportDeliveryService(
  repository: ScientificReportEmailDeliveryRepository,
  parameters: ScientificReportRuntimeParameters,
  createClient: ResendEmailClientFactory = (apiKey) => new Resend(apiKey),
): ScientificReportRunEmailDeliveryService {
  let delivery: ScientificReportEmailDeliveryService | undefined;
  let configuredOwner: string | undefined;
  return Object.freeze({
    deliver: async (input: Parameters<ScientificReportRunEmailDeliveryService['deliver']>[0]) => {
      const allowedOwner = runtimeOwner(parameters);
      if (allowedOwner === null) throw new Error('Scientific report email runtime is disabled.');
      if (input.uid !== allowedOwner) {
        throw new Error('Scientific report runtime owner is invalid.');
      }
      if (!delivery) {
        const from = runtimeSender(parameters);
        const apiKey = runtimeValue(parameters.resendApiKey, 'Resend API key', 512);
        if (apiKey.length < 20) throw new Error('Resend API key runtime parameter is invalid.');
        delivery = new ScientificReportEmailDeliveryService(
          repository,
          new ResendEmailProvider(createClient(apiKey)),
          from,
        );
        configuredOwner = allowedOwner;
      }
      if (configuredOwner !== allowedOwner) {
        throw new Error('Scientific report runtime owner changed unexpectedly.');
      }
      return delivery.deliver(input);
    },
  });
}

/**
 * Routing-off reads no manifest, OpenAI endpoint, or secret. A client is built
 * only after a durable repository claim authorizes the single provider call.
 */
export function createLazyWeeklyStrategicInterpretationService(
  repository: WeeklyInterpretationRepository,
  parameters: ScientificReportAiRuntimeParameters,
  createClient: ReportResponsesClientFactory = (apiKey, options) =>
    createProductionResponsesClient(apiKey, options),
) {
  let generator: WeeklyInterpretationGenerator | undefined;
  const resolveProfile = (): LifeTrackerAiExecutionProfile | null => {
    const policy = resolveAiRoutingRuntimePolicy({
      enabled: parameters.routingEnabled,
      config: parameters.routingConfig,
    });
    return policy ? routedExecutionProfile(policy, 'weekly_strategic_review') : null;
  };
  return new WeeklyStrategicInterpretationService(
    repository,
    resolveProfile,
    () => {
      if (!generator) {
        const apiKey = runtimeValue(parameters.openAiApiKey, 'OpenAI API key', 512);
        if (apiKey.length < 20) throw new Error('OpenAI API key runtime parameter is invalid.');
        const baseURL = runtimeValue(parameters.openAiBaseUrl, 'OpenAI base URL', 512);
        generator = new OpenAiWeeklyInterpretationGenerator(createClient(apiKey, {
          baseURL,
          allowLoopback: process.env.FUNCTIONS_EMULATOR === 'true',
          maxRetries: 0,
        }));
      }
      return generator;
    },
  );
}

function runtimeOwner(
  parameters: Pick<ScientificReportRuntimeParameters, 'enabled' | 'ownerUid'>,
): string | null {
  const enabled = runtimeValue(parameters.enabled, 'Report runtime enabled state', 16);
  if (enabled === 'false') return null;
  if (enabled !== 'true') throw new Error('Report runtime enabled state is invalid.');
  const uid = runtimeValue(parameters.ownerUid, 'Report runtime owner UID', 128);
  if (uid === 'not-configured' || !/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) {
    throw new Error('Report runtime owner UID is invalid.');
  }
  return uid;
}

function runtimeSender(parameters: ScientificReportRuntimeParameters): EmailMailbox {
  const sender = Object.freeze({
    email: runtimeValue(parameters.fromEmail, 'Report sender address', 254),
    name: runtimeValue(parameters.fromName, 'Report sender name', 100),
  });
  validateEmailMailbox(sender, 'Report sender');
  return sender;
}

function runtimeValue(
  parameter: ScientificReportRuntimeStringValue,
  label: string,
  maximum: number,
): string {
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

const app = getApps()[0] ?? initializeApp();
const firestore = getFirestore(app);
const manifestRepository = new FirestoreScientificReportScheduleManifestRepository(firestore);
const runRepository = new FirestoreScientificReportRunRepository(firestore);
const weeklyInterpretationRepository = new FirestoreWeeklyInterpretationRepository(firestore);
const weeklyInterpretation = createLazyWeeklyStrategicInterpretationService(
  weeklyInterpretationRepository,
  aiRuntimeParameters,
);
const lazyEmailDelivery = createLazyResendScientificReportDeliveryService(
  new FirestoreScientificReportEmailDeliveryRepository(firestore),
  runtimeParameters,
);
const runService = new ScientificReportRunService(
  runRepository,
  new ScientificReportSourceLoader(new FirestoreRepository(firestore)),
  lazyEmailDelivery,
  undefined,
  weeklyInterpretation,
);
const scheduleService = new ScientificReportScheduleManifestService(
  manifestRepository,
  runService,
);
const gate = createScientificReportRuntimeGate(runtimeParameters);
const weeklyReviewApiService = new FirestoreWeeklyReviewApiService(
  firestore,
  manifestRepository,
  runRepository,
  weeklyInterpretationRepository,
  runService,
);

export const reconcileScientificReportSchedules = createScientificReportPreferenceFunction({
  gate,
  service: scheduleService,
  logger: functionsLogger,
});

export const deliverScheduledScientificReports = createScheduledScientificReportFunction({
  gate,
  service: scheduleService,
  logger: functionsLogger,
  secrets: [RESEND_API_KEY, REPORT_OPENAI_API_KEY],
});

export const weeklyExecutiveReviewApi = createWeeklyReviewCallableFunction({
  gate,
  service: weeklyReviewApiService,
  logger: functionsLogger,
  secrets: [RESEND_API_KEY, REPORT_OPENAI_API_KEY],
});

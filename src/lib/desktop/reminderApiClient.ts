import { getFunctions, httpsCallable } from 'firebase/functions';
import firebaseApp from '@/lib/firebase';
import { RUNTIME_TARGET } from '@/lib/runtimeEnvironment';
import {
  DESKTOP_REMINDER_FUNCTION_NAME,
  DESKTOP_REMINDER_FUNCTION_REGION,
  desktopReminderClaimRequest,
  desktopReminderListRequest,
  parseDesktopReminderApiResponse,
  type DesktopReminderApiRequest,
  type DesktopReminderClaimResponse,
  type DesktopReminderListResponse,
} from '../../../packages/notification-contract';

export interface DesktopReminderApiClient {
  list(): Promise<DesktopReminderListResponse>;
  claim(jobId: string): Promise<DesktopReminderClaimResponse>;
}

export type DesktopReminderCallable = (
  request: DesktopReminderApiRequest,
) => Promise<unknown>;

export function createDesktopReminderApiClient(
  call: DesktopReminderCallable,
): DesktopReminderApiClient {
  return Object.freeze({
    async list() {
      const response = parseDesktopReminderApiResponse(
        await call(desktopReminderListRequest()),
      );
      if (response.action !== 'list') {
        throw new Error('Desktop reminder API returned the wrong action.');
      }
      return response;
    },

    async claim(jobId) {
      const response = parseDesktopReminderApiResponse(
        await call(desktopReminderClaimRequest(jobId)),
      );
      if (response.action !== 'claim') {
        throw new Error('Desktop reminder API returned the wrong action.');
      }
      if (response.status === 'dispatch' && response.dispatch.jobId !== jobId) {
        throw new Error('Desktop reminder dispatch identity does not match the claim.');
      }
      return response;
    },
  });
}

let cachedClient: DesktopReminderApiClient | undefined;

export function getDesktopReminderApiClient(): DesktopReminderApiClient {
  if (RUNTIME_TARGET !== 'desktop') {
    throw new Error('Desktop reminder API is unavailable outside the Desktop runtime.');
  }
  if (cachedClient) return cachedClient;
  const functions = getFunctions(firebaseApp, DESKTOP_REMINDER_FUNCTION_REGION);
  const callable = httpsCallable<DesktopReminderApiRequest, unknown>(
    functions,
    DESKTOP_REMINDER_FUNCTION_NAME,
    { timeout: 10_000 },
  );
  cachedClient = createDesktopReminderApiClient(async (request) => (
    (await callable(request)).data
  ));
  return cachedClient;
}

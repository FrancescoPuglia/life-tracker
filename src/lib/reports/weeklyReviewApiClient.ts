import { getFunctions, httpsCallable } from 'firebase/functions';
import firebaseApp from '@/lib/firebase';
import {
  WEEKLY_REVIEW_FUNCTION_NAME,
  WEEKLY_REVIEW_FUNCTION_REGION,
  parseWeeklyReviewApiResponse,
  weeklyReviewRetryRequest,
  weeklyReviewSendTestRequest,
  weeklyReviewStatusRequest,
  type WeeklyReviewApiRequest,
  type WeeklyReviewSendResponse,
  type WeeklyReviewStatusResponse,
} from '../../../packages/report-contract';

export interface WeeklyReviewApiClient {
  status(): Promise<WeeklyReviewStatusResponse>;
  sendTest(): Promise<WeeklyReviewSendResponse>;
  retryDelivery(reportId: string): Promise<WeeklyReviewSendResponse>;
}

export type WeeklyReviewCallable = (request: WeeklyReviewApiRequest) => Promise<unknown>;

export function createWeeklyReviewApiClient(call: WeeklyReviewCallable): WeeklyReviewApiClient {
  return Object.freeze({
    async status() {
      const response = parseWeeklyReviewApiResponse(await call(weeklyReviewStatusRequest()));
      if (response.action !== 'status') throw new Error('Weekly review status action is invalid.');
      return response;
    },
    async sendTest() {
      const response = parseWeeklyReviewApiResponse(await call(weeklyReviewSendTestRequest()));
      if (response.action !== 'send_test') throw new Error('Weekly review send action is invalid.');
      return response;
    },
    async retryDelivery(reportId) {
      const response = parseWeeklyReviewApiResponse(
        await call(weeklyReviewRetryRequest(reportId)),
      );
      if (response.action !== 'retry_delivery') {
        throw new Error('Weekly review retry action is invalid.');
      }
      return response;
    },
  });
}

let cachedClient: WeeklyReviewApiClient | undefined;

export function getWeeklyReviewApiClient(): WeeklyReviewApiClient {
  if (cachedClient) return cachedClient;
  const functions = getFunctions(firebaseApp, WEEKLY_REVIEW_FUNCTION_REGION);
  const callable = httpsCallable<WeeklyReviewApiRequest, unknown>(
    functions,
    WEEKLY_REVIEW_FUNCTION_NAME,
    { timeout: 540_000 },
  );
  cachedClient = createWeeklyReviewApiClient(async (request) => (await callable(request)).data);
  return cachedClient;
}

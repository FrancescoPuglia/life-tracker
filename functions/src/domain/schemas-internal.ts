import type { z } from 'zod';
import { analyticsArgsSchema, readArgsSchema } from './schemas';

export type ReadArgs = z.infer<typeof readArgsSchema>;
export type AnalyticsArgs = z.infer<typeof analyticsArgsSchema>;

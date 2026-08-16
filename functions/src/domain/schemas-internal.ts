import type { z } from 'zod';
import { analyticsArgsSchema, readArgsSchema, stateArgsSchema } from './schemas';

export type ReadArgs = z.infer<typeof readArgsSchema>;
export type AnalyticsArgs = z.infer<typeof analyticsArgsSchema>;
export type StateArgs = z.infer<typeof stateArgsSchema>;

import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const capabilitySchema = z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/);
const idempotencySchema = z.string().min(16).max(160).regex(/^[A-Za-z0-9_-]+$/);

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(12_000),
  mode: z.enum(['ask', 'plan', 'analyze', 'coach']),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(8_000),
  }).strict()).max(20).default([]),
}).strict();

export const applyRequestSchema = z.object({
  approvalCapability: capabilitySchema,
  idempotencyKey: idempotencySchema,
}).strict();

export const rollbackRequestSchema = z.object({
  rollbackCapability: capabilitySchema,
  idempotencyKey: idempotencySchema,
}).strict();

export function parsePathId(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new z.ZodError([]);
  }
  return idSchema.parse(decoded);
}

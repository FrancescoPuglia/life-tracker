import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from './errors';

export type CapabilityPurpose = 'approval' | 'rollback';

/**
 * Derives opaque user-held capabilities from a backend-only signing secret.
 * Only SHA-256 hashes are persisted. Stable derivation lets an idempotent HTTP
 * retry recover the same rollback capability without storing the raw value.
 */
export class CapabilityIssuer {
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      throw new DomainError('INTERNAL', 'Capability signing secret is not configured safely.');
    }
  }

  issue(
    purpose: CapabilityPurpose,
    uid: string,
    resourceId: string,
    bindingHash: string,
  ): string {
    return createHmac('sha256', this.secret)
      .update(`life-tracker\0${purpose}\0${uid}\0${resourceId}\0${bindingHash}`)
      .digest('base64url');
  }
}

export function hashCapability(capability: string): string {
  return createHash('sha256').update(capability).digest('hex');
}

export function capabilityHashMatches(actualHash: string, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actualHash) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

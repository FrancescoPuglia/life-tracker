export type DomainErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EXPIRED'
  | 'UNKNOWN_TOOL'
  | 'LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'STATE_CHANGED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_REPLAYED'
  | 'COMMITTED_UNVERIFIED'
  | 'INTERNAL';

/** Error safe to map to an HTTP status without exposing stack traces or secrets. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

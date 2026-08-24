import { DomainError } from '../domain/errors';
import type { HeaderValue, HttpResponseLike } from './types';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export const LIFE_TRACKER_DESKTOP_ORIGIN = 'https://tauri.localhost';

export function parseAllowedOrigins(configured: string): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const candidate of configured.split(',').map((value) => value.trim()).filter(Boolean)) {
    if (candidate === '*') {
      throw new DomainError('INVALID_ARGUMENT', 'Wildcard CORS origins are forbidden.');
    }
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new DomainError('INVALID_ARGUMENT', 'Invalid configured CORS origin.');
    }
    const loopback = LOOPBACK_HOSTS.has(parsed.hostname);
    if (
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      throw new DomainError('INVALID_ARGUMENT', 'Unsafe configured CORS origin.');
    }
    origins.add(parsed.origin);
  }
  if (!origins.size) throw new DomainError('INVALID_ARGUMENT', 'At least one CORS origin is required.');
  return origins;
}

export function applyCors(
  originHeader: HeaderValue,
  allowedOrigins: ReadonlySet<string>,
  response: HttpResponseLike,
): boolean {
  response.setHeader('Vary', 'Origin');
  if (originHeader === undefined) return true;
  if (typeof originHeader !== 'string' || !allowedOrigins.has(originHeader)) return false;
  response.setHeader('Access-Control-Allow-Origin', originHeader);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
  response.setHeader('Access-Control-Max-Age', '600');
  return true;
}

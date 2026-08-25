import type { ReconcileReminderInput } from './reconciliation-service';

/**
 * Returns an immutable reconciliation input whose user-authored preference
 * cannot enable WhatsApp. Server runtime/deployment policy remains authoritative.
 */
export function withWhatsAppPreferenceDisabled(
  input: ReconcileReminderInput,
): ReconcileReminderInput {
  const value = input.notificationPreferencesValue;
  const preferences = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : Object.freeze({});
  return Object.freeze({
    ...input,
    notificationPreferencesValue: Object.freeze({
      ...preferences,
      whatsappEnabled: false,
    }),
  });
}

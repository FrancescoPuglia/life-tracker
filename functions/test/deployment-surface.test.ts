import { describe, expect, it } from 'vitest';
import * as defaultDeployment from '../src/index';

describe('default Firebase Functions deployment surface', () => {
  it('exports only the verified Secure AI endpoint', () => {
    const endpointNames = Object.entries(defaultDeployment)
      .filter(([, value]) => isEndpoint(value))
      .map(([name]) => name)
      .sort();

    expect(endpointNames).toEqual(['lifeTrackerAiApi']);
    expect(endpointNames).not.toEqual(expect.arrayContaining([
      'deliverScheduledScientificReports',
      'desktopReminderApi',
      'lifeTrackerMcp',
      'reconcileNotificationPreferenceReminders',
      'reconcileScientificReportSchedules',
      'reconcileTimeBlockReminders',
      'reconcileUserProfileReminders',
    ]));
  });
});

function isEndpoint(value: unknown): boolean {
  return typeof value === 'function' && '__endpoint' in value;
}

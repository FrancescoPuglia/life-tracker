import { describe, expect, it } from 'vitest';
import * as defaultDeployment from '../src/index';

describe('default Firebase Functions deployment surface', () => {
  it('does not export reminder endpoints owned by the isolated reminder codebase', () => {
    const endpointNames = Object.entries(defaultDeployment)
      .filter(([, value]) => isEndpoint(value))
      .map(([name]) => name)
      .sort();

    expect(endpointNames).toEqual([
      'deliverScheduledScientificReports',
      'lifeTrackerAiApi',
      'lifeTrackerMcp',
      'reconcileScientificReportSchedules',
    ]);
    expect(endpointNames).not.toEqual(expect.arrayContaining([
      'desktopReminderApi',
      'reconcileNotificationPreferenceReminders',
      'reconcileTimeBlockReminders',
      'reconcileUserProfileReminders',
    ]));
  });
});

function isEndpoint(value: unknown): boolean {
  return typeof value === 'function' && '__endpoint' in value;
}

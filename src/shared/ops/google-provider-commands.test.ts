import { describe, expect, it } from 'vitest'
import { capabilityForPermission } from '#/shared/auth/capability-for-permission'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  GOOGLE_PROVIDER_OPERATOR_COMMANDS,
  googleProviderApplyRefusal,
  googleProviderReportNotice,
} from './google-provider-commands'

describe('operator commands that need a call to Google', () => {
  it('lists the three report-only commands', () => {
    expect(Object.keys(GOOGLE_PROVIDER_OPERATOR_COMMANDS).sort()).toEqual([
      'ops:disconnect-connection',
      'ops:gbp-subscribe',
      'ops:reconcile-publication',
    ])
  })

  // The pointer is only worth printing while the job it names still runs.
  it.each([
    ['ops:gbp-subscribe', 'reconcile-gbp-notification-subscriptions', 'every:86400000'],
    ['ops:reconcile-publication', 'reconcile-ambiguous-publications', 'every:300000'],
  ])('%s points at the enabled scheduled job %s', (command, jobName, schedule) => {
    expect(GOOGLE_PROVIDER_OPERATOR_COMMANDS[command]).toContain(jobName)
    expect(JOB_FAMILY_ROWS.find((row) => row.jobName === jobName)).toMatchObject({
      schedule,
      registration: 'enabled',
    })
  })

  // The in-app disconnect is gated like any other manager action, so the two
  // stops this pointer names can refuse it. The pointer has to say so, and in
  // which order to use them, or it sends the operator into a second refusal.
  it('sends a disconnect to the app, says what refuses it there, and gives the order', () => {
    expect(GOOGLE_PROVIDER_OPERATOR_COMMANDS['ops:disconnect-connection']).toBe(
      'To disconnect, an AccountAdmin of the Organization uses Settings, Integrations in the app. ' +
        'The app refuses that while the Organization is in BETA_SUSPENDED_ORGS, and while ' +
        `BETA_CAPABILITIES_OFF is all or names ${capabilityForPermission('integration.manage')}: ` +
        'have them disconnect before you suspend the Organization, or lift the suspension for the disconnect. ' +
        "To stop the Organization's Google work without them, add its ID to BETA_SUSPENDED_ORGS on web and worker; " +
        'to stop Google for everyone, set BETA_CAPABILITIES_OFF to the Google capabilities ' +
        '(docs/operations/runbooks.md §2, §10 and §11).',
    )
  })

  // Both reads go to Google under the review-sync capability
  // (google-review-sync-authorizer.ts), and the manager's button is a reply
  // command first. A stop of either leaves the reply where it is.
  it('refuses --apply with the reason, what does the work instead, and what stops that', () => {
    expect(googleProviderApplyRefusal('ops:reconcile-publication')).toBe(
      '--apply is refused: this command needs a call to Google, and operator commands ' +
        'run without the Google provider runtime, so it only reports. ' +
        "The worker's reconcile-ambiguous-publications job re-reads Google for every due reply every five minutes, " +
        'and a manager can use Check Google again on the reply in the Inbox. ' +
        'Both reads need property.connect_gbp for the Organization, and Check Google again needs ' +
        `${capabilityForPermission('reply.manage')} as well: while BETA_CAPABILITIES_OFF or ` +
        'BETA_SUSPENDED_ORGS stops one, that read is refused and the reply stays ambiguous ' +
        '(docs/operations/runbooks.md §6).',
    )
  })

  it('closes a report by saying it is all the command does', () => {
    expect(googleProviderReportNotice('ops:gbp-subscribe')).toBe(
      'ops:gbp-subscribe only reports: --apply is refused. ' +
        'The worker subscribes accounts by itself: an import subscribes its own, and the daily ' +
        "reconcile-gbp-notification-subscriptions job re-asserts every Organization's " +
        '(docs/operations/google-pubsub-setup.md §6).',
    )
  })

  it.each(['ops:quarantine', 'ops:queue', 'toString', 'constructor'])(
    'leaves %s alone',
    (command) => {
      expect(googleProviderApplyRefusal(command)).toBeNull()
      expect(googleProviderReportNotice(command)).toBeNull()
    },
  )
})

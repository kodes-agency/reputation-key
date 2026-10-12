import { describe, expect, it } from 'vitest'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  GOOGLE_PROVIDER_OPERATOR_COMMANDS,
  googleProviderApplyRefusal,
  googleProviderReportNotice,
} from './google-provider-commands'

describe('operator commands that need a call to Google', () => {
  it('are exactly the three the operator container refuses', () => {
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
    const entry = GOOGLE_PROVIDER_OPERATOR_COMMANDS[command]
    expect(entry?.automatedJob).toBe(jobName)
    expect(entry?.instead).toContain(jobName)
    expect(JOB_FAMILY_ROWS.find((row) => row.jobName === jobName)).toMatchObject({
      schedule,
      registration: 'enabled',
    })
  })

  it('sends a disconnect to the app and to the stop controls, not to a job', () => {
    const entry = GOOGLE_PROVIDER_OPERATOR_COMMANDS['ops:disconnect-connection']
    expect(entry?.automatedJob).toBeNull()
    expect(entry?.instead).toContain('Settings, Integrations')
    expect(entry?.instead).toContain('BETA_SUSPENDED_ORGS')
    expect(entry?.instead).toContain('BETA_CAPABILITIES_OFF')
  })

  it('refuses --apply with the reason and what does the work instead', () => {
    expect(googleProviderApplyRefusal('ops:reconcile-publication')).toBe(
      '--apply is refused: this command needs a call to Google, and operator commands ' +
        'run without the Google provider runtime, so it only reports. ' +
        "The worker's reconcile-ambiguous-publications job re-reads Google for every due reply every five minutes, " +
        'and a manager can use Check Google again on the reply in the Inbox (docs/operations/runbooks.md §6).',
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

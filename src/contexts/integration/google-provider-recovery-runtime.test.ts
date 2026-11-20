import { describe, expect, it } from 'vitest'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'

describe('Google provider recovery runtime', () => {
  // The sweep consumes Integration's worker capability, which runs both stores
  // (see reconcile-google-provider-recovery.test.ts for the delegation).
  it('runs both bounded recovery stores from the enabled five-minute permit sweep', () => {
    const schedule = JOB_FAMILY_ROWS.find(
      (row) => row.jobName === 'permit-start-deadline-sweep',
    )

    expect(schedule).toMatchObject({
      queue: 'background',
      capability: 'none',
      schedule: 'every:300000',
      registration: 'enabled',
    })
  })
})

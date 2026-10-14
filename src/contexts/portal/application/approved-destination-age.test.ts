// The three numbers that keep a secondary link on the public page between one
// revalidation and the next: how often the job runs, how old an approval must
// be before the job takes it again, and how old the public edge lets it be.

import { describe, expect, it } from 'vitest'
import { PORTAL_BACKGROUND_JOB_ROWS } from '#/shared/governance/portal-job-rows'
import {
  APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS,
  APPROVED_DESTINATION_REVALIDATION_DUE_AFTER_MS,
} from './approved-destination-age'

const revalidationJob = () => {
  const row = PORTAL_BACKGROUND_JOB_ROWS.find(
    ({ jobName }) => jobName === 'portal-approved-destination-revalidation',
  )
  const interval = /^every:(\d+)/u.exec(row?.schedule ?? '')?.[1]
  if (!row || interval === undefined) throw new Error('revalidation job row not found')
  return { intervalMs: Number(interval), runBudgetMs: row.timeoutMs }
}

describe('approved destination revalidation timing', () => {
  it('takes again, on the next run, every approval the last run validated', () => {
    // An approval validated at the end of a run that used its whole budget is
    // stamped that late; it must still be old enough when the next run starts.
    const { intervalMs, runBudgetMs } = revalidationJob()

    expect(
      APPROVED_DESTINATION_REVALIDATION_DUE_AFTER_MS + runBudgetMs,
    ).toBeLessThanOrEqual(intervalMs)
  })

  it('serves an approval through a run that starts late by more than the job’s own budget', () => {
    // Refreshed once per interval, and by up to a run budget later than it was
    // last time: the public edge must still accept it, with room to spare.
    const { intervalMs, runBudgetMs } = revalidationJob()

    expect(intervalMs + runBudgetMs).toBeLessThan(
      APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS,
    )
  })
})

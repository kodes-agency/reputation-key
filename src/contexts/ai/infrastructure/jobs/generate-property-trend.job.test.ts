// Property AI trend generation job unit tests.
//
// This family is property-scoped in the entry-point catalogue, and the
// delayed-execution gate reads an Organization and a Property from the job
// payload and nowhere else. A handler that accepts only the schedule can never
// run: the job the gate allows throws on parse here, and the job this handler
// accepts is denied `missing_scope` before it arrives. The payload must also
// stay identifier-only. How the family is enqueued is covered beside it, in
// ai-job-enqueue.test.ts.

import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { GeneratePropertyTrendResult } from '../../application/use-cases/generate-property-trend'
import { createGeneratePropertyTrendJobHandler } from './generate-property-trend.job'

const SCHEDULE_ID = '71000000-0000-4000-8000-000000000301'
const ORGANIZATION_ID = 'ai-trend-job-test'
const PROPERTY_ID = '71000000-0000-4000-8000-000000000302'
const REQUEST = {
  scheduleId: SCHEDULE_ID,
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
} as const

function createHarness(result: GeneratePropertyTrendResult = { status: 'completed' }) {
  const generatePropertyTrend = vi.fn(async () => result)
  return {
    handler: createGeneratePropertyTrendJobHandler({ generatePropertyTrend }),
    generatePropertyTrend,
  }
}

const job = (data: unknown) => ({ data }) as unknown as Job

describe('generate property AI trend job', () => {
  it('generates the scheduled trend for the scope the job carries', async () => {
    const test = createHarness()

    await test.handler(job(REQUEST))

    expect(test.generatePropertyTrend).toHaveBeenCalledExactlyOnceWith({
      scheduleId: SCHEDULE_ID,
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
    })
  })

  it('refuses a payload that names only the schedule', async () => {
    const test = createHarness()

    await expect(test.handler(job({ scheduleId: SCHEDULE_ID }))).rejects.toThrow()
    expect(test.generatePropertyTrend).not.toHaveBeenCalled()
  })

  it('refuses a payload that carries anything but identifiers', async () => {
    const test = createHarness()

    await expect(
      test.handler(job({ ...REQUEST, reviewText: 'must never travel in a job' })),
    ).rejects.toThrow()
    expect(test.generatePropertyTrend).not.toHaveBeenCalled()
  })

  it('fails the attempt when generation asks for a retry', async () => {
    const test = createHarness({
      status: 'retry',
      retryAtEpochMillis: 1,
      code: 'trend_sequence_or_aggregate_gap',
    })

    await expect(test.handler(job(REQUEST))).rejects.toThrow(
      'AI property trend retry required: trend_sequence_or_aggregate_gap',
    )
  })

  it.each(['completed', 'replayed', 'no_data', 'stale'] as const)(
    'completes when generation reports %s',
    async (status) => {
      const test = createHarness({ status })

      await expect(test.handler(job(REQUEST))).resolves.toBeUndefined()
    },
  )
})

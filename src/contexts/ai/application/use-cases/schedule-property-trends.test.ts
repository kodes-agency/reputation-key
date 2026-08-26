import { describe, expect, it, vi } from 'vitest'
import type { SchedulePropertyTrendsResult } from './schedule-property-trends'
import { createSchedulePropertyTrends } from './schedule-property-trends'

/** The job hands the scheduler a fresh `randomUUID()` per tick as its lease owner. */
const LEASE_OWNER = '71000000-0000-4000-8000-000000000401'

function createHarness(outcome: SchedulePropertyTrendsResult | Error) {
  const scheduleDueBatch = vi.fn(async (_input: Readonly<{ leaseOwner: string }>) => {
    if (outcome instanceof Error) throw outcome
    return outcome
  })
  const schedulePropertyTrends = createSchedulePropertyTrends({
    schedules: {
      scheduleDueBatch,
      read: vi.fn(async () => null),
      recordProviderFreeOutcome: vi.fn(async () => 'stale' as const),
      recordDeterministicReport: vi.fn(async () => 'stale' as const),
    },
  })
  return { schedulePropertyTrends, scheduleDueBatch }
}

describe('schedule property trends', () => {
  it('claims the scheduler with the caller lease owner and reports the batch verdict', async () => {
    const scheduled: SchedulePropertyTrendsResult = {
      status: 'scheduled',
      schedulerGeneration: 4,
      scheduledCount: 100,
      hasMore: true,
    }
    const harness = createHarness(scheduled)

    await expect(
      harness.schedulePropertyTrends({ leaseOwner: LEASE_OWNER }),
    ).resolves.toEqual(scheduled)
    expect(harness.scheduleDueBatch).toHaveBeenCalledOnce()
    // Exact equality: the lease owner must arrive verbatim and alone, since the
    // store uses it as the sole lease identity for the scheduler head row.
    expect(harness.scheduleDueBatch.mock.calls[0]?.[0]).toEqual({
      leaseOwner: LEASE_OWNER,
    })
  })

  /**
   * Nothing due is the steady state: the lease was taken, the generation
   * advanced, and no property qualified (already reported, ineligible, or not
   * yet at its local calendar boundary). It must stay `scheduled` with a zero
   * count and `hasMore: false` so the job stops instead of re-enqueuing.
   */
  it('reports an empty batch as scheduled rather than busy', async () => {
    const harness = createHarness({
      status: 'scheduled',
      schedulerGeneration: 4,
      scheduledCount: 0,
      hasMore: false,
    })

    await expect(
      harness.schedulePropertyTrends({ leaseOwner: LEASE_OWNER }),
    ).resolves.toEqual({
      status: 'scheduled',
      schedulerGeneration: 4,
      scheduledCount: 0,
      hasMore: false,
    })
  })

  it('surfaces a held scheduler lease as busy without inventing a generation', async () => {
    const harness = createHarness({ status: 'busy' })

    await expect(
      harness.schedulePropertyTrends({ leaseOwner: LEASE_OWNER }),
    ).resolves.toEqual({
      status: 'busy',
    })
  })

  it('propagates scheduler failures instead of swallowing them into busy', async () => {
    const harness = createHarness(new Error('scheduler head locked'))

    await expect(
      harness.schedulePropertyTrends({ leaseOwner: LEASE_OWNER }),
    ).rejects.toThrow('scheduler head locked')
    expect(harness.scheduleDueBatch).toHaveBeenCalledOnce()
  })
})

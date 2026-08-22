// The queue seam for the backfill advance sweep.
//
// The seam is thin on purpose — all recovery logic lives in
// `contexts/ai/application/use-cases/advance-review-analysis-backfill`, proven
// against real PostgreSQL in
// `ai-review-analysis-backfill-delivery.integration.test.ts`. What is pinned
// here is what the seam alone can get wrong: dropping a count an operator reads
// to tell a healthy run from a recovering one, and leaking an identifier into a
// log line. The second matters more than it looks: BQC-7.3 forbids run,
// organization, property and review identifiers in logs, and this job is the
// one place that holds all four.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLogger } from '#/shared/observability/logger'
import {
  createAiReviewAnalysisBackfillAdvanceHandler,
  JOB_NAME,
} from './ai-review-analysis-backfill-advance.job'

// Spied, not module-mocked: `trace` pulls the same observability module in, and
// a stub logger module takes its telemetry helpers down with it.
const logged: Array<Record<string, unknown>> = []
const info = vi.spyOn(getLogger(), 'info').mockImplementation((fields: unknown) => {
  logged.push(fields as Record<string, unknown>)
})
afterEach(() => info.mockClear())

const OUTCOME = Object.freeze({
  runsVisited: 3,
  itemsEmitted: 2,
  itemsSkipped: 1,
  itemsRecovered: 1,
  runsCompleted: 1,
  runsSuperseded: 0,
  runsStalled: 1,
  batchFull: false,
})

describe('AI review-analysis backfill advance job', () => {
  it('reports every sweep count an operator needs to read the run', async () => {
    logged.length = 0
    const sweep = vi.fn(async () => OUTCOME)

    await createAiReviewAnalysisBackfillAdvanceHandler({ sweep })({} as never)

    expect(sweep).toHaveBeenCalledTimes(1)
    expect(logged).toEqual([{ job: JOB_NAME, ...OUTCOME }])
  })

  it('lets a sweep failure fail the job so BullMQ retries the tick', async () => {
    logged.length = 0
    const sweep = vi.fn(async () => {
      throw new Error('advance sweep unavailable')
    })

    // Swallowing it would leave a run open with its watermark already moved and
    // nothing scheduled to finish it — the failure shape this sweep exists for.
    await expect(
      createAiReviewAnalysisBackfillAdvanceHandler({ sweep })({} as never),
    ).rejects.toThrow('advance sweep unavailable')
    expect(logged).toEqual([])
  })
})

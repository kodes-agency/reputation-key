import { describe, expect, it, vi } from 'vitest'
import { PORTAL_BACKGROUND_JOB_ROWS } from '#/shared/governance/portal-job-rows'
import {
  createRevalidateApprovedDestinationsHandler,
  REVALIDATION_PAGE_SIZE,
  REVALIDATION_RUN_BUDGET_MS,
} from './revalidate-approved-destinations.job'

type Outcome = Awaited<
  ReturnType<
    Parameters<typeof createRevalidateApprovedDestinationsHandler>[0]['revalidate']
  >
>

const outcome = (overrides: Partial<Outcome> = {}): Outcome => ({
  scanned: 0,
  validated: 0,
  quarantined: 0,
  unavailable: 0,
  unauthorized: 0,
  stale: 0,
  ...overrides,
})

/** A page that took `REVALIDATION_PAGE_SIZE` destinations and validated them all. */
const fullPage = (overrides: Partial<Outcome> = {}): Outcome =>
  outcome({
    scanned: REVALIDATION_PAGE_SIZE,
    validated: REVALIDATION_PAGE_SIZE,
    ...overrides,
  })

const JOB_PAYLOAD = { data: { organizationId: 'must-not-be-used' } } as never

function setUp(pages: ReadonlyArray<Outcome>, secondsPerPage = 0) {
  let nowMs = Date.UTC(2026, 9, 26, 9, 0, 0)
  const authorizeScope = vi.fn(async () => true)
  const queue = [...pages]
  const revalidate = vi.fn(async () => {
    nowMs += secondsPerPage * 1_000
    const next = queue.shift()
    if (!next) throw new Error('revalidate was called more often than the test allows')
    return next
  })
  const logger = { info: vi.fn() }
  const run = createRevalidateApprovedDestinationsHandler({
    revalidate,
    authorizeScope,
    clock: () => new Date(nowMs),
    logger,
  })
  return { run, revalidate, authorizeScope, logger }
}

describe('Portal approved destination revalidation job', () => {
  it('runs one authorized page with no job payload authority when nothing else is due', async () => {
    const { run, revalidate, authorizeScope, logger } = setUp([
      outcome({ scanned: 2, validated: 1, quarantined: 1 }),
    ])

    await run(JOB_PAYLOAD)

    expect(revalidate).toHaveBeenCalledTimes(1)
    expect(revalidate).toHaveBeenCalledWith({
      limit: REVALIDATION_PAGE_SIZE,
      authorizeScope,
    })
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      {
        job: 'portal-approved-destination-revalidation',
        pages: 1,
        scanned: 2,
        validated: 1,
        quarantined: 1,
        unavailable: 0,
        unauthorized: 0,
        stale: 0,
      },
      'Portal approved-destination revalidation completed',
    )
  })

  it('keeps taking pages while they come back full, and adds them into one summary', async () => {
    const { run, revalidate, logger } = setUp([
      fullPage(),
      fullPage({ validated: REVALIDATION_PAGE_SIZE - 3, quarantined: 2, stale: 1 }),
      fullPage(),
      outcome({ scanned: 7, validated: 6, unauthorized: 1 }),
    ])

    await run(JOB_PAYLOAD)

    expect(revalidate).toHaveBeenCalledTimes(4)
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      {
        job: 'portal-approved-destination-revalidation',
        pages: 4,
        scanned: REVALIDATION_PAGE_SIZE * 3 + 7,
        validated: REVALIDATION_PAGE_SIZE * 2 + (REVALIDATION_PAGE_SIZE - 3) + 6,
        quarantined: 2,
        unavailable: 0,
        unauthorized: 1,
        stale: 1,
      },
      'Portal approved-destination revalidation completed',
    )
  })

  it('stops on a short page, even one that follows full pages, without asking again', async () => {
    const { run, revalidate } = setUp([
      fullPage(),
      outcome({
        scanned: REVALIDATION_PAGE_SIZE - 1,
        validated: REVALIDATION_PAGE_SIZE - 1,
      }),
    ])

    await run(JOB_PAYLOAD)

    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  it('stops starting pages once the run budget is spent', async () => {
    // Every page takes a minute and is full, so only the clock can end the run.
    const { run, revalidate, logger } = setUp(
      Array.from({ length: 10 }, () => fullPage()),
      60,
    )

    await run(JOB_PAYLOAD)

    // 60 s, 120 s and 180 s into the run: the third page ends past the 150 s budget.
    expect(REVALIDATION_RUN_BUDGET_MS).toBe(150_000)
    expect(revalidate).toHaveBeenCalledTimes(3)
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ pages: 3, scanned: REVALIDATION_PAGE_SIZE * 3 }),
      'Portal approved-destination revalidation completed',
    )
  })

  it('takes another page when a full page ends exactly one tick inside the budget', async () => {
    const { run, revalidate } = setUp(
      [fullPage(), outcome({ scanned: 1, validated: 1 })],
      REVALIDATION_RUN_BUDGET_MS / 1_000 - 1,
    )

    await run(JOB_PAYLOAD)

    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  it('stops when a full page validated and quarantined nothing, because the next page would be the same rows', async () => {
    const { run, revalidate, logger } = setUp([
      fullPage({ validated: 0, unavailable: 30, unauthorized: 20 }),
    ])

    await run(JOB_PAYLOAD)

    expect(revalidate).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ pages: 1, unavailable: 30, unauthorized: 20 }),
      'Portal approved-destination revalidation completed',
    )
  })

  it('keeps going when a full page validated only some of its rows', async () => {
    const { run, revalidate } = setUp([
      fullPage({ validated: 1, unavailable: REVALIDATION_PAGE_SIZE - 1 }),
      outcome(),
    ])

    await run(JOB_PAYLOAD)

    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  it('lets a quarantine count as progress, since it takes the row out of the due set', async () => {
    const { run, revalidate } = setUp([
      fullPage({ validated: 0, quarantined: REVALIDATION_PAGE_SIZE }),
      outcome(),
    ])

    await run(JOB_PAYLOAD)

    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  it('leaves the job’s own timeout room for the page in flight when the budget ends', () => {
    // The worker fails a run that passes its timeout; a page started just inside
    // the budget has to finish before that.
    const row = PORTAL_BACKGROUND_JOB_ROWS.find(
      ({ jobName }) => jobName === 'portal-approved-destination-revalidation',
    )
    if (!row) throw new Error('revalidation job row not found')

    expect(REVALIDATION_RUN_BUDGET_MS).toBeLessThanOrEqual(row.timeoutMs / 2)
  })

  it('does not swallow a failing page: earlier pages stay committed and the run fails', async () => {
    const { run, logger } = setUp([fullPage()])

    await expect(run(JOB_PAYLOAD)).rejects.toThrow('more often than the test allows')
    expect(logger.info).not.toHaveBeenCalled()
  })
})

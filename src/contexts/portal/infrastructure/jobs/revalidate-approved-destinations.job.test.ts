import { describe, expect, it, vi } from 'vitest'
import type { PortalApprovedDestinationRepository } from '../../application/ports/portal-approved-destination.repository'
import { revalidatePortalApprovedDestinations } from '../../application/use-cases/manage-portal-approved-destinations'
import {
  organizationId,
  propertyId,
  portalApprovedDestinationId,
  userId,
} from '#/shared/domain/ids'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'
import { PORTAL_BACKGROUND_JOB_ROWS } from '#/shared/governance/portal-job-rows'
import { createPortalDestinationNetworkValidator } from '../adapters/portal-destination-network-validator.adapter'
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
  visitedIds: [],
  oldestUnvalidatedAgeMs: 0,
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
    visitedIds: Array.from({ length: REVALIDATION_PAGE_SIZE }, (_, i) =>
      portalApprovedDestinationId(`visited-${i}`),
    ),
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
  const dispatch = vi.fn(async () => {})
  const run = createRevalidateApprovedDestinationsHandler({
    revalidate,
    authorizeScope,
    clock: () => new Date(nowMs),
    logger,
    alertDispatcher: { dispatch },
  })
  return { run, revalidate, authorizeScope, logger, dispatch }
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
      at: expect.any(Date),
      excludeIds: [],
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

  it('continues after a full page with no successful checks', async () => {
    const { run, revalidate, logger } = setUp([
      fullPage({ validated: 0, unavailable: 30, unauthorized: 20 }),
      outcome({ scanned: 1, validated: 1 }),
    ])

    await run(JOB_PAYLOAD)

    expect(revalidate).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        pages: 2,
        scanned: 51,
        validated: 1,
        unavailable: 30,
        unauthorized: 20,
      }),
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

  it.each([29 * 60_000, 30 * 60_000])(
    'alerts only once the oldest failed validation reaches the freshness limit (%i ms)',
    async (age) => {
      const { run, dispatch } = setUp([
        outcome({ scanned: 1, unavailable: 1, oldestUnvalidatedAgeMs: age }),
      ])
      await run(JOB_PAYLOAD)
      expect(dispatch).toHaveBeenCalledTimes(age >= 30 * 60_000 ? 1 : 0)
      if (age >= 30 * 60_000)
        expect(dispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'portal.destination-revalidation-lag',
            value: age,
            threshold: 30 * 60_000,
          }),
        )
    },
  )

  it('alerts on unfinished capacity when the paging budget is exhausted', async () => {
    const { run, dispatch } = setUp([fullPage(), fullPage(), fullPage()], 60)
    await run(JOB_PAYLOAD)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'portal.destination-revalidation-lag',
        value: 180_000,
        threshold: REVALIDATION_RUN_BUDGET_MS,
      }),
    )
  })

  it('does not swallow a failing page: earlier pages stay committed and the run fails', async () => {
    const { run, logger } = setUp([fullPage()])

    await expect(run(JOB_PAYLOAD)).rejects.toThrow('more often than the test allows')
    expect(logger.info).not.toHaveBeenCalled()
  })
})

describe('revalidation progress across failing scopes', () => {
  it.each([1, 4])(
    'reaches the healthy next page within budget after fifty failing sites with %i addresses',
    async (addressCount) => {
      vi.useFakeTimers()
      try {
        const startedAt = new Date('2026-11-05T12:00:00Z')
        vi.setSystemTime(startedAt)
        const clock = () => new Date()
        const old = new Date(startedAt.getTime() - 60 * 60_000)
        const rows = Array.from({ length: 51 }, (_, i) => ({
          id: portalApprovedDestinationId(`destination-${i}`),
          organizationId: organizationId(i === 50 ? 'healthy' : 'failing'),
          propertyId: propertyId(i === 50 ? 'healthy' : 'failing'),
          normalizedUri: `https://site-${i}.example/`,
          hostname: `site-${i}.example`,
          sourceType: 'custom' as const,
          approvalState: 'approved' as const,
          validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
          requestedBy: userId('admin'),
          approvedBy: userId('admin'),
          approvedAt: old,
          disabledAt: null,
          disabledReason: null,
          lastValidatedAt: old,
          createdAt: old,
          updatedAt: old,
          nextAttemptAt: null as Date | null,
          validationFailures: 0,
        }))
        const healthy = rows[50]!
        let inFlight = 0
        let peakInFlight = 0
        let cancellations = 0
        const request = vi.fn(
          async (uri: string, _address: unknown, signal?: AbortSignal) => {
            inFlight += 1
            peakInFlight = Math.max(peakInFlight, inFlight)
            try {
              if (uri === healthy.normalizedUri) return { status: 200, location: null }
              await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, 5_000)
                signal?.addEventListener(
                  'abort',
                  () => {
                    clearTimeout(timer)
                    cancellations += 1
                    // Capacity stays occupied until the aborted transport drains.
                    setTimeout(resolve, 100)
                  },
                  { once: true },
                )
              })
              throw new Error('Request timed out')
            } finally {
              inFlight -= 1
            }
          },
        )
        const visited: string[] = []
        const repo = {
          listDueForNetworkRevalidation: vi.fn<
            PortalApprovedDestinationRepository['listDueForNetworkRevalidation']
          >(async (before, limit, selection) => {
            const page = rows
              .filter(
                (row) =>
                  row.lastValidatedAt <= before &&
                  (!row.nextAttemptAt || row.nextAttemptAt <= selection!.at) &&
                  !selection?.excludeIds?.includes(row.id),
              )
              .slice(0, limit)
            visited.push(...page.map((row) => row.id))
            return page.map((row) => ({ ...row }))
          }),
          recordNetworkValidation: vi.fn<
            PortalApprovedDestinationRepository['recordNetworkValidation']
          >(async (input) => {
            const row = rows.find((row) => row.id === input.id)!
            if (input.result.outcome === 'safe')
              row.lastValidatedAt = input.result.validatedAt
            else if (input.result.outcome === 'unavailable') {
              row.nextAttemptAt = input.result.nextAttemptAt
              row.validationFailures += 1
            }
            return { ...row }
          }),
        }
        const logger = { info: vi.fn() }
        const run = createRevalidateApprovedDestinationsHandler({
          revalidate: revalidatePortalApprovedDestinations({
            destinationRepo: repo as never,
            destinationNetworkValidator: createPortalDestinationNetworkValidator({
              clock,
              resolve: async () =>
                ['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']
                  .slice(0, addressCount)
                  .map((address) => ({ address, family: 4 as const })),
              request,
            }),
            clock,
          }),
          authorizeScope: async () => true,
          clock,
          logger,
          alertDispatcher: { dispatch: vi.fn(async () => {}) },
        })

        const running = run(JOB_PAYLOAD)
        await vi.runAllTimersAsync()
        await running

        expect(healthy.lastValidatedAt.getTime()).toBeGreaterThan(startedAt.getTime())
        expect(clock().getTime() - startedAt.getTime()).toBeLessThan(
          REVALIDATION_RUN_BUDGET_MS,
        )
        expect(peakInFlight).toBeGreaterThan(1)
        expect(peakInFlight).toBeLessThanOrEqual(5)
        expect(inFlight).toBe(0)
        expect(cancellations).toBe(50)
        expect(vi.getTimerCount()).toBe(0)
        expect(visited).toHaveLength(51)
        expect(new Set(visited).size).toBe(51)
        expect(request).toHaveBeenCalledTimes(51)
        expect(repo.recordNetworkValidation).toHaveBeenCalledTimes(51)
        for (const row of rows.slice(0, 50)) {
          expect(row.lastValidatedAt).toEqual(old)
          expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(startedAt.getTime())
          expect(row.validationFailures).toBe(1)
        }
        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            pages: 2,
            scanned: 51,
            validated: 1,
            unavailable: 50,
          }),
          'Portal approved-destination revalidation completed',
        )
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it.each(['unavailable', 'unauthorized'] as const)(
    'reaches a healthy row behind 50 %s rows and visits each row once',
    async (failure) => {
      const now = new Date('2026-11-05T12:00:00Z')
      const old = new Date(now.getTime() - 60 * 60_000)
      const rows = Array.from({ length: 51 }, (_, i) => ({
        id: portalApprovedDestinationId(`destination-${String(i).padStart(3, '0')}`),
        organizationId: organizationId('org'),
        propertyId: propertyId(i === 50 ? 'healthy' : 'failing'),
        normalizedUri: `https://site-${i}.example/`,
        hostname: `site-${i}.example`,
        sourceType: 'custom' as const,
        approvalState: 'approved' as const,
        validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
        requestedBy: userId('admin'),
        approvedBy: userId('admin'),
        approvedAt: old,
        disabledAt: null,
        disabledReason: null,
        lastValidatedAt: old,
        createdAt: old,
        updatedAt: old,
        nextAttemptAt: null as Date | null,
        validationFailures: 0,
      }))
      const validate = vi.fn(async (uri: string) =>
        uri === rows[50]!.normalizedUri
          ? {
              outcome: 'safe' as const,
              validatedAt: now,
              finalUri: uri,
              redirectCount: 0,
            }
          : {
              outcome: 'unavailable' as const,
              reason: 'dns_unavailable' as const,
              observedAt: now,
            },
      )
      const visited: string[] = []
      const repo = {
        listDueForNetworkRevalidation: vi.fn<
          PortalApprovedDestinationRepository['listDueForNetworkRevalidation']
        >(async (_before, limit, selection) => {
          const page = rows
            .filter(
              (row) =>
                row.lastValidatedAt.getTime() <= now.getTime() - 600_000 &&
                (!row.nextAttemptAt || row.nextAttemptAt <= now) &&
                !selection?.excludeIds?.includes(row.id),
            )
            .slice(0, limit)
          visited.push(...page.map((row) => row.id))
          return page.map((row) => ({ ...row }))
        }),
        recordNetworkValidation: vi.fn<
          PortalApprovedDestinationRepository['recordNetworkValidation']
        >(async (input) => {
          const row = rows.find((row) => row.id === input.id)!
          if (input.result.outcome === 'safe') row.lastValidatedAt = now
          else if (input.result.outcome === 'unavailable')
            row.nextAttemptAt = input.result.nextAttemptAt
          return { ...row }
        }),
      }
      const dispatch = vi.fn(async () => {})
      const run = createRevalidateApprovedDestinationsHandler({
        revalidate: revalidatePortalApprovedDestinations({
          destinationRepo: repo as never,
          destinationNetworkValidator: { validate },
          clock: () => now,
        }),
        authorizeScope: async (_org, property) =>
          failure !== 'unauthorized' || property === 'healthy',
        clock: () => now,
        logger: { info: vi.fn() },
        alertDispatcher: { dispatch },
      })
      await run(JOB_PAYLOAD)
      expect(rows[50]!.lastValidatedAt).toEqual(now)
      expect(visited).toHaveLength(51)
      expect(new Set(visited).size).toBe(51)
      expect(validate).toHaveBeenCalledTimes(failure === 'unauthorized' ? 1 : 51)
      expect(repo.recordNetworkValidation).toHaveBeenCalledTimes(
        failure === 'unauthorized' ? 1 : 51,
      )
      if (failure === 'unavailable')
        expect(dispatch).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'portal.destination-revalidation-lag' }),
        )
      else expect(dispatch).not.toHaveBeenCalled()
    },
  )
})

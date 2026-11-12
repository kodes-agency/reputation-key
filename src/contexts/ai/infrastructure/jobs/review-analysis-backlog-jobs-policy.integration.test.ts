import {
  NOW,
  OTHER_ORGANIZATION,
  OTHER_PROPERTY,
  PLATFORM_STOPS,
  queued,
  type QueuedEntry,
  REFUSAL_HOLD_MILLIS,
  reviewIdFor,
  STOPPED_ORGANIZATION,
  STOPPED_PROPERTY,
  STOPPED_SCOPE,
  createWorker,
} from '#/contexts/ai/infrastructure/testing/backlog-policy-handler.test-fixtures'
import type { DomainEvent } from '#/shared/events/events'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => createMockLogger(),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, work: () => unknown) => work()),
}))

/** The envelope the relay builds from a fact's outbox row. */
function delivered(fact: DomainEvent, recordedAtEpochMillis: number) {
  const row = toOutboxEvent(fact)
  return buildConsumerEvent({
    id: fact.eventId,
    eventType: row.eventType,
    eventVersion: row.eventVersion ?? 1,
    payload: JSON.parse(JSON.stringify(row.payload)),
    organizationId: row.organizationId,
    propertyId: row.propertyId ?? null,
    sourceContext: row.sourceContext,
    sourceAggregateId: row.sourceAggregateId,
    recordedAt: new Date(recordedAtEpochMillis),
  })
}

const worker = createWorker({
  delivered,
  createDispatcher: createDispatcherHandler,
  logger: createMockLogger(),
})

describe('Review Analysis backlog jobs under platform policy', () => {
  it('sends a queued review to the provider when policy allows its Organization', async () => {
    const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
    const run = await worker({}, rows)

    await run.fire()

    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
    expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      internalSubjectId: '7f000000-0000-4000-8000-000000000001',
    })
  })

  it.each(PLATFORM_STOPS)(
    'sends nothing to the provider and leaves the review queued while %s',
    async (_stop, env) => {
      const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
      const run = await worker(env, rows)

      await run.fire()

      expect(run.analyzeReview).not.toHaveBeenCalled()
      // Still waiting, exactly as it was: no attempt counted, nothing settled
      // as "not analysable", and no horizon running against it.
      expect(run.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(rows).toEqual([
        {
          ...queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY }),
          state: 'queued',
          attempts: 0,
          firstStartedAtEpochMillis: null,
          nextAttemptAtEpochMillis: expect.any(Number),
        },
      ])
      expect(rows[0]?.nextAttemptAtEpochMillis).toBeGreaterThan(NOW)
    },
  )

  it('keeps analysing the other Organizations while one is suspended', async () => {
    const rows = [
      queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY }),
      queued(2, { org: OTHER_ORGANIZATION, prop: OTHER_PROPERTY }),
    ]
    const run = await worker({ BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION }, rows)

    await run.fire()

    expect(
      run.analyzeReview.mock.calls.map(([request]) => request.organizationId),
    ).toEqual([OTHER_ORGANIZATION])
    expect(rows.find((row) => row.organizationId === STOPPED_ORGANIZATION)).toMatchObject(
      { state: 'queued', attempts: 0, firstStartedAtEpochMillis: null },
    )
  })

  it('keeps a profile refusal queued past the horizon and drains it after restoration', async () => {
    const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
    const run = await worker({}, rows)
    run.switches.profileUnavailable = true
    await run.fire()
    run.advance(24 * 60 * 60 * 1_000)
    await run.fire()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'queued' })
    expect(run.advanceWithoutAnalysis).not.toHaveBeenCalled()
    expect(await run.operations()).toHaveLength(0)
    expect(run.analyzeReview).not.toHaveBeenCalled()

    run.switches.profileUnavailable = false
    run.advance(30_000)
    await run.fire()
    expect(run.analyzeReview).toHaveBeenCalledOnce()
    expect(await run.operations()).toHaveLength(1)
    expect((await run.operations())[0]).toMatchObject({ executionAttempt: 1 })
  })

  it('analyses a refused review once the stop is lifted and its hold has passed', async () => {
    const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
    const run = await worker({ BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION }, rows)
    await run.fire()
    const callsWhileStopped = run.analyzeReview.mock.calls.length

    run.restartUnder({})
    run.advance(REFUSAL_HOLD_MILLIS - 1)
    await run.fire()
    const callsWhileHeld = run.analyzeReview.mock.calls.length
    run.advance(1)
    await run.fire()

    expect({ callsWhileStopped, callsWhileHeld }).toEqual({
      callsWhileStopped: 0,
      callsWhileHeld: 0,
    })
    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
    expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      internalSubjectId: '7f000000-0000-4000-8000-000000000001',
    })
  })

  // The other way into the same backlog. Its job is Property-scoped, so the
  // dispatch gate decides it for the review's own Organization and Property
  // and the handler never runs for a stopped one.
  it('analyses an opened review on demand when policy allows its Organization', async () => {
    const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
    const run = await worker({}, rows)

    await run.analyzeNow(queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY }))

    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
  })

  it('refuses the on-demand job for a suspended Organization before it claims the review', async () => {
    const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
    const run = await worker({ BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION }, rows)

    await expect(
      run.analyzeNow(queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })),
    ).resolves.toEqual({
      gate: 'denied',
      reason: 'org_suspended',
      executionKind: 'worker',
    })
    expect(run.analyzeReview).not.toHaveBeenCalled()
    expect(rows).toEqual([
      queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY }),
    ])
  })
})

// Everything above starts from a review already in the backlog. A review
// Google shows RepKey during the stop used to never get there: platform
// policy refused its consumer at the dispatcher, which records an obsolete
// receipt and is never retried, and a stopped AI control settled it as
// "not analysable" with no operation, which nothing reopens. Either way the
// review stayed outside the Property's analysis after the stop was lifted.
describe('Review Analysis for a review that arrives during a stop', () => {
  it('analyses a new review on delivery when nothing is stopped', async () => {
    const rows: QueuedEntry[] = []
    const run = await worker({}, rows)

    await run.arrive(1, STOPPED_SCOPE)

    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
    expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      internalSubjectId: reviewIdFor(1),
    })
    expect(rows).toEqual([])
  })

  it.each(PLATFORM_STOPS)(
    'queues a review that arrives while %s, and analyses it once the stop is lifted',
    async (_stop, env) => {
      const rows: QueuedEntry[] = []
      const run = await worker(env, rows)

      const arrival = await run.arrive(1, STOPPED_SCOPE)
      await run.fire()

      // Nothing left for the provider, nothing was settled "not analysable",
      // and the review waits as an untried entry the drain has already been
      // refused once.
      expect(run.analyzeReview).not.toHaveBeenCalled()
      expect(run.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(arrival).toMatchObject({ delivery: 'completed', receipt: 'applied' })
      expect(rows).toEqual([
        {
          eventEnvelopeId: arrival.eventId,
          organizationId: STOPPED_ORGANIZATION,
          propertyId: STOPPED_PROPERTY,
          reviewId: reviewIdFor(1),
          state: 'queued',
          attempts: 0,
          nextAttemptAtEpochMillis: NOW + REFUSAL_HOLD_MILLIS,
          firstStartedAtEpochMillis: null,
          origin: 'deferred_live',
        },
      ])

      run.restartUnder({})
      run.advance(REFUSAL_HOLD_MILLIS)
      await run.fire()

      expect(run.analyzeReview).toHaveBeenCalledTimes(1)
      expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
        organizationId: STOPPED_ORGANIZATION,
        propertyId: STOPPED_PROPERTY,
        internalSubjectId: reviewIdFor(1),
      })
    },
  )

  it('keeps analysing another Organization on delivery while one is suspended', async () => {
    const rows: QueuedEntry[] = []
    const run = await worker({ BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION }, rows)

    await run.arrive(1, STOPPED_SCOPE)
    await run.arrive(2, { org: OTHER_ORGANIZATION, prop: OTHER_PROPERTY })

    expect(
      run.analyzeReview.mock.calls.map(([request]) => request.organizationId),
    ).toEqual([OTHER_ORGANIZATION])
    expect(rows.map((row) => row.organizationId)).toEqual([STOPPED_ORGANIZATION])
  })

  // A suspended Organization is refused, and most of its Properties never
  // enabled AI. Their reviews must not pile up in the backlog waiting for a
  // stop that is not one.
  it('queues nothing for a Property that never enabled AI, refused or not', async () => {
    const rows: QueuedEntry[] = []
    const run = await worker({ BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION }, rows, {
      neverEnabled: [STOPPED_PROPERTY, OTHER_PROPERTY],
    })
    expect(await run.authorizations()).toEqual([null, null])

    const refused = await run.arrive(1, STOPPED_SCOPE)
    const allowed = await run.arrive(2, { org: OTHER_ORGANIZATION, prop: OTHER_PROPERTY })

    expect([refused, allowed]).toMatchObject([
      { delivery: 'completed', receipt: 'applied' },
      { delivery: 'completed', receipt: 'applied' },
    ])
    expect(rows).toEqual([])
    expect(run.analyzeReview).not.toHaveBeenCalled()
    expect(run.advanceWithoutAnalysis).not.toHaveBeenCalled()
  })

  it('holds a review that arrives while the Review Analysis control is killed, and analyses it after the restore', async () => {
    const rows: QueuedEntry[] = []
    const run = await worker({}, rows)
    await run.killReviewAnalysis()

    const arrival = await run.arrive(1, STOPPED_SCOPE)
    const queuedOnArrival = rows.map((row) => ({ ...row }))
    await run.fire()

    expect(run.analyzeReview).not.toHaveBeenCalled()
    expect(run.advanceWithoutAnalysis).not.toHaveBeenCalled()
    expect(arrival).toMatchObject({ delivery: 'completed', receipt: 'applied' })
    const waiting = {
      eventEnvelopeId: arrival.eventId,
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      reviewId: reviewIdFor(1),
      state: 'queued',
      attempts: 0,
      firstStartedAtEpochMillis: null,
      origin: 'deferred_live',
    }
    expect(queuedOnArrival).toEqual([{ ...waiting, nextAttemptAtEpochMillis: NOW }])
    // The drain asked, was told the control is stopped, and put it back
    // untried: no attempt counted and no horizon running against it.
    expect(rows).toEqual([
      { ...waiting, nextAttemptAtEpochMillis: NOW + REFUSAL_HOLD_MILLIS },
    ])

    await run.restoreReviewAnalysis()
    run.advance(REFUSAL_HOLD_MILLIS - 1)
    await run.fire()
    const callsWhileHeld = run.analyzeReview.mock.calls.length
    run.advance(1)
    await run.fire()

    expect(callsWhileHeld).toBe(0)
    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
    expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      internalSubjectId: reviewIdFor(1),
    })
  })

  it('leaves a review that was already queued untried while the control is killed', async () => {
    const rows = [queued(1, STOPPED_SCOPE)]
    const run = await worker({}, rows)
    await run.killReviewAnalysis()

    await run.fire()

    expect(run.analyzeReview).not.toHaveBeenCalled()
    expect(run.advanceWithoutAnalysis).not.toHaveBeenCalled()
    expect(rows).toEqual([
      {
        ...queued(1, STOPPED_SCOPE),
        nextAttemptAtEpochMillis: NOW + REFUSAL_HOLD_MILLIS,
      },
    ])
  })

  it('leaves an opened review queued when its on-demand analysis meets a killed control', async () => {
    const rows = [queued(1, STOPPED_SCOPE)]
    const run = await worker({}, rows)
    await run.killReviewAnalysis()

    await run.analyzeNow(queued(1, STOPPED_SCOPE))

    expect(run.analyzeReview).not.toHaveBeenCalled()
    expect(run.advanceWithoutAnalysis).not.toHaveBeenCalled()
    expect(rows).toMatchObject([
      { state: 'queued', attempts: 0, firstStartedAtEpochMillis: null },
    ])
  })

  // A review that was tried before the stop already has an operation, claimed
  // under the control generations of that moment. The kill moves a generation
  // and the restore moves it again, the request fingerprint covers them, and
  // the idempotency key is the review's event, so after the restore the same
  // claim can only answer `conflict`. Settled "disabled" with no operation, the
  // review waited for the reaper to abandon the stale operation at its 24-hour
  // expiry. Closed as suspended, it is the reopen pass's at the next sweep
  // (`ai-review-analysis-reopen.adapter.integration.test.ts`).
  describe.each([
    [
      'its lane was full',
      { laneBusy: true },
      { executionAttempt: 0, failureCode: null, providerCalls: 0 },
    ],
    [
      'the provider said to come back later',
      { laneBusy: false },
      { executionAttempt: 1, failureCode: 'provider_unavailable', providerCalls: 1 },
    ],
  ])(
    'for a queued review that was tried before the kill, when %s',
    (_case, before, tried) => {
      async function triedThenKilledThenRestored() {
        const rows = [queued(1, STOPPED_SCOPE)]
        const run = await worker({}, rows)
        run.switches.laneBusy = before.laneBusy
        await run.fire()
        const beforeTheKill = await run.operations()

        await run.killReviewAnalysis()
        run.advance(REFUSAL_HOLD_MILLIS)
        await run.fire()
        const duringTheStop = {
          operations: await run.operations(),
          settlements: run.advanceWithoutAnalysis.mock.calls.length,
          rows: rows.map((row) => ({ ...row })),
        }

        run.switches.laneBusy = false
        await run.restoreReviewAnalysis()
        run.advance(REFUSAL_HOLD_MILLIS)
        await run.fire()
        return { run, rows, beforeTheKill, duringTheStop }
      }

      it('holds the review and its operation untouched while the control is killed', async () => {
        const { beforeTheKill, duringTheStop } = await triedThenKilledThenRestored()

        expect(beforeTheKill).toMatchObject([
          {
            state: 'pending',
            executionAttempt: tried.executionAttempt,
            failureCode: tried.failureCode,
          },
        ])
        expect(duringTheStop.operations).toEqual(beforeTheKill)
        expect(duringTheStop.settlements).toBe(0)
        expect(duringTheStop.rows).toMatchObject([
          { state: 'queued', firstStartedAtEpochMillis: null },
        ])
      })

      it('closes that operation as suspended at the restore and settles the review sequence', async () => {
        const { run, rows, beforeTheKill } = await triedThenKilledThenRestored()

        // What the reopen pass selects: the review's operation failed with a
        // reopen code, its sequence settled, and no backlog entry left.
        expect(await run.operations()).toEqual([
          { ...beforeTheKill[0], state: 'failed', failureCode: 'execution_suspended' },
        ])
        expect(run.advanceWithoutAnalysis.mock.calls).toEqual([
          [
            expect.objectContaining({
              dispositionCode: 'operation_abandoned',
            }),
          ],
        ])
        expect(rows).toEqual([])
        // Nothing was sent under the stale operation.
        expect(run.analyzeReview).toHaveBeenCalledTimes(tried.providerCalls)
      })
    },
  )

  // The consumer's catalogue row is ungated so that the review above can be
  // queued. What keeps it from analysing a stopped Organization's review on
  // delivery is the policy question it is handed, so the worker's composition
  // must hand it the drain's own.
  it('is given the scope authorizer of the drain where the worker is composed', () => {
    const composition = readFileSync(
      join(process.cwd(), 'src/composition/ai-wiring.ts'),
      'utf8',
    )
    const build = readFileSync(join(process.cwd(), 'src/contexts/ai/build.ts'), 'utf8')

    expect(composition).toMatch(
      /authorizeReviewAnalysisScope: createScheduledScopeAuthorizer\(\s*'system:ai\.review_analysis_backlog_drain',?\s*\)/u,
    )
    expect(build).toMatch(/authorizeScope: input\.authorizeReviewAnalysisScope,/u)
  })
})

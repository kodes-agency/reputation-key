// BQC-3.7 — outbox relay unit tests (fake repository + fake queue).
//
// Contract under test:
//   - poison rows are ENQUEUED — no relay-side payload validation; the
//     dispatcher is the single validation authority (its 3.6
//     UnrecoverableError quarantines poison), ending the re-claim busy loop
//   - dispatch jobs carry an explicit retry policy (attempts + backoff) so
//     first-failure dispatches retry, then quarantine via BQC-3.6
//   - the relay renews the lease on the unprocessed remainder every 10
//     published events so a slow batch cannot lose the lease mid-publish
//   - jobId = event.id dedup is preserved; queue failures leave the row
//     unpublished so the lease expiry path reclaims it

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import { EXPEDITED_DISPATCH_EVENT_TYPES } from './dispatch-job-options'
import { createOutboxRelay } from './relay'
import type {
  OutboxRepository,
  UnpublishedEvent,
} from './infrastructure/outbox-repository'

const RECORDED = new Date('2026-07-17T10:00:00.000Z')

function makeEvent(
  id: string,
  payload: unknown = { resourceId: 'r-1' },
): UnpublishedEvent {
  return {
    id,
    eventType: 'test.unregistered_poison',
    eventVersion: 1,
    payload,
    organizationId: 'org-1',
    propertyId: null,
    sourceContext: 'test',
    sourceAggregateId: 'agg-1',
    recordedAt: RECORDED,
  }
}

function makeRepo(events: UnpublishedEvent[]) {
  const state = {
    markedPublished: [] as string[],
    renewals: [] as Array<{ ids: string[]; owner: string; leaseDurationMs: number }>,
  }
  const repo = {
    claimUnpublished: vi.fn(async () => events),
    markPublished: vi.fn(async (id: string) => {
      state.markedPublished.push(id)
    }),
    renewLease: vi.fn(
      async (ids: readonly string[], owner: string, leaseDurationMs: number) => {
        state.renewals.push({ ids: [...ids], owner, leaseDurationMs })
        return ids.length
      },
    ),
  } as unknown as OutboxRepository
  return { repo, state }
}

function makeQueue() {
  const added: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = []
  const queue = {
    add: vi.fn(async (name: string, data: unknown, opts: Record<string, unknown>) => {
      added.push({ name, data, opts })
      return { id: opts.jobId }
    }),
  } as unknown as Queue
  return { queue, added }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('outbox relay (BQC-3.7)', () => {
  it('enqueues poison rows — the dispatcher is the single validation authority', async () => {
    // No schema is registered for this event type. The pre-3.7 relay threw in
    // validateEventPayload and re-claimed the row every 5s forever; the
    // hardened relay enqueues it so the dispatcher can quarantine it (3.6).
    const events = [makeEvent('evt-poison', { garbage: true })]
    const { repo, state } = makeRepo(events)
    const { queue, added } = makeQueue()

    const relay = createOutboxRelay(repo, queue, { relayId: 'relay-test-1' })
    await relay.poll()

    expect(added).toHaveLength(1)
    expect(added[0]!.name).toBe('test.unregistered_poison')
    expect(state.markedPublished).toEqual(['evt-poison'])
  })

  it('applies the dispatch retry policy (attempts + exponential backoff) with jobId dedup', async () => {
    const events = [makeEvent('evt-1'), makeEvent('evt-2')]
    const { repo } = makeRepo(events)
    const { queue, added } = makeQueue()

    const relay = createOutboxRelay(repo, queue, { relayId: 'relay-test-1' })
    await relay.poll()

    expect(added).toHaveLength(2)
    for (const [i, call] of added.entries()) {
      expect(call.opts.jobId).toBe(events[i]!.id)
      expect(call.opts.attempts).toBe(8)
      expect(call.opts.backoff).toEqual({
        type: 'exponential',
        delay: 30_000,
        jitter: 0.5,
      })
    }
  })

  it('publishes the switch a manager is watching, not its replay, to the front of the queue', async () => {
    const events = [
      { ...makeEvent('evt-ai'), eventType: 'identity.merchant_ai.changed' },
      {
        ...makeEvent('evt-backfill'),
        eventType: 'ai.review_analysis.backfill_requested',
      },
      { ...makeEvent('evt-review'), eventType: 'review.created' },
    ]
    const { repo } = makeRepo(events)
    const { queue, added } = makeQueue()

    const relay = createOutboxRelay(repo, queue, { relayId: 'relay-test-1' })
    await relay.poll()

    expect(added.map((call) => [call.name, call.opts.lifo])).toEqual([
      ['identity.merchant_ai.changed', true],
      ['ai.review_analysis.backfill_requested', undefined],
      ['review.created', undefined],
    ])
  })

  it('expedites only catalogued event families', () => {
    const catalogued = new Set(EVENT_FAMILY_ROWS.map((row) => row.eventType))
    expect(
      [...EXPEDITED_DISPATCH_EVENT_TYPES].filter(
        (eventType) => !catalogued.has(eventType),
      ),
    ).toEqual([])
  })

  describe('scheduled drain', () => {
    const full = (tag: string) =>
      Array.from({ length: 50 }, (_, i) => makeEvent(`${tag}-${i}`))

    function sequenceRepo(batches: UnpublishedEvent[][]) {
      const claimUnpublished = vi.fn(async () => batches.shift() ?? [])
      const repo = {
        claimUnpublished,
        markPublished: vi.fn(async () => {}),
        renewLease: vi.fn(async (ids: readonly string[]) => ids.length),
      } as unknown as OutboxRepository
      return { repo, claimUnpublished }
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps publishing while polls come back full, within one tick', async () => {
      vi.useFakeTimers()
      const { repo, claimUnpublished } = sequenceRepo([
        full('a'),
        full('b'),
        [makeEvent('c-0')],
      ])
      const { queue, added } = makeQueue()
      const stop = createOutboxRelay(repo, queue, { relayId: 'relay-test-1' }).start(
        1_000,
      )

      // One tick, then half an interval: the next tick has not fired, so every
      // claim below belongs to the first tick's drain.
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(500)
      expect(claimUnpublished).toHaveBeenCalledTimes(3)
      expect(added).toHaveLength(101)
      stop()
    })

    it('leaves a drain in progress to finish instead of starting another', async () => {
      vi.useFakeTimers()
      let release: (events: UnpublishedEvent[]) => void = () => {}
      const claimUnpublished = vi.fn(
        () =>
          new Promise<UnpublishedEvent[]>((resolve) => {
            release = resolve
          }),
      )
      const repo = {
        claimUnpublished,
        markPublished: vi.fn(async () => {}),
        renewLease: vi.fn(async (ids: readonly string[]) => ids.length),
      } as unknown as OutboxRepository
      const { queue } = makeQueue()
      const stop = createOutboxRelay(repo, queue, { relayId: 'relay-test-1' }).start(
        1_000,
      )

      await vi.advanceTimersByTimeAsync(3_000)
      expect(claimUnpublished).toHaveBeenCalledOnce()
      release([])
      stop()
    })

    it('stops draining once the relay is stopped', async () => {
      vi.useFakeTimers()
      const { repo, claimUnpublished } = sequenceRepo([full('a'), full('b'), full('c')])
      const { queue } = makeQueue()
      let stop: () => void = () => {}
      ;(repo.markPublished as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        stop()
      })
      stop = createOutboxRelay(repo, queue, { relayId: 'relay-test-1' }).start(1_000)

      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() => expect(claimUnpublished).toHaveBeenCalledOnce())
      await vi.advanceTimersByTimeAsync(5_000)
      expect(claimUnpublished).toHaveBeenCalledOnce()
    })
  })

  it('renews the lease for the unprocessed remainder every 10 published events', async () => {
    const events = Array.from({ length: 25 }, (_, i) => makeEvent(`evt-${i}`))
    const { repo, state } = makeRepo(events)
    const { queue } = makeQueue()

    const relay = createOutboxRelay(repo, queue, {
      relayId: 'relay-test-1',
      leaseDurationMs: 30_000,
    })
    await relay.poll()

    expect(state.markedPublished).toHaveLength(25)
    expect(state.renewals).toHaveLength(2)
    // After 10 published: the remaining 15 are renewed; after 20: the last 5.
    expect(state.renewals[0]).toEqual({
      ids: events.slice(10).map((e) => e.id),
      owner: 'relay-test-1',
      leaseDurationMs: 30_000,
    })
    expect(state.renewals[1]).toEqual({
      ids: events.slice(20).map((e) => e.id),
      owner: 'relay-test-1',
      leaseDurationMs: 30_000,
    })
  })

  it('does not renew for batches of 10 or fewer', async () => {
    const events = Array.from({ length: 10 }, (_, i) => makeEvent(`evt-${i}`))
    const { repo, state } = makeRepo(events)
    const { queue } = makeQueue()

    const relay = createOutboxRelay(repo, queue, { relayId: 'relay-test-1' })
    await relay.poll()

    expect(state.markedPublished).toHaveLength(10)
    expect(state.renewals).toHaveLength(0)
  })

  it('keeps publishing when a lease renewal fails', async () => {
    const events = Array.from({ length: 12 }, (_, i) => makeEvent(`evt-${i}`))
    const { repo, state } = makeRepo(events)
    ;(repo.renewLease as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('db connection lost'),
    )
    const { queue } = makeQueue()

    const relay = createOutboxRelay(repo, queue, { relayId: 'relay-test-1' })
    await relay.poll()

    // Renewal failure is logged and tolerated — the batch still completes; an
    // expired lease is reclaimed and the enqueue dedups on jobId.
    expect(state.markedPublished).toHaveLength(12)
    expect(repo.renewLease).toHaveBeenCalledTimes(1)
  })

  it('leaves the row unpublished when the queue add fails (lease expiry reclaims it)', async () => {
    const events = [makeEvent('evt-fail'), makeEvent('evt-ok')]
    const { repo, state } = makeRepo(events)
    const { queue } = makeQueue()
    ;(queue.add as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('redis unavailable'),
    )

    const relay = createOutboxRelay(repo, queue, { relayId: 'relay-test-1' })
    await relay.poll()

    expect(state.markedPublished).toEqual(['evt-ok'])
  })

  it('skips publishing entirely when no queue is available', async () => {
    const events = [makeEvent('evt-1')]
    const { repo, state } = makeRepo(events)

    const relay = createOutboxRelay(repo, undefined, { relayId: 'relay-test-1' })
    await relay.poll()

    expect(state.markedPublished).toHaveLength(0)
  })

  it('passes the host-scoped relay identity to claimUnpublished', async () => {
    const { repo } = makeRepo([])
    const { queue } = makeQueue()

    const relay = createOutboxRelay(repo, queue)
    await relay.poll()

    const claimArgs = (repo.claimUnpublished as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(claimArgs[1]).toMatch(/^relay-.+-\d+$/)
    expect(claimArgs[1]).not.toBe(`relay-${process.pid}`)
  })
})

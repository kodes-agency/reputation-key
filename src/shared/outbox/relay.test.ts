import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import { EXPEDITED_DISPATCH_EVENT_TYPES } from './dispatch-job-options'
import { createOutboxRelay } from './relay'
import type { OutboxRepository } from './infrastructure/outbox-repository'

type Delivery = Readonly<{
  id: string
  subjectId: string
  organizationId: string
  eventType: string
}>

function delivery(id: string, eventType = 'test.unregistered_poison'): Delivery {
  return { id: `work-${id}`, subjectId: id, organizationId: 'org-1', eventType }
}

function makeRepo(batches: Delivery[][]) {
  const schedulePending = vi.fn(async () => batches.shift() ?? [])
  const repo = { delivery: { schedulePending } } as unknown as OutboxRepository
  return { repo, schedulePending }
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

afterEach(() => vi.useRealTimers())

describe('outbox delivery admission', () => {
  it('admits poison facts without validating their payload at the relay', async () => {
    const work = delivery('poison')
    const { repo, schedulePending } = makeRepo([[work]])
    const { queue, added } = makeQueue()

    await createOutboxRelay(repo, queue).poll()

    expect(schedulePending).toHaveBeenCalledOnce()
    expect(added).toEqual([
      {
        name: work.eventType,
        data: { workId: work.id },
        opts: expect.objectContaining({ jobId: `${work.id}-initial`, attempts: 1 }),
      },
    ])
  })

  it('sends only work IDs and gives the ledger sole ownership of retries', async () => {
    const work = [delivery('one'), delivery('two')]
    const { repo } = makeRepo([work])
    const { queue, added } = makeQueue()

    await createOutboxRelay(repo, queue).poll()

    expect(added).toHaveLength(2)
    for (const [index, call] of added.entries()) {
      expect(call.data).toEqual({ workId: work[index]!.id })
      expect(call.opts).toMatchObject({
        jobId: `${work[index]!.id}-initial`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      })
      expect(call.opts.backoff).toBeUndefined()
    }
  })

  it('expedites the switch a manager is watching while its replay keeps its place', async () => {
    const { repo } = makeRepo([
      [
        delivery('switch', 'identity.merchant_ai.changed'),
        delivery('backfill', 'ai.review_analysis.backfill_requested'),
        delivery('review', 'review.created'),
      ],
    ])
    const { queue, added } = makeQueue()

    await createOutboxRelay(repo, queue).poll()

    expect(added.map((call) => [call.name, call.opts.lifo])).toEqual([
      ['identity.merchant_ai.changed', true],
      ['ai.review_analysis.backfill_requested', undefined],
      ['review.created', undefined],
    ])
  })

  it('expedites only catalogued event families', () => {
    const catalogued = new Set(EVENT_FAMILY_ROWS.map((row) => row.eventType))
    expect(
      [...EXPEDITED_DISPATCH_EVENT_TYPES].filter((type) => !catalogued.has(type)),
    ).toEqual([])
  })

  it('persists admission before enqueue and continues after a transport failure', async () => {
    const work = [delivery('failed'), delivery('healthy')]
    const { repo, schedulePending } = makeRepo([work])
    const { queue, added } = makeQueue()
    vi.mocked(queue.add).mockRejectedValueOnce(new Error('transport unavailable'))

    await createOutboxRelay(repo, queue).poll()

    expect(schedulePending).toHaveBeenCalledOnce()
    expect(queue.add).toHaveBeenCalledTimes(2)
    expect(schedulePending.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(queue.add).mock.invocationCallOrder[0]!,
    )
    expect(added).toHaveLength(1)
    expect(added[0]!.data).toEqual({ workId: work[1]!.id })
  })

  it('admits durable work even when the queue is unavailable', async () => {
    const { repo, schedulePending } = makeRepo([[delivery('pending')]])

    await createOutboxRelay(repo, undefined).poll()

    expect(schedulePending).toHaveBeenCalledOnce()
  })

  it('never enqueues when durable admission fails', async () => {
    const { repo, schedulePending } = makeRepo([])
    schedulePending.mockRejectedValueOnce(new Error('database unavailable'))
    const { queue } = makeQueue()

    await expect(createOutboxRelay(repo, queue).poll()).rejects.toThrow(
      'database unavailable',
    )
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('passes the bounded batch and consumer expectations to admission', async () => {
    const { repo, schedulePending } = makeRepo([])
    const expectations = [{ eventType: 'test.fact', consumerName: 'test.consumer' }]

    await createOutboxRelay(repo, undefined, {
      batchSize: 7,
      consumerExpectations: expectations,
    }).poll()

    expect(schedulePending).toHaveBeenCalledWith(7, expectations)
  })
})

describe('scheduled delivery drain', () => {
  const full = (tag: string) =>
    Array.from({ length: 50 }, (_, index) => delivery(`${tag}-${index}`))

  it('drains full batches within one tick', async () => {
    vi.useFakeTimers()
    const { repo, schedulePending } = makeRepo([full('a'), full('b'), [delivery('last')]])
    const { queue, added } = makeQueue()
    const stop = createOutboxRelay(repo, queue).start(1_000)

    await vi.advanceTimersByTimeAsync(1_500)
    expect(schedulePending).toHaveBeenCalledTimes(3)
    expect(added).toHaveLength(101)
    await stop()
  })

  it('does not overlap a pass while admission is pending', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<Delivery[]>()
    const { repo, schedulePending } = makeRepo([])
    schedulePending.mockReturnValueOnce(gate.promise)
    const { queue } = makeQueue()
    const stop = createOutboxRelay(repo, queue).start(1_000)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(schedulePending).toHaveBeenCalledOnce()
    gate.resolve([])
    await stop()
  })

  it('stops draining after the active batch once stopped', async () => {
    vi.useFakeTimers()
    const { repo, schedulePending } = makeRepo([full('a'), full('b')])
    const { queue } = makeQueue()
    let stop: () => Promise<void> = async () => {}
    vi.mocked(queue.add).mockImplementationOnce(async () => {
      void stop()
      return { id: 'first' } as Awaited<ReturnType<Queue['add']>>
    })
    stop = createOutboxRelay(repo, queue).start(1_000)

    await vi.advanceTimersByTimeAsync(6_000)
    expect(schedulePending).toHaveBeenCalledOnce()
    await stop()
  })

  it('recovers the next tick after admission fails', async () => {
    vi.useFakeTimers()
    const { repo, schedulePending } = makeRepo([[delivery('recovered')]])
    schedulePending.mockRejectedValueOnce(new Error('database unavailable'))
    const { queue, added } = makeQueue()
    const stop = createOutboxRelay(repo, queue).start(1_000)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(schedulePending).toHaveBeenCalledTimes(2)
    expect(added).toHaveLength(1)
    await stop()
  })

  it('waits for the active enqueue before dependencies close', async () => {
    vi.useFakeTimers()
    const { repo, schedulePending } = makeRepo([[delivery('pending')]])
    const { queue } = makeQueue()
    const gate = Promise.withResolvers<Awaited<ReturnType<Queue['add']>>>()
    vi.mocked(queue.add).mockReturnValueOnce(gate.promise)
    const stop = createOutboxRelay(repo, queue).start(10)
    await vi.advanceTimersByTimeAsync(10)
    let stopped = false
    const stopping = stop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    gate.resolve({ id: 'pending' } as Awaited<ReturnType<Queue['add']>>)
    await stopping
    await vi.advanceTimersByTimeAsync(50)
    expect(stopped).toBe(true)
    expect(schedulePending).toHaveBeenCalledOnce()
  })
})

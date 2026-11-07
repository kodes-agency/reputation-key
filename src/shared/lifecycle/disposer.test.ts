import { describe, expect, it, vi } from 'vitest'
import { disposeResources, type DisposalHook } from './disposer'

const hook = (
  label: string,
  order: string[],
  release: () => void | Promise<unknown> = () => {},
): DisposalHook => ({
  label,
  release: async () => {
    order.push(label)
    await release()
  },
})

describe('disposeResources', () => {
  it('runs the hooks of a stage together and the stages one after another', async () => {
    const order: string[] = []
    const gate = Promise.withResolvers<void>()
    const done = disposeResources([
      [hook('a1', order, () => gate.promise), hook('a2', order)],
      [hook('b', order)],
    ])

    await new Promise((resolve) => setImmediate(resolve))
    expect(order).toEqual(['a1', 'a2'])
    gate.resolve()

    await expect(done).resolves.toEqual({ timedOut: false, stuck: [], failed: [] })
    expect(order).toEqual(['a1', 'a2', 'b'])
  })

  it('reports a rejecting hook and still runs every later stage', async () => {
    const order: string[] = []
    const onError = vi.fn()
    const failure = new Error('refused')

    const result = await disposeResources(
      [
        [
          hook('first', order, () => {
            throw failure
          }),
        ],
        [hook('second', order)],
      ],
      { onError },
    )

    expect(result).toEqual({ timedOut: false, stuck: [], failed: ['first'] })
    expect(order).toEqual(['first', 'second'])
    expect(onError).toHaveBeenCalledWith(failure, 'first')
  })

  it('still waits for peers and releases later stages when error reporting throws', async () => {
    const order: string[] = []
    const peer = Promise.withResolvers<void>()
    const failure = new Error('close failed')
    const onError = vi.fn(() => {
      throw new Error('logger failed')
    })
    const disposal = disposeResources(
      [
        [
          hook('failed', order, () => Promise.reject(failure)),
          hook('peer', order, () => peer.promise),
        ],
        [hook('later', order)],
      ],
      { onError },
    )
    const settled = vi.fn()
    const observed = disposal.then(settled, settled)

    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).not.toHaveBeenCalled()
    expect(order).toEqual(['failed', 'peer'])
    peer.resolve()

    await expect(disposal).resolves.toEqual({
      timedOut: false,
      stuck: [],
      failed: ['failed'],
    })
    await observed
    expect(order).toEqual(['failed', 'peer', 'later'])
    expect(onError).toHaveBeenCalledWith(failure, 'failed')
  })

  it('stops starting stages once the deadline expires and names what was left', async () => {
    const order: string[] = []

    const result = await disposeResources(
      [[hook('hung', order, () => new Promise<void>(() => {}))], [hook('later', order)]],
      { budgetMs: 20 },
    )

    expect(result).toEqual({ timedOut: true, stuck: ['hung', 'later'], failed: [] })
    expect(order).toEqual(['hung'])
  })
})

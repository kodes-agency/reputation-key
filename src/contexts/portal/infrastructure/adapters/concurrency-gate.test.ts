import { describe, expect, it } from 'vitest'
import { createConcurrencyGate } from './concurrency-gate'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('createConcurrencyGate', () => {
  it('never runs more tasks at once than its limit, and runs them all', async () => {
    const gate = createConcurrencyGate(2)
    let running = 0
    let peak = 0
    const gates = Array.from({ length: 5 }, deferred)
    const results = gates.map((held, index) =>
      gate(async () => {
        running += 1
        peak = Math.max(peak, running)
        await held.promise
        running -= 1
        return index
      }),
    )
    await Promise.resolve()
    expect(running).toBe(2)
    for (const held of gates) {
      held.resolve()
      await Promise.resolve()
    }
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
  })

  it('gives its place to the next task when one throws', async () => {
    const gate = createConcurrencyGate(1)
    const failed = gate(async () => {
      throw new Error('boom')
    })
    const next = gate(async () => 'ran')
    await expect(failed).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ran')
  })
})

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

  it('hands a freed place straight to a waiting task, so a late arrival cannot take it', async () => {
    // Whatever microtask a new caller lands on after a release, the peak stays
    // at the limit: sweep the arrival timing across the wake-up window.
    for (let delay = 0; delay <= 6; delay += 1) {
      const gate = createConcurrencyGate(2)
      let running = 0
      let peak = 0
      const track = async (held: Promise<void>) => {
        running += 1
        peak = Math.max(peak, running)
        await held
        running -= 1
      }
      const first = deferred()
      const second = deferred()
      const third = deferred()
      const fourth = deferred()
      const runs = [
        gate(() => track(first.promise)),
        gate(() => track(second.promise)),
        gate(() => track(third.promise)),
      ]
      await Promise.resolve()
      first.resolve()
      for (let tick = 0; tick < delay; tick += 1) await Promise.resolve()
      runs.push(gate(() => track(fourth.promise)))
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
      second.resolve()
      third.resolve()
      fourth.resolve()
      await Promise.all(runs)
      expect(peak, `arrival ${delay} microtasks after the release`).toBe(2)
    }
  })
})

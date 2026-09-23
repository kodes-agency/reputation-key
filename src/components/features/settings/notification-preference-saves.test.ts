import { describe, expect, it } from 'vitest'
import {
  applyPreferencePatch,
  createSerialRunner,
  type PreferenceValues,
} from './notification-preference-saves'

/** A promise the test settles by hand. */
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createSerialRunner', () => {
  it('starts a second save of the same row only after the first has settled', async () => {
    const runner = createSerialRunner()
    const first = deferred()
    const started: string[] = []

    const a = runner.run('row', async () => {
      started.push('a')
      await first.promise
    })
    const b = runner.run('row', async () => {
      started.push('b')
    })
    await flush()
    expect(started).toEqual(['a'])

    first.resolve()
    await Promise.all([a, b])
    expect(started).toEqual(['a', 'b'])
  })

  it('still runs the next save when the one before it failed', async () => {
    const runner = createSerialRunner()
    const failed = runner.run('row', async () => {
      throw new Error('network down')
    })
    const next = runner.run('row', async () => 'saved')

    await expect(failed).rejects.toThrow('network down')
    await expect(next).resolves.toBe('saved')
  })

  it('does not hold up a different row', async () => {
    const runner = createSerialRunner()
    const blocked = deferred()
    void runner.run('in_app', () => blocked.promise)

    await expect(runner.run('email', async () => 'saved')).resolves.toBe('saved')
    blocked.resolve()
  })
})

describe('applyPreferencePatch', () => {
  const saved: PreferenceValues = { enabled: true, cadence: 'daily' }

  it('fills a row that was never saved from the category defaults', () => {
    expect(
      applyPreferencePatch('workflow_collaboration', 'email', undefined, {
        cadence: 'immediate',
      }),
    ).toEqual({ enabled: false, cadence: 'immediate' })
  })

  it('keeps every value the patch does not name', () => {
    expect(applyPreferencePatch('urgent_operational', 'email', saved, {})).toEqual(saved)
  })

  it('clamps a cadence the category no longer offers', () => {
    expect(
      applyPreferencePatch('recognition', 'email', saved, { cadence: 'immediate' }),
    ).toEqual({ enabled: true, cadence: 'daily' })
  })
})

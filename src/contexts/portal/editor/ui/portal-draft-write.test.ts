import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, saved } from './portal-draft-autosave-harness'

afterEach(() => vi.useRealTimers())

describe('immediate editor writes', () => {
  it.each([
    'portal-look-colours',
    'portal-look-wordmark',
    'portal-photo-focal',
    'link-texts:tile',
  ])('retires a failed %s save only after its replacement is accepted', async (key) => {
    const { autosave } = harness()
    const stale = vi.fn(async () => {
      throw new Error('offline')
    })
    autosave.schedule(key, stale)
    await autosave.flush()
    expect(autosave.needsAttention()).toBe(true)
    await expect(
      autosave.write(
        async () => {
          throw new Error('refused')
        },
        { replaces: [key] },
      ),
    ).rejects.toThrow('refused')
    expect(autosave.needsAttention()).toBe(true)
    await autosave.write(async () => undefined, { replaces: [key] })
    await autosave.retry()
    expect(stale).toHaveBeenCalledTimes(1)
    expect(autosave.hasUnsaved()).toBe(false)
  })

  it('keeps edits made after a replacement was requested', async () => {
    const { autosave } = harness()
    let release: () => void = () => undefined
    const replacing = autosave.write(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
      { replaces: ['portal-photo-focal'] },
    )
    await vi.advanceTimersByTimeAsync(0)
    const latest = vi.fn(saved)
    autosave.schedule('portal-photo-focal', latest)
    release()
    await replacing
    await autosave.flush()
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it('runs at once when no field is waiting and returns the control’s result', async () => {
    const { autosave } = harness()
    await expect(autosave.write(async () => 'new photo')).resolves.toBe('new photo')
    expect(autosave.hasUnsaved()).toBe(false)
  })

  it('lands a pending focal point before starting photo replacement', async () => {
    const { autosave } = harness()
    const log: string[] = []
    let finishFocal: () => void = () => undefined
    autosave.schedule('photo-focal', async () => {
      log.push('focal started')
      await new Promise<void>((resolve) => {
        finishFocal = resolve
      })
      log.push('focal landed')
      return 'saved'
    })
    const result = autosave.write(async () => {
      log.push('use photo started')
      return 'new photo'
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toEqual(['focal started'])
    finishFocal()
    await expect(result).resolves.toBe('new photo')
    expect(log).toEqual(['focal started', 'focal landed', 'use photo started'])
  })

  it.each(['address', 'icon', 'photo', 'look', 'linktree-enabled'])(
    'keeps a slow %s write in the same queue as later typing and actions',
    async (field) => {
      const { autosave } = harness()
      const log: string[] = []
      let release: () => void = () => undefined
      const first = autosave.write(
        () =>
          new Promise<void>((resolve) => {
            log.push(field)
            release = resolve
          }),
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(autosave.getState().status).toBe('idle')
      autosave.schedule('welcome', async () => (log.push('text'), 'saved'))
      await vi.advanceTimersByTimeAsync(800)
      const second = autosave.write(async () => {
        log.push('next action')
      })
      const leaving = autosave.flush().then(() => log.push('left'))
      expect(autosave.hasUnsaved()).toBe(true)
      expect(log).toEqual([field])

      release()
      await Promise.all([first, second, leaving])
      expect(log).toEqual([field, 'text', 'next action', 'left'])
      expect(autosave.hasUnsaved()).toBe(false)
    },
  )

  it('reports a refused action to its control and still runs the next save', async () => {
    const { autosave } = harness()
    const refused = autosave.write(async () => {
      throw new Error('refused')
    })
    const rejection = expect(refused).rejects.toThrow('refused')
    const text = vi.fn(saved)
    autosave.schedule('welcome', text)
    await autosave.flush()
    await rejection
    expect(text).toHaveBeenCalledTimes(1)
    expect(autosave.getState().status).toBe('saved')
  })
})

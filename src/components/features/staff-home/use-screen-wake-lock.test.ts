import { describe, expect, it, vi } from 'vitest'
import { keepScreenAwake, useScreenWakeLock } from './use-screen-wake-lock'

function page(): {
  visibilityState: DocumentVisibilityState
  addEventListener: EventTarget['addEventListener']
  removeEventListener: EventTarget['removeEventListener']
  dispatch: () => boolean
} {
  const events = new EventTarget()
  return {
    visibilityState: 'visible',
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatch: () => events.dispatchEvent(new Event('visibilitychange')),
  }
}
describe('screen wake lock', () => {
  it('is optional and swallows a browser refusal', async () => {
    const doc = page()
    const stop = keepScreenAwake(undefined, doc)
    stop()
    const request = vi.fn().mockRejectedValue(new Error('Battery policy'))
    const release = keepScreenAwake({ request }, doc)
    await Promise.resolve()
    release()
    expect(request).toHaveBeenCalledWith('screen')
    expect(typeof useScreenWakeLock).toBe('function')
  })
  it('releases when hidden, reacquires on visibility and releases on leaving', async () => {
    const doc = page()
    const release = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockResolvedValue({ release })
    const stop = keepScreenAwake({ request }, doc)
    await Promise.resolve()
    doc.visibilityState = 'hidden'
    doc.dispatch()
    expect(release).toHaveBeenCalledTimes(1)
    doc.visibilityState = 'visible'
    doc.dispatch()
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(2)
    stop()
    expect(release).toHaveBeenCalledTimes(2)
    doc.dispatch()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('releases a request that resolves after unmount', async () => {
    const doc = page()
    const release = vi.fn().mockResolvedValue(undefined)
    let resolve: (lock: { release: typeof release }) => void = () => undefined
    const request = () =>
      new Promise<{ release: typeof release }>((done) => {
        resolve = done
      })
    const stop = keepScreenAwake({ request }, doc)
    stop()
    resolve({ release })
    await Promise.resolve()
    expect(release).toHaveBeenCalledTimes(1)
  })
})

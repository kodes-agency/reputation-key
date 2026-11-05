import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebShutdown } from './graceful-shutdown'

const makeShutdown = (
  closers: Parameters<typeof createWebShutdown>[0]['closers'] = [],
) => {
  const options = {
    fetch: vi.fn(async () => new Response('finished')),
    closers,
    budgetMs: 1000,
    logger: { info: vi.fn(), error: vi.fn() },
    beginDrain: vi.fn(),
    failed: vi.fn(),
    setExitCode: vi.fn(),
    forceExit: vi.fn(),
  }
  return { options, create: () => createWebShutdown(options) }
}

afterEach(() => vi.useRealTimers())

/** Let every queued microtask run, so "not released yet" is not just "not yet scheduled". */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('web process drain', () => {
  it('SIGTERM waits for a live native response before releasing dependencies and refuses new traffic', async () => {
    const release = vi.fn(async () => {})
    const { options, create } = makeShutdown([{ name: 'database', close: release }])
    const web = create()
    const signals = new EventEmitter()
    signals.once('SIGTERM', () => {
      void web.shutdown('SIGTERM')
    })
    const native = new EventEmitter()
    const request = Object.assign(new Request('http://local/request'), {
      runtime: { node: { res: native } },
    })
    expect((await web.fetch(request)).status).toBe(200)

    signals.emit('SIGTERM')
    const draining = web.shutdown()
    expect(web.shutdown()).toBe(draining)
    expect(options.beginDrain).toHaveBeenCalledOnce()
    await flush()
    expect(release).not.toHaveBeenCalled()
    expect((await web.fetch(new Request('http://local/late'))).status).toBe(503)
    expect(options.fetch).toHaveBeenCalledOnce()

    native.emit('finish')
    await draining
    expect(release).toHaveBeenCalledOnce()
    expect(options.setExitCode).not.toHaveBeenCalled()
    expect(options.forceExit).not.toHaveBeenCalled()
    expect(native.listenerCount('close')).toBe(0)
    expect(options.logger.info).toHaveBeenCalledWith(
      { signal: 'SIGTERM' },
      expect.stringContaining('Shutdown signal received'),
    )
  })

  it('an aborted socket still waits for the running handler before cleanup', async () => {
    const release = vi.fn(async () => {})
    const { options, create } = makeShutdown([{ name: 'database', close: release }])
    const gate = Promise.withResolvers<Response>()
    options.fetch.mockReturnValue(gate.promise)
    const web = create()
    const native = new EventEmitter()
    const request = Object.assign(new Request('http://local/aborted'), {
      runtime: { node: { res: native } },
    })
    const response = web.fetch(request)
    native.emit('close')
    const draining = web.shutdown()
    await flush()
    expect(release).not.toHaveBeenCalled()
    gate.resolve(new Response('finished'))
    await response
    await draining
    expect(release).toHaveBeenCalledOnce()
  })

  it('waits for a streaming response body outside the native adapter', async () => {
    const release = vi.fn(async () => {})
    const { options, create } = makeShutdown([{ name: 'database', close: release }])
    let finishBody = () => {}
    options.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('part'))
            finishBody = () => controller.close()
          },
        }),
      ),
    )
    const web = create()
    const response = await web.fetch(new Request('http://local/stream'))
    const body = response.text()
    const draining = web.shutdown()
    await flush()
    expect(release).not.toHaveBeenCalled()
    finishBody()
    expect(await body).toBe('part')
    await draining
    expect(release).toHaveBeenCalledOnce()
  })

  it('a rejected close still releases later resources and sets exit status 1', async () => {
    const later = vi.fn(async () => {})
    const { options, create } = makeShutdown([
      {
        name: 'redis',
        close: async () => {
          throw new Error('close failed')
        },
      },
      { name: 'pool', close: later },
    ])
    await create().shutdown()
    expect(later).toHaveBeenCalledOnce()
    expect(options.failed).toHaveBeenCalledOnce()
    expect(options.setExitCode).toHaveBeenCalledWith(1)
  })

  it('a hung request exhausts the same deadline and exits 1 without closing its dependencies', async () => {
    vi.useFakeTimers()
    const release = vi.fn(async () => {})
    const { options, create } = makeShutdown([{ name: 'database', close: release }])
    const web = create()
    const native = new EventEmitter()
    await web.fetch(
      Object.assign(new Request('http://local/hung'), {
        runtime: { node: { res: native } },
      }),
    )
    const draining = web.shutdown()
    await vi.advanceTimersByTimeAsync(1000)
    await draining
    expect(release).not.toHaveBeenCalled()
    expect(options.forceExit).toHaveBeenCalledWith(1)
    native.emit('close')
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()
  })
})

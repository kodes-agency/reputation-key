import { EventEmitter } from 'node:events'
import type { Page, Request } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { assertDownloadBudget, attachDownloadLog } from './download-log'

function browser() {
  const events = new EventEmitter()
  const idle = vi.fn(async () => undefined)
  const page = Object.assign(events, { waitForLoadState: idle }) as unknown as Page
  return { events, idle, finish: attachDownloadLog(page) }
}

function response(url: string, bodyBytes: number, headerBytes = 100): Request {
  return {
    url: () => url,
    sizes: async () => ({
      requestBodySize: 500,
      requestHeadersSize: 200,
      responseBodySize: bodyBytes,
      responseHeadersSize: headerBytes,
    }),
  } as unknown as Request
}

describe('guest download recording', () => {
  it('counts encoded responses and headers, including repeat URLs and external assets', async () => {
    const { events, finish } = browser()
    for (const request of [
      response('http://app/p/portal', 1000),
      response('http://app/assets/guest.js', 2000),
      response('http://app/fonts/guest/font.woff2', 3000),
      response('http://app/_serverFn/rating', 50),
      response('http://app/_serverFn/rating', 60),
      response('https://cdn.example/photo.jpg', 4000),
    ])
      events.emit('requestfinished', request)

    const report = await finish()
    expect(report.bytes).toBe(10_710)
    expect(report.responses).toHaveLength(6)
    expect(report.responses[1]).toEqual({
      url: 'http://app/assets/guest.js',
      bodyBytes: 2000,
      headerBytes: 100,
    })
    expect(events.listenerCount('request')).toBe(0)
    expect(events.listenerCount('requestfinished')).toBe(0)
    expect(events.listenerCount('requestfailed')).toBe(0)
  })

  it('includes responses arriving while the journey settles and waits for their sizes', async () => {
    const { events, idle, finish } = browser()
    const request = response('http://app/late.css', 100)
    let complete!: (value: Awaited<ReturnType<Request['sizes']>>) => void
    request.sizes = () =>
      new Promise((resolve) => {
        complete = resolve
      })
    idle.mockImplementation(async () => {
      events.emit('requestfinished', request)
    })

    const report = finish()
    await Promise.resolve()
    complete({
      requestBodySize: 0,
      requestHeadersSize: 0,
      responseBodySize: 100,
      responseHeadersSize: 20,
    })
    expect((await report).bytes).toBe(120)
    expect(idle).toHaveBeenCalledWith('networkidle')
  })

  it('refuses an incomplete measurement when a request fails', async () => {
    const { events, finish } = browser()
    events.emit('requestfinished', response('http://app/p/portal', 1000))
    events.emit('requestfailed', response('http://app/truncated.js', 0))
    await expect(finish()).rejects.toThrow('incomplete')
  })

  it('refuses a pending download that fails after an earlier network idle', async () => {
    const { events, idle, finish } = browser()
    events.emit('requestfinished', response('http://app/p/portal', 1000))
    await idle()
    const request = response('http://app/truncated.js', 0)
    events.emit('request', request)

    const measurement = expect(finish()).rejects.toThrow('incomplete')
    await new Promise<void>((resolve) => setImmediate(resolve))
    events.emit('requestfailed', request)
    await measurement
    expect(events.listenerCount('request')).toBe(0)
    expect(events.listenerCount('requestfinished')).toBe(0)
    expect(events.listenerCount('requestfailed')).toBe(0)
  })

  it('drains requests started while response sizes are being collected', async () => {
    const { events, finish } = browser()
    const initial = response('http://app/p/portal', 1000)
    const sizes = await initial.sizes()
    let complete!: (value: typeof sizes) => void
    initial.sizes = () =>
      new Promise((resolve) => {
        complete = resolve
      })
    events.emit('request', initial)
    events.emit('requestfinished', initial)

    const measurement = finish()
    await new Promise<void>((resolve) => setImmediate(resolve))
    const late = response('http://app/late.css', 200)
    events.emit('request', late)
    complete(sizes)
    await new Promise<void>((resolve) => setImmediate(resolve))
    events.emit('requestfinished', late)

    const report = await measurement
    expect(report.bytes).toBe(1400)
    expect(report.responses).toHaveLength(2)
  })

  it('refuses unavailable response sizes instead of silently counting zero', async () => {
    const { events, finish } = browser()
    const request = response('http://app/p/portal', 0)
    request.sizes = async () => {
      throw new Error('size unavailable')
    }
    events.emit('requestfinished', request)
    await expect(finish()).rejects.toThrow('incomplete')
  })

  it('refuses an empty recording', async () => {
    await expect(browser().finish()).rejects.toThrow('No downloaded bytes')
  })
})

describe('guest download budget', () => {
  it('accepts a download total exactly at the fixed ceiling', () => {
    expect(() => assertDownloadBudget({ bytes: 1000 }, 1000)).not.toThrow()
  })

  it('rejects a single byte over the ceiling', () => {
    expect(() => assertDownloadBudget({ bytes: 1001 }, 1000)).toThrow(
      'Guest downloaded 1001 bytes; fixed limit is 1000 bytes',
    )
  })

  it('rejects an excess download, including response headers', async () => {
    const { events, finish } = browser()
    events.emit('requestfinished', response('http://app/p/portal', 900, 100))
    expect(() => assertDownloadBudget({ bytes: 1000 }, 1000)).not.toThrow()
    events.emit('requestfinished', response('http://app/excess.bin', 1, 100))
    const report = await finish()
    expect(() => assertDownloadBudget(report, 1000)).toThrow(
      'Guest downloaded 1101 bytes; fixed limit is 1000 bytes',
    )
  })

  it('drains a pending excess download after an earlier network idle', async () => {
    const { events, idle, finish } = browser()
    const initial = response('http://app/p/portal', 900, 100)
    events.emit('request', initial)
    events.emit('requestfinished', initial)
    await idle()

    const excess = response('http://app/excess.bin', 1, 100)
    events.emit('request', excess)
    const finalized = vi.fn()
    const measurement = finish().then((report) => {
      finalized()
      return report
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const finalizedBeforeCompletion = finalized.mock.calls.length > 0
    events.emit('requestfinished', excess)

    const report = await measurement
    expect(finalizedBeforeCompletion).toBe(false)
    expect(() => assertDownloadBudget(report, 1000)).toThrow(
      'Guest downloaded 1101 bytes; fixed limit is 1000 bytes',
    )
    expect(events.listenerCount('request')).toBe(0)
    expect(events.listenerCount('requestfinished')).toBe(0)
    expect(events.listenerCount('requestfailed')).toBe(0)
  })
})

import { createServer as createPortReservation } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import {
  assertSeparatedPlatformHealthPort,
  createSidecarPlatformHealthController,
  createSidecarPlatformHealthServer,
} from './platform-health'

describe('sidecar platform health boundary (REG-04)', () => {
  it('keeps liveness dependency-free and readiness dynamic after boot', async () => {
    const readiness = vi
      .fn<(signal: AbortSignal) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const health = createSidecarPlatformHealthController({
      readiness,
      readinessTimeoutMs: 100,
    })

    const live = await health.handle(new Request('http://platform.invalid/health/live'))
    expect(live.status).toBe(200)
    expect(await live.json()).toEqual({ ok: true })
    expect(readiness).not.toHaveBeenCalled()

    await expect(
      health.handle(new Request('http://platform.invalid/health/ready')),
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      health.handle(new Request('http://platform.invalid/health/ready')),
    ).resolves.toMatchObject({ status: 503 })
    await expect(
      health.handle(new Request('http://platform.invalid/health/ready')),
    ).resolves.toMatchObject({ status: 200 })
    expect(readiness).toHaveBeenCalledTimes(3)
  })

  it('fails readiness closed on rejection or timeout without exposing a reason', async () => {
    const marker = 'provider-secret-marker'
    const rejecting = createSidecarPlatformHealthController({
      readiness: async () => {
        throw new Error(marker)
      },
      readinessTimeoutMs: 100,
    })
    const rejected = await rejecting.handle(
      new Request('http://platform.invalid/health/ready'),
    )
    expect(rejected.status).toBe(503)
    expect(await rejected.text()).toBe('{"ok":false}\n')
    expect(await responseHeaders(rejected)).toEqual({
      cacheControl: 'no-store',
      contentType: 'application/json; charset=utf-8',
      nosniff: 'nosniff',
    })

    const hanging = createSidecarPlatformHealthController({
      readiness: (signal) =>
        new Promise<boolean>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error(marker)), {
            once: true,
          })
        }),
      readinessTimeoutMs: 5,
    })
    const timedOut = await hanging.handle(
      new Request('http://platform.invalid/health/ready'),
    )
    expect(timedOut.status).toBe(503)
    expect(await timedOut.text()).toBe('{"ok":false}\n')
  })

  it('makes drain immediately unready while liveness remains dependency-free', async () => {
    const readiness = vi.fn(async () => true)
    const health = createSidecarPlatformHealthController({
      readiness,
      readinessTimeoutMs: 100,
    })

    health.beginDrain()

    const ready = await health.handle(new Request('http://platform.invalid/health/ready'))
    const live = await health.handle(new Request('http://platform.invalid/health/live'))
    expect(ready.status).toBe(503)
    expect(live.status).toBe(200)
    expect(readiness).not.toHaveBeenCalled()
  })

  it('does not let an in-flight readiness success race a newly-started drain', async () => {
    let resolveReadiness: ((ready: boolean) => void) | undefined
    const readiness = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReadiness = resolve
        }),
    )
    const health = createSidecarPlatformHealthController({
      readiness,
      readinessTimeoutMs: 100,
    })

    const response = health.handle(new Request('http://platform.invalid/health/ready'))
    await vi.waitFor(() => expect(readiness).toHaveBeenCalledOnce())
    health.beginDrain()
    resolveReadiness?.(true)

    await expect(response).resolves.toMatchObject({ status: 503 })
  })

  it('exposes only exact content-free health GETs, never protected sidecar routes', async () => {
    const readiness = vi.fn(async () => true)
    const health = createSidecarPlatformHealthController({
      readiness,
      readinessTimeoutMs: 100,
    })

    for (const request of [
      new Request('http://platform.invalid/authorize'),
      new Request('http://platform.invalid/v1/responses'),
      new Request('http://platform.invalid/health/ready?detail=1'),
      new Request('http://platform.invalid/health/ready', { method: 'POST' }),
    ]) {
      const response = await health.handle(request)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('')
    }
    expect(readiness).not.toHaveBeenCalled()
  })

  it('requires a dedicated port distinct from the protected mTLS listener', () => {
    expect(() => assertSeparatedPlatformHealthPort(8080, 8443)).not.toThrow()
    expect(() => assertSeparatedPlatformHealthPort(8443, 8443)).toThrow(
      /must be distinct/,
    )
    expect(() => assertSeparatedPlatformHealthPort(0, 8443)).toThrow(/invalid/)
    expect(() => assertSeparatedPlatformHealthPort(8080, 65_536)).toThrow(/invalid/)
  })

  it('serves the same exact policy through the plain HTTP platform adapter', async () => {
    const port = await availablePort()
    const readiness = vi.fn(async () => true)
    const health = createSidecarPlatformHealthServer({
      host: '0.0.0.0',
      healthPort: port,
      protectedMtlsPort: port === 8443 ? 8444 : 8443,
      readiness,
      readinessTimeoutMs: 100,
    })

    await health.listen()
    try {
      const live = await fetch(`http://127.0.0.1:${port}/health/live`)
      const ready = await fetch(`http://127.0.0.1:${port}/health/ready`)
      const protectedRoute = await fetch(`http://127.0.0.1:${port}/authorize`)
      expect(live.status).toBe(200)
      expect(await live.json()).toEqual({ ok: true })
      expect(ready.status).toBe(200)
      expect(await ready.json()).toEqual({ ok: true })
      expect(protectedRoute.status).toBe(404)

      health.beginDrain()
      const draining = await fetch(`http://127.0.0.1:${port}/health/ready`)
      expect(draining.status).toBe(503)
      expect(await draining.json()).toEqual({ ok: false })
    } finally {
      await health.stop()
    }
  })
})

async function responseHeaders(response: Response) {
  return {
    cacheControl: response.headers.get('cache-control'),
    contentType: response.headers.get('content-type'),
    nosniff: response.headers.get('x-content-type-options'),
  }
}

async function availablePort(): Promise<number> {
  const reservation = createPortReservation()
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '0.0.0.0', resolve)
  })
  const address = reservation.address()
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()))
  })
  if (!address || typeof address === 'string') {
    throw new Error('test port reservation did not expose a TCP port')
  }
  return address.port
}

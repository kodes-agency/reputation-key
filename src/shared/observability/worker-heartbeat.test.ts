import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/node'
import { WORKER_HEARTBEAT_KEY } from '#/shared/health/worker-heartbeat'
import { recordWorkerHeartbeat } from './worker-heartbeat'

vi.mock('@sentry/node', () => ({
  isEnabled: vi.fn(),
  captureCheckIn: vi.fn(),
}))

vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({ BETTER_AUTH_URL: 'https://app.example.test/configured/path' }),
}))

const clock = () => new Date('2026-11-04T12:00:00.000Z')
const redis = { set: vi.fn().mockResolvedValue('OK'), get: vi.fn() }
const logger = { warn: vi.fn() }
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'closed-beta-v2')
  vi.mocked(Sentry.isEnabled).mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('recordWorkerHeartbeat', () => {
  it('writes the heartbeat and checks in with the monitor configuration', async () => {
    await recordWorkerHeartbeat(redis, clock, logger)

    expect(redis.set).toHaveBeenCalledWith(
      WORKER_HEARTBEAT_KEY,
      clock().toISOString(),
      'EX',
      900,
    )
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      new URL('https://app.example.test/api/health/ready'),
      { redirect: 'manual', signal: expect.any(AbortSignal) },
    )
    expect(Sentry.captureCheckIn).toHaveBeenCalledExactlyOnceWith(
      { monitorSlug: 'worker-heartbeat', status: 'ok' },
      {
        schedule: { type: 'interval', value: 5, unit: 'minute' },
        checkinMargin: 5,
        maxRuntime: 1,
        failureIssueThreshold: 2,
        recoveryThreshold: 1,
      },
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each([204, 302, 500, 503])(
    'reports a %i web response as an error and logs only its status once',
    async (status) => {
      const body = status === 204 ? null : 'private details'
      fetchMock.mockResolvedValueOnce(new Response(body, { status }))

      await expect(recordWorkerHeartbeat(redis, clock, logger)).resolves.toBeUndefined()

      expect(redis.set).toHaveBeenCalledOnce()
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(Sentry.captureCheckIn).toHaveBeenCalledExactlyOnceWith(
        { monitorSlug: 'worker-heartbeat', status: 'error' },
        expect.any(Object),
      )
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        { status },
        'Worker web health check failed',
      )
    },
  )

  it('waits for the web check, then reports an error when it outlasts five seconds', async () => {
    // Node's timeout signal runs on a timer that fake timers cannot reach, so
    // the test owns the signal and expires it while the fetch is in flight.
    const expiry = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expiry.signal)
    const fetchStarted = Promise.withResolvers<void>()
    fetchMock.mockImplementationOnce((_url, init) => {
      fetchStarted.resolve()
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    })

    const heartbeat = recordWorkerHeartbeat(redis, clock, logger)
    await fetchStarted.promise
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled()

    const reason = new DOMException('The operation timed out.', 'TimeoutError')
    expiry.abort(reason)
    await expect(heartbeat).resolves.toBeUndefined()

    expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000)
    expect(redis.set).toHaveBeenCalledOnce()
    expect(Sentry.captureCheckIn).toHaveBeenCalledExactlyOnceWith(
      { monitorSlug: 'worker-heartbeat', status: 'error' },
      expect.any(Object),
    )
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { err: reason },
      'Worker web health check failed',
    )
  })

  it('keeps the heartbeat successful and reports an error when fetch throws', async () => {
    const err = new TypeError('fetch failed')
    fetchMock.mockRejectedValueOnce(err)

    await expect(recordWorkerHeartbeat(redis, clock, logger)).resolves.toBeUndefined()

    expect(redis.set).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(Sentry.captureCheckIn).toHaveBeenCalledExactlyOnceWith(
      { monitorSlug: 'worker-heartbeat', status: 'error' },
      expect.any(Object),
    )
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { err },
      'Worker web health check failed',
    )
  })

  it('keeps writing the heartbeat without configured Sentry', async () => {
    vi.mocked(Sentry.isEnabled).mockReturnValue(false)

    await recordWorkerHeartbeat(redis, clock, logger)

    expect(redis.set).toHaveBeenCalledOnce()
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['test', 'development'])('does not check in in %s', async (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv)

    await recordWorkerHeartbeat(redis, clock, logger)

    expect(redis.set).toHaveBeenCalledOnce()
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not check in from a local production stack', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', undefined)

    await recordWorkerHeartbeat(redis, clock, logger)

    expect(redis.set).toHaveBeenCalledOnce()
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logs a throwing check-in once and leaves the heartbeat successful', async () => {
    const err = new Error('Sentry unavailable')
    vi.mocked(Sentry.captureCheckIn).mockImplementationOnce(() => {
      throw err
    })

    await expect(recordWorkerHeartbeat(redis, clock, logger)).resolves.toBeUndefined()

    expect(redis.set).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { err },
      'Worker heartbeat check-in failed',
    )
  })

  it('leaves a failed heartbeat write to the health check and sends no check-in', async () => {
    const failure = new Error('redis down')
    redis.set.mockRejectedValueOnce(failure)

    await expect(recordWorkerHeartbeat(redis, clock, logger)).rejects.toBe(failure)

    expect(Sentry.captureCheckIn).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

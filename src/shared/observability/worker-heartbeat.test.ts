import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/node'
import { WORKER_HEARTBEAT_KEY } from '#/shared/health/worker-heartbeat'
import { recordWorkerHeartbeat } from './worker-heartbeat'

vi.mock('@sentry/node', () => ({
  isEnabled: vi.fn(),
  captureCheckIn: vi.fn(),
}))

const clock = () => new Date('2026-11-04T12:00:00.000Z')
const redis = { set: vi.fn().mockResolvedValue('OK'), get: vi.fn() }
const logger = { warn: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'closed-beta-v2')
  vi.mocked(Sentry.isEnabled).mockReturnValue(true)
})

afterEach(() => vi.unstubAllEnvs())

describe('recordWorkerHeartbeat', () => {
  it('writes the heartbeat and checks in with the monitor configuration', async () => {
    await recordWorkerHeartbeat(redis, clock, logger)

    expect(redis.set).toHaveBeenCalledWith(
      WORKER_HEARTBEAT_KEY,
      clock().toISOString(),
      'EX',
      900,
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
  })

  it('keeps writing the heartbeat without configured Sentry', async () => {
    vi.mocked(Sentry.isEnabled).mockReturnValue(false)

    await recordWorkerHeartbeat(redis, clock, logger)

    expect(redis.set).toHaveBeenCalledOnce()
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled()
  })

  it.each(['test', 'development'])('does not check in in %s', async (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv)

    await recordWorkerHeartbeat(redis, clock, logger)

    expect(redis.set).toHaveBeenCalledOnce()
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled()
  })

  it('does not check in from a local production stack', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', undefined)

    await recordWorkerHeartbeat(redis, clock, logger)

    expect(redis.set).toHaveBeenCalledOnce()
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled()
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
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { reportGuestObservationLoss } from './report-observation-loss'

const NOW = new Date('2026-08-27T12:02:00.000Z')

function recordingLogger() {
  const warn = vi.fn()
  const logger: LoggerPort = {
    info: vi.fn(),
    warn,
    error: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  }
  return { logger, warn }
}

describe('reportGuestObservationLoss', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records only the controlled observation class and time', async () => {
    const record = vi.fn(async () => {})
    const { logger, warn } = recordingLogger()
    const report = reportGuestObservationLoss({
      monitor: { record },
      clock: () => NOW,
      logger,
    })

    await expect(report('review_link')).resolves.toBe('recorded')

    expect(record).toHaveBeenCalledWith({ kind: 'review_link', occurredAt: NOW })
    expect(warn).toHaveBeenCalledWith(
      {
        observationKind: 'review_link',
        observationLossMonitor: 'recorded',
      },
      'Guest analytics observation was lost',
    )
  })

  it('keeps the public path available and reports explicit degradation when monitoring fails', async () => {
    const { logger, warn } = recordingLogger()
    const report = reportGuestObservationLoss({
      monitor: {
        record: async () => {
          throw new Error('redis://secret-host:6379 and tenant payload')
        },
      },
      clock: () => NOW,
      logger,
    })

    await expect(report('scan')).resolves.toBe('monitor_unavailable')
    expect(warn).toHaveBeenCalledWith(
      {
        observationKind: 'scan',
        observationLossMonitor: 'unavailable',
      },
      'Guest analytics observation was lost',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-host')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tenant payload')
  })

  it('bounds an unresponsive monitor so public navigation cannot wait on Redis retries', async () => {
    vi.useFakeTimers()
    const { logger, warn } = recordingLogger()
    const report = reportGuestObservationLoss({
      monitor: { record: () => new Promise<void>(() => undefined) },
      clock: () => NOW,
      logger,
    })

    const outcome = report('review_link')
    await vi.advanceTimersByTimeAsync(250)

    await expect(outcome).resolves.toBe('monitor_unavailable')
    expect(warn).toHaveBeenCalledWith(
      {
        observationKind: 'review_link',
        observationLossMonitor: 'unavailable',
      },
      'Guest analytics observation was lost',
    )
  })

  it('does not let a logging failure escape into the public journey', async () => {
    const { logger, warn } = recordingLogger()
    warn.mockImplementation(() => {
      throw new Error('log transport unavailable')
    })
    const report = reportGuestObservationLoss({
      monitor: { record: async () => {} },
      clock: () => NOW,
      logger,
    })

    await expect(report('scan')).resolves.toBe('recorded')
  })
})

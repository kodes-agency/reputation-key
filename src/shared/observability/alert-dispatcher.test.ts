import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { AlertEvent } from './alert-definitions'
import { createAlertDispatcher } from './alert-dispatcher'

const clock = () => new Date('2026-09-03T12:00:00.000Z')

const BASE_ALERT = {
  name: 'worker.job-runtime-unready',
  owner: 'Platform',
  runbook: '§7.4',
  value: 3,
  threshold: 1,
  windowMs: 60_000,
  detail: 'Three governed jobs are not ready.',
} satisfies Omit<AlertEvent, 'severity'>

describe('alert dispatcher error reporting', () => {
  it.each(['P1', 'P2'] as const)(
    'reports %s alerts after logging them',
    async (severity) => {
      const logger = pino({ level: 'silent' })
      const error = vi.spyOn(logger, 'error')
      const report = vi.fn()
      const event = { ...BASE_ALERT, severity }

      await createAlertDispatcher({ logger, clock, report }).dispatch(event)

      expect(error).toHaveBeenCalledOnce()
      expect(report).toHaveBeenCalledOnce()
      expect(report).toHaveBeenCalledWith(event)
      expect(error.mock.invocationCallOrder[0]).toBeLessThan(
        report.mock.invocationCallOrder[0]!,
      )
    },
  )

  it.each(['P0', 'P3'] as const)('does not report %s alerts', async (severity) => {
    const logger = pino({ level: 'silent' })
    const report = vi.fn()

    await createAlertDispatcher({ logger, clock, report }).dispatch({
      ...BASE_ALERT,
      severity,
    })

    expect(report).not.toHaveBeenCalled()
  })
})

describe('alert dispatcher delivery', () => {
  const event: AlertEvent = { ...BASE_ALERT, severity: 'P1' }
  const webhookUrl = 'https://alerts.example.test/hook'

  it('still posts the webhook when error reporting throws', async () => {
    const logger = pino({ level: 'silent' })
    const fetchFn = vi.fn().mockResolvedValue({ ok: true })
    const report = vi.fn(() => {
      throw new Error('monitor down')
    })

    await createAlertDispatcher({ logger, clock, report, webhookUrl, fetchFn }).dispatch(
      event,
    )

    expect(report).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('retries a failed webhook once and stops after it succeeds', async () => {
    const logger = pino({ level: 'silent' })
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('reset'))
      .mockResolvedValue({ ok: true })

    await createAlertDispatcher({ logger, clock, webhookUrl, fetchFn }).dispatch(event)

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('gives up after two attempts without throwing', async () => {
    const logger = pino({ level: 'silent' })
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 })

    await expect(
      createAlertDispatcher({ logger, clock, webhookUrl, fetchFn }).dispatch(event),
    ).resolves.toBeUndefined()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

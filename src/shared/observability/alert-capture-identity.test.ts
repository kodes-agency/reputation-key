import { describe, expect, it, vi } from 'vitest'
import type { AlertEvent } from './alert-definitions'
import {
  createErrorMonitor,
  type ErrorCaptureContext,
  type ErrorMonitor,
  type ErrorMonitoringSdk,
} from './telemetry'

// The reporter captures through the process-wide monitor; route it to the one
// each test builds so the capture runs through a real beforeSend.
const route = vi.hoisted(() => ({ monitor: undefined as ErrorMonitor | undefined }))

vi.mock('#/shared/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./telemetry')>()),
  captureObservabilityException: (error: unknown, context: ErrorCaptureContext) =>
    route.monitor?.captureException(error, context),
}))

const { reportAlertToObservability } = await import('#/composition/alert-reporter')

type CaptureContext = Readonly<{
  tags?: Record<string, string>
  fingerprint?: readonly string[]
}>

function recordingSdk() {
  const scope = { clear: vi.fn(), addEventProcessor: vi.fn() }
  return {
    init: vi.fn<ErrorMonitoringSdk['init']>(),
    isInitialized: vi.fn<ErrorMonitoringSdk['isInitialized']>(() => false),
    setTags: vi.fn<ErrorMonitoringSdk['setTags']>(),
    captureException: vi.fn<ErrorMonitoringSdk['captureException']>(),
    captureFeedback: vi.fn<ErrorMonitoringSdk['captureFeedback']>(() => 'a'.repeat(32)),
    withScope: vi.fn<ErrorMonitoringSdk['withScope']>((callback) => callback(scope)),
    withIsolationScope: vi.fn<ErrorMonitoringSdk['withIsolationScope']>((callback) =>
      callback(scope),
    ),
    flush: vi.fn<ErrorMonitoringSdk['flush']>(async () => true),
  } satisfies ErrorMonitoringSdk
}

function alert(name: string, severity: AlertEvent['severity']): AlertEvent {
  return {
    name,
    severity,
    owner: 'Platform',
    runbook: '§15',
    value: 4,
    threshold: 1,
    windowMs: 300_000,
    detail: 'content-free summary',
  }
}

/**
 * What Sentry would send for each capture: the SDK builds the event from the
 * error and the capture context, then runs the configured beforeSend. Every
 * alert shares one stack (reporter → dispatcher), so only the fingerprint and
 * the exception type can tell two alerts apart once the message is redacted.
 */
function sentEvents(alerts: readonly AlertEvent[]) {
  const sentry = recordingSdk()
  const monitor = createErrorMonitor({
    sentry,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  monitor.initialize({
    service: 'worker',
    dsn: 'https://public@o1.ingest.us.sentry.io/1',
    environment: 'cell-us',
    release: 'a'.repeat(40),
    tracesSampleRate: 0,
  })
  const beforeSend = sentry.init.mock.calls[0]![0].beforeSend as (
    event: Record<string, unknown>,
  ) => Record<string, unknown> | null

  route.monitor = monitor
  try {
    for (const event of alerts) reportAlertToObservability(event)
  } finally {
    route.monitor = undefined
  }

  return sentry.captureException.mock.calls.map(([error, context]) => {
    const captured = error as Error
    const capture = (context ?? {}) as CaptureContext
    return beforeSend({
      exception: {
        values: [
          {
            type: captured.name,
            value: captured.message,
            stacktrace: { frames: [{ function: 'reportAlertToObservability' }] },
          },
        ],
      },
      tags: capture.tags,
      ...(capture.fingerprint ? { fingerprint: [...capture.fingerprint] } : {}),
    })
  })
}

describe('alert captures in the error monitor', () => {
  it('group each alert as its own issue with its name and severity as tags', () => {
    const [missing, feedback] = sentEvents([
      alert('notification.missing-for-inbox-item', 'P1'),
      alert('notification.email-provider-feedback-missing', 'P2'),
    ])

    expect(missing).toMatchObject({
      fingerprint: ['alert', 'notification.missing-for-inbox-item'],
      tags: {
        runtime_source: 'alert-dispatcher',
        alert: 'notification.missing-for-inbox-item',
        alert_severity: 'p1',
      },
      exception: {
        values: [
          {
            type: '[alert] notification.missing-for-inbox-item',
            value: '[REDACTED]',
          },
        ],
      },
    })
    expect(feedback).toMatchObject({
      fingerprint: ['alert', 'notification.email-provider-feedback-missing'],
      tags: { alert_severity: 'p2' },
    })
  })

  it('keeps any other capture free of a fingerprint', () => {
    const sentry = recordingSdk()
    const monitor = createErrorMonitor({
      sentry,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    monitor.initialize({
      service: 'web',
      dsn: 'https://public@o1.ingest.us.sentry.io/1',
      environment: 'cell-us',
      release: 'a'.repeat(40),
      tracesSampleRate: 0,
    })
    const beforeSend = sentry.init.mock.calls[0]![0].beforeSend as (
      event: Record<string, unknown>,
    ) => Record<string, unknown> | null

    const sent = beforeSend({
      tags: { runtime_source: 'nitro', alert: 'forged.alert' },
      fingerprint: ['caller-chosen'],
    })

    expect(sent).not.toHaveProperty('fingerprint')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureObservabilityException: vi.fn(),
}))

vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.captureObservabilityException,
}))

import { reportAlertToObservability } from './alert-reporter'

describe('reportAlertToObservability', () => {
  beforeEach(() => {
    mocks.captureObservabilityException.mockReset()
  })

  it('captures the complete operator-facing alert context', () => {
    reportAlertToObservability({
      name: 'worker.job-runtime-unready',
      severity: 'P1',
      owner: 'Platform',
      runbook: '§7.4',
      value: 3,
      threshold: 1,
      windowMs: 60_000,
      detail: 'Three governed jobs are not ready.',
    })

    expect(mocks.captureObservabilityException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '[alert] worker.job-runtime-unready',
        message:
          '[alert] worker.job-runtime-unready firing (P1): value 3 vs threshold 1; runbook §7.4',
      }),
      {
        source: 'alert-dispatcher',
        alert: { name: 'worker.job-runtime-unready', severity: 'P1' },
      },
    )
  })

  it('hands the monitor the content-free facts the alert was raised on', () => {
    reportAlertToObservability({
      name: 'sync.failed-nonzero',
      severity: 'P2',
      owner: 'Platform',
      runbook: 'runbooks.md §13',
      value: 3,
      threshold: 0,
      windowMs: 300_000,
      detail: '3 Review sync(s) have a coded failure whose retry is due',
      facts: { count: 3, codes: { provider_failure: 2, source_changed: 1 } },
    })

    expect(mocks.captureObservabilityException).toHaveBeenCalledWith(expect.any(Error), {
      source: 'alert-dispatcher',
      alert: {
        name: 'sync.failed-nonzero',
        severity: 'P2',
        facts: { count: 3, codes: { provider_failure: 2, source_changed: 1 } },
      },
    })
  })
})

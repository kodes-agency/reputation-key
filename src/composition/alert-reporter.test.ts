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
        message:
          '[alert] worker.job-runtime-unready firing (P1): value 3 vs threshold 1; runbook §7.4',
      }),
      { source: 'alert-dispatcher' },
    )
  })
})

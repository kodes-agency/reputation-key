import type { AlertEvent } from '#/shared/observability/alert-definitions'
import { captureObservabilityException } from '#/shared/observability/telemetry'

/** Forward dispatched P1/P2 alert evaluations to the configured error monitor. */
export function reportAlertToObservability(event: AlertEvent): void {
  const error = new Error(
    `[alert] ${event.name} firing (${event.severity}): value ${event.value} vs threshold ${event.threshold}; runbook ${event.runbook}`,
  )
  // The monitor redacts the message; the type survives and titles the issue.
  error.name = `[alert] ${event.name}`
  captureObservabilityException(error, {
    source: 'alert-dispatcher',
    alert: { name: event.name, severity: event.severity },
  })
}

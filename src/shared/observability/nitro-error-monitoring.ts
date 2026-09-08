import type {
  ErrorCaptureContext,
  ObservabilityInitResult,
  ObservabilityService,
} from './telemetry'
import { isExpectedRefusal } from '#/shared/security/expected-refusal'

interface NitroErrorMonitor {
  initialize(service: ObservabilityService): ObservabilityInitResult
  captureException(error: unknown, context: ErrorCaptureContext): void
}

interface NitroErrorMonitoringApp {
  readonly hooks: {
    hook(
      name: 'error',
      callback: (error: Error, context: { readonly tags?: string[] }) => void,
    ): unknown
  }
}

/**
 * Register the Nitro error hook without forwarding its request or route
 * context. Expected 4xx responses are product/security outcomes, not issues.
 */
export function createNitroErrorMonitoringPlugin(
  monitor: NitroErrorMonitor,
): (app: NitroErrorMonitoringApp) => void {
  return (app) => {
    monitor.initialize('web')
    app.hooks.hook('error', (error) => {
      if (isExpectedRefusal(error)) return
      monitor.captureException(error, { source: 'nitro' })
    })
  }
}

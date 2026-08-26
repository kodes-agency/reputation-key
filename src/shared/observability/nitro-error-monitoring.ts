import type {
  ErrorCaptureContext,
  ObservabilityInitResult,
  ObservabilityService,
} from './telemetry'

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

function httpStatus(error: Error): number | undefined {
  const candidate = error as Error & { status?: unknown; statusCode?: unknown }
  if (typeof candidate.statusCode === 'number') return candidate.statusCode
  return typeof candidate.status === 'number' ? candidate.status : undefined
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
      const status = httpStatus(error)
      if (status !== undefined && status < 500) return
      monitor.captureException(error, { source: 'nitro' })
    })
  }
}

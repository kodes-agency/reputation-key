// Nitro v3 error hook for unexpected server failures. The production process
// has already initialized Sentry through its Node --import preload; this hook
// binds the bundled application module to that SDK and captures errors Nitro
// handles before they can become process-level failures.

import { definePlugin } from 'nitro'
import { createNitroErrorMonitoringPlugin } from '#/shared/observability/nitro-error-monitoring'
import {
  captureObservabilityException,
  initObservability,
} from '#/shared/observability/telemetry'

export default definePlugin(
  createNitroErrorMonitoringPlugin({
    initialize: initObservability,
    captureException: captureObservabilityException,
  }),
)

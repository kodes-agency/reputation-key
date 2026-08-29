import { runSidecarStartup } from '../sidecar-operational-runtime'
import { monitoredSidecarObservability } from '../sidecar-monitored-observability'

await runSidecarStartup(
  'google-execution-admission',
  async () => {
    await import('./index')
  },
  monitoredSidecarObservability,
)

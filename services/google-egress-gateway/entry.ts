import { runSidecarStartup } from '../sidecar-operational-runtime'
import { monitoredSidecarObservability } from '../sidecar-monitored-observability'

await runSidecarStartup(
  'google-egress-gateway',
  async () => {
    await import('./index')
  },
  monitoredSidecarObservability,
)

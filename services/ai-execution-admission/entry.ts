import { runSidecarStartup } from '../sidecar-operational-runtime'
import { unmonitoredSidecarObservability } from '../sidecar-unmonitored-observability'

await runSidecarStartup(
  'ai-execution-admission',
  async () => {
    await import('./index')
  },
  unmonitoredSidecarObservability,
)

import { runSidecarStartup } from '../sidecar-operational-runtime'

await runSidecarStartup('ai-execution-admission', async () => {
  await import('./index')
})

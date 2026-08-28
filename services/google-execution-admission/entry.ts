import { runSidecarStartup } from '../sidecar-operational-runtime'

await runSidecarStartup('google-execution-admission', async () => {
  await import('./index')
})

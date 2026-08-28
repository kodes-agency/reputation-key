import { runSidecarStartup } from '../sidecar-operational-runtime'

await runSidecarStartup('google-egress-gateway', async () => {
  await import('./index')
})

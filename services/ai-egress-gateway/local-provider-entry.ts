import { runSidecarStartup } from '../sidecar-operational-runtime'

await runSidecarStartup('ai-egress-gateway', async () => {
  const [
    { startAiEgressGateway },
    { createLocalAiProviderFetch },
    { createOpenAiConnector },
  ] = await Promise.all([
    import('./bootstrap'),
    import('./local-provider-transport'),
    import('./openai-connector'),
  ])
  const outboundFetch = createLocalAiProviderFetch()
  await startAiEgressGateway((input) =>
    createOpenAiConnector({ ...input, outboundFetch }),
  )
})

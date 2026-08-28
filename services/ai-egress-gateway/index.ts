import { runSidecarStartup } from '../sidecar-operational-runtime'

await runSidecarStartup('ai-egress-gateway', async () => {
  const [{ startAiEgressGateway }, { createOpenAiConnector }] = await Promise.all([
    import('./bootstrap'),
    import('./openai-connector'),
  ])
  await startAiEgressGateway((input) => createOpenAiConnector(input))
})

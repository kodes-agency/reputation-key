import { startAiEgressGateway } from './bootstrap'
import { createLocalAiProviderFetch } from './local-provider-transport'
import { createOpenAiConnector } from './openai-connector'

async function main(): Promise<void> {
  const outboundFetch = createLocalAiProviderFetch()
  await startAiEgressGateway((input) =>
    createOpenAiConnector({ ...input, outboundFetch }),
  )
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})

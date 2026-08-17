import { startAiEgressGateway } from './bootstrap'
import { createOpenAiConnector } from './openai-connector'

await startAiEgressGateway((input) => createOpenAiConnector(input))

import type { OpenAiConnector } from './contracts'
import {
  createOpenAiProviderAdapter,
  createOpenAiProviderPreparation,
} from './openai-provider-adapter'
import { createAiProviderRegistry } from './provider-selection'

/** The registry of OpenAI alone, for preparers: every v2 route is OpenAI's. */
export function openAiPreparationRegistry() {
  return createAiProviderRegistry([createOpenAiProviderPreparation()])
}

/** The registry of OpenAI alone around one connector, for the gateway service. */
export function openAiAdapterRegistry(connector: OpenAiConnector) {
  return createAiProviderRegistry([createOpenAiProviderAdapter(connector)])
}

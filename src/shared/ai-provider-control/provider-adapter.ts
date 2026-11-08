import type {
  AiProviderAdapter,
  AiProviderConnection,
  AiProviderPreparation,
  PreparedInvocationBase,
} from './provider-contracts'

/**
 * A provider's request shaping joined to its one connector. Every provider is
 * wrapped the same way, so the gateway cannot tell which one it is calling; the
 * connector alone decides what an observer, readiness or shutdown means for it.
 */
export function createProviderAdapter<Invocation extends PreparedInvocationBase>(
  preparation: AiProviderPreparation<Invocation>,
  connector: AiProviderConnection<Invocation>,
): AiProviderAdapter<Invocation> {
  return Object.freeze({
    ...preparation,
    invoke: (...call: Parameters<AiProviderConnection<Invocation>['invoke']>) =>
      connector.invoke(...call),
    readiness: () => connector.readiness?.() ?? true,
    close: () => connector.close?.(),
    destroy: () => connector.destroy?.(),
  })
}

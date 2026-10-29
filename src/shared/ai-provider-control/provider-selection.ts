import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import type { AiProviderId } from './provider-contracts'

// Which provider serves an operation (contract section 7.3, decision 7).
//
// Switching is an operator's act and nothing else. The operator names a provider
// per capability; a profile that attests only one provider is served by it and
// ignores the name, so choosing Anthropic for review analysis moves no v2
// operation. There is no per-call fallback and no list of providers to try in
// turn: the one function below returns the provider the operator chose or throws
// why it cannot, and a refusal, an overload, a quota stop or an ambiguous dispatch
// is the same answer to the caller whichever provider gave it. Moving to the other
// provider takes the operator changing the choice and then a new analysis epoch,
// so one evidence window never mixes two models' judgements.

/** The operator's choice, per capability. It names a provider; it never ranks two. */
export type AiProviderSelectionConfig = Readonly<
  Partial<Record<MerchantAiCapability, AiProviderId>>
>

export type AiProviderSelectionRefusal =
  /** The profile attests no provider at all. */
  | 'no_eligible_provider'
  /** The profile attests several and the operator has chosen none of them. */
  | 'selection_required'
  /** The operator chose a provider the profile does not attest. */
  | 'selected_not_eligible'
  /** The choice is attested but this process holds no adapter for it. */
  | 'selected_not_registered'
  /** The choice's adapter says it cannot take a call now. */
  | 'selected_not_ready'

export class AiProviderSelectionError extends Error {
  constructor(readonly code: AiProviderSelectionRefusal) {
    super(code)
    this.name = 'AiProviderSelectionError'
  }
}

type SelectableAdapter = Readonly<{ providerId: AiProviderId; readiness?(): boolean }>

export type AiProviderRegistry<Adapter extends SelectableAdapter> = Readonly<{
  adapters: ReadonlyMap<AiProviderId, Adapter>
  selection: AiProviderSelectionConfig
}>

/** One adapter per provider; two for the same provider is a wiring mistake. */
export function createAiProviderRegistry<Adapter extends SelectableAdapter>(
  adapters: readonly Adapter[],
  selection: AiProviderSelectionConfig = {},
): AiProviderRegistry<Adapter> {
  const byProvider = new Map<AiProviderId, Adapter>()
  for (const adapter of adapters) {
    if (byProvider.has(adapter.providerId)) {
      throw new TypeError(`provider ${adapter.providerId} is registered twice`)
    }
    byProvider.set(adapter.providerId, adapter)
  }
  return Object.freeze({
    adapters: byProvider,
    selection: Object.freeze({ ...selection }),
  })
}

/**
 * The adapter that serves a capability's profile, or why none does.
 *
 * `eligible` is the providers the profile is attested for. A profile attested for
 * exactly one is served by it, whatever the operator chose and whatever the
 * adapter's readiness says, exactly as before the seam existed: its connector
 * decides at the call whether it can dispatch. A profile attested for several
 * needs the operator's choice, and only that choice can serve it: when its adapter
 * is missing or not ready the answer is a refusal, never another eligible provider.
 */
export function selectAiProvider<Adapter extends SelectableAdapter>(
  registry: AiProviderRegistry<Adapter>,
  input: Readonly<{
    capability: MerchantAiCapability | null
    eligible: readonly AiProviderId[]
  }>,
): Adapter {
  const [only, ...others] = input.eligible
  if (only === undefined) throw new AiProviderSelectionError('no_eligible_provider')
  if (others.length === 0) {
    const adapter = registry.adapters.get(only)
    if (adapter === undefined)
      throw new AiProviderSelectionError('selected_not_registered')
    return adapter
  }
  const chosen =
    input.capability === null ? undefined : registry.selection[input.capability]
  if (chosen === undefined) throw new AiProviderSelectionError('selection_required')
  if (!input.eligible.includes(chosen)) {
    throw new AiProviderSelectionError('selected_not_eligible')
  }
  const adapter = registry.adapters.get(chosen)
  if (adapter === undefined) throw new AiProviderSelectionError('selected_not_registered')
  if (adapter.readiness?.() === false) {
    throw new AiProviderSelectionError('selected_not_ready')
  }
  return adapter
}

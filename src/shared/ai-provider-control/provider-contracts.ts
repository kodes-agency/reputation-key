import type { z } from 'zod/v4'
import type {
  AiAdmissionDescriptorV1,
  AiExecutionGrantV1,
  AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import type {
  AiGatewayRoute,
  AiReasoningEffortV1,
} from '#/shared/ai-openai-request-contract'
import type { AiProviderId } from '#/shared/ai-provider-ids'
import type { AiProviderPriceCatalogue } from '#/shared/ai-provider-pricing'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { DerivedDescriptorFacts } from './prepared-invocation'

// The provider-neutral seam (contract section 7.1). The gateway service, the
// admission authority and the use cases above them speak these types; one adapter
// per provider turns them into that provider's request and back. Nothing here
// names OpenAI: the OpenAI adapter (`openai-provider-adapter.ts`) is the first
// implementation and the Anthropic adapter is the second.

export type { AiProviderId }

/**
 * Tokens a provider billed or reported, in the vocabulary the settlement ledger
 * speaks. `inputTokens` is the whole input, cached or not. `cachedTokens` is the
 * part read from the provider's prompt cache (OpenAI `cached_tokens`, Anthropic
 * `cache_read_input_tokens`) and is billed at the cached rate. A cache WRITE
 * (Anthropic `cache_creation_input_tokens`) is counted in `inputTokens` as
 * ordinary input: the ledger has no write rate and RepKey never asks for one.
 * `totalTokens` is `inputTokens + outputTokens`.
 */
export type AiProviderUsage = Readonly<{
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}>

/** What a provider call came to, whether or not it produced a usable answer. */
export type AiProviderOutcome<T> = Readonly<{
  disposition: AiSettlementRequestV1['disposition']
  reportedDisposition: AiSettlementRequestV1['reportedDisposition']
  result: T | null
  usageKnown: boolean
  providerRetryable: boolean
  usage: AiProviderUsage
  retryAfterSeconds: number | null
  outboundFetchUsed: boolean
}>

/**
 * The part of a prepared invocation the gateway reads whatever the provider is:
 * the descriptor admission authorizes, the request binding that signs it, and the
 * exact bytes a provider call may send. Each adapter's own invocation extends it.
 */
export type PreparedInvocationBase = Readonly<{
  descriptor: AiAdmissionDescriptorV1
  requestBindingKeyId: string
  requestBindingHmac: string
  canonicalProviderBytes: Uint8Array
}>

/**
 * What an adapter pins about the request it makes: the model and the version and
 * digest of its provider attestation (`ai-provider-attestations.ts`). An
 * operation records this beside its provider, so a later audit can say exactly
 * which request shape, transport and price list produced an answer.
 */
export type AiProviderRequestProfile = Readonly<{
  model: string
  version: string
  digest: string
}>

export type ProductAiGatewayRoute = Exclude<AiGatewayRoute, 'synthetic-canary'>

/**
 * A review-analysis, reply or trend request before any provider has shaped it:
 * the prompt, the schema it must answer in, and the redacted payload. Nothing in
 * it is a provider concept.
 */
export type LogicalAiInvocation = Readonly<{
  route: ProductAiGatewayRoute
  operationId: string
  promptVersion?: string
  developerPrompt: string
  outputSchemaName: string
  /** The answer's schema; each adapter derives the wire schema its provider accepts. */
  outputSchema: z.ZodTypeAny
  /** Canonical JSON of the redacted payload: the one thing the model reads. */
  untrustedData: string
  maxOutputTokens: number
  reasoningEffort: AiReasoningEffortV1
  /** Pseudonymous, per Property: a provider's abuse-monitoring identifier. */
  safetyIdentifier: `rk1_${string}`
}>

export type PrepareProviderInvocationInput = Readonly<{
  logical: LogicalAiInvocation
  /** The canonical review (or aggregate) bytes the operation's source digest covers. */
  sourceBytes: Uint8Array
  /** The structured payload `logical.untrustedData` is the canonical form of. */
  providerPayload: unknown
  createDescriptor: (facts: DerivedDescriptorFacts) => AiAdmissionDescriptorV1
  requestBindingKeys: VersionedHmacKeyring
}>

/** The half of an adapter that shapes the exact request. It reads no credential. */
export type AiProviderPreparation<
  Invocation extends PreparedInvocationBase = PreparedInvocationBase,
> = Readonly<{
  providerId: AiProviderId
  requestProfile: AiProviderRequestProfile
  /** What this provider charges, which reservations and settlements are priced by. */
  pricing: AiProviderPriceCatalogue
  prepare(input: PrepareProviderInvocationInput): Invocation
}>

/** The half of an adapter that holds a credential and makes the one call. */
export type AiProviderConnection<
  Invocation extends PreparedInvocationBase = PreparedInvocationBase,
> = Readonly<{
  /**
   * The connector does not apply the route's strict answer schema when a provider
   * enforces only part of it on the wire. A billed answer that is merely out of
   * range is repaired by `acceptProviderResult`, the single acceptance point.
   */
  invoke(
    invocation: Invocation,
    grant: AiExecutionGrantV1,
    outputSchema: z.ZodTypeAny,
    signal: AbortSignal,
    observer?: Readonly<{ onText(text: string): void; onDispatch(): void }>,
  ): Promise<AiProviderOutcome<unknown>>
  readiness?(): boolean
  close?(): Promise<void> | void
  destroy?(): void
}>

/**
 * One provider behind the seam. `invoke` is called at most once per permit, with
 * an invocation this same adapter prepared; the gateway never hands one provider's
 * invocation to another's connection.
 */
export type AiProviderAdapter<
  Invocation extends PreparedInvocationBase = PreparedInvocationBase,
> = AiProviderPreparation<Invocation> & AiProviderConnection<Invocation>

export type OneShotProviderFetchState = {
  outboundFetchUsed: boolean
  completeStatus: number | null
  retryAfterSeconds: number | null
  decodedResponseBytes: Uint8Array | null
  sdkRequestBytes: Uint8Array | null
}

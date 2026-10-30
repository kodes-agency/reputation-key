import { type KeyObject } from 'node:crypto'
import type { AiExecutionGrantV1 } from '#/shared/ai-internal-transport-contract'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  PROVIDER_ZERO_USAGE,
  evaluateProviderDispatchGate,
  providerConnectorOutcome,
  providerNoDispatchOutcome,
  type GrantNonceRegistry,
  type OneShotProviderFetchState,
  type ProviderBoundaryInvocation,
} from './connector-boundary'
import {
  logProviderAttestationThrow,
  logProviderGateRefusal,
  logProviderPreDispatchThrow,
} from './connector-diagnostics'
import type { ProviderRefusalBase } from './dispositions'
import type { AiProviderOutcome, AiProviderUsage } from './provider-contracts'

// What every provider connector decides the same way, whichever provider it is:
// whether the call may be made at all, and what an exception means once it has been
// tried. A connector supplies only what differs (how a non-200 is classified, what
// its error classes are, which usage it can still read from a body).

/**
 * The gate before any byte can leave: the grant, the request binding, the exact
 * bytes and the nonce. A refusal zeroes the canonical bytes and is `no_dispatch`;
 * `null` means the call may go ahead.
 */
export function refusalAtProviderDispatchGate(
  input: Readonly<{
    invocation: ProviderBoundaryInvocation
    grant: AiExecutionGrantV1
    requestBindingKeys: VersionedHmacKeyring
    admissionPublicKeys: ReadonlyMap<string, KeyObject>
    nonceRegistry: GrantNonceRegistry
    now: () => number
  }>,
): AiProviderOutcome<unknown> | null {
  const { invocation, grant } = input
  try {
    const currentTime = input.now()
    // The gates are evaluated separately so the log can name the one that fired.
    // Nonce consumption stays last, so a diagnostic never burns a nonce that would
    // otherwise have dispatched.
    const gate = evaluateProviderDispatchGate({
      invocation,
      grant,
      requestBindingKeys: input.requestBindingKeys,
      admissionPublicKeys: input.admissionPublicKeys,
      nonceRegistry: input.nonceRegistry,
      currentTime,
    })
    if (gate.accepted) return null
    logProviderGateRefusal(invocation, grant, currentTime, gate.reasons)
  } catch (error) {
    // Swallowing this made an attestation crash look identical to a clean
    // "declined to dispatch". Name it.
    logProviderAttestationThrow(invocation, error)
  }
  invocation.canonicalProviderBytes.fill(0)
  return providerNoDispatchOutcome()
}

type ThrowOutcomeInput = Readonly<{
  error: unknown
  /** The one-shot fetch's record; `null` when the dispatch threw before it existed. */
  state: OneShotProviderFetchState | null
  /** True when no pinned outbound was built (an injected fetch, or it threw first). */
  pinnedAbsent: boolean
  invocation: ProviderBoundaryInvocation
  /** The grant's response bound, which a non-200 body was read under. */
  responseBytes: number
  signal: AbortSignal
  /** How this provider reads a complete answer other than 200. */
  classifyRefusal(state: OneShotProviderFetchState, maxBytes: number): ProviderRefusalBase
  /** True for this provider's own "the answer cannot be used" error class. */
  isInvalidOutput(error: unknown): boolean
  /** The usage still readable from a 200 body the connector could not interpret. */
  usageOfDecodedBody(bytes: Uint8Array | null): AiProviderUsage | null
  /** Content-free diagnostics for the synthetic canary route only. */
  onInvalidOutput?(error: unknown): void
  onPost200Throw?(error: unknown): void
}>

function unusableAnswer(usage: AiProviderUsage | null): AiProviderOutcome<unknown> {
  return providerConnectorOutcome({
    disposition: 'output_invalid',
    reportedDisposition: 'success',
    result: null,
    usageKnown: usage !== null,
    providerRetryable: false,
    usage: usage ?? PROVIDER_ZERO_USAGE,
    retryAfterSeconds: null,
    outboundFetchUsed: true,
  })
}

/**
 * What an exception out of the SDK call means. In the order that matters: a
 * complete answer other than 200 is the provider's refusal; nothing sent is
 * `no_dispatch`; an aborted signal is the deadline or the caller; an unusable 200
 * is billed `output_invalid`; anything else after dispatch is ambiguous.
 */
export function outcomeOfProviderThrow(
  input: ThrowOutcomeInput,
): AiProviderOutcome<unknown> {
  const { state, invocation, signal } = input
  if (state !== null && state.completeStatus !== null && state.completeStatus !== 200) {
    return providerConnectorOutcome({
      ...input.classifyRefusal(state, input.responseBytes),
      result: null,
      usage: PROVIDER_ZERO_USAGE,
      outboundFetchUsed: true,
    })
  }
  if (state === null || !state.outboundFetchUsed) {
    // The dispatch threw before any byte left the process. Discarding the error
    // here is what made a broken pinned-outbound path look like a deliberate
    // no-dispatch.
    logProviderPreDispatchThrow(
      invocation,
      input.error,
      input.pinnedAbsent,
      state === null,
    )
    return providerNoDispatchOutcome()
  }
  if (signal.aborted) {
    return providerConnectorOutcome({
      disposition:
        signal.reason === 'provider_deadline' ? 'deadline_exceeded' : 'caller_aborted',
      result: null,
      usageKnown: false,
      providerRetryable: false,
      usage: PROVIDER_ZERO_USAGE,
      retryAfterSeconds: null,
      outboundFetchUsed: true,
    })
  }
  if (input.isInvalidOutput(input.error)) {
    input.onInvalidOutput?.(input.error)
    return unusableAnswer(null)
  }
  if (state.completeStatus === 200) {
    input.onPost200Throw?.(input.error)
    return unusableAnswer(input.usageOfDecodedBody(state.decodedResponseBytes))
  }
  return providerConnectorOutcome({
    disposition: 'transport_ambiguous',
    result: null,
    usageKnown: false,
    providerRetryable: false,
    usage: PROVIDER_ZERO_USAGE,
    retryAfterSeconds: null,
    outboundFetchUsed: true,
  })
}

export const CREDENTIAL_AUTHORIZATION_VECTOR_KEYS = Object.freeze({
  lifecycleVersion: 'expectedConnectionLifecycleVersion',
  accessVersion: 'expectedConnectionAccessVersion',
  credentialGeneration: 'expectedCredentialGeneration',
} as const)

export type CredentialSourceKind = 'refresh' | 'reauth' | 'reconnect'
export type CredentialSourceState =
  | 'registered'
  | 'provider_started'
  | 'terminal'
  | 'provider_outcome_ambiguous'
  | 'provider_reset_terminal'
export type CredentialCleanupOutcome =
  | 'confirmed_not_sent'
  | 'confirmed_revoked'
  | 'cleanup_ambiguous'
  | 'provider_reset_confirmed'

export type CredentialSubjectGuardKey = Readonly<{
  projectClientHmacKeyVersion: string
  projectClientHmac: string
  subjectHmacKeyVersion: string
  subjectHmac: string
}>

export type CredentialSourceRegistration = Readonly<{
  sourceOperationId: string
  revokePermitId: string
  sourceWorkPermitId: string
  organizationId: string
  connectionId: string | null
  guardKey: CredentialSubjectGuardKey
  kind: CredentialSourceKind
  expectedLifecycleVersion: number
  expectedAccessVersion: number
  expectedCredentialGeneration: number
  cleanupDeadlineAt: Date
  now: Date
}>

export type CredentialLifecycleResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false
      code:
        | 'not_found'
        | 'scope_mismatch'
        | 'invalid_transition'
        | 'stale_sequence'
        | 'deadline_exceeded'
        | 'token_mismatch'
        | 'concurrent_operation'
    }>

export type CredentialLifecycleStore = Readonly<{
  registerSource: (
    input: CredentialSourceRegistration,
  ) => Promise<CredentialLifecycleResult<Readonly<{ guardId: string; sequence: number }>>>
  markProviderStarted: (
    input: Readonly<{
      organizationId: string
      sourceOperationId: string
      now: Date
    }>,
  ) => Promise<CredentialLifecycleResult<Readonly<{ sequence: number }>>>
  completeWithoutCleanup: (
    input: Readonly<{
      organizationId: string
      sourceOperationId: string
      outcomeCode: string
      now: Date
    }>,
  ) => Promise<CredentialLifecycleResult<Readonly<{ sequence: number }>>>
  activateCleanup: (
    input: Readonly<{
      organizationId: string
      sourceOperationId: string
      tokenHmacKeyVersion: string
      tokenHmac: string
      sendAuthorizationExpiresAt: Date
      outcomeCode: string
      now: Date
    }>,
  ) => Promise<
    CredentialLifecycleResult<Readonly<{ revokePermitId: string; sequence: number }>>
  >
  finishCleanupWithoutDispatch: (
    input: Readonly<{
      organizationId: string
      revokePermitId: string
      outcomeCode: string
      now: Date
    }>,
  ) => Promise<CredentialLifecycleResult<Readonly<{ sourceOperationId: string }>>>
  acquireCleanupDispatch: (
    input: Readonly<{
      organizationId: string
      revokePermitId: string
      tokenHmacKeyVersion: string
      tokenHmac: string
      now: Date
    }>,
  ) => Promise<CredentialLifecycleResult<Readonly<{ sourceOperationId: string }>>>
  finishCleanup: (
    input: Readonly<{
      organizationId: string
      revokePermitId: string
      outcome: CredentialCleanupOutcome
      outcomeCode: string
      now: Date
    }>,
  ) => Promise<CredentialLifecycleResult<Readonly<{ sourceOperationId: string }>>>
  markProviderOutcomeAmbiguous: (
    input: Readonly<{
      organizationId: string
      sourceOperationId: string
      outcomeCode: string
      now: Date
    }>,
  ) => Promise<CredentialLifecycleResult<Readonly<{ sequence: number }>>>
  expireDeadlines: (
    input: Readonly<{
      now: Date
      limit: number
    }>,
  ) => Promise<Readonly<{ expired: number }>>
}>

export type CredentialLifecycleSweepState = Readonly<{
  sourceState: CredentialSourceState
  revokeState:
    'dormant' | 'active' | 'dispatching' | 'consumed_no_revoke' | CredentialCleanupOutcome
  guardState:
    | 'open'
    | 'source_active'
    | 'cleanup_pending'
    | 'drained'
    | 'provider_reset_required'
    | 'ambiguous'
    | 'provider_reset_terminal'
  terminalAt: Date | null
}>

export function isCredentialLifecycleSweepEligible(
  state: CredentialLifecycleSweepState,
  before: Date,
): boolean {
  if (!state.terminalAt || state.terminalAt > before) return false
  const sourceTerminal =
    state.sourceState === 'terminal' || state.sourceState === 'provider_reset_terminal'
  const revokeTerminal = [
    'consumed_no_revoke',
    'confirmed_not_sent',
    'confirmed_revoked',
    'provider_reset_confirmed',
  ].includes(state.revokeState)
  const guardTerminal =
    state.guardState === 'drained' || state.guardState === 'provider_reset_terminal'
  return sourceTerminal && revokeTerminal && guardTerminal
}

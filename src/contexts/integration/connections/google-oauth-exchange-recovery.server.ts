export const GOOGLE_OAUTH_EXCHANGE_RESPONSE_TTL_MS = 10 * 60_000
export const GOOGLE_OAUTH_EXCHANGE_APPLY_LEASE_MS = 30_000

export type GoogleOAuthExchangeMode = 'new' | 'reauth' | 'reconnect'

export type GoogleOAuthExchangeAttemptFacts = Readonly<{
  id: string
  organizationId: string
  initiatorUserId: string
  connectionId: string
  connectionMode: GoogleOAuthExchangeMode
  targetConnectionId: string | null
  expectedLifecycleVersion: number
  expectedAccessVersion: number
  expectedCredentialGeneration: number
}>

export type GoogleOAuthExchangeAttemptState =
  | 'prepared'
  | 'provider_started'
  | 'response_preserved'
  | 'applying'
  | 'completed'
  | 'failed'
  | 'provider_outcome_ambiguous'
  | 'expired'

export type GoogleOAuthExchangeRecoveryClaim = GoogleOAuthExchangeAttemptFacts &
  Readonly<{ encryptedResult: string }>

export type GoogleOAuthExchangeRecoveryResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false
      code:
        | 'not_found'
        | 'scope_mismatch'
        | 'invalid_transition'
        | 'already_started'
        | 'in_progress'
        | 'outcome_ambiguous'
        | 'expired'
        | 'completed'
    }>

export type GoogleOAuthExchangeRecoveryStore = Readonly<{
  begin(
    input: GoogleOAuthExchangeAttemptFacts & Readonly<{ now: Date }>,
  ): Promise<GoogleOAuthExchangeRecoveryResult<Readonly<{ state: 'prepared' }>>>
  markProviderStarted(
    input: Readonly<{
      id: string
      organizationId: string
      initiatorUserId: string
      now: Date
    }>,
  ): Promise<GoogleOAuthExchangeRecoveryResult<Readonly<{ started: true }>>>
  preserveSuccessfulResult(
    input: Readonly<{
      id: string
      organizationId: string
      initiatorUserId: string
      encryptedResult: string
      now: Date
    }>,
  ): Promise<GoogleOAuthExchangeRecoveryResult<Readonly<{ preserved: true }>>>
  claimPreservedResult(
    input: Readonly<{
      id: string
      organizationId: string
      initiatorUserId: string
      now: Date
    }>,
  ): Promise<GoogleOAuthExchangeRecoveryResult<GoogleOAuthExchangeRecoveryClaim>>
  loadCompletedAttempt(
    input: Readonly<{
      id: string
      organizationId: string
      initiatorUserId: string
    }>,
  ): Promise<GoogleOAuthExchangeAttemptFacts | null>
  releaseClaim(
    input: Readonly<{
      id: string
      organizationId: string
      initiatorUserId: string
      outcomeCode: string
      now: Date
    }>,
  ): Promise<GoogleOAuthExchangeRecoveryResult<Readonly<{ released: true }>>>
  discardClaim(
    input: Readonly<{
      id: string
      organizationId: string
      initiatorUserId: string
      outcomeCode: string
      now: Date
    }>,
  ): Promise<GoogleOAuthExchangeRecoveryResult<Readonly<{ discarded: true }>>>
  finishWithoutResult(
    input: Readonly<{
      id: string
      organizationId: string
      initiatorUserId: string
      outcome: 'failed' | 'provider_outcome_ambiguous'
      outcomeCode: string
      now: Date
    }>,
  ): Promise<GoogleOAuthExchangeRecoveryResult<Readonly<{ finished: true }>>>
  expire(
    input: Readonly<{ now: Date; limit: number }>,
  ): Promise<Readonly<{ expired: number }>>
}>

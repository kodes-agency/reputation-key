import type {
  ImportOutcomeCode,
  ImportProfileField,
  ImportProgressDto,
} from '../google-import-contract'
import type { ImportDiscoveryAuthorization } from './google-import-reference-store.port'
import type { GoogleImportReplayDigest } from '../google-import-replay'

export const GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS = 5
export const GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS = 60_000

export type GoogleImportItemIntent = Readonly<{
  id: string
  connectionId: string
  existingPropertyId: string | null
  providerAccountSuffix: string
  providerLocationSuffix: string
  googleReviewUri?: string | null
  /** The category discovery read for the location, in stored form (`normalizeGooglePrimaryCategory`). */
  googlePrimaryCategory?: string | null
  expectedConnectionLifecycleVersion: number
  expectedConnectionAccessVersion: number
  expectedCredentialGeneration: number
  expectedSourceEpoch: number | null
  expectedProfileVersion: number | null
  destinationPropertyId: string
  authorization: ImportDiscoveryAuthorization
  action: 'create' | 'relink'
  updateExistingProfile: boolean
  propertyName: string
  propertyAddress: string | null
  countryCode: string | null
  timezone: string
  effectDeadlineAt: Date
}>

export type GoogleImportDispatchItem = Readonly<{
  itemId: string
  expectedConnectionLifecycleVersion: number
  expectedSourceEpoch: number | null
  retryRevision: number
  dispatchEpoch: number
}>

export type GoogleImportClaimedItem = Readonly<{
  organizationId: string
  importJobId: string
  itemId: string
  initiatedBy: string
  connectionId: string
  existingPropertyId: string | null
  destinationPropertyId: string
  providerAccountSuffix: string
  providerLocationSuffix: string
  googleReviewUri: string | null
  googlePrimaryCategory: string | null
  expectedConnectionLifecycleVersion: number
  expectedConnectionAccessVersion: number
  expectedCredentialGeneration: number
  expectedSourceEpoch: number | null
  expectedProfileVersion: number | null
  authorization: ImportDiscoveryAuthorization
  action: 'create' | 'relink'
  updateExistingProfile: boolean
  propertyName: string
  propertyAddress: string | null
  countryCode: string | null
  timezone: string
  retryRevision: number
  attemptOrdinal: number
  dispatchEpoch: number
  claimFence: string
  effectDeadlineAt: Date
}>

export type GoogleImportClaimResult =
  | Readonly<{ kind: 'claimed'; item: GoogleImportClaimedItem }>
  | Readonly<{
      kind: 'ignored'
      reason:
        | 'missing'
        | 'terminal'
        | 'stale_revision'
        | 'stale_attempt'
        | 'claim_active'
        | 'stale_dispatch'
    }>
  | Readonly<{
      kind: 'ignored'
      reason: 'effect_expired' | 'attempts_exhausted'
      effectDeadlineAt: Date
      authority: GoogleImportTerminalAuthority
    }>

/**
 * What a terminal outcome may record beyond its code. A `tenant_profile_invalid`
 * item names the rejected field; an `already_exists` item may name the Property
 * in the same Organization that already holds its location. Both are internal,
 * content-free references and never provider identifiers.
 */
export type GoogleImportOutcomeDetail =
  | Readonly<{ kind: 'invalid_profile_field'; field: ImportProfileField }>
  | Readonly<{ kind: 'existing_property'; propertyId: string }>

export type GoogleImportTerminalAuthority =
  | Readonly<{ kind: 'pending'; dispatchEpoch: number }>
  | Readonly<{
      kind: 'claim' | 'expired_claim'
      dispatchEpoch: number
      claimFence: string
    }>
  | Readonly<{ kind: 'lifecycle' }>

export type GoogleImportDueItem = GoogleImportDispatchItem &
  Readonly<{
    organizationId: string
    importJobId: string
    status: 'pending' | 'processing'
    claimFence: string | null
    attemptOrdinal: number
    effectDeadlineAt: Date
  }>

export type GoogleImportTerminalInput = Readonly<{
  organizationId: string
  itemId: string
  retryRevision: number
  claimFence: string
  dispatchEpoch: number
  outcomeCode: ImportOutcomeCode
  /**
   * Whether the item keeps the provider identifiers and fences a retry needs.
   * It must be true for `temporarily_unavailable` and false for every other
   * outcome (`retainsRetryState`, `terminalWriteFor`): the items table accepts
   * no other pairing, and the store refuses one before writing.
   */
  retainRetryState: boolean
  now: Date
  detail?: GoogleImportOutcomeDetail
}>

export type GoogleImportIntent = Readonly<{
  id: string
  organizationId: string
  requestId: string
  initiatedBy: string
  wireReplay: GoogleImportReplayDigest
  semanticReplay: GoogleImportReplayDigest
  items: readonly GoogleImportItemIntent[]
  now: Date
  outboxEventId: string
}>

export type GoogleImportStoredReplay = Readonly<{
  importJobId: string
  initiatedBy: string
  wireReplay: GoogleImportReplayDigest | null
  semanticReplay: GoogleImportReplayDigest | null
}>

export type GoogleImportRetryCandidate = Readonly<{
  importJobId: string
  itemId: string
  connectionId: string
  existingPropertyId: string | null
  expectedSourceEpoch: number | null
  expectedProfileVersion: number | null
  authorization: ImportDiscoveryAuthorization
}>

export type GoogleImportExpiredItem = Readonly<{
  organizationId: string
  itemId: string
  retryRevision: number
}>

export type GoogleImportPurgeCandidate = Readonly<{
  organizationId: string
  importJobId: string
  deletionFence: number
}>

export type GoogleImportLifecycleScope =
  | Readonly<{ kind: 'organization'; organizationId: string }>
  | Readonly<{ kind: 'user'; organizationId: string; userId: string }>
  | Readonly<{ kind: 'connection'; organizationId: string; connectionId: string }>
  | Readonly<{ kind: 'property'; organizationId: string; propertyId: string }>
  | Readonly<{ kind: 'request'; organizationId: string; importJobId: string }>

export type GoogleImportLifecycleParent = Readonly<{
  organizationId: string
  importJobId: string
}>

export type GoogleImportLifecycleItem = Readonly<{
  organizationId: string
  importJobId: string
  itemId: string
  retryRevision: number
  active: boolean
}>

export type GoogleImportRetryResult =
  | Readonly<{
      kind: 'accepted' | 'replayed'
      importJobId: string
      retryRevision: number
    }>
  | Readonly<{
      kind: 'rejected'
      reason:
        | 'missing'
        | 'not_initiator'
        | 'request_conflict'
        | 'stale_revision'
        | 'not_retryable'
        | 'effect_expired'
        | 'authorization_denied'
        | 'authorization_unavailable'
    }>

export type GoogleImportStore = Readonly<{
  /**
   * Who asked for the import that produced this Property — the FIRST one, so a
   * later relink does not take credit for the history the original brought in.
   * Null when no import produced it, or when the request rows have aged out
   * (they are purged 30 days after the import became terminal).
   */
  findPropertyImportInitiator(
    organizationId: string,
    propertyId: string,
  ): Promise<string | null>
  findReplay(
    organizationId: string,
    requestId: string,
  ): Promise<GoogleImportStoredReplay | null>
  commitImport(intent: GoogleImportIntent): Promise<'committed' | 'conflict'>
  retryItem(
    input: Readonly<{
      organizationId: string
      initiatingUserId: string
      itemId: string
      retryRequestId: string
      expectedRetryRevision: number
      requestDigest: GoogleImportReplayDigest
      matchesRequestDigest: (stored: GoogleImportReplayDigest) => boolean
      now: Date
      outboxEventId: string
      authorize: (
        candidate: GoogleImportRetryCandidate,
      ) => Promise<'authorized' | 'denied' | 'unavailable'>
    }>,
  ): Promise<GoogleImportRetryResult>
  claimItem(
    input: Readonly<{
      organizationId: string
      itemId: string
      retryRevision: number
      /** Queue delivery ordinal; PostgreSQL allocates the durable attempt. */
      attemptOrdinal: number
      dispatchEpoch: number
      claimFence: string
      now: Date
      leaseExpiresAt: Date
    }>,
  ): Promise<GoogleImportClaimResult>
  runClaimedEffect<TResult>(
    input: Readonly<{
      organizationId: string
      itemId: string
      retryRevision: number
      attemptOrdinal: number
      dispatchEpoch: number
      claimFence: string
      now: Date
    }>,
    effect: () => Promise<TResult>,
  ): Promise<
    | Readonly<{ kind: 'executed'; value: TResult }>
    | Readonly<{ kind: 'lost' }>
    | Readonly<{ kind: 'effect_expired' }>
  >
  releaseClaimForRetry(
    input: Readonly<{
      organizationId: string
      itemId: string
      retryRevision: number
      dispatchEpoch: number
      claimFence: string
      expiredOnly?: boolean
      now: Date
    }>,
  ): Promise<'released' | 'lost'>
  reconcileFromReceipt(
    input: Readonly<{
      organizationId: string
      itemId: string
      now: Date
    }>,
  ): Promise<'completed' | 'lost'>
  completeClaim(input: GoogleImportTerminalInput): Promise<'completed' | 'lost'>
  terminalizeItem(
    input: Readonly<{
      organizationId: string
      itemId: string
      retryRevision: number
      authority: GoogleImportTerminalAuthority
      outcomeCode: ImportOutcomeCode
      retainRetryState: boolean
      now: Date
    }>,
  ): Promise<'completed' | 'lost'>
  /**
   * Load the current pending items for one tenant-scoped parent. `null`
   * distinguishes a purged/missing parent from an existing parent with no
   * pending work; the outbox consumer records the former as obsolete.
   */
  listPendingDispatchItems(
    organizationId: string,
    importJobId: string,
  ): Promise<readonly GoogleImportDispatchItem[] | null>
  listRetryCandidates(
    organizationId: string,
    userId: string,
    importJobId: string,
    now: Date,
  ): Promise<readonly GoogleImportRetryCandidate[]>
  listExpiredItems(now: Date, limit: number): Promise<readonly GoogleImportExpiredItem[]>
  /** Reserve and advance at most 100 due active items before doing work. */
  reserveDueItems(now: Date, limit: number): Promise<readonly GoogleImportDueItem[]>
  listPurgeCandidates(
    now: Date,
    limit: number,
  ): Promise<readonly GoogleImportPurgeCandidate[]>
  purgeParent(
    input: Readonly<{
      organizationId: string
      importJobId: string
      expectedDeletionFence: number
      now: Date
      outboxEventId: string
    }>,
  ): Promise<'purged' | 'lost'>
  listLifecycleScopeParents(
    scope: GoogleImportLifecycleScope,
    limit: number,
  ): Promise<readonly GoogleImportLifecycleParent[]>
  fenceLifecycleParent(
    input: Readonly<{
      organizationId: string
      importJobId: string
      now: Date
    }>,
  ): Promise<'fenced' | 'lost'>
  listLifecycleScopeItems(
    scope: GoogleImportLifecycleScope,
    limit: number,
  ): Promise<readonly GoogleImportLifecycleItem[]>
  scrubLifecycleItems(
    input: Readonly<{
      organizationId: string
      itemIds: readonly string[]
      now: Date
    }>,
  ): Promise<number>
  countLifecycleScopeItems(
    scope: GoogleImportLifecycleScope,
    limit: number,
  ): Promise<number>
  getOperatorProgress(
    organizationId: string,
    importJobId: string,
  ): Promise<ImportProgressDto | null>
  getProgress(
    organizationId: string,
    userId: string,
    importJobId: string,
  ): Promise<ImportProgressDto | null>
}>

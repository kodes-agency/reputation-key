import type { ImportOutcomeCode, ImportProgressDto } from '../google-import-v2-contract'
import type { ImportDiscoveryAuthorization } from './google-import-reference-store.port'
import type { GoogleImportReplayDigest } from '../google-import-replay'

export const GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS = 5
export const GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS = 60_000

export type GoogleImportV2ItemIntent = Readonly<{
  id: string
  connectionId: string
  existingPropertyId: string | null
  providerAccountSuffix: string
  providerLocationSuffix: string
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
  processingRegion: string
  routingPolicyVersion: number
  effectDeadlineAt: Date
}>

export type GoogleImportV2DispatchItem = Readonly<{
  itemId: string
  expectedConnectionLifecycleVersion: number
  expectedSourceEpoch: number | null
  retryRevision: number
  processingRegion: string
  routingPolicyVersion: number
}>

export type GoogleImportV2ClaimedItem = Readonly<{
  organizationId: string
  importJobId: string
  itemId: string
  initiatedBy: string
  connectionId: string
  existingPropertyId: string | null
  destinationPropertyId: string
  providerAccountSuffix: string
  providerLocationSuffix: string
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
  processingRegion: string
  routingPolicyVersion: number
  retryRevision: number
  attemptOrdinal: number
  claimFence: string
  effectDeadlineAt: Date
}>

export type GoogleImportV2ClaimResult =
  | Readonly<{ kind: 'claimed'; item: GoogleImportV2ClaimedItem }>
  | Readonly<{
      kind: 'ignored'
      reason:
        | 'missing'
        | 'terminal'
        | 'stale_revision'
        | 'stale_attempt'
        | 'claim_active'
        | 'effect_expired'
    }>

export type GoogleImportV2TerminalInput = Readonly<{
  organizationId: string
  itemId: string
  retryRevision: number
  claimFence: string
  outcomeCode: ImportOutcomeCode
  retainProtectedRouting: boolean
  now: Date
}>

export type GoogleImportV2Intent = Readonly<{
  id: string
  organizationId: string
  requestId: string
  initiatedBy: string
  wireReplay: GoogleImportReplayDigest
  semanticReplay: GoogleImportReplayDigest
  items: readonly GoogleImportV2ItemIntent[]
  now: Date
  outboxEventId: string
}>

export type GoogleImportV2StoredReplay = Readonly<{
  importJobId: string
  initiatedBy: string
  wireReplay: GoogleImportReplayDigest | null
  semanticReplay: GoogleImportReplayDigest | null
}>

export type GoogleImportV2RetryCandidate = Readonly<{
  importJobId: string
  itemId: string
  connectionId: string
  existingPropertyId: string | null
  expectedSourceEpoch: number | null
  expectedProfileVersion: number | null
  authorization: ImportDiscoveryAuthorization
}>

export type GoogleImportV2ExpiredItem = Readonly<{
  organizationId: string
  itemId: string
  retryRevision: number
}>

export type GoogleImportV2PurgeCandidate = Readonly<{
  organizationId: string
  importJobId: string
  deletionFence: number
}>

export type GoogleImportV2LifecycleScope =
  | Readonly<{ kind: 'organization'; organizationId: string }>
  | Readonly<{ kind: 'user'; organizationId: string; userId: string }>
  | Readonly<{ kind: 'connection'; organizationId: string; connectionId: string }>
  | Readonly<{ kind: 'property'; organizationId: string; propertyId: string }>
  | Readonly<{ kind: 'request'; organizationId: string; importJobId: string }>

export type GoogleImportV2LifecycleParent = Readonly<{
  organizationId: string
  importJobId: string
}>

export type GoogleImportV2LifecycleItem = Readonly<{
  organizationId: string
  importJobId: string
  itemId: string
  retryRevision: number
  active: boolean
}>

export type GoogleImportV2RetryResult =
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

export type GoogleImportV2Store = Readonly<{
  findReplay(
    organizationId: string,
    requestId: string,
  ): Promise<GoogleImportV2StoredReplay | null>
  commitIntent(intent: GoogleImportV2Intent): Promise<'committed' | 'conflict'>
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
        candidate: GoogleImportV2RetryCandidate,
      ) => Promise<'authorized' | 'denied' | 'unavailable'>
    }>,
  ): Promise<GoogleImportV2RetryResult>
  claimItem(
    input: Readonly<{
      organizationId: string
      itemId: string
      retryRevision: number
      attemptOrdinal: number
      claimFence: string
      now: Date
      leaseExpiresAt: Date
    }>,
  ): Promise<GoogleImportV2ClaimResult>
  runClaimedEffect<TResult>(
    input: Readonly<{
      organizationId: string
      itemId: string
      retryRevision: number
      attemptOrdinal: number
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
      claimFence: string
      now: Date
    }>,
  ): Promise<'released' | 'lost'>
  reconcileFromReceipt(
    input: Readonly<{
      organizationId: string
      itemId: string
      destinationPropertyId: string | null
      outcomeCode: Extract<
        ImportOutcomeCode,
        'imported' | 'relinked' | 'property_deleted'
      >
      now: Date
    }>,
  ): Promise<'completed' | 'lost'>
  completeClaim(input: GoogleImportV2TerminalInput): Promise<'completed' | 'lost'>
  terminalizeItem(
    input: Readonly<{
      organizationId: string
      itemId: string
      retryRevision: number
      outcomeCode: ImportOutcomeCode
      retainProtectedRouting: boolean
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
  ): Promise<readonly GoogleImportV2DispatchItem[] | null>
  listRetryCandidates(
    organizationId: string,
    userId: string,
    importJobId: string,
    now: Date,
  ): Promise<readonly GoogleImportV2RetryCandidate[]>
  listExpiredItems(
    now: Date,
    limit: number,
  ): Promise<readonly GoogleImportV2ExpiredItem[]>
  listPurgeCandidates(
    now: Date,
    limit: number,
  ): Promise<readonly GoogleImportV2PurgeCandidate[]>
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
    scope: GoogleImportV2LifecycleScope,
    limit: number,
  ): Promise<readonly GoogleImportV2LifecycleParent[]>
  fenceLifecycleParent(
    input: Readonly<{
      organizationId: string
      importJobId: string
      now: Date
    }>,
  ): Promise<'fenced' | 'lost'>
  listLifecycleScopeItems(
    scope: GoogleImportV2LifecycleScope,
    limit: number,
  ): Promise<readonly GoogleImportV2LifecycleItem[]>
  scrubLifecycleItems(
    input: Readonly<{
      organizationId: string
      itemIds: readonly string[]
      now: Date
    }>,
  ): Promise<number>
  countLifecycleScopeItems(
    scope: GoogleImportV2LifecycleScope,
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

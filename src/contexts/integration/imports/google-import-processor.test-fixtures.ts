import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/shared/testing/google-provider-identifiers-v1'
import { vi } from 'vitest'
import type { GbpSubscribeResult } from '../connections/manage-notifications.server'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/public-api'
import type { GoogleImportCommandAuthorizer } from './google-import-discovery.server'
import type {
  GoogleImportClaimedItem,
  GoogleImportStore,
} from './import-store.port.server'
import { createGoogleImportProcessor } from './google-import-processor.server'

export const NOW = new Date('2026-08-12T12:00:00.000Z')
export const ORG_ID = 'org-1'
export const USER_ID = 'user-1'
export const ITEM_ID = '00000000-0000-4000-8000-000000000001'
const JOB_ID = '00000000-0000-4000-8000-000000000002'
export const PROPERTY_ID = '00000000-0000-4000-8000-000000000003'
export const CONNECTION_ID = '00000000-0000-4000-8000-000000000004'
export const CLAIM_FENCE = '00000000-0000-4000-8000-000000000005'
const PROVIDER_ACCOUNT_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-account-primary'].expectedSegments.accountId
export const PROVIDER_LOCATION_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments.locationId
export const GOOGLE_REVIEW_URI =
  'https://search.google.com/local/writereview?placeid=provider-location-1'
export const GOOGLE_PRIMARY_CATEGORY = 'Boat rental service'

export const actor = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Admin',
  effectivePermissions: new Set(['integration.manage', 'property.create']),
  scopeByPermission: new Map(),
} as unknown as AuthContext

export const authorization = {
  organizationId: ORG_ID,
  userId: USER_ID,
  connectionId: CONNECTION_ID,
  connectionLifecycleVersion: 4,
  connectionAccessVersion: 3,
  credentialGeneration: 2,
  authorizationVector: {
    executionPolicyVersion: 'beta-local-2',
    role: 'Admin',
    permissionDigest: 'a'.repeat(64),
    connectionLifecycleVersion: 4,
    connectionAccessVersion: 3,
    credentialGeneration: 2,
  },
} as const

export function claimedItem(
  over: Partial<GoogleImportClaimedItem> = {},
): GoogleImportClaimedItem {
  return {
    organizationId: ORG_ID,
    importJobId: JOB_ID,
    itemId: ITEM_ID,
    initiatedBy: USER_ID,
    connectionId: CONNECTION_ID,
    existingPropertyId: null,
    destinationPropertyId: PROPERTY_ID,
    providerAccountSuffix: PROVIDER_ACCOUNT_ID,
    providerLocationSuffix: PROVIDER_LOCATION_ID,
    googleReviewUri: GOOGLE_REVIEW_URI,
    googlePrimaryCategory: GOOGLE_PRIMARY_CATEGORY,
    expectedConnectionLifecycleVersion: 4,
    expectedConnectionAccessVersion: 3,
    expectedCredentialGeneration: 2,
    expectedSourceEpoch: null,
    expectedProfileVersion: null,
    authorization,
    action: 'create',
    updateExistingProfile: true,
    propertyName: 'Acme Hotel',
    propertyAddress: '1 Main Street',
    countryCode: 'US',
    timezone: 'America/New_York',
    retryRevision: 0,
    dispatchEpoch: 0,
    attemptOrdinal: 1,
    claimFence: CLAIM_FENCE,
    effectDeadlineAt: new Date(NOW.getTime() + 60_000),
    ...over,
  }
}

export function claimed(
  over: Partial<GoogleImportClaimedItem> = {},
): Readonly<{ kind: 'claimed'; item: GoogleImportClaimedItem }> {
  return { kind: 'claimed', item: claimedItem(over) }
}

/** The Property receipt a committed create/relink effect leaves behind. */
export function importedReceipt(
  over: Partial<
    NonNullable<Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>>
  > = {},
): Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>> {
  return {
    organizationId: ORG_ID,
    idempotencyKey: ITEM_ID,
    destinationPropertyId: PROPERTY_ID,
    outcome: 'imported',
    destinationSourceEpoch: 0,
    destinationProfileVersion: 1,
    tombstone: false,
    expiresAt: new Date(NOW.getTime() + 60_000),
    retentionReleasedAt: null,
    ...over,
  } as Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>
}

export function setup(
  over: {
    claim?: Awaited<ReturnType<GoogleImportStore['claimItem']>>
    actor?: AuthContext | null
    resolveActorError?: unknown
    authorization?: Awaited<ReturnType<GoogleImportCommandAuthorizer>>
    receipt?: Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>
    receipts?: readonly Awaited<
      ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>
    >[]
    createError?: unknown
    relinkError?: unknown
    locationHolders?: readonly Readonly<{ organizationId: string; propertyId: string }>[]
    locationLookupError?: unknown
    enqueueReviewSyncError?: unknown
    subscribeToNotificationsError?: unknown
    subscribeResult?: GbpSubscribeResult
    defaultPublicDisplayNameError?: unknown
    clock?: () => Date
  } = {},
) {
  const item = claimedItem()
  const claimItem = vi.fn().mockResolvedValue(over.claim ?? { kind: 'claimed', item })
  const releaseClaimForRetry = vi.fn().mockResolvedValue('released')
  const reconcileFromReceipt = vi.fn().mockResolvedValue('completed')
  const completeClaim = vi.fn().mockResolvedValue('completed')
  const runClaimedEffect = vi.fn(
    async (
      _input: unknown,
      effect: () => Promise<unknown>,
    ): Promise<Readonly<{ kind: 'executed'; value: unknown }>> => ({
      kind: 'executed',
      value: await effect(),
    }),
  )
  const terminalizeItem = vi.fn().mockResolvedValue('completed')
  const store = {
    claimItem,
    releaseClaimForRetry,
    reconcileFromReceipt,
    completeClaim,
    runClaimedEffect,
    terminalizeItem,
  } as unknown as GoogleImportStore
  const createBoundProperty = over.createError
    ? vi.fn().mockRejectedValue(over.createError)
    : vi.fn().mockResolvedValue({
        propertyId: PROPERTY_ID,
        outcome: 'imported',
        sourceEpoch: 0,
        profileVersion: 1,
        replayed: false,
        tombstone: false,
      })
  const relink = over.relinkError
    ? vi.fn().mockRejectedValue(over.relinkError)
    : vi.fn().mockResolvedValue({
        propertyId: PROPERTY_ID,
        outcome: 'relinked',
        sourceEpoch: 2,
        profileVersion: 3,
        replayed: false,
        tombstone: false,
      })
  const readReceipt = vi.fn()
  for (const receipt of over.receipts ?? [over.receipt ?? null]) {
    readReceipt.mockResolvedValueOnce(receipt)
  }
  readReceipt.mockResolvedValue(null)
  const readInternal = vi.fn().mockResolvedValue({
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    state: 'active',
    connectionId: CONNECTION_ID,
    accountId: PROVIDER_ACCOUNT_ID,
    locationId: PROVIDER_LOCATION_ID,
    sourceEpoch: 0,
    profileVersion: 1,
    profileSource: 'tenant_confirmed',
    profileConfirmedAt: NOW,
    deletedAt: null,
    name: 'Acme Hotel',
    address: '1 Main Street',
    countryCode: 'US',
    timezone: 'America/New_York',
    lifecycleState: 'active',
  })
  const readByLocationIds = over.locationLookupError
    ? vi.fn().mockRejectedValue(over.locationLookupError)
    : vi.fn().mockResolvedValue(over.locationHolders ?? [])
  const propertyBindingApi = {
    readReceipt,
    readInternal,
    readByLocationIds,
    createBoundProperty,
    relink,
  } as unknown as PropertyGoogleBindingPublicApi
  const authorize = vi
    .fn()
    .mockResolvedValue(
      over.authorization ?? { ok: true, authorization, accessToken: null },
    )
  const resolveActor = over.resolveActorError
    ? vi.fn().mockRejectedValue(over.resolveActorError)
    : vi.fn().mockResolvedValue(over.actor === undefined ? actor : over.actor)
  const enqueueReviewSync = over.enqueueReviewSyncError
    ? vi.fn().mockRejectedValue(over.enqueueReviewSyncError)
    : vi.fn().mockResolvedValue(undefined)
  const subscribeToNotifications = over.subscribeToNotificationsError
    ? vi.fn().mockRejectedValue(over.subscribeToNotificationsError)
    : vi.fn().mockResolvedValue(
        over.subscribeResult ?? {
          outcome: 'subscribed',
          accounts: { subscribed: 1, alreadySubscribed: 0, failed: 0, failureCodes: {} },
        },
      )
  const defaultPublicDisplayName = over.defaultPublicDisplayNameError
    ? vi.fn().mockRejectedValue(over.defaultPublicDisplayNameError)
    : vi.fn().mockResolvedValue(true)
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }
  const processor = createGoogleImportProcessor({
    store,
    propertyBindingApi,
    authorizeGoogleImportCommand: authorize,
    resolveActor,
    clock: over.clock ?? (() => NOW),
    newClaimFence: () => CLAIM_FENCE,
    logger,
  })
  return {
    processor,
    item,
    claimItem,
    releaseClaimForRetry,
    runClaimedEffect,
    terminalizeItem,
    reconcileFromReceipt,
    completeClaim,
    readReceipt,
    readInternal,
    readByLocationIds,
    createBoundProperty,
    relink,
    authorize,
    resolveActor,
    enqueueReviewSync,
    subscribeToNotifications,
    defaultPublicDisplayName,
    logger,
  }
}

export type GoogleImportHarness = ReturnType<typeof setup>

/** Runs one processor attempt for the default item, with optional input overrides. */
export function run(
  harness: GoogleImportHarness,
  over: Partial<Parameters<GoogleImportHarness['processor']['process']>[0]> = {},
) {
  return harness.processor.process({
    organizationId: ORG_ID,
    itemId: ITEM_ID,
    retryRevision: 0,
    dispatchEpoch: 0,
    attemptOrdinal: 1,
    ...over,
  })
}

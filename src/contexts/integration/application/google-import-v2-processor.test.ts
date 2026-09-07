import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_PROVIDER_FIXTURES_V1,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import type { GoogleImportCommandAuthorizer } from './google-import-discovery'
import type {
  GoogleImportV2ClaimedItem,
  GoogleImportV2Store,
} from './ports/google-import-v2-store.port'
import { createGoogleImportV2Processor } from './google-import-v2-processor'

const NOW = new Date('2026-08-12T12:00:00.000Z')
const ORG_ID = 'org-1'
const USER_ID = 'user-1'
const ITEM_ID = '00000000-0000-4000-8000-000000000001'
const JOB_ID = '00000000-0000-4000-8000-000000000002'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000003'
const CONNECTION_ID = '00000000-0000-4000-8000-000000000004'
const CLAIM_FENCE = '00000000-0000-4000-8000-000000000005'
const PROVIDER_ACCOUNT_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-account-primary'].expectedSegments.accountId
const PROVIDER_LOCATION_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments.locationId
const GOOGLE_REVIEW_URI =
  'https://search.google.com/local/writereview?placeid=provider-location-1'

const actor = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Admin',
  effectivePermissions: new Set(['integration.manage', 'property.create']),
  scopeByPermission: new Map(),
} as unknown as AuthContext

const authorization = {
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

function claimedItem(
  over: Partial<GoogleImportV2ClaimedItem> = {},
): GoogleImportV2ClaimedItem {
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
    attemptOrdinal: 1,
    claimFence: CLAIM_FENCE,
    effectDeadlineAt: new Date(NOW.getTime() + 60_000),
    ...over,
  }
}

/** The Property receipt a committed create/relink effect leaves behind. */
function importedReceipt(
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

function setup(
  over: {
    claim?: Awaited<ReturnType<GoogleImportV2Store['claimItem']>>
    actor?: AuthContext | null
    resolveActorError?: unknown
    authorization?: Awaited<ReturnType<GoogleImportCommandAuthorizer>>
    receipt?: Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>
    receipts?: readonly Awaited<
      ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>
    >[]
    createError?: unknown
    relinkError?: unknown
    enqueueReviewSyncError?: unknown
    subscribeToNotificationsError?: unknown
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
  } as unknown as GoogleImportV2Store
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
  const propertyBindingApi = {
    readReceipt,
    readInternal,
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
    : vi.fn().mockResolvedValue('subscribed')
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }
  const processor = createGoogleImportV2Processor({
    store,
    propertyBindingApi,
    authorizeGoogleImportCommand: authorize,
    resolveActor,
    clock: () => NOW,
    newClaimFence: () => CLAIM_FENCE,
    enqueueReviewSync,
    subscribeToNotifications,
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
    createBoundProperty,
    relink,
    authorize,
    resolveActor,
    enqueueReviewSync,
    subscribeToNotifications,
    logger,
  }
}

describe('GoogleImportV2Processor', () => {
  it('executes a freshly authorized create only while its exact claim fence is locked', async () => {
    const committedReceipt = {
      organizationId: ORG_ID,
      idempotencyKey: ITEM_ID,
      destinationPropertyId: PROPERTY_ID,
      outcome: 'imported',
      destinationSourceEpoch: 0,
      destinationProfileVersion: 1,
      tombstone: false,
      expiresAt: new Date(NOW.getTime() + 60_000),
      retentionReleasedAt: null,
    } as Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>
    const harness = setup({ receipts: [null, null, committedReceipt] })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.runClaimedEffect).toHaveBeenCalledWith(
      {
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
        claimFence: CLAIM_FENCE,
        now: NOW,
      },
      expect.any(Function),
    )
    expect(harness.resolveActor).toHaveBeenCalledWith(ORG_ID, USER_ID)
    expect(harness.authorize).toHaveBeenCalledWith({
      actor,
      connectionId: CONNECTION_ID,
      phase: 'publish',
      expected: authorization,
      properties: [],
      requireAccessToken: false,
    })
    expect(harness.createBoundProperty).toHaveBeenCalledOnce()
    expect(harness.createBoundProperty).toHaveBeenCalledWith(
      expect.objectContaining({
        property: expect.objectContaining({
          googleReviewDestination: {
            state: 'verified',
            uri: GOOGLE_REVIEW_URI,
            retrievedAt: NOW,
            sourceEpoch: 0,
            profileVersion: 1,
          },
        }),
      }),
    )
    expect(harness.reconcileFromReceipt).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      destinationPropertyId: PROPERTY_ID,
      outcomeCode: 'imported',
      now: NOW,
    })
    expect(harness.enqueueReviewSync).toHaveBeenCalledWith(
      {
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        initiator: {
          kind: 'system',
          id: 'google-property-import',
        },
        correlationId: `google-import:${ITEM_ID}`,
      },
      {
        jobId: `review-sync-${PROPERTY_ID}-source-epoch-0`,
      },
    )
    expect(harness.enqueueReviewSync.mock.invocationCallOrder[0]).toBeLessThan(
      harness.reconcileFromReceipt.mock.invocationCallOrder[0]!,
    )
    expect(harness.completeClaim).not.toHaveBeenCalled()
    expect(harness.runClaimedEffect.mock.invocationCallOrder[0]).toBeLessThan(
      harness.createBoundProperty.mock.invocationCallOrder[0]!,
    )
  })

  it('reconciles an existing Property receipt before claiming or authorizing', async () => {
    const harness = setup({
      receipt: {
        organizationId: ORG_ID,
        idempotencyKey: ITEM_ID,
        destinationPropertyId: PROPERTY_ID,
        outcome: 'imported',
        destinationSourceEpoch: 0,
        destinationProfileVersion: 1,
        tombstone: false,
        expiresAt: new Date(NOW.getTime() + 60_000),
        retentionReleasedAt: null,
      } as Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>,
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.reconcileFromReceipt).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      destinationPropertyId: PROPERTY_ID,
      outcomeCode: 'imported',
      now: NOW,
    })
    expect(harness.claimItem).not.toHaveBeenCalled()
    expect(harness.resolveActor).not.toHaveBeenCalled()
    expect(harness.authorize).not.toHaveBeenCalled()
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
  })

  it('does nothing when the durable claim rejects stale work', async () => {
    const harness = setup({
      claim: { kind: 'ignored', reason: 'stale_attempt' },
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.resolveActor).not.toHaveBeenCalled()
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
    expect(harness.completeClaim).not.toHaveBeenCalled()
  })

  // The stalled-recovery bug: returning normally here marked the BullMQ
  // attempt completed. When the arrival WAS the single permitted stalled
  // recovery, nothing re-dispatched the item and the row stayed 'processing'
  // until its effect deadline. Throwing keeps the attempt budget alive so a
  // later attempt claims the item once the lease has expired.
  it('throws on an active claim lease so BullMQ retries instead of completing', async () => {
    const harness = setup({
      claim: { kind: 'ignored', reason: 'claim_active' },
    })

    await expect(
      harness.processor.process({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
      }),
    ).rejects.toThrow(/claim lease is still active/)

    // No effect, and above all no terminal write: the other attempt owns it.
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
    expect(harness.completeClaim).not.toHaveBeenCalled()
    expect(harness.terminalizeItem).not.toHaveBeenCalled()
    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
  })

  it.each([
    ['pg-pool acquisition timeout', new Error('timeout exceeded when trying to connect')],
    [
      'too many connections',
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
    ],
    [
      'lock_timeout expiry',
      Object.assign(new Error('canceling statement due to lock timeout'), {
        code: '55P03',
      }),
    ],
    [
      'idle-in-transaction termination',
      Object.assign(new Error('terminating connection due to idle-in-transaction'), {
        code: '25P03',
      }),
    ],
  ])(
    'classifies %s as transient rather than internal_error',
    async (_label, createError) => {
      const harness = setup({ createError })

      // Transient handling = release the claim and rethrow for a fresh attempt.
      await expect(
        harness.processor.process({
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          attemptOrdinal: 1,
        }),
      ).rejects.toBe(createError)

      expect(harness.releaseClaimForRetry).toHaveBeenCalledTimes(1)
      // Never a terminal outcome, and specifically never internal_error.
      expect(harness.completeClaim).not.toHaveBeenCalled()
    },
  )

  // The two authorization denials are DIFFERENT facts and must not share an
  // outcome code. `authorization_denied` is the capability gate refusing —
  // "this feature is unavailable" — while `authorization_changed` is the
  // narrow claim that something the item froze at enqueue no longer matches.
  // They were collapsed into `authorization_changed`, so a cancelled item's
  // persisted `outcome_code` could not say which had happened, and an
  // investigation spent its time in the wrong half of the authorizer.
  it.each([
    ['the capability gate denies', 'authorization_denied', 'policy_disabled'],
    ['frozen authorization drifted', 'authorization_changed', 'authorization_changed'],
  ] as const)(
    'cancels with a distinct outcome when %s',
    async (_label, code, outcomeCode) => {
      const harness = setup({ authorization: { ok: false, code } })

      await harness.processor.process({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
      })

      expect(harness.createBoundProperty).not.toHaveBeenCalled()
      expect(harness.completeClaim).toHaveBeenCalledWith(
        expect.objectContaining({ outcomeCode, retainRetryState: false }),
      )
    },
  )

  it.each([
    ['missing membership', { actor: null }, 'authorization_changed'],
    [
      'authorization infrastructure outage',
      { resolveActorError: new Error('authorization unavailable') },
      'temporarily_unavailable',
    ],
  ] as const)(
    'fails closed on %s before Property mutation',
    async (_label, override, outcomeCode) => {
      const harness = setup(override)

      await harness.processor.process({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
      })

      expect(harness.authorize).not.toHaveBeenCalled()
      expect(harness.createBoundProperty).not.toHaveBeenCalled()
      expect(harness.completeClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          outcomeCode,
          retainRetryState: false,
        }),
      )
    },
  )

  it('reconciles a receipt that appears after claim but before the fenced effect', async () => {
    const receipt = {
      organizationId: ORG_ID,
      idempotencyKey: ITEM_ID,
      destinationPropertyId: PROPERTY_ID,
      outcome: 'imported',
      destinationSourceEpoch: 0,
      destinationProfileVersion: 1,
      tombstone: false,
      expiresAt: new Date(NOW.getTime() + 60_000),
      retentionReleasedAt: null,
    } as Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>
    const harness = setup({ receipts: [null, receipt] })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.runClaimedEffect).toHaveBeenCalledOnce()
    expect(harness.reconcileFromReceipt).toHaveBeenCalledOnce()
    expect(harness.resolveActor).not.toHaveBeenCalled()
    expect(harness.authorize).not.toHaveBeenCalled()
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
  })

  it('terminalizes an expired receipt-free item without claiming it', async () => {
    const harness = setup({
      claim: { kind: 'ignored', reason: 'effect_expired' },
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.terminalizeItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      outcomeCode: 'temporarily_unavailable',
      retainRetryState: false,
      now: NOW,
    })
    expect(harness.resolveActor).not.toHaveBeenCalled()
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
  })

  it('releases a transient failed attempt and throws for BullMQ retry', async () => {
    const harness = setup({ createError: new Error('database unavailable') })

    await expect(
      harness.processor.process({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
      }),
    ).rejects.toThrow('database unavailable')

    expect(harness.releaseClaimForRetry).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      claimFence: CLAIM_FENCE,
      now: NOW,
    })
    expect(harness.completeClaim).not.toHaveBeenCalled()
  })

  it('terminalizes before BullMQ backoff could cross the effect deadline', async () => {
    const item = claimedItem({
      effectDeadlineAt: new Date(NOW.getTime() + 29_999),
    })
    const harness = setup({
      claim: { kind: 'claimed', item },
      createError: new Error('database unavailable'),
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(harness.completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'temporarily_unavailable',
        retainRetryState: true,
      }),
    )
  })

  it('records a bounded transient failure after the final attempt', async () => {
    const item = claimedItem({ attemptOrdinal: 5 })
    const harness = setup({
      claim: { kind: 'claimed', item },
      createError: new Error('database unavailable'),
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 5,
    })

    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(harness.completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'temporarily_unavailable',
        retainRetryState: true,
      }),
    )
  })

  it('logs the originating error before folding it into a content-free outcome', async () => {
    const harness = setup({
      createError: Object.assign(new Error('slug already taken'), {
        code: 'invalid_slug',
        name: 'PropertyDomainError',
      }),
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeCode: 'internal_error' }),
    )
    expect(harness.logger.warn).toHaveBeenCalledWith(
      {
        itemId: ITEM_ID,
        action: 'create',
        attemptOrdinal: 1,
        retryRevision: 0,
        errorName: 'PropertyDomainError',
        errorCode: 'invalid_slug',
        outcome: 'internal_error',
      },
      'Google import item effect failed',
    )
    // The whole point of the record is diagnosis; it must not smuggle content.
    const logged = JSON.stringify(harness.logger.warn.mock.calls)
    expect(logged).not.toContain('slug already taken')
    expect(logged).not.toContain('Acme Hotel')
    expect(logged).not.toContain(PROVIDER_LOCATION_ID)
    // BANNED_LOG_KEYS: the tenant identifier must never reach a log line.
    expect(logged).not.toContain(ORG_ID)
    expect(logged).not.toContain('organizationId')
  })

  it('relinks with the expected Property generation snapshot', async () => {
    const item = claimedItem({
      action: 'relink',
      existingPropertyId: PROPERTY_ID,
      destinationPropertyId: PROPERTY_ID,
      expectedSourceEpoch: 7,
      expectedProfileVersion: 9,
    })
    const receipt = {
      organizationId: ORG_ID,
      idempotencyKey: ITEM_ID,
      destinationPropertyId: PROPERTY_ID,
      outcome: 'relinked',
      destinationSourceEpoch: 8,
      destinationProfileVersion: 10,
      tombstone: false,
      expiresAt: new Date(NOW.getTime() + 60_000),
      retentionReleasedAt: null,
    } as Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>
    const harness = setup({
      claim: { kind: 'claimed', item },
      receipts: [null, null, receipt],
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: [
          {
            propertyId: PROPERTY_ID,
            sourceEpoch: 7,
            profileVersion: 9,
            action: 'property.update',
          },
        ],
      }),
    )
    expect(harness.relink).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        expectedSourceEpoch: 7,
        expectedProfileVersion: 9,
        profile: expect.objectContaining({
          googleReviewUri: GOOGLE_REVIEW_URI,
        }),
      }),
    )
    expect(harness.reconcileFromReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'relinked',
        destinationPropertyId: PROPERTY_ID,
      }),
    )
    expect(harness.completeClaim).not.toHaveBeenCalled()
  })

  // GBP push activation: the imported/relinked receipt branch is the moment the
  // property is live, so it is where we ask Google to START publishing. Without
  // this call nothing ever invoked `subscribe` and push was dark by
  // construction, no matter how GBP_PUBSUB_TOPIC was configured.
  it('subscribes the connection to GBP notifications when a property goes live', async () => {
    const harness = setup({ receipts: [null, null, importedReceipt()] })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.subscribeToNotifications).toHaveBeenCalledWith(ORG_ID, CONNECTION_ID)
    // After the backfill enqueue: a slow subscribe must not delay the sync that
    // makes the property usable.
    expect(harness.subscribeToNotifications.mock.invocationCallOrder[0]).toBeGreaterThan(
      harness.enqueueReviewSync.mock.invocationCallOrder[0]!,
    )
  })

  it('does not subscribe when the receipt is not an imported/relinked live property', async () => {
    const harness = setup({
      receipt: {
        organizationId: ORG_ID,
        idempotencyKey: ITEM_ID,
        destinationPropertyId: PROPERTY_ID,
        outcome: 'property_deleted',
        destinationSourceEpoch: 0,
        destinationProfileVersion: 1,
        tombstone: true,
        expiresAt: new Date(NOW.getTime() + 60_000),
        retentionReleasedAt: null,
      } as Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>,
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.subscribeToNotifications).not.toHaveBeenCalled()
  })

  // Push is an optimization over the discovery sweep, never a correctness gate:
  // a subscribe outage must not cost the import its committed Property effect.
  it('imports the property even when the notification subscribe fails', async () => {
    const harness = setup({
      receipts: [null, null, importedReceipt()],
      subscribeToNotificationsError: Object.assign(new Error('GBP 503 from Google'), {
        code: 'upstream_error',
        name: 'GbpApiError',
      }),
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.createBoundProperty).toHaveBeenCalledOnce()
    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(harness.reconcileFromReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'imported',
        destinationPropertyId: PROPERTY_ID,
      }),
    )
    expect(harness.logger.warn).toHaveBeenCalledWith(
      { itemId: ITEM_ID, errorName: 'GbpApiError', errorCode: 'upstream_error' },
      expect.stringContaining('GBP notification subscribe failed after import'),
    )
    const logged = JSON.stringify(harness.logger.warn.mock.calls)
    expect(logged).not.toContain('GBP 503 from Google')
    expect(logged).not.toContain(ORG_ID)
  })
})

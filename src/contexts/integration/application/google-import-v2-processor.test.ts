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
  approvalBindingId: '00000000-0000-4000-8000-000000000006',
  authorizationVector: {
    executionPolicyVersion: 12,
    googleContentPolicyVersion: 8,
    emergencyKillVersion: 2,
    role: 'Admin',
    permissionDigest: 'a'.repeat(64),
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
    providerAccountSuffix: 'account-1',
    providerLocationSuffix: 'location-1',
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
    processingRegion: 'us',
    routingPolicyVersion: 1,
    retryRevision: 0,
    attemptOrdinal: 1,
    claimFence: CLAIM_FENCE,
    effectDeadlineAt: new Date(NOW.getTime() + 60_000),
    ...over,
  }
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
  const propertyBindingApi = {
    readReceipt,
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
  const processor = createGoogleImportV2Processor({
    store,
    propertyBindingApi,
    authorizeGoogleImportCommand: authorize,
    resolveActor,
    clock: () => NOW,
    newClaimFence: () => CLAIM_FENCE,
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
    createBoundProperty,
    relink,
    authorize,
    resolveActor,
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
    expect(harness.reconcileFromReceipt).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      destinationPropertyId: PROPERTY_ID,
      outcomeCode: 'imported',
      now: NOW,
    })
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

  it('cancels without a Property effect when current authorization changed', async () => {
    const harness = setup({
      authorization: { ok: false, code: 'authorization_changed' },
    })

    await harness.processor.process({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
    })

    expect(harness.createBoundProperty).not.toHaveBeenCalled()
    expect(harness.completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'authorization_changed',
        retainProtectedRouting: false,
      }),
    )
  })

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
          retainProtectedRouting: false,
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
      retainProtectedRouting: false,
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
        retainProtectedRouting: true,
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
        retainProtectedRouting: true,
      }),
    )
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
})

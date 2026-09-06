import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, userId } from '#/shared/domain/ids'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { OutboxPayloadError } from '#/shared/outbox/event-adapter'
import { isBannedLogKey } from '#/shared/observability/metrics-schema'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type {
  ClaimedImportCandidate,
  GoogleImportReferenceStore,
  ImportDiscoveryAuthorization,
} from './ports/google-import-reference-store.port'
import type { GoogleImportCommandAuthorizer } from './google-import-discovery'
import type {
  GoogleImportV2Intent,
  GoogleImportV2RetryCandidate,
  GoogleImportV2SagaIntent,
  GoogleImportV2StoredReplay,
  GoogleImportV2Store,
} from './ports/google-import-v2-store.port'
import {
  retryPropertyImportItemInputSchema,
  startPropertyImportInputSchema,
} from './dto/google-import-v2.dto'
import {
  createGoogleImportTransaction,
  GoogleImportTransactionError,
} from './google-import-transaction'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-000000000002'
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000003'
const CONNECTION_ID = '00000000-0000-4000-8000-000000000004'
const REQUEST_ID = '00000000-0000-4000-8000-000000000005'
const JOB_ID = '00000000-0000-4000-8000-000000000006'
const ITEM_ID = '00000000-0000-4000-8000-000000000010'
const RETRY_REQUEST_ID = '00000000-0000-4000-8000-000000000011'
const REF_A = `v1.${'A'.repeat(43)}`
const REF_B = `v1.${'B'.repeat(43)}`
const REF_C = `v1.${'C'.repeat(43)}`
const NOW = new Date('2026-08-12T10:00:00.000Z')

const actor: AuthContext = {
  organizationId: organizationId(ORG_ID),
  userId: userId(USER_ID),
  role: 'AccountAdmin',
}

const authorization: ImportDiscoveryAuthorization = {
  organizationId: ORG_ID,
  userId: USER_ID,
  connectionId: CONNECTION_ID,
  connectionLifecycleVersion: 2,
  connectionAccessVersion: 3,
  credentialGeneration: 4,
  authorizationVector: {
    executionPolicyVersion: 'beta-local-2',
    role: 'owner',
    permissionDigest: 'a'.repeat(64),
  },
}

function createClaim(
  candidateRef: string,
  locationId = 'location-1',
): ClaimedImportCandidate {
  return {
    candidateRef,
    authorization,
    candidate: {
      candidateId: '00000000-0000-4000-8000-000000000008',
      accountRef: REF_C,
      accountId: 'account-1',
      locationId,
      accountDisplayName: 'Primary',
      businessName: 'Cafe One',
      address: '1 Main Street',
      primaryCategory: 'Cafe',
      countryCode: 'US',
      eligibility: { kind: 'create' },
      expectedSourceEpoch: null,
      expectedProfileVersion: null,
      affectedPropertyId: null,
    },
  }
}

function startInput(candidateRefs: readonly string[] = [REF_A]) {
  return startPropertyImportInputSchema.parse({
    requestId: REQUEST_ID,
    confirmation: 'apply',
    items: candidateRefs.map((candidateRef, index) => ({
      candidateRef,
      action: 'create',
      profile: {
        name: `Cafe ${index + 1}`,
        address: `${index + 1} Main Street`,
        countryCode: 'US',
        timezone: 'America/New_York',
        confirmed: true,
      },
    })),
  })
}

function referenceStore(claims: readonly ClaimedImportCandidate[]) {
  const byReference = new Map(claims.map((claim) => [claim.candidateRef, claim]))
  const claimCandidates = vi.fn<GoogleImportReferenceStore['claimCandidates']>(
    async (input) => ({
      ok: true,
      candidates: input.candidateRefs.flatMap((candidateRef) => {
        const claim = byReference.get(candidateRef)
        return claim ? [claim] : []
      }),
    }),
  )
  const releaseCandidateClaims = vi.fn(async () => true)
  const consumeCandidateClaims = vi.fn(async () => true)
  const notFound = async () => ({
    ok: false as const,
    code: 'not_found' as const,
  })
  const references: GoogleImportReferenceStore = {
    publishAccountPage: vi.fn(notFound),
    resolveAccount: vi.fn(notFound),
    redeemAccountsCursor: vi.fn(notFound),
    publishCandidatePage: vi.fn(notFound),
    redeemLocationsCursor: vi.fn(notFound),
    resolveCandidate: vi.fn(notFound),
    claimCandidates,
    releaseCandidateClaims,
    consumeCandidateClaims,
    renewLease: vi.fn(notFound),
    invalidateOrganization: vi.fn(async () => true),
    invalidateUser: vi.fn(async () => true),
    invalidateConnection: vi.fn(async () => true),
    invalidateProperty: vi.fn(async () => true),
  }
  return {
    references,
    claimCandidates,
    releaseCandidateClaims,
    consumeCandidateClaims,
  }
}

function memoryStore() {
  const replays = new Map<string, GoogleImportV2StoredReplay>()
  const intents: GoogleImportV2Intent[] = []
  const sagaIntents: GoogleImportV2SagaIntent[] = []
  const findReplay = vi.fn(
    async (organization: string, requestId: string) =>
      replays.get(`${organization}:${requestId}`) ?? null,
  )
  const commitIntent = vi.fn(async (intent: GoogleImportV2Intent) => {
    const key = `${intent.organizationId}:${intent.requestId}`
    if (replays.has(key)) return 'conflict' as const
    intents.push(intent)
    replays.set(key, {
      importJobId: intent.id,
      initiatedBy: intent.initiatedBy,
      wireReplay: intent.wireReplay,
      semanticReplay: intent.semanticReplay,
    })
    return 'committed' as const
  })
  const commitSaga = vi.fn(async (intent: GoogleImportV2SagaIntent) => {
    const key = `${intent.organizationId}:${intent.requestId}`
    if (replays.has(key)) return 'conflict' as const
    sagaIntents.push(intent)
    replays.set(key, {
      importJobId: intent.id,
      initiatedBy: intent.initiatedBy,
      wireReplay: intent.wireReplay,
      semanticReplay: intent.semanticReplay,
    })
    return 'committed' as const
  })
  const retryItem = vi.fn<GoogleImportV2Store['retryItem']>(async () => ({
    kind: 'rejected',
    reason: 'missing',
  }))
  const listRetryCandidates = vi.fn<GoogleImportV2Store['listRetryCandidates']>(
    async () => [],
  )
  const getProgress = vi.fn<GoogleImportV2Store['getProgress']>(async () => null)
  const store: GoogleImportV2Store = {
    findReplay,
    commitSaga,
    commitIntent,
    retryItem,
    claimItem: vi.fn(async () => ({
      kind: 'ignored' as const,
      reason: 'missing' as const,
    })),
    runClaimedEffect: vi.fn(async () => ({ kind: 'lost' as const })),
    releaseClaimForRetry: vi.fn(async () => 'lost' as const),
    reconcileFromReceipt: vi.fn(async () => 'lost' as const),
    completeClaim: vi.fn(async () => 'lost' as const),
    terminalizeItem: vi.fn(async () => 'lost' as const),
    listRetryCandidates,
    listPendingDispatchItems: vi.fn(async () => []),
    listExpiredItems: vi.fn(async () => []),
    listStaleClaimItems: vi.fn(async () => []),
    listPurgeCandidates: vi.fn(async () => []),
    purgeParent: vi.fn(async () => 'lost' as const),
    listLifecycleScopeParents: vi.fn(async () => []),
    fenceLifecycleParent: vi.fn(async () => 'lost' as const),
    listLifecycleScopeItems: vi.fn(async () => []),
    scrubLifecycleItems: vi.fn(async () => 0),
    countLifecycleScopeItems: vi.fn(async () => 0),
    getOperatorProgress: vi.fn(async () => null),
    getProgress,
  }
  return {
    store,
    replays,
    intents,
    sagaIntents,
    findReplay,
    commitIntent,
    commitSaga,
    retryItem,
    listRetryCandidates,
    getProgress,
  }
}

function setup(
  candidateRefs: readonly string[] = [REF_A],
  overrides?: Readonly<{
    cancelImportSaga?: (organizationId: string, importJobId: string) => Promise<void>
  }>,
) {
  const refs = referenceStore(
    candidateRefs.map((reference, index) =>
      createClaim(reference, `location-${index + 1}`),
    ),
  )
  const stored = memoryStore()
  let generated = 0
  const authorizeGoogleImportCommand = vi.fn<GoogleImportCommandAuthorizer>(async () => ({
    ok: true,
    authorization,
    accessToken: null,
  }))
  const logError = vi.fn()
  const logger = { ...createMockLogger(), error: logError }
  const transaction = createGoogleImportTransaction({
    store: stored.store,
    references: refs.references,
    authorizeGoogleImportCommand,
    replayKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
    clock: () => NOW,
    logger,
    ...(overrides?.cancelImportSaga
      ? { cancelImportSaga: overrides.cancelImportSaga }
      : {}),
    idGen: () => {
      generated += 1
      return generated === 1
        ? JOB_ID
        : `10000000-0000-4000-8000-${String(generated).padStart(12, '0')}`
    },
  })
  return { transaction, authorizeGoogleImportCommand, logError, ...refs, ...stored }
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof GoogleImportTransactionError && error.code === code,
  )
}

describe('Google import transaction', () => {
  it('commits one durable parent saga, closes the authorization race, and consumes claims', async () => {
    const fixture = setup()

    await expect(fixture.transaction.start(startInput(), actor)).resolves.toEqual({
      importJobId: JOB_ID,
      replayed: false,
    })

    expect(fixture.commitSaga).toHaveBeenCalledTimes(1)
    expect(fixture.sagaIntents[0]).toMatchObject({
      id: JOB_ID,
      organizationId: ORG_ID,
      requestId: REQUEST_ID,
      initiatedBy: USER_ID,
      batches: [
        {
          ordinal: 0,
          items: [
            {
              providerAccountSuffix: 'account-1',
              providerLocationSuffix: 'location-1',
              effectDeadlineAt: new Date('2026-08-13T10:00:00.000Z'),
            },
          ],
        },
      ],
    })
    expect(fixture.authorizeGoogleImportCommand).toHaveBeenCalledTimes(2)
    expect(fixture.consumeCandidateClaims).toHaveBeenCalledTimes(1)
    expect(fixture.releaseCandidateClaims).not.toHaveBeenCalled()
  })

  it('claims and persists every location through resumable 100-item child batches', async () => {
    const candidateRefs = Array.from(
      { length: 205 },
      (_, index) => `v1.${index.toString(36).padStart(43, '0')}`,
    )
    const fixture = setup(candidateRefs)

    await expect(
      fixture.transaction.start(startInput(candidateRefs), actor),
    ).resolves.toEqual({ importJobId: JOB_ID, replayed: false })

    expect(
      fixture.claimCandidates.mock.calls.map(([input]) => input.candidateRefs.length),
    ).toEqual([100, 100, 5])
    expect(fixture.sagaIntents[0]?.batches.map((batch) => batch.items.length)).toEqual([
      100, 100, 5,
    ])
    expect(fixture.sagaIntents[0]?.batches.map((batch) => batch.ordinal)).toEqual([
      0, 1, 2,
    ])
    expect(fixture.consumeCandidateClaims).toHaveBeenCalledTimes(3)
    expect(fixture.commitIntent).not.toHaveBeenCalled()
  })

  it('replays reordered exact requests after candidate references are gone', async () => {
    const fixture = setup([REF_A, REF_B])
    const original = startInput([REF_A, REF_B])
    const reordered = { ...original, items: [...original.items].reverse() }
    const first = await fixture.transaction.start(original, actor)
    fixture.claimCandidates.mockRejectedValue(new Error('references deleted'))

    await expect(fixture.transaction.start(reordered, actor)).resolves.toEqual({
      importJobId: first.importJobId,
      replayed: true,
    })
    expect(fixture.claimCandidates).toHaveBeenCalledTimes(1)
  })

  it('accepts same-user semantic replay through new references', async () => {
    const fixture = setup()
    await fixture.transaction.start(startInput([REF_A]), actor)
    fixture.claimCandidates.mockResolvedValue({
      ok: true,
      candidates: [createClaim(REF_B, 'location-1')],
    })

    await expect(fixture.transaction.start(startInput([REF_B]), actor)).resolves.toEqual({
      importJobId: JOB_ID,
      replayed: true,
    })
    expect(fixture.commitSaga).toHaveBeenCalledTimes(1)
    expect(fixture.consumeCandidateClaims).toHaveBeenCalledTimes(2)
  })

  it('rejects same-user semantic mismatch and releases the new claim', async () => {
    const fixture = setup()
    await fixture.transaction.start(startInput([REF_A]), actor)
    fixture.claimCandidates.mockResolvedValue({
      ok: true,
      candidates: [createClaim(REF_B, 'different-location')],
    })

    await expectCode(
      fixture.transaction.start(startInput([REF_B]), actor),
      'request_conflict',
    )
    expect(fixture.releaseCandidateClaims).toHaveBeenCalledTimes(1)
  })

  it('returns a cross-user conflict without touching references', async () => {
    const fixture = setup()
    await fixture.transaction.start(startInput(), actor)
    const otherActor = { ...actor, userId: userId(OTHER_USER_ID) }

    await expectCode(
      fixture.transaction.start(startInput(), otherActor),
      'request_conflict',
    )
    expect(fixture.claimCandidates).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the final authorization snapshot changes', async () => {
    const fixture = setup()
    fixture.authorizeGoogleImportCommand
      .mockResolvedValueOnce({ ok: true, authorization, accessToken: null })
      .mockResolvedValueOnce({ ok: false, code: 'authorization_changed' })

    await expectCode(fixture.transaction.start(startInput(), actor), 'unauthorized')
    expect(fixture.commitSaga).not.toHaveBeenCalled()
    expect(fixture.releaseCandidateClaims).toHaveBeenCalledTimes(1)
  })

  it('recovers a committed intent after an ambiguous commit response', async () => {
    const fixture = setup()
    fixture.commitSaga.mockImplementationOnce(async (intent) => {
      fixture.replays.set(`${intent.organizationId}:${intent.requestId}`, {
        importJobId: intent.id,
        initiatedBy: intent.initiatedBy,
        wireReplay: intent.wireReplay,
        semanticReplay: intent.semanticReplay,
      })
      throw new Error('connection dropped after commit')
    })

    await expect(fixture.transaction.start(startInput(), actor)).resolves.toEqual({
      importJobId: JOB_ID,
      replayed: true,
    })
    expect(fixture.consumeCandidateClaims).toHaveBeenCalledTimes(1)
    expect(fixture.releaseCandidateClaims).not.toHaveBeenCalled()
  })

  it('classifies a strict outbox-schema rejection as non-retryable', async () => {
    const fixture = setup()
    fixture.commitSaga.mockRejectedValueOnce(
      new OutboxPayloadError('invalid_payload', 'strict schema rejected the event'),
    )

    await expectCode(fixture.transaction.start(startInput(), actor), 'contract_rejected')
    expect(fixture.releaseCandidateClaims).toHaveBeenCalledTimes(1)
    expect(fixture.logError).not.toHaveBeenCalled()
  })

  it('classifies a wrapped database constraint rejection as non-retryable', async () => {
    const fixture = setup()
    fixture.commitSaga.mockRejectedValueOnce(
      Object.assign(new Error('query failed'), {
        cause: Object.assign(new Error('check constraint failed'), { code: '23514' }),
      }),
    )

    await expectCode(fixture.transaction.start(startInput(), actor), 'contract_rejected')
    expect(fixture.releaseCandidateClaims).toHaveBeenCalledTimes(1)
    expect(fixture.logError).not.toHaveBeenCalled()
  })

  it('keeps a transient database connection failure retryable', async () => {
    const fixture = setup()
    fixture.commitSaga.mockRejectedValueOnce(
      Object.assign(new Error('database connection failed'), { code: '08006' }),
    )

    await expectCode(
      fixture.transaction.start(startInput(), actor),
      'temporarily_unavailable',
    )
    expect(fixture.releaseCandidateClaims).toHaveBeenCalledTimes(1)
    expect(fixture.logError).not.toHaveBeenCalled()
  })

  it('logs an unclassified commit failure with bounded execution identity', async () => {
    const fixture = setup()
    const failure = new Error('unexpected commit failure')
    fixture.commitSaga.mockRejectedValueOnce(failure)

    await expectCode(
      fixture.transaction.start(startInput(), actor),
      'temporarily_unavailable',
    )

    expect(fixture.logError).toHaveBeenCalledOnce()
    const [fields, message] = fixture.logError.mock.calls[0]!
    expect(fields).toEqual({
      err: failure,
      operation: 'commitSaga',
      requestId: REQUEST_ID,
    })
    expect(Object.keys(fields).filter(isBannedLogKey)).toEqual([])
    expect(message).toBe('Google import saga commit threw without a classified cause')
  })

  it('retains claims when both commit and recovery reads are unavailable', async () => {
    const fixture = setup()
    fixture.commitSaga.mockRejectedValueOnce(new Error('commit response lost'))
    fixture.findReplay
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('recovery unavailable'))

    await expectCode(
      fixture.transaction.start(startInput(), actor),
      'temporarily_unavailable',
    )
    expect(fixture.releaseCandidateClaims).not.toHaveBeenCalled()
  })

  it('maps expired references to a generic invalid reference', async () => {
    const fixture = setup()
    fixture.claimCandidates.mockResolvedValueOnce({ ok: false, code: 'expired' })

    await expectCode(fixture.transaction.start(startInput(), actor), 'invalid_reference')
    expect(fixture.commitSaga).not.toHaveBeenCalled()
  })

  it('keeps recovery and status tenant/user scoped', async () => {
    const fixture = setup()
    await fixture.transaction.start(startInput(), actor)

    await expect(fixture.transaction.recover(REQUEST_ID, actor)).resolves.toEqual({
      importJobId: JOB_ID,
    })
    await expectCode(
      fixture.transaction.recover(REQUEST_ID, {
        ...actor,
        userId: userId(OTHER_USER_ID),
      }),
      'invalid_reference',
    )
    await expectCode(fixture.transaction.status(JOB_ID, actor), 'invalid_reference')
  })

  it('cancels only the initiating user saga and treats repeated cancellation as success', async () => {
    const cancelImportSaga = vi.fn(async () => undefined)
    const fixture = setup([REF_A], { cancelImportSaga })
    const activeProgress = {
      contractVersion: 3 as const,
      importJobId: JOB_ID,
      requestId: REQUEST_ID,
      status: 'processing' as const,
      totalCount: 1,
      processedCount: 0,
      counts: {
        pending: 1,
        processing: 0,
        imported: 0,
        relinked: 0,
        already_exists: 0,
        failed: 0,
        cancelled: 0,
      },
      items: [],
      canRetry: false,
      pollAfterMs: 2_000,
      purgeAt: null,
      updatedAt: NOW.toISOString(),
    }
    const cancelledProgress = {
      ...activeProgress,
      status: 'cancelled' as const,
      processedCount: 1,
      counts: { ...activeProgress.counts, pending: 0, cancelled: 1 },
      pollAfterMs: null,
    }
    fixture.getProgress
      .mockResolvedValueOnce(activeProgress)
      .mockResolvedValueOnce(cancelledProgress)
      .mockResolvedValueOnce(cancelledProgress)
      .mockResolvedValueOnce(cancelledProgress)

    await expect(fixture.transaction.cancel(JOB_ID, actor)).resolves.toEqual(
      cancelledProgress,
    )
    await expect(fixture.transaction.cancel(JOB_ID, actor)).resolves.toEqual(
      cancelledProgress,
    )
    expect(cancelImportSaga).toHaveBeenCalledTimes(1)
    expect(cancelImportSaga).toHaveBeenCalledWith(ORG_ID, JOB_ID)

    fixture.getProgress.mockResolvedValueOnce(null)
    await expectCode(
      fixture.transaction.cancel(JOB_ID, {
        ...actor,
        userId: userId(OTHER_USER_ID),
      }),
      'invalid_reference',
    )
  })
  it('accepts a retry only after fresh original-initiator authorization', async () => {
    const fixture = setup()
    const candidate: GoogleImportV2RetryCandidate = {
      importJobId: JOB_ID,
      itemId: ITEM_ID,
      connectionId: CONNECTION_ID,
      existingPropertyId: null,
      expectedSourceEpoch: null,
      expectedProfileVersion: null,
      authorization,
    }
    fixture.retryItem.mockImplementationOnce(async (input) => {
      expect(await input.authorize(candidate)).toBe('authorized')
      return { kind: 'accepted', importJobId: JOB_ID, retryRevision: 1 }
    })
    const input = retryPropertyImportItemInputSchema.parse({
      itemId: ITEM_ID,
      retryRequestId: RETRY_REQUEST_ID,
      expectedRetryRevision: 0,
    })

    await expect(fixture.transaction.retry(input, actor)).resolves.toEqual({
      importJobId: JOB_ID,
      retryRevision: 1,
      replayed: false,
    })
    expect(fixture.retryItem).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        initiatingUserId: USER_ID,
        itemId: ITEM_ID,
        retryRequestId: RETRY_REQUEST_ID,
        expectedRetryRevision: 0,
        requestDigest: {
          keyVersion: 'v1',
          digest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        },
      }),
    )
    expect(fixture.authorizeGoogleImportCommand).toHaveBeenCalledWith({
      actor,
      connectionId: CONNECTION_ID,
      phase: 'publish',
      expected: authorization,
      properties: [],
      requireAccessToken: false,
    })
  })

  it('maps stale retry revisions and unavailable authorization safely', async () => {
    const fixture = setup()
    const input = retryPropertyImportItemInputSchema.parse({
      itemId: ITEM_ID,
      retryRequestId: RETRY_REQUEST_ID,
      expectedRetryRevision: 0,
    })
    fixture.retryItem.mockResolvedValueOnce({
      kind: 'rejected',
      reason: 'stale_revision',
    })
    await expectCode(fixture.transaction.retry(input, actor), 'request_conflict')

    fixture.retryItem.mockResolvedValueOnce({
      kind: 'rejected',
      reason: 'authorization_unavailable',
    })
    await expectCode(
      fixture.transaction.retry(
        {
          ...input,
          retryRequestId: '00000000-0000-4000-8000-000000000012',
        },
        actor,
      ),
      'temporarily_unavailable',
    )
  })

  it('only exposes retry controls after fresh item authorization', async () => {
    const fixture = setup()
    const candidate: GoogleImportV2RetryCandidate = {
      importJobId: JOB_ID,
      itemId: ITEM_ID,
      connectionId: CONNECTION_ID,
      existingPropertyId: null,
      expectedSourceEpoch: null,
      expectedProfileVersion: null,
      authorization,
    }
    fixture.listRetryCandidates.mockResolvedValue([candidate])
    fixture.getProgress.mockResolvedValue({
      contractVersion: 3,
      importJobId: JOB_ID,
      requestId: REQUEST_ID,
      status: 'completed_with_issues',
      totalCount: 1,
      processedCount: 1,
      counts: {
        pending: 0,
        processing: 0,
        imported: 0,
        relinked: 0,
        already_exists: 0,
        failed: 1,
        cancelled: 0,
      },
      items: [
        {
          itemId: ITEM_ID,
          propertyName: 'Cafe One',
          action: 'create',
          status: 'failed',
          outcomeCode: 'temporarily_unavailable',
          messageKey: 'property_import.temporarily_unavailable',
          retryable: true,
          retryRevision: 0,
          userAction: 'retry',
        },
      ],
      canRetry: true,
      pollAfterMs: null,
      purgeAt: '2026-09-11T10:00:00.000Z',
      updatedAt: NOW.toISOString(),
    })

    await expect(fixture.transaction.status(JOB_ID, actor)).resolves.toMatchObject({
      canRetry: true,
      items: [{ itemId: ITEM_ID, retryable: true }],
    })

    fixture.authorizeGoogleImportCommand.mockResolvedValueOnce({
      ok: false,
      code: 'authorization_changed',
    })
    await expect(fixture.transaction.status(JOB_ID, actor)).resolves.toMatchObject({
      canRetry: false,
      items: [{ itemId: ITEM_ID, retryable: false }],
    })
  })
})

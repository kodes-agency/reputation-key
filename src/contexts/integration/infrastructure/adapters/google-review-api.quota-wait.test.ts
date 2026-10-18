import { describe, expect, it, vi, type Mock } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { runReviewProviderSnapshot } from '#/contexts/review/application/use-cases/run-review-provider-snapshot'
import type {
  ReviewProviderSnapshotRepository,
  ReviewProviderSnapshotRun,
} from '#/contexts/review/application/ports/review-provider-snapshot.repository'
import type { ReviewId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import {
  createGoogleReviewCursorStore,
  type GoogleReviewCursorStore,
} from '../google-review-cursor-store'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '../../../../../test-fixtures/generated/google-provider-identifiers-v1'
import { createGoogleReviewApiAdapter } from './google-review-api.adapter'

// Closed beta, 2026-10-16..18: 126 snapshot runs failed `cursor_failure` with
// the cursor store answering `exhausted` next to a `quota_exhausted` admission
// denial. The page cursor was redeemed BEFORE the gateway decided, so every
// denial (never sent to Google) spent one of its redemptions; the use case
// retried the same page, and the sixth try found the cursor used up. These
// tests drive the real cursor store through the real adapter with a gateway
// that refuses the page for longer than any redemption budget could absorb.

const ORG_ID = organizationId('0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC')
const PROPERTY_ID = propertyId('00000000-0000-4000-8000-000000000002')
const CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000003')
const RUN_ID = '00000000-0000-4000-8000-000000000004'
const REVIEW_ID = '00000000-0000-4000-8000-000000000005' as ReviewId
const SOURCE_EPOCH = 17
const NOW_MS = Date.parse('2026-10-18T12:00:00.000Z')
const SECOND_REVIEW_NAME = GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(/0001$/u, '0002')

/** The redemption budget a published review cursor starts with. */
const CURSOR_BUDGET = 10
/** Well past the budget: a quota wait may last any number of refusals. */
const QUOTA_DENIALS = CURSOR_BUDGET * 2 + 5

const authorization = Object.freeze({
  capability: 'property.connect_gbp',
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  initiatorUserId: null,
  expectedCredentialGeneration: 3,
  authorizationVector: Object.freeze({
    generation: 3,
    propertySourceEpoch: SOURCE_EPOCH,
  }),
}) satisfies GoogleProviderCallAuthorization

const connection = {
  status: 'active',
  credentialUseState: 'active',
  lifecycleVersion: 7,
  accessVersion: 11,
  credentialGeneration: 3,
}

/** What the gateway answers while the shared `reviews.list` quota is spent. */
const QUOTA_DENIAL = Object.freeze({
  ok: false,
  code: 'admission_denied',
  admissionCode: 'quota_exhausted',
  dispatch: 'not_sent',
  retryAfterMs: 1_200,
})

/** Google itself answered 429: the page token reached Google. */
const GOOGLE_429 = Object.freeze({
  ok: true,
  status: 429,
  headers: { contentType: 'application/json', cacheControl: null, retryAfter: '1' },
  body: new Uint8Array(),
})

/** The request may have left before the transport failed. */
const TRANSPORT_UNKNOWN = Object.freeze({
  ok: false,
  code: 'transport_error',
  dispatch: 'unknown',
  retryAfterMs: 0,
})

function jsonPage(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: null,
      retryAfter: null,
    },
    body: new TextEncoder().encode(JSON.stringify(body)),
  }
}

function providerReview(name: string) {
  return {
    name,
    starRating: 'FIVE',
    comment: 'Synthetic review body',
    reviewer: { displayName: 'Synthetic Reviewer' },
    createTime: '2026-10-01T10:00:00.000Z',
  }
}

// Factories, not constants: the adapter zeroes every body it has read.
const firstPage = () =>
  jsonPage({
    reviews: [providerReview(GOOGLE_REVIEW_PRIMARY_RESOURCE)],
    totalReviewCount: 2,
    averageRating: 5,
    nextPageToken: 'provider-page-token',
  })
const lastPage = () =>
  jsonPage({
    reviews: [providerReview(SECOND_REVIEW_NAME)],
    totalReviewCount: 2,
    averageRating: 5,
  })

function realCursorStore(): GoogleReviewCursorStore {
  let nonce = 0
  return createGoogleReviewCursorStore({
    store: createInMemoryProviderEphemeralStore(() => NOW_MS),
    keys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
    nowMs: () => NOW_MS,
    randomNonce: () => Buffer.alloc(32, ++nonce).toString('base64url'),
  })
}

function createAdapter(execute: Mock, cursorStore: GoogleReviewCursorStore) {
  const warn = vi.fn()
  const api = createGoogleReviewApiAdapter({
    connectionRepo: { findById: vi.fn().mockResolvedValue(connection) } as never,
    logger: { warn } as never,
    cursorStore,
    executor: { execute },
    authorizeReviewSyncProviderCall: vi
      .fn()
      .mockResolvedValue({ accessToken: 'access-token', authorization }),
    nowMs: () => NOW_MS,
  })
  return { api, warn }
}

function listInput(cursorRef: string | null, pageIndex: number) {
  return {
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    sourceEpoch: SOURCE_EPOCH,
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    runId: RUN_ID,
    phase: 'main' as const,
    pageIndex,
    cursorRef,
  }
}

/** Reads page 0 through the adapter, which publishes the page-1 cursor. */
async function publishSecondPageCursor(
  api: ReturnType<typeof createAdapter>['api'],
): Promise<string> {
  const first = await api.listReviewsPage(listInput(null, 0))
  if (first.nextCursorRef === null) throw new Error('fixture published no cursor')
  return first.nextCursorRef
}

describe('a review page cursor at the adapter seam', () => {
  it('survives any number of quota refusals that never reached Google', async () => {
    const execute = vi.fn().mockResolvedValueOnce(firstPage())
    for (let denial = 0; denial < QUOTA_DENIALS; denial += 1) {
      execute.mockResolvedValueOnce(QUOTA_DENIAL)
    }
    execute.mockResolvedValueOnce(lastPage())
    const { api, warn } = createAdapter(execute, realCursorStore())
    const cursorRef = await publishSecondPageCursor(api)

    for (let denial = 0; denial < QUOTA_DENIALS; denial += 1) {
      await expect(api.listReviewsPage(listInput(cursorRef, 1))).rejects.toMatchObject({
        _tag: 'GoogleReviewApiError',
        code: 'provider_rate_limited',
        recoverable: true,
        // The provider plane's floor over the admission hint: the continuation
        // waits instead of re-running at queue speed.
        retryAfterMs: 5_000,
        failure: { dispatch: 'not_sent' },
      })
    }
    const page = await api.listReviewsPage(listInput(cursorRef, 1))

    expect(page.reviews.map((review) => review.reviewName)).toEqual([SECOND_REVIEW_NAME])
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        routeKey: 'reviews.list',
        pageToken: 'provider-page-token',
      }),
      expect.anything(),
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('spends a redemption on every request that reached, or may have reached, Google', async () => {
    // A dispatched 429 or a transport failure presented the page token to
    // Google, so it counts against the bounded replay; only `not_sent` is
    // given back. The budget is exactly ten such sends.
    const execute = vi.fn().mockResolvedValueOnce(firstPage())
    for (let send = 0; send < CURSOR_BUDGET; send += 1) {
      execute.mockResolvedValueOnce(QUOTA_DENIAL)
      execute.mockResolvedValueOnce(send % 2 === 0 ? GOOGLE_429 : TRANSPORT_UNKNOWN)
    }
    const { api, warn } = createAdapter(execute, realCursorStore())
    const cursorRef = await publishSecondPageCursor(api)

    for (let attempt = 0; attempt < CURSOR_BUDGET * 2; attempt += 1) {
      await expect(api.listReviewsPage(listInput(cursorRef, 1))).rejects.toMatchObject({
        recoverable: true,
      })
    }
    await expect(api.listReviewsPage(listInput(cursorRef, 1))).rejects.toMatchObject({
      code: 'cursor_exhausted',
    })

    expect(execute).toHaveBeenCalledTimes(1 + CURSOR_BUDGET * 2)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'redeem', code: 'exhausted', pageIndex: 1 }),
      expect.any(String),
    )
  })

  it('keeps the rate-limit answer when the redemption cannot be given back', async () => {
    const cursorRef = `v1.${'c'.repeat(43)}`
    const execute = vi.fn().mockResolvedValue(QUOTA_DENIAL)
    const refusing = createAdapter(execute, {
      redeem: vi.fn(async () => ({
        ok: true as const,
        value: { pageToken: 'provider-page-token' },
      })),
      release: vi.fn(async () => ({ ok: false as const, code: 'conflict' as const })),
      publishNext: vi.fn(),
      discardRun: vi.fn(),
      startedAtMs: vi.fn(async () => null),
    })
    const faulting = createAdapter(execute, {
      redeem: vi.fn(async () => ({
        ok: true as const,
        value: { pageToken: 'provider-page-token' },
      })),
      release: vi.fn(async () => {
        throw new Error('redis connection reset')
      }),
      publishNext: vi.fn(),
      discardRun: vi.fn(),
      startedAtMs: vi.fn(async () => null),
    })

    for (const { api, warn, code } of [
      { ...refusing, code: 'conflict' },
      { ...faulting, code: 'store_threw' },
    ]) {
      await expect(api.listReviewsPage(listInput(cursorRef, 4))).rejects.toMatchObject({
        code: 'provider_rate_limited',
        retryAfterMs: 5_000,
      })
      expect(warn).toHaveBeenCalledWith(
        {
          event: 'reviews_cursor_rejected',
          operation: 'release',
          code,
          phase: 'main',
          pageIndex: 4,
          runId: RUN_ID,
        },
        expect.any(String),
      )
      const logged = JSON.stringify(warn.mock.calls)
      expect(logged).not.toContain(cursorRef)
      expect(logged).not.toContain('provider-page-token')
      expect(logged).not.toContain('redis connection reset')
    }
  })

  it('gives nothing back for a page Google answered', async () => {
    const release = vi.fn()
    const { api } = createAdapter(vi.fn().mockResolvedValue(lastPage()), {
      redeem: vi.fn(async () => ({
        ok: true as const,
        value: { pageToken: 'provider-page-token' },
      })),
      release,
      publishNext: vi.fn(),
      discardRun: vi.fn(),
      startedAtMs: vi.fn(async () => null),
    })

    await api.listReviewsPage(listInput(`v1.${'d'.repeat(43)}`, 1))

    expect(release).not.toHaveBeenCalled()
  })
})

function scanningRun(cursorRef: string): ReviewProviderSnapshotRun {
  return {
    id: RUN_ID,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    sourceEpoch: SOURCE_EPOCH,
    observationOrigin: 'ongoing',
    state: 'scanning',
    phase: 'main',
    startedAt: new Date(NOW_MS - 60_000),
    expectedProviderTotal: 2,
    expectedProviderAverageRating: 5,
    mainPageIndex: 1,
    mainCursorRef: cursorRef,
    mainUniqueCount: 1,
    confirmationPageIndex: 0,
    confirmationCursorRef: null,
    confirmationUniqueCount: 0,
    confirmationDeadline: null,
    applyCursorReviewId: null,
    terminalAt: null,
    failureCode: null,
  }
}

const unexpected = () =>
  vi.fn(async () => {
    throw new Error('not part of a main-scan page')
  })

function snapshotRepository(run: ReviewProviderSnapshotRun) {
  return {
    readExpiredActiveRun: vi.fn(async () => null),
    startOrResume: unexpected(),
    readHistoryCutoff: vi.fn(async () => null),
    fixImportHistoryCutoff: unexpected(),
    readRun: vi.fn(async () => run),
    commitPage: vi.fn(async () => ({
      status: 'committed' as const,
      run,
      finalPage: true,
    })),
    finishMainScan: vi.fn(async () => ({
      status: 'confirming' as const,
      run: { ...run, state: 'confirming' as const, phase: 'confirmation' as const },
    })),
    readNextLinkedCandidate: unexpected(),
    confirmLinkedCandidateMissing: unexpected(),
    recordCandidateObservation: unexpected(),
    beginConfirmationScan: unexpected(),
    finishConfirmationScan: unexpected(),
    failRun: vi.fn(async () => ({ ...run, state: 'failed' as const })),
    applyDeletionBatch: unexpected(),
    expireRawSourceBatch: unexpected(),
    sweepExpiredTombstones: unexpected(),
  } satisfies ReviewProviderSnapshotRepository
}

function silentLogger(): LoggerPort {
  const logger: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  }
  return logger
}

describe('a snapshot run waiting out the reviews.list quota', () => {
  it('fetches the page once admitted instead of failing with cursor_failure', async () => {
    const execute = vi.fn().mockResolvedValueOnce(firstPage())
    for (let denial = 0; denial < QUOTA_DENIALS; denial += 1) {
      execute.mockResolvedValueOnce(QUOTA_DENIAL)
    }
    execute.mockResolvedValueOnce(lastPage())
    const { api } = createAdapter(execute, realCursorStore())
    const repository = snapshotRepository(scanningRun(await publishSecondPageCursor(api)))
    const runStep = runReviewProviderSnapshot({
      repository,
      googleReviewApi: api,
      propertySourceEpoch: {
        getSourceEpoch: vi.fn(async () => ({ sourceEpoch: SOURCE_EPOCH })),
      },
      observationWriter: {
        allocateReplyReadGeneration: vi.fn(async () => 1),
        persist: vi.fn(async () => ({
          reviewId: REVIEW_ID,
          sourceRevision: 1,
          isNew: false,
        })),
      },
      subjectKeyService: {
        acquireDeriver: vi.fn(async () => ({
          activeVersion: 'key-v1',
          retiringVersion: null,
          inventoryGeneration: 1,
          deriveCandidates: () =>
            [
              {
                contractVersion: 'review-provider-subject-v1' as const,
                keyVersion: 'key-v1',
                locatorHmac: new Uint8Array(32),
                verifierHmac: new Uint8Array(32),
              },
            ] as const,
        })),
        stageTrustedNext: unexpected(),
        activateTrustedNext: unexpected(),
        removeRetiring: unexpected(),
      },
      syncActivity: {
        recordNewReviewObserved: vi.fn(async () => undefined),
        recordPushObserved: vi.fn(async () => undefined),
      },
      clock: () => new Date(NOW_MS),
      logger: silentLogger(),
    })
    const step = () =>
      runStep({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: SOURCE_EPOCH,
        observationOrigin: 'ongoing',
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        runId: RUN_ID,
      })

    for (let denial = 0; denial < QUOTA_DENIALS; denial += 1) {
      await expect(step()).resolves.toEqual({
        status: 'checkpointed',
        runId: RUN_ID,
        state: 'scanning',
        retryAfterMs: 5_000,
      })
    }
    await expect(step()).resolves.toEqual({
      status: 'checkpointed',
      runId: RUN_ID,
      state: 'confirming',
    })

    expect(repository.failRun).not.toHaveBeenCalled()
    expect(repository.commitPage).toHaveBeenCalledTimes(1)
    expect(repository.commitPage).toHaveBeenCalledWith(
      expect.objectContaining({ expectedPageIndex: 1, nextCursorRef: null }),
    )
  })
})

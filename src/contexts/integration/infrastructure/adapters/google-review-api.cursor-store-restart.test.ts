import { describe, expect, it, vi, type Mock } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { runReviewProviderSnapshot } from '#/contexts/review/application/use-cases/run-review-provider-snapshot'
import type {
  ReviewProviderSnapshotRepository,
  ReviewProviderSnapshotRun,
} from '#/contexts/review/application/ports/review-provider-snapshot.repository'
import type { ReviewId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import { createGoogleReviewCursorStore } from '../google-review-cursor-store'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '../../../../../test-fixtures/generated/google-provider-identifiers-v1'
import { createGoogleReviewApiAdapter } from './google-review-api.adapter'

// Closed beta, 2026-10-18 18:24 UTC: a deploy redeployed google-provider-redis,
// which keeps nothing across a restart (ADR 0050). The two largest Properties
// were mid-scan; their next redeem found no cursor (`not_found`), both runs
// failed `cursor_failure`, and each became a Sentry error, a dead letter and
// three alerts. Every deploy does this to whichever runs are in flight. These
// tests drive the real use case through the real adapter and cursor store over
// a provider store the test restarts, as a redeploy does.

const ORG_ID = organizationId('0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC')
const PROPERTY_ID = propertyId('00000000-0000-4000-8000-000000000002')
const CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000003')
const RUN_ID = '00000000-0000-4000-8000-000000000004'
const REVIEW_ID = '00000000-0000-4000-8000-000000000005' as ReviewId
const SOURCE_EPOCH = 17
/** The deploy: the provider store comes back empty at this instant. */
const RESTART_MS = Date.parse('2026-10-18T18:24:10.000Z')
const STORE_BOOTED_MS = RESTART_MS - 6 * 60 * 60_000
const RUN_STARTED_MS = RESTART_MS - 5 * 60_000
const SECOND_REVIEW_NAME = GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(/0001$/u, '0002')

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
const pageWithNext = (reviewName: string, nextPageToken: string) => () =>
  jsonPage({
    reviews: [providerReview(reviewName)],
    totalReviewCount: 3,
    averageRating: 5,
    nextPageToken,
  })
const firstPage = pageWithNext(GOOGLE_REVIEW_PRIMARY_RESOURCE, 'provider-page-token-1')
const secondPage = pageWithNext(SECOND_REVIEW_NAME, 'provider-page-token-2')

/**
 * A provider store the test can restart. The new instance is empty and reports
 * its own start, as a redeployed google-provider-redis does.
 */
function restartableProviderStore(clock: { nowMs: number }) {
  let current = createInMemoryProviderEphemeralStore(() => clock.nowMs)
  const store: ProviderEphemeralStore = {
    putIfAbsent: (namespace, key, value, ttlSeconds) =>
      current.putIfAbsent(namespace, key, value, ttlSeconds),
    read: (namespace, key) => current.read(namespace, key),
    consume: (namespace, key) => current.consume(namespace, key),
    consumeIfEquals: (namespace, key, expected) =>
      current.consumeIfEquals(namespace, key, expected),
    replaceIfEquals: (namespace, key, expected, next, ttlSeconds) =>
      current.replaceIfEquals(namespace, key, expected, next, ttlSeconds),
    compareAndSwapMany: (namespace, entries) =>
      current.compareAndSwapMany(namespace, entries),
    remove: (namespace, key) => current.remove(namespace, key),
    startedAtMs: () => current.startedAtMs(),
  }
  return {
    store,
    restart: () => {
      current = createInMemoryProviderEphemeralStore(() => clock.nowMs)
    },
  }
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

function scanningRun(
  input: Readonly<{
    id: string
    startedAtMs: number
    pageIndex: number
    cursorRef: string
  }>,
): ReviewProviderSnapshotRun {
  return {
    id: input.id,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    sourceEpoch: SOURCE_EPOCH,
    observationOrigin: 'ongoing',
    state: 'scanning',
    phase: 'main',
    startedAt: new Date(input.startedAtMs),
    expectedProviderTotal: 3,
    expectedProviderAverageRating: 5,
    mainPageIndex: input.pageIndex,
    mainCursorRef: input.cursorRef,
    mainUniqueCount: input.pageIndex,
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
      finalPage: false,
    })),
    finishMainScan: unexpected(),
    readNextLinkedCandidate: unexpected(),
    confirmLinkedCandidateMissing: unexpected(),
    recordCandidateObservation: unexpected(),
    beginConfirmationScan: unexpected(),
    finishConfirmationScan: unexpected(),
    failRun: vi.fn(async ({ code }) => ({
      ...run,
      state: 'failed' as const,
      failureCode: code,
    })),
    applyDeletionBatch: unexpected(),
    expireRawSourceBatch: unexpected(),
    sweepExpiredTombstones: unexpected(),
  } satisfies ReviewProviderSnapshotRepository
}

/** The real adapter over the real cursor store, on a clock the test moves. */
function createSeam() {
  const clock = { nowMs: STORE_BOOTED_MS }
  const provider = restartableProviderStore(clock)
  let nonce = 0
  const cursorStore = createGoogleReviewCursorStore({
    store: provider.store,
    keys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
    nowMs: () => clock.nowMs,
    randomNonce: () => Buffer.alloc(32, ++nonce).toString('base64url'),
  })
  const execute: Mock = vi.fn()
  const adapterWarn = vi.fn()
  const api = createGoogleReviewApiAdapter({
    connectionRepo: { findById: vi.fn().mockResolvedValue(connection) } as never,
    logger: { warn: adapterWarn } as never,
    cursorStore,
    executor: { execute },
    authorizeReviewSyncProviderCall: vi
      .fn()
      .mockResolvedValue({ accessToken: 'access-token', authorization }),
    nowMs: () => clock.nowMs,
  })
  return { clock, provider, execute, adapterWarn, api }
}

type Seam = ReturnType<typeof createSeam>

/** Reads page 0 of `runId` through the adapter, which publishes the page-1 cursor. */
async function publishSecondPageCursor(seam: Seam, runId: string): Promise<string> {
  seam.execute.mockResolvedValueOnce(firstPage())
  const first = await seam.api.listReviewsPage({
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    sourceEpoch: SOURCE_EPOCH,
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    runId,
    phase: 'main',
    pageIndex: 0,
    cursorRef: null,
  })
  if (first.nextCursorRef === null) throw new Error('fixture published no cursor')
  return first.nextCursorRef
}

function snapshotStep(seam: Seam, run: ReviewProviderSnapshotRun) {
  const repository = snapshotRepository(run)
  const logger = silentLogger()
  const step = runReviewProviderSnapshot({
    repository,
    googleReviewApi: seam.api,
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
    clock: () => new Date(seam.clock.nowMs),
    logger,
  })
  const result = step({
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    sourceEpoch: SOURCE_EPOCH,
    observationOrigin: 'ongoing',
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    runId: run.id,
  })
  return { result, repository, logger }
}

describe('a snapshot run whose cursor store restarted mid-scan', () => {
  it('ends quietly as cursor_lost when the next cursor went with the restart', async () => {
    const seam = createSeam()
    seam.clock.nowMs = RUN_STARTED_MS
    const cursorRef = await publishSecondPageCursor(seam, RUN_ID)
    seam.clock.nowMs = RESTART_MS
    seam.provider.restart()
    seam.clock.nowMs = RESTART_MS + 10_000

    const { result, repository, logger } = snapshotStep(
      seam,
      scanningRun({ id: RUN_ID, startedAtMs: RUN_STARTED_MS, pageIndex: 1, cursorRef }),
    )

    await expect(result).resolves.toEqual({
      status: 'failed',
      runId: RUN_ID,
      code: 'cursor_lost',
    })
    expect(repository.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID, code: 'cursor_lost' }),
    )
    // Nothing reached Google for the lost page, and nothing was logged as an error.
    expect(seam.execute).toHaveBeenCalledTimes(1)
    expect(logger.error).not.toHaveBeenCalled()
    expect(seam.adapterWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reviews_cursor_rejected',
        operation: 'redeem',
        code: 'not_found',
        storeStartedAt: new Date(RESTART_MS).toISOString(),
      }),
      expect.any(String),
    )
  })

  it('ends quietly as cursor_lost when the restart came while Google answered the page', async () => {
    const seam = createSeam()
    seam.clock.nowMs = RUN_STARTED_MS
    const cursorRef = await publishSecondPageCursor(seam, RUN_ID)
    seam.clock.nowMs = RESTART_MS - 1_000
    seam.execute.mockImplementationOnce(async () => {
      seam.clock.nowMs = RESTART_MS
      seam.provider.restart()
      return secondPage()
    })

    const { result, repository } = snapshotStep(
      seam,
      scanningRun({ id: RUN_ID, startedAtMs: RUN_STARTED_MS, pageIndex: 1, cursorRef }),
    )

    // The page-1 token was redeemed before the restart; the page-2 cursor
    // could not be published under a parent the store no longer holds.
    await expect(result).resolves.toEqual({
      status: 'failed',
      runId: RUN_ID,
      code: 'cursor_lost',
    })
    expect(repository.commitPage).not.toHaveBeenCalled()
    expect(seam.adapterWarn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'publish_next', code: 'not_found' }),
      expect.any(String),
    )
  })
})

describe('a snapshot run whose cursor vanished with no store restart', () => {
  it('fails loudly as cursor_failure, run after run', async () => {
    const seam = createSeam()
    // The store has been up for hours; nothing restarted it.
    seam.clock.nowMs = RESTART_MS
    const runIds = [
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012',
      '00000000-0000-4000-8000-000000000013',
    ]

    for (const [attempt, runId] of runIds.entries()) {
      const startedAtMs = RESTART_MS + attempt * 10 * 60_000
      seam.clock.nowMs = startedAtMs
      await publishSecondPageCursor(seam, runId)
      seam.clock.nowMs = startedAtMs + 60_000
      // A ref the store does not hold: whatever dropped it, it was not a restart.
      const { result, repository } = snapshotStep(
        seam,
        scanningRun({
          id: runId,
          startedAtMs,
          pageIndex: 1,
          cursorRef: `v1.${'z'.repeat(43)}`,
        }),
      )

      await expect(result).resolves.toEqual({
        status: 'failed',
        runId,
        code: 'cursor_failure',
      })
      expect(repository.failRun).toHaveBeenCalledWith(
        expect.objectContaining({ runId, code: 'cursor_failure' }),
      )
    }
  })
})

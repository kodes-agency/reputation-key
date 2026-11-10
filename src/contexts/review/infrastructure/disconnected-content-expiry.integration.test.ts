import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { disconnectGoogleAccount } from '#/contexts/integration/application/use-cases/disconnect-google-account'
import { refreshGoogleToken } from '#/contexts/integration/application/use-cases/refresh-google-token'
import { integrationError } from '#/contexts/integration/domain/errors'
import { createAtomicIntegrationCommandStore } from '#/contexts/integration/infrastructure/integration-command-store'
import { createGoogleConnectionRepository } from '#/contexts/integration/infrastructure/repositories/google-connection.repository'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
  createRunReviewSourceContentLifecycle,
} from '../application/use-cases/run-source-content-lifecycle'
import { reviewCreated } from '../domain/events'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createEligibleReads } from '../application/eligible-reads'
import { createServingStats } from './serving-stats'
import { createReviewRepository } from './repositories/review.repository'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createReviewSourceContentLifecycleStore } from './repositories/source-content-lifecycle-store.repository'

const ORG = organizationId('disconnected-content-expiry-org')
const OTHER_ORG = organizationId('disconnected-content-expiry-other')
const PROPERTY = propertyId('b8000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('b8000000-0000-4000-8000-000000000002')
const FETCHED_AT = new Date('2026-08-01T12:00:00Z')
const STOPPED_AT = new Date('2026-08-15T12:00:00Z')
const DEADLINE = new Date('2026-08-31T12:00:00Z')
const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'google_reply_observation_heads',
    'google_reply_observations',
    'replies',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_heads',
    'reviews',
    'properties',
    'google_connections',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

async function setup() {
  let now = STOPPED_AT
  const clock = () => now
  const db = getDb()
  const connectionRepo = createGoogleConnectionRepository(db, clock)
  const connection = buildTestGoogleConnection({
    id: 'b8000000-0000-4000-8000-000000000003',
    organizationId: ORG,
    googleSubject: 'disconnected-content-expiry-subject',
    tokenExpiresAt: new Date(STOPPED_AT.getTime() - 1),
  })
  await connectionRepo.insert(connection)
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, google_connection_id)
     VALUES ($1, $2, 'Content expiry', 'disconnected-content-expiry', 'UTC', $3)`,
    [PROPERTY, ORG, connection.id],
  )
  const review = await createAtomicReviewCommandStore(
    db,
    () => FETCHED_AT,
    undefined,
    undefined,
    replyScopeEffects,
  ).upsertAndRecord(
    {
      id: REVIEW,
      organizationId: ORG,
      propertyId: PROPERTY,
      platform: 'google',
      externalId: 'disconnected-content-review',
      externalLocationId: 'locations/disconnected-content-expiry',
      googleConnectionId: connection.id,
      reviewerName: 'Provider reviewer',
      reviewerProfilePhotoUrl: null,
      googleReviewUrl: null,
      rating: 4,
      text: 'Retained provider review',
      translatedText: null,
      languageCode: 'en',
      reviewedAt: FETCHED_AT,
      expiresAt: DEADLINE,
      sentimentLabel: null,
      sentimentScore: null,
      sourceCreatedAt: FETCHED_AT,
      sourceUpdatedAt: FETCHED_AT,
      firstFetchedAt: FETCHED_AT,
      lastFetchedAt: FETCHED_AT,
      contentExpiresAt: DEADLINE,
      contentHash: 'content-expiry-hash',
      sourceSeenGeneration: null,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 0,
      aiSourceByteLength: 24,
      aiSourceDigest: 'a'.repeat(64),
    },
    (persisted) =>
      reviewCreated({
        reviewId: persisted.id,
        organizationId: ORG,
        propertyId: PROPERTY,
        platform: 'google',
        sourceEpoch: persisted.sourceEpoch,
        sourceRevision: persisted.sourceRevision,
        analysisSequence: persisted.analysisSequence,
        occurredAt: FETCHED_AT,
      }),
    FETCHED_AT,
    'a'.repeat(64),
  )
  await createGoogleReplyObservationStore(db).record({
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    sourceEpoch: review.sourceEpoch,
    materialReviewRevision: review.sourceRevision,
    readGeneration: 1,
    observationKey: 'b'.repeat(64),
    source: 'provider_snapshot',
    observedText: 'Retained provider reply',
    providerUpdatedAt: FETCHED_AT,
    observedAt: FETCHED_AT,
    contentExpiresAt: DEADLINE,
  })
  await getPool().query(
    `INSERT INTO replies (id, review_id, organization_id, text, status, source)
     VALUES ('b8000000-0000-4000-8000-000000000004', $1, $2,
             'Retained manager draft', 'draft', 'internal')`,
    [REVIEW, ORG],
  )
  const commandStore = createAtomicIntegrationCommandStore(db, clock)
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const disconnect = disconnectGoogleAccount({
    connectionRepo,
    commandStore,
    oauth,
    encryption,
    clock,
    logger: createMockLogger(),
  })
  const refreshAtProvider = vi.fn(async () => {
    throw integrationError('reauthorization_required', 'Synthetic revoked grant')
  })
  const refresh = refreshGoogleToken({
    connectionRepo,
    commandStore,
    encryption,
    clock,
    oauth: { ...oauth, refreshAccessToken: refreshAtProvider },
  })
  const runLifecycle = createRunReviewSourceContentLifecycle({
    store: createReviewSourceContentLifecycleStore(db, replyScopeEffects),
    clock,
    authorizeApply: async () => ({
      approvalId: 'test-expiry-approval',
      evidenceSha256: 'c'.repeat(64),
      approvedAt: FETCHED_AT.toISOString(),
    }),
  })
  return {
    connection,
    connectionRepo,
    disconnect,
    refresh,
    refreshAtProvider,
    ctx: buildTestAuthContext({ organizationId: ORG, role: 'AccountAdmin' }),
    setTime: (value: Date) => {
      now = value
    },
    expire: () =>
      runLifecycle({
        mode: 'apply',
        batchSize: 10,
        scope: { kind: 'expired', organizationId: ORG },
        applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      }),
  }
}

async function retainedContent() {
  const result = await getPool().query(
    `SELECT c.text, r.source_content_state, c.last_fetched_at, c.content_expires_at,
            r.text AS old_review_text, r.last_fetched_at AS old_last_fetched_at,
            r.content_expires_at AS old_content_expires_at,
            c.text AS cache_text, c.content_expires_at AS cache_deadline,
            o.original_text AS observation_text, o.content_expires_at AS observation_deadline,
            g.normalized_text AS provider_reply, g.content_expires_at AS reply_deadline
     FROM reviews r
     JOIN review_source_contents c ON c.review_id = r.id
     JOIN review_source_observations o ON o.review_id = r.id
     JOIN google_reply_observations g ON g.review_id = r.id
     WHERE r.id = $1 AND r.organization_id = $2`,
    [REVIEW, ORG],
  )
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]).toMatchObject({
    text: 'Retained provider review',
    old_review_text: null,
    old_last_fetched_at: null,
    old_content_expires_at: null,
    source_content_state: 'active',
    last_fetched_at: FETCHED_AT,
    content_expires_at: DEADLINE,
    cache_text: 'Retained provider review',
    cache_deadline: DEADLINE,
    observation_text: 'Retained provider review',
    observation_deadline: DEADLINE,
    provider_reply: 'Retained provider reply',
    reply_deadline: DEADLINE,
  })
  return result.rows
}

/** Every read that serves the review's words, as the pages and AI paths make them. */
async function servingReads(at: Date) {
  const db = getDb()
  const repo = createReviewRepository(db, () => at, undefined, replyScopeEffects)
  const eligible = createEligibleReads({ reviewRepo: repo, clock: () => at })
  const stats = createServingStats({ db, clock: () => at })
  const window = [
    new Date('2026-07-01T00:00:00Z'),
    new Date('2026-12-01T00:00:00Z'),
  ] as const
  return {
    byId: await repo.findById(REVIEW, ORG),
    byIds: await repo.findByIds([REVIEW], ORG),
    byProperty: await repo.findByPropertyId(PROPERTY, ORG),
    byOrganization: await repo.findByOrganizationId(ORG),
    byExternalId: await repo.findByExternalId(
      'google',
      'disconnected-content-review',
      ORG,
    ),
    search: await repo.findIdsByContentFilter(ORG, { textQuery: 'Retained' }, at),
    snippet: await eligible.getReviewSnippetById(REVIEW, ORG),
    snippets: (await eligible.getReviewSnippetsByIds([REVIEW], ORG)).size,
    rating: await eligible.getEligibleRatingById(REVIEW, ORG),
    recent: await stats.getRecentReviews(ORG, PROPERTY, 5),
    period: await stats.getPeriodStats(ORG, PROPERTY, ...window),
  }
}

describe('disconnected Google content expiry', () => {
  it.each(['disconnect', 'provider_revoked'] as const)(
    '%s retains every content clock until the existing deadline, then erases once',
    async (cause) => {
      const fixture = await setup()
      const original = await retainedContent()
      const stop = async () => {
        if (cause === 'disconnect') {
          await fixture.disconnect({ connectionId: fixture.connection.id }, fixture.ctx)
        } else {
          await expect(fixture.refresh(ORG, fixture.connection.id)).rejects.toMatchObject(
            {
              code: 'reauthorization_required',
            },
          )
        }
      }
      await stop()
      const beforeDeadline = new Date(DEADLINE.getTime() - 1)
      const served = await servingReads(beforeDeadline)
      expect(served.byId?.text).toBe('Retained provider review')
      expect(served.search).toEqual([REVIEW])
      expect(served.recent.map((row) => row.text)).toEqual(['Retained provider review'])
      expect(served.period.count).toBe(1)
      fixture.setTime(beforeDeadline)
      await stop()
      expect(await retainedContent()).toEqual(original)
      await expect(fixture.expire()).resolves.toMatchObject({
        apply: { enabled: true, rowsRedacted: 0 },
      })
      expect(await retainedContent()).toEqual(original)
      await expect(
        fixture.connectionRepo.findById(ORG, fixture.connection.id),
      ).resolves.toMatchObject({
        status: cause === 'disconnect' ? 'disconnected' : 'reauth_required',
      })
      if (cause === 'provider_revoked')
        expect(fixture.refreshAtProvider).toHaveBeenCalledTimes(1)
      const stopFacts = await getPool().query(
        `SELECT event_type, payload->>'cause' AS cause FROM outbox_events
         WHERE source_aggregate_id = $1 AND organization_id = $2
           AND event_type IN ('integration.google_account.disconnected',
                              'integration.google_account.reauthorization_required')`,
        [fixture.connection.id, ORG],
      )
      expect(stopFacts.rows).toEqual([
        {
          event_type:
            cause === 'disconnect'
              ? 'integration.google_account.disconnected'
              : 'integration.google_account.reauthorization_required',
          cause: cause === 'disconnect' ? null : 'provider_revoked',
        },
      ])

      fixture.setTime(DEADLINE)
      await expect(fixture.expire()).resolves.toMatchObject({
        apply: { enabled: true, rowsRedacted: 1 },
      })
      await expect(fixture.expire()).resolves.toMatchObject({
        apply: { enabled: true, rowsRedacted: 0 },
      })
      const after = await servingReads(DEADLINE)
      expect(after).toMatchObject({
        byId: null,
        byIds: [],
        byProperty: [],
        byOrganization: [],
        byExternalId: null,
        search: [],
        snippet: { status: 'not_found' },
        snippets: 0,
        rating: null,
        recent: [],
        period: { count: 0 },
      })
      const proof = await getPool().query(
        `SELECT r.source_content_state, r.text, r.content_expires_at,
           (SELECT count(*)::int FROM review_source_contents WHERE review_id = r.id) AS caches,
           (SELECT count(*)::int FROM review_source_observations
            WHERE review_id = r.id AND content_state = 'active') AS active_observations,
           (SELECT count(*)::int FROM review_source_observations
            WHERE review_id = r.id) AS observation_identities,
           (SELECT count(*)::int FROM google_reply_observations
            WHERE review_id = r.id AND normalized_text IS NOT NULL) AS provider_replies,
           (SELECT count(*)::int FROM material_review_revisions
            WHERE review_id = r.id AND content_state = 'active') AS active_revisions,
           (SELECT count(*)::int FROM material_review_revisions
            WHERE review_id = r.id) AS revision_identities,
           (SELECT text FROM replies WHERE review_id = r.id AND source = 'internal') AS manager_text,
           (SELECT count(*)::int FROM outbox_events WHERE source_aggregate_id = r.id::text
            AND event_type = 'review.source_transitioned') AS transitions
         FROM reviews r WHERE r.id = $1 AND r.organization_id = $2`,
        [REVIEW, ORG],
      )
      expect(proof.rows).toEqual([
        expect.objectContaining({
          source_content_state: 'source_expired',
          text: null,
          content_expires_at: null,
          caches: 0,
          active_observations: 0,
          observation_identities: 1,
          provider_replies: 0,
          active_revisions: 0,
          revision_identities: 1,
          manager_text: 'Retained manager draft',
          transitions: 1,
        }),
      ])
    },
  )
})

import { vi } from 'vitest'
import { sql } from 'drizzle-orm'
import type { getDb } from '#/shared/db'
import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { reviewId, type OrganizationId } from '#/shared/domain/ids'
import { deriveReviewProviderSubject } from '#/shared/google-contracts/review-provider-subject-contract'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'
import { drizzleSeedRunner } from '#/shared/db/testing/drizzle-seed-runner'
import type { GoogleReviewApiPort } from './google-review-api.port.server'
import type { ReviewProviderSubjectKeyService } from './provider-subject-keyring.server'
import { createReviewProviderObservationWriter } from './sync-reviews.server'
import { createGoogleReplyObservationStore } from '../publication/google-reply-observation-store.server'
import { createAtomicReviewCommandStore } from '../reviews/review-command-store.server'
import { createReviewProviderSnapshotRepository } from './review-provider-snapshot-repository.server'
import { createReviewRepository } from '../reviews/review-repository.server'

// The real snapshot repository, observation writer and subject key service on
// a real database, for suites that fake only the Google side.

type Db = ReturnType<typeof getDb>

let uuidCounter = 0
const PROCESS_PREFIX = `${process.pid.toString(16).padStart(8, '0')}-${Math.trunc(
  performance.timeOrigin % 0x10000,
)
  .toString(16)
  .padStart(4, '0')}`

/** A unique, well-formed uuid: process prefix plus a counter, no ambient entropy. */
export function testUuid(): string {
  uuidCounter += 1
  return `${PROCESS_PREFIX}-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`
}

/** The real snapshot repository and Review observation writer, on one clock. */
export function createSnapshotWriter(
  db: Db,
  options: Readonly<{ clock: () => Date; nextRunId?: () => string }>,
) {
  const { clock } = options
  const snapshotRepository = createReviewProviderSnapshotRepository(
    db,
    options.nextRunId ?? testUuid,
    replyScopeEffects,
  )
  const writer = createReviewProviderObservationWriter({
    reviewRepo: createReviewRepository(db, clock, undefined, replyScopeEffects),
    clock,
    idGen: () => reviewId(testUuid()),
    commandStore: createAtomicReviewCommandStore(
      db,
      clock,
      undefined,
      undefined,
      replyScopeEffects,
    ),
    googleReplyObservationStore: createGoogleReplyObservationStore(db),
    historyCutoffs: snapshotRepository,
  })
  return { snapshotRepository, writer }
}

/**
 * A Google review API whose newest-first listing and targeted read are the
 * suite's own. Every other call does nothing.
 */
export function createFakeGoogleReviewApi(
  fakes: Pick<GoogleReviewApiPort, 'listReviewsPage'> &
    Partial<Pick<GoogleReviewApiPort, 'getReview'>>,
): GoogleReviewApiPort {
  return {
    readReviewsHead: vi.fn(),
    getReview: vi.fn(async () => ({ status: 'not_found' as const })),
    discardReviewCursors: vi.fn(async () => undefined),
    replyToReview: vi.fn(async () => ({ providerCorrelationId: null })),
    ...fakes,
  }
}

export function createSpyLogger(): LoggerPort {
  const logger: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  }
  return logger
}

/**
 * The subject key a suite derives with. When the database already holds an
 * active key version the suite uses that one and leaves it alone; otherwise it
 * inserts its own under a generation no other suite uses, and removes it again.
 */
export function createSubjectKeyHarness(
  db: Db,
  key: Readonly<{ version: string; byte: number; generation: number }>,
) {
  let activeVersion = key.version
  let insertedKey = false
  const keyBytes = new Uint8Array(32).fill(key.byte)

  const service: ReviewProviderSubjectKeyService = {
    acquireDeriver: async () => ({
      activeVersion,
      retiringVersion: null,
      inventoryGeneration: 1,
      deriveCandidates: (scope) => [
        deriveReviewProviderSubject({
          ...scope,
          keyVersion: activeVersion,
          key: keyBytes,
        }),
      ],
    }),
    stageTrustedNext: vi.fn(async () => undefined),
    activateTrustedNext: vi.fn(async () => undefined),
    removeRetiring: vi.fn(async () => undefined),
  }

  return {
    service,
    async ensureActive(): Promise<void> {
      const active = await db.execute(sql`
        SELECT key_version FROM review_provider_subject_hmac_key_versions
        WHERE state = 'active'
      `)
      const existing = active.rows[0]?.key_version
      if (existing != null) {
        activeVersion = String(existing)
        return
      }
      await db.execute(sql`
        INSERT INTO review_provider_subject_hmac_key_versions
          (key_version, key_digest, state, generation, created_at, activated_at)
        VALUES
          (${key.version}, ${String(key.byte).repeat(64)}, 'active', ${key.generation},
           transaction_timestamp(), transaction_timestamp())
      `)
      insertedKey = true
    },
    async removeInserted(): Promise<void> {
      if (!insertedKey) return
      await db.execute(sql`
        DELETE FROM review_provider_subject_hmac_key_versions
        WHERE key_version = ${key.version}
      `)
    },
  }
}

export async function insertTestOrganization(
  db: Db,
  organization: OrganizationId,
  name: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${organization}, ${name}, ${organization}, now())
  `)
}

/** The Review snapshot tables of an organization, children before parents. */
export async function clearReviewSnapshotData(
  db: Db,
  organization: OrganizationId,
  options: Readonly<{ inboxItems?: boolean; snapshotFacts?: boolean }> = {},
): Promise<void> {
  if (options.inboxItems) {
    await db.execute(sql`DELETE FROM inbox_items WHERE organization_id = ${organization}`)
  }
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${organization}`)
  await db.execute(
    sql`DELETE FROM google_reply_observation_heads WHERE organization_id = ${organization}`,
  )
  await db.execute(
    sql`DELETE FROM google_reply_observations WHERE organization_id = ${organization}`,
  )
  await db.execute(
    sql`DELETE FROM review_provider_subjects WHERE organization_id = ${organization}`,
  )
  if (options.snapshotFacts) {
    await db.execute(
      sql`DELETE FROM review_google_reputation_snapshot_facts WHERE organization_id = ${organization}`,
    )
  }
  await db.execute(
    sql`DELETE FROM review_provider_snapshot_runs WHERE organization_id = ${organization}`,
  )
  await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${organization}`)
  await db.execute(
    sql`DELETE FROM review_ai_analysis_heads WHERE organization_id = ${organization}`,
  )
  // Deleting the Property cascades every Review-owned per-epoch fact.
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${organization}`)
  await db.execute(
    sql`DELETE FROM google_connections WHERE organization_id = ${organization}`,
  )
}

export async function seedSnapshotConnection(
  db: Db,
  connection: Readonly<{
    id: Parameters<typeof seedGoogleConnection>[1]['id']
    organizationId: OrganizationId
    googleSubject: string
    connectedBy: string
  }>,
): Promise<void> {
  await seedGoogleConnection(drizzleSeedRunner(db), {
    ...connection,
    accessToken: 'sealed-access',
    refreshToken: 'sealed-refresh',
  })
}

export async function insertTestProperty(
  db: Db,
  property: Readonly<{
    id: string
    organizationId: OrganizationId
    name: string
    slug: string
    sourceEpoch?: number
  }>,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
    VALUES (${property.id}, ${property.organizationId}, ${property.name}, ${property.slug},
      'UTC', ${property.sourceEpoch ?? 0})
  `)
}

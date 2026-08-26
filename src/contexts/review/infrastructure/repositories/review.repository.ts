// Review context — Drizzle review repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Reviews table has no deletedAt column, so baseWhere is not used.
//
// Query limits:
//   500  — findByPropertyId, findAllByOrganization: per-request page size. Matches typical
//          GBP location review counts (<500 for most businesses). Paginate if exceeded.
//   BQC-8.3: the system-level lifecycle sweeps (refresh-expiring, purge-expired)
//          use keyset-bounded batch queries (findExpiringBatchAcrossTenants,
//          findExpiredBatchBeforeAcrossTenants) with caller-supplied limits —
//          the one-shot 5,000-row scans were removed (not cursor-safe at scale).

import { timingSafeEqual } from 'node:crypto'
import {
  and,
  asc,
  eq,
  lte,
  lt,
  gt,
  gte,
  inArray,
  desc,
  isNotNull,
  sql,
} from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviews, reviewProviderSubjects } from '#/shared/db/schema/review.schema'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { Review, ReviewPlatform } from '../../domain/types'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { reviewFromRow, reviewToRow } from '../mappers/review.mapper'
import { reviewError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'
import type {
  AiReviewSourceDenial,
  AiReviewSourceRequest,
  AiReviewSourceResult,
} from '../../application/ports/ai-review-source.port'
import { computeAiReviewSourceProvenance } from '../../application/ai-review-source'
import { upsertReviewSourceContent } from '../review-source-content-store'

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1 = 16_384
const MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1 = 65_536

function parseSafeNonnegativeInteger(value: unknown): number | null {
  try {
    const parsed =
      typeof value === 'bigint'
        ? value
        : typeof value === 'number' && Number.isSafeInteger(value)
          ? BigInt(value)
          : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
            ? BigInt(value)
            : null
    if (parsed == null || parsed < 0n || parsed > MAX_SAFE_INTEGER_BIGINT) return null
    return Number(parsed)
  } catch {
    return null
  }
}

function expectationDenial(
  input: AiReviewSourceRequest,
  row: Readonly<{
    source_epoch: unknown
    source_revision: unknown
    analysis_sequence: unknown
  }>,
): AiReviewSourceDenial | null {
  const sourceEpoch = parseSafeNonnegativeInteger(row.source_epoch)
  const sourceRevision = parseSafeNonnegativeInteger(row.source_revision)
  const analysisSequence = parseSafeNonnegativeInteger(row.analysis_sequence)
  if (sourceEpoch == null || sourceRevision == null || analysisSequence == null) {
    return 'policy_unavailable'
  }
  if (sourceEpoch !== input.expected.sourceEpoch) return 'source_epoch_changed'
  if (sourceRevision !== input.expected.sourceRevision) return 'source_revision_changed'
  if (
    input.expected.kind === 'analysis' &&
    analysisSequence !== input.expected.analysisSequence
  ) {
    return 'analysis_sequence_changed'
  }
  return null
}

type AiSourceDatabaseRow = Readonly<{
  source_epoch: unknown
  source_revision: unknown
  analysis_sequence: unknown
  content_expires_at_epoch_millis: unknown
  reviewed_at_epoch_millis: unknown
  ai_source_byte_length: unknown
  ai_source_digest: unknown
  raw_source_bytes: unknown
  is_unexpired: unknown
  text: unknown
  rating: unknown
  language_code: unknown
  reviewer_name: unknown
}>

function aiSourceLookupSql(input: AiReviewSourceRequest) {
  return sql`
    WITH captured AS (
      SELECT transaction_timestamp() AS now
    )
    SELECT
      review.source_epoch,
      review.source_revision,
      review.analysis_sequence,
      ai_epoch_millis_v1(review.content_expires_at) AS content_expires_at_epoch_millis,
      ai_epoch_millis_v1(review.reviewed_at) AS reviewed_at_epoch_millis,
      review.ai_source_byte_length,
      review.ai_source_digest,
      (
        COALESCE(octet_length(review.text), 0)::bigint
        + COALESCE(octet_length(review.language_code), 0)::bigint
        + COALESCE(octet_length(review.reviewer_name), 0)::bigint
      ) AS raw_source_bytes,
      review.content_expires_at > captured.now AS is_unexpired,
      CASE WHEN
        review.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(review.text), 0)::bigint
          + COALESCE(octet_length(review.language_code), 0)::bigint
          + COALESCE(octet_length(review.reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
        AND review.content_expires_at > captured.now
      THEN review.text ELSE NULL END AS text,
      CASE WHEN
        review.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(review.text), 0)::bigint
          + COALESCE(octet_length(review.language_code), 0)::bigint
          + COALESCE(octet_length(review.reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
        AND review.content_expires_at > captured.now
      THEN review.rating ELSE NULL END AS rating,
      CASE WHEN
        review.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(review.text), 0)::bigint
          + COALESCE(octet_length(review.language_code), 0)::bigint
          + COALESCE(octet_length(review.reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
        AND review.content_expires_at > captured.now
      THEN review.language_code ELSE NULL END AS language_code,
      CASE WHEN
        review.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(review.text), 0)::bigint
          + COALESCE(octet_length(review.language_code), 0)::bigint
          + COALESCE(octet_length(review.reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
        AND review.content_expires_at > captured.now
      THEN review.reviewer_name ELSE NULL END AS reviewer_name
    FROM reviews AS review
    CROSS JOIN captured
    WHERE review.organization_id = ${input.organizationId}
      AND review.property_id = ${input.propertyId}::uuid
      AND review.id = ${input.reviewId}::uuid
    LIMIT 1
  `
}
export const createReviewRepository = (db: Database): ReviewRepository => ({
  findById: async (id: ReviewId, organizationId: OrganizationId) => {
    return trace('review.findById', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(and(eq(reviews.id, id), eq(reviews.organizationId, organizationId)))
        .limit(1)
      return rows[0] ? reviewFromRow(rows[0]) : null
    })
  },

  readReplyStateRevision: async (organizationId, reviewId) => {
    return trace('review.readReplyStateRevision', async () => {
      const [row] = await db
        .select({ replyStateRevision: reviews.replyStateRevision })
        .from(reviews)
        .where(and(eq(reviews.organizationId, organizationId), eq(reviews.id, reviewId)))
        .limit(1)
      return row?.replyStateRevision ?? 0
    })
  },
  readForAi: async (input): Promise<AiReviewSourceResult> => {
    return await trace('review.readForAi', async () => {
      try {
        return await db.transaction(async (tx): Promise<AiReviewSourceResult> => {
          const result = await tx.execute(aiSourceLookupSql(input))
          const row = result.rows[0] as AiSourceDatabaseRow | undefined
          if (row == null) return { status: 'not_found' }

          const expectationMismatch = expectationDenial(input, row)
          if (expectationMismatch != null) return { status: expectationMismatch }

          const rawSourceBytes = parseSafeNonnegativeInteger(row.raw_source_bytes)
          const storedByteLength = parseSafeNonnegativeInteger(row.ai_source_byte_length)
          if (rawSourceBytes == null || storedByteLength == null) {
            return { status: 'policy_unavailable' }
          }
          if (
            storedByteLength > MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1 ||
            rawSourceBytes > MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1
          ) {
            return { status: 'source_too_large' }
          }
          if (row.is_unexpired !== true) return { status: 'expired' }

          const reviewedAtEpochMillis = parseSafeNonnegativeInteger(
            row.reviewed_at_epoch_millis,
          )
          const contentExpiresAtEpochMillis = parseSafeNonnegativeInteger(
            row.content_expires_at_epoch_millis,
          )
          const sourceEpoch = parseSafeNonnegativeInteger(row.source_epoch)
          const sourceRevision = parseSafeNonnegativeInteger(row.source_revision)
          const analysisSequence = parseSafeNonnegativeInteger(row.analysis_sequence)
          const rating = Number(row.rating)
          if (
            reviewedAtEpochMillis == null ||
            contentExpiresAtEpochMillis == null ||
            sourceEpoch == null ||
            sourceRevision == null ||
            analysisSequence == null ||
            ![1, 2, 3, 4, 5].includes(rating) ||
            (row.text !== null && typeof row.text !== 'string') ||
            (row.language_code !== null && typeof row.language_code !== 'string') ||
            (row.reviewer_name !== null && typeof row.reviewer_name !== 'string') ||
            typeof row.ai_source_digest !== 'string' ||
            !/^[0-9a-f]{64}$/.test(row.ai_source_digest)
          ) {
            return { status: 'policy_unavailable' }
          }

          const provenance = computeAiReviewSourceProvenance({
            text: row.text as string | null,
            rating: rating as Review['rating'],
            languageCode: row.language_code as string | null,
            reviewedAtEpochMillis,
            reviewerDisplayName: row.reviewer_name as string | null,
          })
          const persistedDigest = Buffer.from(row.ai_source_digest, 'hex')
          const recomputedDigest = Buffer.from(provenance.digest, 'hex')
          if (
            provenance.byteLength !== storedByteLength ||
            persistedDigest.byteLength !== recomputedDigest.byteLength ||
            !timingSafeEqual(persistedDigest, recomputedDigest)
          ) {
            return { status: 'policy_unavailable' }
          }

          return {
            status: 'available',
            observation: {
              kind: 'review',
              reviewId: input.reviewId,
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              text: provenance.text,
              rating: provenance.rating,
              languageCode: provenance.languageCode,
              reviewedAtEpochMillis,
              contentExpiresAtEpochMillis,
              sourceEpoch,
              sourceRevision,
              analysisSequence,
            },
          }
        })
      } catch {
        return { status: 'policy_unavailable' }
      }
    })
  },

  readTrendPopulation: async (input) => {
    return await trace('review.readTrendPopulation', async () => {
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 2 ||
        input.limit > 10_001 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.startLocalDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.endLocalDate) ||
        input.startLocalDate > input.endLocalDate
      ) {
        return { status: 'policy_unavailable' as const }
      }
      try {
        const result = await db.execute(sql<{
          reviewId: string
          sourceRevision: number | string
          analysisSequence: number | string
          localDate: string
          hasText: boolean
        }>`
          WITH captured AS (
            SELECT transaction_timestamp() AS now
          )
          SELECT
            review."id"::text AS "reviewId",
            review."source_revision"::float8 AS "sourceRevision",
            review."analysis_sequence"::float8 AS "analysisSequence",
            resolve_ai_property_local_date_v1(
              source."reviewed_at",
              ${input.timezone},
              ${input.calendarProfileVersion}
            )::text AS "localDate",
            NULLIF(btrim(source."text"), '') IS NOT NULL AS "hasText"
          FROM "reviews" AS review
          INNER JOIN "review_source_contents" AS source
            ON source."organization_id" = review."organization_id"
           AND source."property_id" = review."property_id"
           AND source."review_id" = review."id"
          CROSS JOIN captured
          WHERE review."organization_id" = ${input.organizationId}
            AND review."property_id" = ${input.propertyId}::uuid
            AND review."source_content_state" = 'active'
            AND review."source_epoch" = ${input.sourceEpoch}
            AND source."source_epoch" = ${input.sourceEpoch}
            AND source."source_revision" = review."source_revision"
            AND source."content_expires_at" > captured.now
            AND resolve_ai_property_local_date_v1(
              source."reviewed_at",
              ${input.timezone},
              ${input.calendarProfileVersion}
            ) BETWEEN ${input.startLocalDate}::date AND ${input.endLocalDate}::date
          ORDER BY source."reviewed_at", review."id"
          LIMIT ${input.limit}
        `)
        if (result.rows.length >= input.limit) {
          return { status: 'limit_exceeded' as const }
        }
        const population = []
        for (const row of result.rows) {
          const sourceRevision = parseSafeNonnegativeInteger(row.sourceRevision)
          const analysisSequence = parseSafeNonnegativeInteger(row.analysisSequence)
          if (
            sourceRevision === null ||
            analysisSequence === null ||
            typeof row.reviewId !== 'string' ||
            typeof row.localDate !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(row.localDate) ||
            typeof row.hasText !== 'boolean'
          ) {
            return { status: 'policy_unavailable' as const }
          }
          population.push(
            Object.freeze({
              reviewId: reviewId(row.reviewId),
              sourceRevision,
              analysisSequence,
              localDate: row.localDate,
              hasText: row.hasText,
            }),
          )
        }
        return {
          status: 'complete' as const,
          reviews: Object.freeze(population),
        }
      } catch {
        return { status: 'policy_unavailable' as const }
      }
    })
  },

  assertCurrentForAi: async (input) => {
    return await trace('review.assertCurrentForAi', async () => {
      try {
        return await db.transaction(async (tx) => {
          const result = await tx.execute(sql`
            WITH captured AS (
              SELECT transaction_timestamp() AS now
            )
            SELECT
              review.source_epoch,
              review.source_revision,
              review.analysis_sequence,
              review.ai_source_byte_length,
              (
                COALESCE(octet_length(review.text), 0)::bigint
                + COALESCE(octet_length(review.language_code), 0)::bigint
                + COALESCE(octet_length(review.reviewer_name), 0)::bigint
              ) AS raw_source_bytes,
              review.content_expires_at > captured.now AS is_unexpired
            FROM reviews AS review
            CROSS JOIN captured
            WHERE review.organization_id = ${input.organizationId}
              AND review.property_id = ${input.propertyId}::uuid
              AND review.id = ${input.reviewId}::uuid
            LIMIT 1
          `)
          const row = result.rows[0] as
            | Readonly<{
                source_epoch: unknown
                source_revision: unknown
                analysis_sequence: unknown
                ai_source_byte_length: unknown
                raw_source_bytes: unknown
                is_unexpired: unknown
              }>
            | undefined
          if (row == null) return { status: 'not_found' as const }
          const expectationMismatch = expectationDenial(input, row)
          if (expectationMismatch != null) return { status: expectationMismatch }
          const byteLength = parseSafeNonnegativeInteger(row.ai_source_byte_length)
          const rawSourceBytes = parseSafeNonnegativeInteger(row.raw_source_bytes)
          if (byteLength == null || rawSourceBytes == null) {
            return { status: 'policy_unavailable' as const }
          }
          if (
            byteLength > MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1 ||
            rawSourceBytes > MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1
          ) {
            return { status: 'source_too_large' as const }
          }
          if (row.is_unexpired !== true) return { status: 'expired' as const }
          return { status: 'current' as const }
        })
      } catch {
        return { status: 'policy_unavailable' as const }
      }
    })
  },

  readAiAnalysisHead: async (input) => {
    return await trace('review.readAiAnalysisHead', async () => {
      try {
        const result = await db.execute(sql`
          SELECT
            property.source_epoch AS current_source_epoch,
            head.head_sequence
          FROM properties AS property
          LEFT JOIN review_ai_analysis_heads AS head
            ON head.organization_id = property.organization_id
            AND head.property_id = property.id
            AND head.source_epoch = ${input.sourceEpoch}
          WHERE property.organization_id = ${input.organizationId}
            AND property.id = ${input.propertyId}::uuid
          LIMIT 1
        `)
        const row = result.rows[0] as
          Readonly<{ current_source_epoch: unknown; head_sequence: unknown }> | undefined
        if (row == null) return { status: 'not_found' as const }
        const currentEpoch = parseSafeNonnegativeInteger(row.current_source_epoch)
        if (currentEpoch == null) return { status: 'policy_unavailable' as const }
        if (currentEpoch !== input.sourceEpoch) {
          return { status: 'source_epoch_changed' as const }
        }
        const analysisSequence = parseSafeNonnegativeInteger(row.head_sequence)
        if (analysisSequence == null) {
          return { status: 'policy_unavailable' as const }
        }
        return { status: 'current' as const, analysisSequence }
      } catch {
        return { status: 'policy_unavailable' as const }
      }
    })
  },

  findByIds: async (ids: ReadonlyArray<ReviewId>, organizationId: OrganizationId) => {
    return trace('review.findByIds', async () => {
      if (ids.length === 0) return []
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(inArray(reviews.id, [...ids]), eq(reviews.organizationId, organizationId)),
        )
      return rows.map((r) => reviewFromRow(r))
    })
  },

  findByExternalId: async (
    platform: ReviewPlatform,
    externalId: string,
    organizationId: OrganizationId,
  ) => {
    return trace('review.findByExternalId', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.platform, platform),
            eq(reviews.externalId, externalId),
            eq(reviews.organizationId, organizationId),
          ),
        )
        .limit(1)
      return rows[0] ? reviewFromRow(rows[0]) : null
    })
  },

  findStableIdentityByProviderSubjects: async (input) => {
    return trace('review.findStableIdentityByProviderSubjects', async () => {
      const matches = new Map<
        string,
        {
          id: string
          organizationId: string
          propertyId: string
          sourceEpoch: number
          sourceRevision: number
          analysisSequence: number
          sourceContentState: string
          firstFetchedAt: Date | null
          sourceSeenGeneration: string | null
          sentimentLabel: string | null
          sentimentScore: number | null
        }
      >()
      for (const subject of input.subjects) {
        const rows = await db
          .select({
            verifierHmac: reviewProviderSubjects.verifierHmac,
            id: reviews.id,
            organizationId: reviews.organizationId,
            propertyId: reviews.propertyId,
            sourceEpoch: reviews.sourceEpoch,
            sourceRevision: reviews.sourceRevision,
            analysisSequence: reviews.analysisSequence,
            sourceContentState: reviews.sourceContentState,
            firstFetchedAt: reviews.firstFetchedAt,
            sourceSeenGeneration: reviews.sourceSeenGeneration,
            sentimentLabel: reviews.sentimentLabel,
            sentimentScore: reviews.sentimentScore,
          })
          .from(reviewProviderSubjects)
          .innerJoin(
            reviews,
            and(
              eq(reviews.id, reviewProviderSubjects.reviewId),
              eq(reviews.organizationId, reviewProviderSubjects.organizationId),
              eq(reviews.propertyId, reviewProviderSubjects.propertyId),
              eq(reviews.sourceEpoch, reviewProviderSubjects.sourceEpoch),
            ),
          )
          .where(
            and(
              eq(reviewProviderSubjects.organizationId, input.organizationId),
              eq(reviewProviderSubjects.propertyId, input.propertyId),
              eq(reviewProviderSubjects.sourceEpoch, input.sourceEpoch),
              eq(reviewProviderSubjects.keyVersion, subject.keyVersion),
              eq(reviewProviderSubjects.locatorHmac, Buffer.from(subject.locatorHmac)),
            ),
          )
          .limit(1)
        const row = rows[0]
        if (!row) continue
        const expected = Buffer.from(subject.verifierHmac)
        const actual = Buffer.from(row.verifierHmac)
        if (
          expected.byteLength !== actual.byteLength ||
          !timingSafeEqual(expected, actual)
        ) {
          throw new Error('Review provider subject verifier collision')
        }
        matches.set(row.id, row)
      }
      if (matches.size > 1) throw new Error('Review provider subject identity collision')
      const row = matches.values().next().value
      if (!row) return null
      if (
        row.sourceContentState !== 'active' &&
        row.sourceContentState !== 'source_expired' &&
        row.sourceContentState !== 'provider_deleted'
      ) {
        throw new Error('Review source content state is invalid')
      }
      return {
        id: reviewId(row.id),
        organizationId: organizationId(row.organizationId),
        propertyId: propertyId(row.propertyId),
        sourceEpoch: row.sourceEpoch,
        sourceRevision: row.sourceRevision,
        analysisSequence: row.analysisSequence,
        sourceContentState: row.sourceContentState,
        firstFetchedAt: row.firstFetchedAt,
        sourceSeenGeneration: row.sourceSeenGeneration,
        sentimentLabel: row.sentimentLabel,
        sentimentScore: row.sentimentScore,
      }
    })
  },

  upsert: async (review: Omit<Review, 'createdAt' | 'updatedAt'>, now?: Date) => {
    return trace('review.upsert', async () => {
      const row = reviewToRow(review)
      const updatedAt = now ?? new Date()
      const result = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(reviews)
          .values(row)
          .onConflictDoUpdate({
            target: [reviews.platform, reviews.externalId, reviews.organizationId],
            set: {
              propertyId: row.propertyId,
              externalLocationId: row.externalLocationId,
              googleConnectionId: row.googleConnectionId,
              reviewerName: row.reviewerName,
              reviewerProfilePhotoUrl: row.reviewerProfilePhotoUrl,
              rating: row.rating,
              text: row.text,
              translatedText: row.translatedText,
              languageCode: row.languageCode,
              reviewedAt: row.reviewedAt,
              expiresAt: row.expiresAt,
              // BQC-1.3: every successful fetch advances the fetch clock and
              // hash/baseline fields (ADR 0031). firstFetchedAt is preserved
              // by omission — only the first observation sets it.
              sourceCreatedAt: row.sourceCreatedAt,
              sourceUpdatedAt: row.sourceUpdatedAt,
              lastFetchedAt: row.lastFetchedAt,
              contentExpiresAt: row.contentExpiresAt,
              contentHash: row.contentHash,
              sourceSeenGeneration: row.sourceSeenGeneration,
              sourceEpoch: row.sourceEpoch,
              sourceRevision: row.sourceRevision,
              analysisSequence: row.analysisSequence,
              aiSourceByteLength: row.aiSourceByteLength,
              aiSourceDigest: row.aiSourceDigest,
              sourceContentState: 'active',
              sourceContentErasedAt: null,
              updatedAt,
            },
          })
          .returning()
        await upsertReviewSourceContent(tx, review)
        return rows
      })

      if (!result[0]) {
        throw reviewError('repo_upsert_failed', 'Review upsert failed — no row returned')
      }
      return reviewFromRow(result[0])
    })
  },

  findByPropertyId: async (propertyId, organizationId, options) => {
    return trace('review.findByPropertyId', async () => {
      const query = db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.propertyId, propertyId),
            eq(reviews.organizationId, organizationId),
          ),
        )
        .orderBy(desc(reviews.reviewedAt))

      // F038: Support LIMIT pushdown instead of fetching 500 rows and sorting in JS
      const limit = options?.limit ?? 500
      const rows = await query.limit(limit)
      return rows.map(reviewFromRow)
    })
  },

  /**
   * BQC-1.4: serving read for recent reviews — eligible content only.
   * Eligibility predicate lives in SQL (defense in depth): non-null
   * contentExpiresAt strictly in the future, newest first.
   */
  findRecentEligibleByPropertyId: async (propertyId, organizationId, options, now) => {
    return trace('review.findRecentEligibleByPropertyId', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.propertyId, propertyId),
            eq(reviews.organizationId, organizationId),
            isNotNull(reviews.contentExpiresAt),
            gt(reviews.contentExpiresAt, now),
          ),
        )
        .orderBy(desc(reviews.reviewedAt))
        .limit(options.limit)
      return rows.map(reviewFromRow)
    })
  },

  findByOrganizationId: async (orgId: OrganizationId) => {
    return trace('review.findByOrganizationId', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(eq(reviews.organizationId, orgId))
        .limit(500)
      return rows.map(reviewFromRow)
    })
  },

  findByConnection: async (organizationId, connectionId, cursor, limit) => {
    return trace('review.findByConnection', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.organizationId, organizationId),
            eq(reviews.googleConnectionId, connectionId),
            cursor ? gt(reviews.id, cursor.id) : undefined,
          ),
        )
        .orderBy(asc(reviews.id))
        .limit(limit)
      return rows.map(reviewFromRow)
    })
  },

  /**
   * BQC-1.2: eligible content filter for cross-context list queries.
   * Eligibility predicate lives here (defense in depth): non-null
   * contentExpiresAt strictly in the future. Text search escapes LIKE
   * wildcards. This returns the complete eligible id set because the inbox
   * uses it for both page results and the matching total; truncating here
   * would silently hide older matches for larger organizations.
   */
  findIdsByContentFilter: async (orgId, filter, now) => {
    return trace('review.findIdsByContentFilter', async () => {
      const conditions = [
        eq(reviews.organizationId, orgId),
        isNotNull(reviews.contentExpiresAt),
        gt(reviews.contentExpiresAt, now),
      ]
      if (filter.ratingMin !== undefined)
        conditions.push(gte(reviews.rating, filter.ratingMin))
      if (filter.ratingMax !== undefined)
        conditions.push(lte(reviews.rating, filter.ratingMax))
      if (filter.textQuery) {
        const escaped = filter.textQuery.replace(/%/g, '\\%').replace(/_/g, '\\_')
        conditions.push(sql`${reviews.text} ilike ${'%' + escaped + '%'}`)
      }
      const rows = await db
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(...conditions))
      return rows.map((r) => r.id as string)
    })
  },

  /**
   * BQC-1.5: keyset-bounded batch (contentExpiresAt ASC, id ASC).
   * Cursor predicate is a strict row-tuple greater-than, so concurrent
   * inserts behind the cursor never cause skips or repeats.
   */
  findExpiringBatchAcrossTenants: async (date, cursor, limit) => {
    return trace('review.findExpiringBatchAcrossTenants', async () => {
      const conditions = [
        isNotNull(reviews.contentExpiresAt),
        lte(reviews.contentExpiresAt, date),
      ]
      if (cursor) {
        conditions.push(
          sql`(${reviews.contentExpiresAt}, ${reviews.id}) > (${cursor.contentExpiresAt}, ${cursor.id})`,
        )
      }
      const rows = await db
        .select()
        .from(reviews)
        .where(and(...conditions))
        .orderBy(reviews.contentExpiresAt, reviews.id)
        .limit(limit)
      return rows.map(reviewFromRow)
    })
  },

  /**
   * BQC-8.3: keyset-bounded batch of expired rows (contentExpiresAt ASC,
   * id ASC), exclusive `contentExpiresAt < date` boundary. Same keyset
   * contract as findExpiringBatchAcrossTenants: the strict row-tuple
   * cursor predicate never skips or repeats as the cursor advances.
   * BQR-3.2 / ADR 0031: no post-expiry grace — purge as soon as the
   * fetch clock expires.
   */
  findExpiredBatchBeforeAcrossTenants: async (date, cursor, limit) => {
    return trace('review.findExpiredBatchBeforeAcrossTenants', async () => {
      const conditions = [
        isNotNull(reviews.contentExpiresAt),
        lt(reviews.contentExpiresAt, date),
      ]
      if (cursor) {
        conditions.push(
          sql`(${reviews.contentExpiresAt}, ${reviews.id}) > (${cursor.contentExpiresAt}, ${cursor.id})`,
        )
      }
      const rows = await db
        .select()
        .from(reviews)
        .where(and(...conditions))
        .orderBy(reviews.contentExpiresAt, reviews.id)
        .limit(limit)
      return rows.map(reviewFromRow)
    })
  },

  /**
   * BQC-8.3: exact purge-eligible count (exclusive boundary) — the restore
   * drill's dry-run/zero-remaining probe. A COUNT, not a bounded scan.
   */
  countExpiredBeforeAcrossTenants: async (date: Date) => {
    return trace('review.countExpiredBeforeAcrossTenants', async () => {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reviews)
        .where(
          and(isNotNull(reviews.contentExpiresAt), lt(reviews.contentExpiresAt, date)),
        )
      return rows[0]?.count ?? 0
    })
  },

  deleteById: async (id: ReviewId, organizationId: OrganizationId) => {
    return trace('review.deleteById', async () => {
      await db
        .delete(reviews)
        .where(and(eq(reviews.id, id), eq(reviews.organizationId, organizationId)))
    })
  },

  deleteByPropertyId: async (propertyId: PropertyId, organizationId: OrganizationId) => {
    return trace('review.deleteByPropertyId', async () => {
      await db
        .delete(reviews)
        .where(
          and(
            eq(reviews.propertyId, propertyId),
            eq(reviews.organizationId, organizationId),
          ),
        )
    })
  },
})

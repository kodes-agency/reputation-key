import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  AiAuthorizationErasureBacklog,
  AiAuthorizationErasureClaim,
  AiAuthorizationErasureDeletedCounts,
  AiAuthorizationErasureStorePort,
} from '../../application/ports/ai-authorization-erasure.port'
import {
  AI_AUTHORIZATION_ERASURE_LEASE_MILLIS,
  AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS,
} from '../../application/use-cases/erase-ai-authorization-derivatives'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type Row = Readonly<Record<string, unknown>>

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATA_CLASSES = new Set(['review_analysis', 'property_aggregate', 'property_trend'])

const safeInteger = (value: unknown, field: string): number => {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`AI authorization erasure read invalid ${field}`)
  }
  return parsed
}

const epochMillis = (value: unknown, field: string): number => {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value))
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`AI authorization erasure read invalid ${field}`)
  }
  return parsed
}

const assertDate = (value: Date, field: string): void => {
  if (!Number.isSafeInteger(value.getTime())) {
    throw new Error(`AI authorization erasure ${field} is invalid`)
  }
}

const assertUuid = (value: string, field: string): void => {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`AI authorization erasure ${field} is invalid`)
  }
}

const claimFromRow = (row: Row): AiAuthorizationErasureClaim => ({
  lifecycleId: String(row.id),
  leaseOwner: String(row.erasure_lease_owner),
  attempt: safeInteger(row.erasure_attempt_count, 'attempt count'),
  deadlineEpochMillis: epochMillis(row.erasure_deadline, 'deadline'),
})

const rowCount = (result: Readonly<{ rowCount?: number | null }>): number => {
  const count = result.rowCount ?? 0
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('AI authorization erasure returned an invalid deletion count')
  }
  return count
}

const dataClassesFromRow = (row: Row): ReadonlySet<string> => {
  if (
    !Array.isArray(row.retired_data_classes) ||
    row.retired_data_classes.some(
      (entry) => typeof entry !== 'string' || !DATA_CLASSES.has(entry),
    )
  ) {
    throw new Error('AI authorization erasure read invalid retired data classes')
  }
  return new Set(row.retired_data_classes)
}

const hasActiveGenerationConflict = (
  lifecycle: Row,
  currentAuthorization: Row | undefined,
  retiredClasses: ReadonlySet<string>,
): boolean => {
  if (!currentAuthorization || currentAuthorization.state !== 'enabled') return false
  const capabilities = Array.isArray(currentAuthorization.capabilities)
    ? currentAuthorization.capabilities.map(String)
    : []
  const previousSourceEpoch = safeInteger(
    lifecycle.previous_source_epoch,
    'previous source epoch',
  )
  const previousReviewAnalysisEpoch = safeInteger(
    lifecycle.previous_review_analysis_epoch,
    'previous Review Analysis epoch',
  )
  const sameReviewGeneration =
    capabilities.includes('review_analysis') &&
    safeInteger(currentAuthorization.authorized_source_epoch, 'current source epoch') ===
      previousSourceEpoch &&
    safeInteger(
      currentAuthorization.review_analysis_epoch,
      'current Review Analysis epoch',
    ) === previousReviewAnalysisEpoch
  if (
    sameReviewGeneration &&
    (retiredClasses.has('review_analysis') || retiredClasses.has('property_aggregate'))
  ) {
    return true
  }

  return (
    retiredClasses.has('property_trend') &&
    capabilities.includes('property_trends') &&
    safeInteger(currentAuthorization.authorized_source_epoch, 'current source epoch') ===
      previousSourceEpoch &&
    safeInteger(
      currentAuthorization.review_analysis_epoch,
      'current Review Analysis epoch',
    ) === previousReviewAnalysisEpoch &&
    safeInteger(
      currentAuthorization.property_trends_epoch,
      'current Property Trends epoch',
    ) ===
      safeInteger(
        lifecycle.previous_property_trends_epoch,
        'previous Property Trends epoch',
      )
  )
}

const deleteRetiredDerivatives = async (
  tx: Tx,
  lifecycle: Row,
  retiredClasses: ReadonlySet<string>,
): Promise<AiAuthorizationErasureDeletedCounts> => {
  const organizationId = String(lifecycle.organization_id)
  const propertyId = String(lifecycle.property_id)
  const sourceEpoch = safeInteger(lifecycle.previous_source_epoch, 'source epoch')
  const reviewAnalysisEpoch = safeInteger(
    lifecycle.previous_review_analysis_epoch,
    'Review Analysis epoch',
  )
  let reviewAnalysis = 0
  let propertyAggregate = 0
  let propertyTrend = 0

  if (retiredClasses.has('property_trend')) {
    propertyTrend += rowCount(
      await tx.execute(sql`
        DELETE FROM ai_property_trend_outcomes AS outcome
        USING ai_property_trend_schedules AS schedule
        WHERE outcome.schedule_id = schedule.id
          AND schedule.organization_id = ${organizationId}
          AND schedule.property_id = ${propertyId}::uuid
          AND schedule.source_epoch = ${sourceEpoch}
          AND schedule.review_analysis_epoch = ${reviewAnalysisEpoch}
          AND schedule.property_trends_epoch = ${safeInteger(
            lifecycle.previous_property_trends_epoch,
            'Property Trends epoch',
          )}
      `),
    )
    propertyTrend += rowCount(
      await tx.execute(sql`
        DELETE FROM ai_property_trend_schedules
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND source_epoch = ${sourceEpoch}
          AND review_analysis_epoch = ${reviewAnalysisEpoch}
          AND property_trends_epoch = ${safeInteger(
            lifecycle.previous_property_trends_epoch,
            'Property Trends epoch',
          )}
      `),
    )
  }

  if (retiredClasses.has('property_aggregate')) {
    // Contributions must be counted before their parent analyses cascade them.
    propertyAggregate += rowCount(
      await tx.execute(sql`
        DELETE FROM ai_property_aggregate_contributions
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND source_epoch = ${sourceEpoch}
          AND review_analysis_epoch = ${reviewAnalysisEpoch}
      `),
    )
    propertyAggregate += rowCount(
      await tx.execute(sql`
        DELETE FROM ai_property_daily_aggregates
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND source_epoch = ${sourceEpoch}
          AND review_analysis_epoch = ${reviewAnalysisEpoch}
      `),
    )
    propertyAggregate += rowCount(
      await tx.execute(sql`
        DELETE FROM ai_property_aggregate_heads
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND source_epoch = ${sourceEpoch}
          AND review_analysis_epoch = ${reviewAnalysisEpoch}
      `),
    )
  }

  if (retiredClasses.has('review_analysis')) {
    reviewAnalysis += rowCount(
      await tx.execute(sql`
        DELETE FROM ai_review_analyses
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND authorization_lineage_id = ${String(
            lifecycle.previous_authorization_lineage_id,
          )}::uuid
          AND source_epoch = ${sourceEpoch}
          AND review_analysis_epoch = ${reviewAnalysisEpoch}
      `),
    )
  }

  return { reviewAnalysis, propertyAggregate, propertyTrend }
}

const failActiveGenerationConflict = async (
  tx: Tx,
  claim: AiAuthorizationErasureClaim,
  occurredAt: Date,
): Promise<'terminal_failed' | 'lost_claim'> => {
  const updated = await tx.execute(sql`
    UPDATE ai_authorization_lifecycle_records
    SET erasure_status = 'failed',
        erasure_failure_code = 'active_generation_conflict',
        erasure_last_failure_at = ${occurredAt},
        erasure_next_attempt_at = NULL,
        erasure_claimed_at = NULL,
        erasure_lease_owner = NULL,
        erasure_lease_expires_at = NULL,
        updated_at = ${occurredAt}
    WHERE id = ${claim.lifecycleId}::uuid
      AND erasure_status = 'in_progress'
      AND erasure_lease_owner = ${claim.leaseOwner}::uuid
      AND erasure_attempt_count = ${claim.attempt}
  `)
  return updated.rowCount === 1 ? 'terminal_failed' : 'lost_claim'
}

/** PostgreSQL authority for exact, bounded local AI derivative erasure. */
export const createAiAuthorizationErasureAdapter = (
  db: Database,
): AiAuthorizationErasureStorePort => ({
  claimNext: async ({ leaseOwner, now }) => {
    assertUuid(leaseOwner, 'lease owner')
    assertDate(now, 'claim time')
    const leaseExpiresAt = new Date(now.getTime() + AI_AUTHORIZATION_ERASURE_LEASE_MILLIS)
    assertDate(leaseExpiresAt, 'lease expiry')

    return db.transaction(async (tx) => {
      // A process that dies on its final durable attempt cannot leave the row
      // leased forever. Equality is expired, matching the claim predicate.
      await tx.execute(sql`
        UPDATE ai_authorization_lifecycle_records
        SET erasure_status = 'failed',
            erasure_failure_code = 'attempt_budget_exhausted',
            erasure_last_failure_at = ${now},
            erasure_claimed_at = NULL,
            erasure_lease_owner = NULL,
            erasure_lease_expires_at = NULL,
            updated_at = ${now}
        WHERE erasure_status = 'in_progress'
          AND erasure_lease_expires_at <= ${now}
          AND erasure_attempt_count >= ${AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS}
      `)
      const result = await tx.execute(sql`
        WITH candidate AS (
          SELECT id
          FROM ai_authorization_lifecycle_records
          WHERE (
            erasure_status = 'pending'
            AND erasure_next_attempt_at <= ${now}
            AND erasure_attempt_count < ${AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS}
          ) OR (
            erasure_status = 'in_progress'
            AND erasure_lease_expires_at <= ${now}
            AND erasure_attempt_count < ${AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS}
          )
          ORDER BY erasure_deadline, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ai_authorization_lifecycle_records AS lifecycle
        SET erasure_status = 'in_progress',
            erasure_attempt_count = lifecycle.erasure_attempt_count + 1,
            erasure_next_attempt_at = NULL,
            erasure_claimed_at = ${now},
            erasure_lease_owner = ${leaseOwner}::uuid,
            erasure_lease_expires_at = ${leaseExpiresAt},
            updated_at = ${now}
        FROM candidate
        WHERE lifecycle.id = candidate.id
        RETURNING lifecycle.id, lifecycle.erasure_lease_owner,
                  lifecycle.erasure_attempt_count, lifecycle.erasure_deadline
      `)
      const row = result.rows[0] as Row | undefined
      return row ? claimFromRow(row) : null
    })
  },

  eraseClaim: async ({ claim, now }) => {
    assertUuid(claim.lifecycleId, 'lifecycle id')
    assertUuid(claim.leaseOwner, 'lease owner')
    assertDate(now, 'completion time')
    return db.transaction(async (tx) => {
      const lifecycleResult = await tx.execute(sql`
        SELECT *
        FROM ai_authorization_lifecycle_records
        WHERE id = ${claim.lifecycleId}::uuid
        FOR UPDATE
      `)
      const lifecycle = lifecycleResult.rows[0] as Row | undefined
      if (
        !lifecycle ||
        lifecycle.erasure_status !== 'in_progress' ||
        String(lifecycle.erasure_lease_owner) !== claim.leaseOwner ||
        safeInteger(lifecycle.erasure_attempt_count, 'attempt count') !== claim.attempt ||
        epochMillis(lifecycle.erasure_deadline, 'deadline') !==
          claim.deadlineEpochMillis ||
        epochMillis(lifecycle.erasure_lease_expires_at, 'lease expiry') <= now.getTime()
      ) {
        return { status: 'lost_claim' as const }
      }

      const retiredClasses = dataClassesFromRow(lifecycle)
      const currentResult = await tx.execute(sql`
        SELECT state, capabilities, authorization_lineage_id,
               authorized_source_epoch, review_analysis_epoch,
               property_trends_epoch
        FROM merchant_ai_enablement
        WHERE organization_id = ${String(lifecycle.organization_id)}
          AND property_id = ${String(lifecycle.property_id)}::uuid
        FOR SHARE
      `)
      if (
        hasActiveGenerationConflict(
          lifecycle,
          currentResult.rows[0] as Row | undefined,
          retiredClasses,
        )
      ) {
        const status = await failActiveGenerationConflict(tx, claim, now)
        return { status }
      }

      const deleted = await deleteRetiredDerivatives(tx, lifecycle, retiredClasses)
      const completed = await tx.execute(sql`
        UPDATE ai_authorization_lifecycle_records
        SET erasure_status = 'completed',
            erasure_completed_at = ${now},
            erasure_next_attempt_at = NULL,
            erasure_claimed_at = NULL,
            erasure_lease_owner = NULL,
            erasure_lease_expires_at = NULL,
            erased_review_analysis_count = ${deleted.reviewAnalysis},
            erased_property_aggregate_count = ${deleted.propertyAggregate},
            erased_property_trend_count = ${deleted.propertyTrend},
            updated_at = ${now}
        WHERE id = ${claim.lifecycleId}::uuid
          AND erasure_status = 'in_progress'
          AND erasure_lease_owner = ${claim.leaseOwner}::uuid
          AND erasure_attempt_count = ${claim.attempt}
      `)
      if (completed.rowCount !== 1) {
        throw new Error('AI authorization erasure completion fence was lost')
      }
      return { status: 'completed' as const, deleted }
    })
  },

  recordClaimFailure: async ({ claim, failureCode, occurredAt, nextAttemptAt }) => {
    assertUuid(claim.lifecycleId, 'lifecycle id')
    assertUuid(claim.leaseOwner, 'lease owner')
    assertDate(occurredAt, 'failure time')
    const terminal = claim.attempt >= AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS
    if (terminal !== (nextAttemptAt === null)) {
      throw new Error('AI authorization erasure retry budget is inconsistent')
    }
    if (nextAttemptAt !== null) {
      assertDate(nextAttemptAt, 'next attempt time')
      if (nextAttemptAt <= occurredAt) {
        throw new Error('AI authorization erasure next attempt is not in the future')
      }
    }
    const result = await db.execute(sql`
      UPDATE ai_authorization_lifecycle_records
      SET erasure_status = ${terminal ? 'failed' : 'pending'},
          erasure_failure_code = ${failureCode},
          erasure_last_failure_at = ${occurredAt},
          erasure_next_attempt_at = ${nextAttemptAt},
          erasure_claimed_at = NULL,
          erasure_lease_owner = NULL,
          erasure_lease_expires_at = NULL,
          updated_at = ${occurredAt}
      WHERE id = ${claim.lifecycleId}::uuid
        AND erasure_status = 'in_progress'
        AND erasure_lease_owner = ${claim.leaseOwner}::uuid
        AND erasure_attempt_count = ${claim.attempt}
    `)
    if (result.rowCount !== 1) return { status: 'lost_claim' }
    return { status: terminal ? 'terminal_failed' : 'retry_scheduled' }
  },

  readBacklog: async (now): Promise<AiAuthorizationErasureBacklog> => {
    assertDate(now, 'backlog observation time')
    const result = await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE erasure_status = 'pending')::integer AS pending,
        count(*) FILTER (WHERE erasure_status = 'in_progress')::integer AS in_progress,
        count(*) FILTER (WHERE erasure_status = 'failed')::integer AS terminal_failed,
        count(*) FILTER (
          WHERE erasure_status IN ('pending', 'in_progress', 'failed')
            AND erasure_deadline <= ${now}
        )::integer AS overdue
      FROM ai_authorization_lifecycle_records
    `)
    const row = result.rows[0] as Row
    return {
      pending: safeInteger(row.pending, 'pending backlog'),
      inProgress: safeInteger(row.in_progress, 'in-progress backlog'),
      terminalFailed: safeInteger(row.terminal_failed, 'terminal backlog'),
      overdue: safeInteger(row.overdue, 'overdue backlog'),
    }
  },
})

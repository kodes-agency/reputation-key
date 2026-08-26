import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyTrendOutcomes,
  aiPropertyTrendSchedulerHeads,
  aiPropertyTrendSchedules,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import {
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
} from '#/shared/ai-property-trend-contract'
import type {
  AiPropertyTrendSchedule,
  AiPropertyTrendScheduleStorePort,
} from '../../application/ports/ai-property-trend-schedule-store.port'
import { aiPropertyTrendGenerationRequested } from '../../domain/events'

const SCHEDULER_KEY = 'property-trend-v1'
const BATCH_SIZE = 100
const LEASE_MILLISECONDS = 60_000
const REPORT_RETENTION_MILLISECONDS = 730 * 24 * 60 * 60 * 1_000

type CandidateRow = Readonly<{
  organizationId: string
  propertyId: string
  dueLocalDate: string
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyTrendsEpoch: number
  propertyProfileVersion: number
  terminalAnalysisSequence: number
  aggregateRevision: number
  timezone: string
}>

function numberFromDatabase(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed))
    throw new Error('Unsafe AI property trend schedule integer')
  return parsed
}

function dateFromDatabase(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

export function createAiPropertyTrendScheduleStore(
  db: Database,
): AiPropertyTrendScheduleStorePort {
  return {
    scheduleDueBatch: async ({ leaseOwner }) =>
      db.transaction(async (tx) => {
        const nowRows = await tx.execute<{ now: Date | string }>(sql`
          SELECT transaction_timestamp() AS "now"
        `)
        const now = dateFromDatabase(nowRows.rows[0]!.now)
        const leaseExpiresAt = new Date(now.getTime() + LEASE_MILLISECONDS)

        const lockedHead = await tx.execute<{
          generation: number | string
          cursorOrganizationId: string | null
          cursorPropertyId: string | null
          leaseOwner: string | null
          leaseExpiresAt: Date | string | null
        }>(sql`
          SELECT
            "generation",
            "cursor_organization_id" AS "cursorOrganizationId",
            "cursor_property_id"::text AS "cursorPropertyId",
            "lease_owner" AS "leaseOwner",
            "lease_expires_at" AS "leaseExpiresAt"
          FROM "ai_property_trend_scheduler_heads"
          WHERE "scheduler_key" = ${SCHEDULER_KEY}
          FOR UPDATE
        `)
        const head = lockedHead.rows[0]
        if (head === undefined)
          throw new Error('AI property trend scheduler head is missing')
        if (
          head.leaseOwner !== null &&
          head.leaseOwner !== leaseOwner &&
          head.leaseExpiresAt !== null &&
          dateFromDatabase(head.leaseExpiresAt).getTime() > now.getTime()
        ) {
          return { status: 'busy' as const }
        }

        const schedulerGeneration = numberFromDatabase(head.generation) + 1
        await tx
          .update(aiPropertyTrendSchedulerHeads)
          .set({
            generation: schedulerGeneration,
            leaseOwner,
            claimedAt: now,
            leaseExpiresAt,
            updatedAt: now,
          })
          .where(eq(aiPropertyTrendSchedulerHeads.schedulerKey, SCHEDULER_KEY))

        const candidates = await tx.execute<CandidateRow>(sql`
          SELECT
            property."organization_id" AS "organizationId",
            property."id"::text AS "propertyId",
            resolve_ai_property_local_date_v1(
              ${now}::timestamptz,
              profile."timezone",
              'property-calendar-v1'
            )::text AS "dueLocalDate",
            auth."authorized_source_epoch" AS "sourceEpoch",
            auth."review_analysis_epoch" AS "reviewAnalysisEpoch",
            auth."property_trends_epoch" AS "propertyTrendsEpoch",
            profile."profile_version" AS "propertyProfileVersion",
            cursor."terminal_analysis_sequence"::float8 AS "terminalAnalysisSequence",
            aggregate."aggregate_revision"::float8 AS "aggregateRevision",
            profile."timezone" AS "timezone"
          FROM "properties" AS property
          INNER JOIN "merchant_ai_enablement" AS auth
            ON auth."organization_id" = property."organization_id"
           AND auth."property_id" = property."id"
          INNER JOIN "ai_property_processing_profiles" AS profile
            ON profile."organization_id" = property."organization_id"
           AND profile."property_id" = property."id"
          INNER JOIN "review_ai_analysis_heads" AS review_head
            ON review_head."organization_id" = property."organization_id"
           AND review_head."property_id" = property."id"
           AND review_head."source_epoch" = auth."authorized_source_epoch"
          INNER JOIN "ai_review_event_cursors" AS cursor
            ON cursor."organization_id" = property."organization_id"
           AND cursor."property_id" = property."id"
           AND cursor."source_epoch" = auth."authorized_source_epoch"
           AND cursor."review_analysis_epoch" = auth."review_analysis_epoch"
          INNER JOIN "ai_property_aggregate_heads" AS aggregate
            ON aggregate."organization_id" = property."organization_id"
           AND aggregate."property_id" = property."id"
           AND aggregate."source_epoch" = auth."authorized_source_epoch"
           AND aggregate."review_analysis_epoch" = auth."review_analysis_epoch"
           AND aggregate."property_profile_version" = profile."profile_version"
          WHERE property."deleted_at" IS NULL
            AND property."lifecycle_state" = 'active'
            AND auth."state" = 'enabled'
            AND 'property_trends' = ANY(auth."capabilities")
            AND auth."capability_runtime_profile_versions"->>'property_trends' = 'property-trends-runtime-v1'
            AND auth."authorized_source_epoch" = profile."source_epoch"
            AND profile."lifecycle_state" = 'active'
            AND cursor."terminal_analysis_sequence" = review_head."head_sequence"
            AND cursor."aggregate_revision" = aggregate."aggregate_revision"
            AND (${head.cursorOrganizationId}::varchar IS NULL OR
              (property."organization_id", property."id") >
              (${head.cursorOrganizationId}::varchar, ${head.cursorPropertyId}::uuid))
            AND (${now} AT TIME ZONE profile."timezone")::time >= TIME '02:15:00'
            AND NOT EXISTS (
              SELECT 1
              FROM "ai_property_trend_schedules" AS existing
              WHERE existing."organization_id" = property."organization_id"
                AND existing."property_id" = property."id"
                AND existing."due_local_date" = resolve_ai_property_local_date_v1(
                  ${now}::timestamptz,
                  profile."timezone",
                  'property-calendar-v1'
                )
                AND existing."source_epoch" = auth."authorized_source_epoch"
                AND existing."review_analysis_epoch" = auth."review_analysis_epoch"
                AND existing."property_trends_epoch" = auth."property_trends_epoch"
                AND existing."property_profile_version" = profile."profile_version"
                AND existing."report_profile_version" = 'property-trend-v1'
            )
          ORDER BY property."organization_id", property."id"
          LIMIT ${BATCH_SIZE}
          FOR SHARE OF property, auth, profile, review_head, cursor, aggregate
        `)

        let scheduledCount = 0
        for (const candidate of candidates.rows) {
          const scheduleId = randomUUID()
          const event = aiPropertyTrendGenerationRequested({
            scheduleId,
            organizationId: organizationId(candidate.organizationId),
            propertyId: propertyId(candidate.propertyId),
            occurredAt: now,
          })
          const inserted = await tx
            .insert(aiPropertyTrendSchedules)
            .values({
              id: scheduleId,
              outboxEventId: event.eventId,
              organizationId: candidate.organizationId,
              propertyId: candidate.propertyId,
              dueLocalDate: candidate.dueLocalDate,
              sourceEpoch: candidate.sourceEpoch,
              reviewAnalysisEpoch: candidate.reviewAnalysisEpoch,
              propertyTrendsEpoch: candidate.propertyTrendsEpoch,
              propertyProfileVersion: candidate.propertyProfileVersion,
              terminalAnalysisSequence: numberFromDatabase(
                candidate.terminalAnalysisSequence,
              ),
              aggregateRevision: numberFromDatabase(candidate.aggregateRevision),
              timezone: candidate.timezone,
              calendarProfileVersion: 'property-calendar-v1',
              reportProfileVersion: 'property-trend-v1',
              schedulerGeneration,
              scheduledAt: now,
            })
            .onConflictDoNothing()
            .returning({ id: aiPropertyTrendSchedules.id })
          if (inserted.length === 0) continue

          await insertOutboxRow(tx, event, { recordedAt: now })
          scheduledCount += 1
        }

        const last = candidates.rows.at(-1)
        const hasMore = candidates.rows.length === BATCH_SIZE
        await tx
          .update(aiPropertyTrendSchedulerHeads)
          .set({
            cursorOrganizationId: hasMore ? last!.organizationId : null,
            cursorPropertyId: hasMore ? last!.propertyId : null,
            leaseOwner: null,
            claimedAt: null,
            leaseExpiresAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(aiPropertyTrendSchedulerHeads.schedulerKey, SCHEDULER_KEY),
              eq(aiPropertyTrendSchedulerHeads.generation, schedulerGeneration),
              eq(aiPropertyTrendSchedulerHeads.leaseOwner, leaseOwner),
            ),
          )

        return {
          status: 'scheduled' as const,
          schedulerGeneration,
          scheduledCount,
          hasMore,
        }
      }),

    read: async (scheduleId) => {
      const rows = await db.execute<{
        id: string
        organizationId: string
        propertyId: string
        dueLocalDate: string
        sourceEpoch: number
        reviewAnalysisEpoch: number
        propertyTrendsEpoch: number
        propertyProfileVersion: number
        terminalAnalysisSequence: number | string
        aggregateRevision: number | string
        timezone: string
        calendarProfileVersion: 'property-calendar-v1'
        reportProfileVersion: 'property-trend-v1'
        schedulerGeneration: number | string
        scheduledAt: Date | string
        outcomeDisposition: AiPropertyTrendSchedule['outcomeDisposition']
      }>(sql`
        SELECT
          schedule."id"::text AS "id",
          schedule."organization_id" AS "organizationId",
          schedule."property_id"::text AS "propertyId",
          schedule."due_local_date"::text AS "dueLocalDate",
          schedule."source_epoch" AS "sourceEpoch",
          schedule."review_analysis_epoch" AS "reviewAnalysisEpoch",
          schedule."property_trends_epoch" AS "propertyTrendsEpoch",
          schedule."property_profile_version" AS "propertyProfileVersion",
          schedule."terminal_analysis_sequence"::float8 AS "terminalAnalysisSequence",
          schedule."aggregate_revision"::float8 AS "aggregateRevision",
          schedule."timezone" AS "timezone",
          schedule."calendar_profile_version" AS "calendarProfileVersion",
          schedule."report_profile_version" AS "reportProfileVersion",
          schedule."scheduler_generation"::float8 AS "schedulerGeneration",
          schedule."scheduled_at" AS "scheduledAt",
          outcome."disposition" AS "outcomeDisposition"
        FROM "ai_property_trend_schedules" AS schedule
        LEFT JOIN "ai_property_trend_outcomes" AS outcome
          ON outcome."schedule_id" = schedule."id"
        WHERE schedule."id" = ${scheduleId}::uuid
        LIMIT 1
      `)
      const row = rows.rows[0]
      if (row === undefined) return null
      return {
        id: row.id,
        organizationId: organizationId(row.organizationId),
        propertyId: propertyId(row.propertyId),
        dueLocalDate: row.dueLocalDate,
        sourceEpoch: row.sourceEpoch,
        reviewAnalysisEpoch: row.reviewAnalysisEpoch,
        propertyTrendsEpoch: row.propertyTrendsEpoch,
        propertyProfileVersion: row.propertyProfileVersion,
        terminalAnalysisSequence: numberFromDatabase(row.terminalAnalysisSequence),
        aggregateRevision: numberFromDatabase(row.aggregateRevision),
        timezone: row.timezone,
        calendarProfileVersion: row.calendarProfileVersion,
        reportProfileVersion: row.reportProfileVersion,
        schedulerGeneration: numberFromDatabase(row.schedulerGeneration),
        scheduledAtEpochMillis: dateFromDatabase(row.scheduledAt).getTime(),
        outcomeDisposition: row.outcomeDisposition,
      }
    },

    recordProviderFreeOutcome: async ({ scheduleId, disposition }) =>
      db.transaction(async (tx) => {
        const existing = await tx
          .select({ disposition: aiPropertyTrendOutcomes.disposition })
          .from(aiPropertyTrendOutcomes)
          .where(eq(aiPropertyTrendOutcomes.scheduleId, scheduleId))
          .limit(1)
        if (existing[0] !== undefined) {
          return existing[0].disposition === disposition ? 'replayed' : 'stale'
        }

        const current = await tx.execute<{
          organizationId: string
          propertyId: string
        }>(sql`
          SELECT schedule."organization_id" AS "organizationId",
                 schedule."property_id"::text AS "propertyId"
          FROM "ai_property_trend_schedules" AS schedule
          INNER JOIN "properties" AS property
            ON property."organization_id" = schedule."organization_id"
           AND property."id" = schedule."property_id"
          INNER JOIN "merchant_ai_enablement" AS auth
            ON auth."organization_id" = schedule."organization_id"
           AND auth."property_id" = schedule."property_id"
          INNER JOIN "ai_property_processing_profiles" AS profile
            ON profile."organization_id" = schedule."organization_id"
           AND profile."property_id" = schedule."property_id"
          INNER JOIN "review_ai_analysis_heads" AS review_head
            ON review_head."organization_id" = schedule."organization_id"
           AND review_head."property_id" = schedule."property_id"
           AND review_head."source_epoch" = schedule."source_epoch"
          INNER JOIN "ai_review_event_cursors" AS cursor
            ON cursor."organization_id" = schedule."organization_id"
           AND cursor."property_id" = schedule."property_id"
           AND cursor."source_epoch" = schedule."source_epoch"
           AND cursor."review_analysis_epoch" = schedule."review_analysis_epoch"
          INNER JOIN "ai_property_aggregate_heads" AS aggregate
            ON aggregate."organization_id" = schedule."organization_id"
           AND aggregate."property_id" = schedule."property_id"
           AND aggregate."source_epoch" = schedule."source_epoch"
           AND aggregate."review_analysis_epoch" = schedule."review_analysis_epoch"
           AND aggregate."property_profile_version" = schedule."property_profile_version"
          WHERE schedule."id" = ${scheduleId}::uuid
            AND property."deleted_at" IS NULL
            AND property."lifecycle_state" = 'active'
            AND auth."state" = 'enabled'
            AND 'property_trends' = ANY(auth."capabilities")
            AND auth."capability_runtime_profile_versions"->>'property_trends' = 'property-trends-runtime-v1'
            AND auth."authorized_source_epoch" = schedule."source_epoch"
            AND auth."review_analysis_epoch" = schedule."review_analysis_epoch"
            AND auth."property_trends_epoch" = schedule."property_trends_epoch"
            AND profile."lifecycle_state" = 'active'
            AND profile."source_epoch" = schedule."source_epoch"
            AND profile."profile_version" = schedule."property_profile_version"
            AND profile."timezone" = schedule."timezone"
            AND review_head."head_sequence" = schedule."terminal_analysis_sequence"
            AND cursor."terminal_analysis_sequence" = schedule."terminal_analysis_sequence"
            AND cursor."aggregate_revision" = schedule."aggregate_revision"
            AND aggregate."terminal_analysis_sequence" = schedule."terminal_analysis_sequence"
            AND aggregate."aggregate_revision" = schedule."aggregate_revision"
          FOR SHARE OF property, auth, profile, review_head, cursor, aggregate
        `)
        const binding = current.rows[0]
        if (binding === undefined) return 'stale'

        const nowRows = await tx.execute<{ now: Date | string }>(sql`
          SELECT transaction_timestamp() AS "now"
        `)
        const recordedAt = dateFromDatabase(nowRows.rows[0]!.now)
        const inserted = await tx
          .insert(aiPropertyTrendOutcomes)
          .values({
            scheduleId,
            organizationId: binding.organizationId,
            propertyId: binding.propertyId,
            disposition,
            recordedAt,
          })
          .onConflictDoNothing()
          .returning({ disposition: aiPropertyTrendOutcomes.disposition })
        if (inserted[0] !== undefined) return 'recorded'

        const replay = await tx
          .select({ disposition: aiPropertyTrendOutcomes.disposition })
          .from(aiPropertyTrendOutcomes)
          .where(eq(aiPropertyTrendOutcomes.scheduleId, scheduleId))
          .limit(1)
        return replay[0]?.disposition === disposition ? 'replayed' : 'stale'
      }),

    recordDeterministicReport: async ({ scheduleId, selectedSignalIds, report }) =>
      db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            disposition: aiPropertyTrendOutcomes.disposition,
            selectedSignalIds: aiPropertyTrendOutcomes.selectedSignalIds,
            signalKey: aiPropertyTrendOutcomes.signalKey,
            direction: aiPropertyTrendOutcomes.direction,
            confidenceBasisPoints: aiPropertyTrendOutcomes.confidenceBasisPoints,
            supportingReviewCount: aiPropertyTrendOutcomes.supportingReviewCount,
            headline: aiPropertyTrendOutcomes.headline,
            sentences: aiPropertyTrendOutcomes.sentences,
            summary: aiPropertyTrendOutcomes.summary,
          })
          .from(aiPropertyTrendOutcomes)
          .where(eq(aiPropertyTrendOutcomes.scheduleId, scheduleId))
          .limit(1)
        if (existing !== undefined) {
          const replayed =
            existing.disposition === 'ready' &&
            JSON.stringify(existing.selectedSignalIds) ===
              JSON.stringify(selectedSignalIds) &&
            existing.signalKey === report.signalKey &&
            existing.direction === report.direction &&
            existing.confidenceBasisPoints === report.confidenceBasisPoints &&
            existing.supportingReviewCount === report.supportingReviewCount &&
            existing.headline === report.headline &&
            JSON.stringify(existing.sentences) === JSON.stringify(report.sentences) &&
            existing.summary === report.summary
          return replayed ? 'replayed' : 'stale'
        }

        const current = await tx.execute<{
          organizationId: string
          propertyId: string
        }>(sql`
          SELECT schedule."organization_id" AS "organizationId",
                 schedule."property_id"::text AS "propertyId"
          FROM "ai_property_trend_schedules" AS schedule
          INNER JOIN "properties" AS property
            ON property."organization_id" = schedule."organization_id"
           AND property."id" = schedule."property_id"
          INNER JOIN "merchant_ai_enablement" AS auth
            ON auth."organization_id" = schedule."organization_id"
           AND auth."property_id" = schedule."property_id"
          INNER JOIN "ai_property_processing_profiles" AS profile
            ON profile."organization_id" = schedule."organization_id"
           AND profile."property_id" = schedule."property_id"
          INNER JOIN "review_ai_analysis_heads" AS review_head
            ON review_head."organization_id" = schedule."organization_id"
           AND review_head."property_id" = schedule."property_id"
           AND review_head."source_epoch" = schedule."source_epoch"
          INNER JOIN "ai_review_event_cursors" AS cursor
            ON cursor."organization_id" = schedule."organization_id"
           AND cursor."property_id" = schedule."property_id"
           AND cursor."source_epoch" = schedule."source_epoch"
           AND cursor."review_analysis_epoch" = schedule."review_analysis_epoch"
          INNER JOIN "ai_property_aggregate_heads" AS aggregate
            ON aggregate."organization_id" = schedule."organization_id"
           AND aggregate."property_id" = schedule."property_id"
           AND aggregate."source_epoch" = schedule."source_epoch"
           AND aggregate."review_analysis_epoch" = schedule."review_analysis_epoch"
           AND aggregate."property_profile_version" = schedule."property_profile_version"
          WHERE schedule."id" = ${scheduleId}::uuid
            AND property."deleted_at" IS NULL
            AND property."lifecycle_state" = 'active'
            AND auth."state" = 'enabled'
            AND 'property_trends' = ANY(auth."capabilities")
            AND auth."capability_runtime_profile_versions"->>'property_trends' = 'property-trends-runtime-v1'
            AND auth."authorized_source_epoch" = schedule."source_epoch"
            AND auth."review_analysis_epoch" = schedule."review_analysis_epoch"
            AND auth."property_trends_epoch" = schedule."property_trends_epoch"
            AND profile."lifecycle_state" = 'active'
            AND profile."source_epoch" = schedule."source_epoch"
            AND profile."profile_version" = schedule."property_profile_version"
            AND profile."timezone" = schedule."timezone"
            AND review_head."head_sequence" = schedule."terminal_analysis_sequence"
            AND cursor."consumed_sequence" = schedule."terminal_analysis_sequence"
            AND cursor."terminal_analysis_sequence" = schedule."terminal_analysis_sequence"
            AND cursor."aggregate_revision" = schedule."aggregate_revision"
            AND aggregate."terminal_analysis_sequence" = schedule."terminal_analysis_sequence"
            AND aggregate."aggregate_revision" = schedule."aggregate_revision"
          FOR SHARE OF property, auth, profile, review_head, cursor, aggregate
        `)
        const binding = current.rows[0]
        if (binding === undefined) return 'stale'

        const nowRows = await tx.execute<{ now: Date | string }>(sql`
          SELECT transaction_timestamp() AS "now"
        `)
        const recordedAt = dateFromDatabase(nowRows.rows[0]!.now)
        const inserted = await tx
          .insert(aiPropertyTrendOutcomes)
          .values({
            scheduleId,
            organizationId: binding.organizationId,
            propertyId: binding.propertyId,
            disposition: 'ready',
            selectedSignalIds: [...selectedSignalIds],
            signalKey: report.signalKey,
            direction: report.direction,
            confidenceBasisPoints: report.confidenceBasisPoints,
            supportingReviewCount: report.supportingReviewCount,
            headline: report.headline,
            sentences: [...report.sentences],
            summary: report.summary,
            renderProfileVersion: AI_TREND_RENDER_PROFILE_VERSION,
            renderProfileDigest: AI_TREND_RENDER_PROFILE_DIGEST,
            recordedAt,
            expiresAt: new Date(recordedAt.getTime() + REPORT_RETENTION_MILLISECONDS),
          })
          .onConflictDoNothing()
          .returning({ disposition: aiPropertyTrendOutcomes.disposition })
        if (inserted[0] !== undefined) return 'recorded'
        return 'stale'
      }),
  }
}

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aliasedResponseTargetKey,
  notExcludedFromResponseTargetReporting,
} from '#/shared/db/inbox-response-target-exclusions'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleResponseTargets,
} from '#/shared/db/schema/inbox.schema'
import { propertyId, type PropertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
  ResponseTargetStore,
} from '../application/ports/response-target.store'

type AnalyticsStore = Pick<
  ResponseTargetStore,
  | 'getPrivateFeedbackAnalytics'
  | 'getGoogleReviewAnalytics'
  | 'getGoogleReviewTargetCountsByProperty'
>

/**
 * The counting readers of the Response Target tables: the two analytics and the
 * per-Property overdue figures. A Google review cycle with a row in
 * `inbox_response_target_exclusions` is left out of every Google figure (it
 * stays a row in the table, and its target still closes with the cycle).
 * Split out of response-target.store.ts for the file-length ratchet.
 */
export const createResponseTargetAnalyticsStore = (db: Database): AnalyticsStore => ({
  getPrivateFeedbackAnalytics: async ({ organizationId: orgId, propertyIds, now }) =>
    trace('inbox.responseTarget.getPrivateFeedbackAnalytics', async () => {
      if (propertyIds !== null && propertyIds.length === 0) {
        return {
          targetKind: 'private_feedback_handling',
          measuredCycleCount: 0,
          activeCount: 0,
          currentOverdueCount: 0,
          handledOnTimeCount: 0,
          handledLateCount: 0,
          reopenCount: 0,
          averageTimeToFirstHandlingMinutes: null,
        }
      }
      const propertyFilter =
        propertyIds === null
          ? sql``
          : sql`AND target.property_id IN (${sql.join(
              propertyIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
      const rows = await db.execute<{
        measured_cycle_count: number
        active_count: number
        current_overdue_count: number
        handled_on_time_count: number
        handled_late_count: number
        reopen_count: number
        average_time_to_first_handling_minutes: number | null
      }>(sql`
        SELECT
          count(*) FILTER (WHERE target.result IS DISTINCT FROM 'cancelled')::integer AS measured_cycle_count,
          count(*) FILTER (
            WHERE target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
          )::integer AS active_count,
          count(*) FILTER (
            WHERE target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
              AND target.due_at <= ${now}
          )::integer AS current_overdue_count,
          count(*) FILTER (WHERE target.result = 'on_time')::integer AS handled_on_time_count,
          count(*) FILTER (WHERE target.result = 'late')::integer AS handled_late_count,
          count(*) FILTER (
            WHERE cycle.opened_reason = 'manual_reopen'
              AND target.result IS DISTINCT FROM 'cancelled'
          )::integer AS reopen_count,
          avg(
            extract(epoch FROM (target.completion_at - target.start_at)) / 60
          ) FILTER (WHERE target.result IN ('on_time', 'late'))::real
            AS average_time_to_first_handling_minutes
        FROM ${inboxHandlingCycleResponseTargets} target
        INNER JOIN ${inboxHandlingCycleHeads} head
          ON head.inbox_item_id = target.inbox_item_id
        INNER JOIN inbox_handling_cycles cycle
          ON cycle.inbox_item_id = target.inbox_item_id
         AND cycle.cycle_number = target.cycle_number
        WHERE target.organization_id = ${orgId}
          AND target.target_kind = 'private_feedback_handling'
          AND target.performance_eligibility = 'measured'
          ${propertyFilter}
      `)
      const row = rows.rows[0]
      return {
        targetKind: 'private_feedback_handling',
        measuredCycleCount: row?.measured_cycle_count ?? 0,
        activeCount: row?.active_count ?? 0,
        currentOverdueCount: row?.current_overdue_count ?? 0,
        handledOnTimeCount: row?.handled_on_time_count ?? 0,
        handledLateCount: row?.handled_late_count ?? 0,
        reopenCount: row?.reopen_count ?? 0,
        averageTimeToFirstHandlingMinutes:
          row?.average_time_to_first_handling_minutes ?? null,
      } satisfies PrivateFeedbackTargetAnalytics
    }),

  getGoogleReviewAnalytics: async ({ organizationId: orgId, propertyIds, now }) =>
    trace('inbox.responseTarget.getGoogleReviewAnalytics', async () => {
      if (propertyIds !== null && propertyIds.length === 0) {
        return {
          targetKind: 'google_review_response',
          measuredCycleCount: 0,
          activeCount: 0,
          currentOverdueCount: 0,
          respondedOnTimeCount: 0,
          respondedLateCount: 0,
          reopenCount: 0,
          historicalOnboardingExcludedCount: 0,
          legacyUnknownExcludedCount: 0,
          averageTimeToResponseMinutes: null,
        }
      }
      const propertyFilter =
        propertyIds === null
          ? sql``
          : sql`AND target.property_id IN (${sql.join(
              propertyIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
      const rows = await db.execute<{
        measured_cycle_count: number
        active_count: number
        current_overdue_count: number
        responded_on_time_count: number
        responded_late_count: number
        reopen_count: number
        historical_onboarding_excluded_count: number
        legacy_unknown_excluded_count: number
        average_time_to_response_minutes: number | null
      }>(sql`
        SELECT
          count(*) FILTER (
            WHERE target.performance_eligibility = 'measured'
              AND target.result IS DISTINCT FROM 'cancelled'
          )::integer AS measured_cycle_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'measured'
              AND target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
          )::integer AS active_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'measured'
              AND target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
              AND target.due_at <= ${now}
          )::integer AS current_overdue_count,
          count(*) FILTER (WHERE target.result = 'on_time')::integer
            AS responded_on_time_count,
          count(*) FILTER (WHERE target.result = 'late')::integer
            AS responded_late_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'measured'
              AND target.result IS DISTINCT FROM 'cancelled'
              AND cycle.opened_reason IN ('manual_reopen', 'provider_reply_deleted')
          )::integer AS reopen_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'historical_onboarding'
          )::integer AS historical_onboarding_excluded_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'legacy_unknown'
          )::integer AS legacy_unknown_excluded_count,
          avg(
            extract(epoch FROM (target.completion_at - target.start_at)) / 60
          ) FILTER (WHERE target.result IN ('on_time', 'late'))::real
            AS average_time_to_response_minutes
        FROM ${inboxHandlingCycleResponseTargets} target
        INNER JOIN ${inboxHandlingCycleHeads} head
          ON head.inbox_item_id = target.inbox_item_id
        INNER JOIN inbox_handling_cycles cycle
          ON cycle.inbox_item_id = target.inbox_item_id
         AND cycle.cycle_number = target.cycle_number
        WHERE target.organization_id = ${orgId}
          AND target.target_kind = 'google_review_response'
          AND ${notExcludedFromResponseTargetReporting(aliasedResponseTargetKey('target'))}
          ${propertyFilter}
      `)
      const row = rows.rows[0]
      return {
        targetKind: 'google_review_response',
        measuredCycleCount: row?.measured_cycle_count ?? 0,
        activeCount: row?.active_count ?? 0,
        currentOverdueCount: row?.current_overdue_count ?? 0,
        respondedOnTimeCount: row?.responded_on_time_count ?? 0,
        respondedLateCount: row?.responded_late_count ?? 0,
        reopenCount: row?.reopen_count ?? 0,
        historicalOnboardingExcludedCount: row?.historical_onboarding_excluded_count ?? 0,
        legacyUnknownExcludedCount: row?.legacy_unknown_excluded_count ?? 0,
        averageTimeToResponseMinutes: row?.average_time_to_response_minutes ?? null,
      } satisfies GoogleReviewTargetAnalytics
    }),

  getGoogleReviewTargetCountsByProperty: async ({
    organizationId: orgId,
    propertyIds,
    now,
  }) =>
    trace('inbox.responseTarget.getGoogleReviewTargetCountsByProperty', async () => {
      const counts = new Map<
        PropertyId,
        Readonly<{ activeCount: number; overdueCount: number }>
      >()
      for (const id of propertyIds) {
        counts.set(id, { activeCount: 0, overdueCount: 0 })
      }
      if (propertyIds.length === 0) return counts

      const rows = await db.execute<{
        property_id: string
        active_count: number
        overdue_count: number
      }>(sql`
        SELECT
          target.property_id,
          count(*) FILTER (
            WHERE target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
          )::integer AS active_count,
          count(*) FILTER (
            WHERE target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
              AND target.due_at <= ${now}
          )::integer AS overdue_count
        FROM ${inboxHandlingCycleResponseTargets} target
        INNER JOIN ${inboxHandlingCycleHeads} head
          ON head.inbox_item_id = target.inbox_item_id
        INNER JOIN inbox_handling_cycles cycle
          ON cycle.inbox_item_id = target.inbox_item_id
         AND cycle.cycle_number = target.cycle_number
        WHERE target.organization_id = ${orgId}
          AND target.target_kind = 'google_review_response'
          AND target.performance_eligibility = 'measured'
          AND ${notExcludedFromResponseTargetReporting(aliasedResponseTargetKey('target'))}
          AND target.property_id = ANY(${sql.param(propertyIds)}::uuid[])
        GROUP BY target.property_id
      `)

      for (const row of rows.rows) {
        counts.set(propertyId(row.property_id), {
          activeCount: row.active_count,
          overdueCount: row.overdue_count,
        })
      }
      return counts
    }),
})

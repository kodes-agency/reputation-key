// Reporting — PostgreSQL persistence of "Not now" on the Overview's Monthly
// portal goal prompt (ADR 0068, PLAN PG-16; migration 0062).
//
// One row per Property (`property_id` is the key), bound to its Organization by
// the composite foreign key, which also cascades it away with the Property.
// "Not now" is an upsert that only moves the month on: a later month replaces
// the row, an earlier or the same month leaves it untouched, so a tab left open
// since last month never brings back a prompt put off since. Every read and
// write names the Organization as well as the Property.
import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalGoalPromptDeferrals } from '#/shared/db/schema/goal.schema'
import { trace } from '#/shared/observability/trace'
import type { PortalGoalPromptDeferralStore } from '../../application/ports/portal-goal-prompt-deferrals.port'

export const createPortalGoalPromptDeferralStore = (
  db: Database,
): PortalGoalPromptDeferralStore => ({
  deferredMonth: (organizationId, propertyId) =>
    trace('reporting.portalGoalPrompt.deferredMonth', async () => {
      const [row] = await db
        .select({ month: portalGoalPromptDeferrals.month })
        .from(portalGoalPromptDeferrals)
        .where(
          and(
            eq(portalGoalPromptDeferrals.organizationId, organizationId),
            eq(portalGoalPromptDeferrals.propertyId, propertyId),
          ),
        )
      return row?.month ?? null
    }),

  defer: (deferral) =>
    trace('reporting.portalGoalPrompt.defer', async () => {
      await db
        .insert(portalGoalPromptDeferrals)
        .values({
          organizationId: deferral.organizationId,
          propertyId: deferral.propertyId,
          month: deferral.month,
          deferredBy: deferral.deferredBy,
          deferredAt: deferral.deferredAt,
        })
        .onConflictDoUpdate({
          target: portalGoalPromptDeferrals.propertyId,
          set: {
            month: deferral.month,
            deferredBy: deferral.deferredBy,
            deferredAt: deferral.deferredAt,
          },
          // Months are `YYYY-MM`, so their order is the strings'.
          setWhere: sql`${portalGoalPromptDeferrals.organizationId} = ${deferral.organizationId}
            AND ${portalGoalPromptDeferrals.month} < ${deferral.month}`,
        })
    }),
})

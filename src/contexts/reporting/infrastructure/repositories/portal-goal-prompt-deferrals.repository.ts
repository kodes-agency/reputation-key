// One row per Property, tenant-bound and cascaded by the composite foreign key
// (ADR 0068). Upsert advances the month only: a stale tab must not revive a prompt
// already deferred for a later month. Every statement includes Organization scope.

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

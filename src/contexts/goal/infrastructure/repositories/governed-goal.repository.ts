import { and, asc, desc, eq, gt, inArray, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import {
  goalDefinitions,
  goalDefinitionVersions,
  goalEvaluations,
  goalPeriods,
  goalRefreshReceipts,
  goalTimezoneEventReceipts,
} from '#/shared/db/schema/goal.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type {
  GovernedGoalDefinition,
  GovernedGoalEvaluation,
  GovernedGoalPeriod,
  GovernedGoalRepository,
  GovernedGoalVersion,
} from '../../application/ports/governed-goal.repository'
import type { GovernedMetricVersion } from '../../domain/governed-goal'

const metricSnapshot = (
  row: typeof goalDefinitionVersions.$inferSelect,
): GovernedMetricVersion => ({
  definitionId: row.metricDefinitionId,
  versionId: row.metricDefinitionVersionId,
  metricKey: row.metricKey,
  valueKind: row.metricValueKind as GovernedMetricVersion['valueKind'],
  allowedScopes: row.metricAllowedScopes,
  sourcePolicyAllowlist: [row.sourcePolicy],
  permittedConsumers: row.metricPermittedConsumers,
  minimumSample: row.metricMinimumSample,
  employmentDecisionEligible: row.metricEmploymentDecisionEligible,
})

function mapDefinition(row: typeof goalDefinitions.$inferSelect): GovernedGoalDefinition {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    scope:
      row.scopeKind === 'portal_group' && row.portalGroupId
        ? { kind: 'portal_group', portalGroupId: row.portalGroupId }
        : { kind: 'property' },
    name: row.name,
    description: row.description,
    status: row.status as GovernedGoalDefinition['status'],
    statusReason: row.statusReason,
    currentVersion: row.currentVersion,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapVersion(
  row: typeof goalDefinitionVersions.$inferSelect,
): GovernedGoalVersion {
  return {
    id: row.id,
    definitionId: row.definitionId,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    version: row.version,
    metric: metricSnapshot(row),
    measureKind: row.measureKind as GovernedGoalVersion['measureKind'],
    targetValue: row.targetValue,
    sourcePolicy: row.sourcePolicy,
    propertyTimezone: row.propertyTimezone,
    recurrenceRule: row.recurrenceRule as GovernedGoalVersion['recurrenceRule'],
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    changeReason: row.changeReason,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

function mapPeriod(row: typeof goalPeriods.$inferSelect): GovernedGoalPeriod {
  return {
    ...row,
    status: row.status as GovernedGoalPeriod['status'],
  }
}

function mapEvaluation(row: typeof goalEvaluations.$inferSelect): GovernedGoalEvaluation {
  return {
    ...row,
    state: row.state as GovernedGoalEvaluation['state'],
  }
}

const definitionValues = (definition: GovernedGoalDefinition) => ({
  id: definition.id,
  organizationId: definition.organizationId,
  propertyId: definition.propertyId,
  scopeKind: definition.scope.kind,
  portalGroupId:
    definition.scope.kind === 'portal_group' ? definition.scope.portalGroupId : null,
  name: definition.name,
  description: definition.description,
  status: definition.status,
  statusReason: definition.statusReason,
  currentVersion: definition.currentVersion,
  createdBy: definition.createdBy,
  createdAt: definition.createdAt,
  updatedAt: definition.updatedAt,
})

const versionValues = (version: GovernedGoalVersion) => ({
  id: version.id,
  definitionId: version.definitionId,
  organizationId: version.organizationId,
  propertyId: version.propertyId,
  version: version.version,
  metricDefinitionId: version.metric.definitionId,
  metricDefinitionVersionId: version.metric.versionId,
  metricKey: version.metric.metricKey,
  metricValueKind: version.metric.valueKind,
  metricMinimumSample: version.metric.minimumSample,
  metricAllowedScopes: version.metric.allowedScopes,
  metricPermittedConsumers: version.metric.permittedConsumers,
  metricEmploymentDecisionEligible: version.metric.employmentDecisionEligible,
  measureKind: version.measureKind,
  targetValue: version.targetValue,
  sourcePolicy: version.sourcePolicy,
  propertyTimezone: version.propertyTimezone,
  recurrenceRule: version.recurrenceRule,
  effectiveFrom: version.effectiveFrom,
  effectiveTo: version.effectiveTo,
  changeReason: version.changeReason,
  createdBy: version.createdBy,
  createdAt: version.createdAt,
})

const periodValues = (period: GovernedGoalPeriod) => ({
  ...period,
})

const evaluationValues = (evaluation: GovernedGoalEvaluation) => ({
  ...evaluation,
})

export function createGovernedGoalRepository(db: Database): GovernedGoalRepository {
  return {
    async getDefinitionScope(organizationId, definitionId) {
      const [row] = await db
        .select({
          organizationId: goalDefinitions.organizationId,
          propertyId: goalDefinitions.propertyId,
          definitionId: goalDefinitions.id,
        })
        .from(goalDefinitions)
        .where(
          and(
            eq(goalDefinitions.organizationId, organizationId),
            eq(goalDefinitions.id, definitionId),
          ),
        )
        .limit(1)
      return row ?? null
    },

    async getDefinition(organizationId, propertyId, definitionId) {
      const [row] = await db
        .select()
        .from(goalDefinitions)
        .where(
          and(
            eq(goalDefinitions.organizationId, organizationId),
            eq(goalDefinitions.propertyId, propertyId),
            eq(goalDefinitions.id, definitionId),
          ),
        )
        .limit(1)
      return row ? mapDefinition(row) : null
    },

    async getCurrentVersion(organizationId, propertyId, definitionId) {
      const [row] = await db
        .select()
        .from(goalDefinitionVersions)
        .where(
          and(
            eq(goalDefinitionVersions.organizationId, organizationId),
            eq(goalDefinitionVersions.propertyId, propertyId),
            eq(goalDefinitionVersions.definitionId, definitionId),
          ),
        )
        .orderBy(desc(goalDefinitionVersions.version))
        .limit(1)
      return row ? mapVersion(row) : null
    },

    async getPeriod(organizationId, propertyId, periodId) {
      const [row] = await db
        .select()
        .from(goalPeriods)
        .where(
          and(
            eq(goalPeriods.organizationId, organizationId),
            eq(goalPeriods.propertyId, propertyId),
            eq(goalPeriods.id, periodId),
          ),
        )
        .limit(1)
      return row ? mapPeriod(row) : null
    },

    async getLatestEvaluation(organizationId, propertyId, periodId) {
      const [row] = await db
        .select()
        .from(goalEvaluations)
        .where(
          and(
            eq(goalEvaluations.organizationId, organizationId),
            eq(goalEvaluations.propertyId, propertyId),
            eq(goalEvaluations.periodId, periodId),
          ),
        )
        .orderBy(desc(goalEvaluations.createdAt), desc(goalEvaluations.id))
        .limit(1)
      return row ? mapEvaluation(row) : null
    },

    async listForProperty(organizationId, propertyId, visiblePortalGroupIds) {
      const visibility =
        visiblePortalGroupIds === null
          ? undefined
          : visiblePortalGroupIds.length === 0
            ? eq(goalDefinitions.scopeKind, 'property')
            : or(
                eq(goalDefinitions.scopeKind, 'property'),
                inArray(goalDefinitions.portalGroupId, visiblePortalGroupIds),
              )
      const rows = await db
        .select()
        .from(goalDefinitions)
        .where(
          and(
            eq(goalDefinitions.organizationId, organizationId),
            eq(goalDefinitions.propertyId, propertyId),
            visibility,
          ),
        )
        .orderBy(asc(goalDefinitions.name), asc(goalDefinitions.id))
      return rows.map(mapDefinition)
    },

    async createDefinition(input) {
      await db.transaction(async (tx) => {
        await tx.insert(goalDefinitions).values(definitionValues(input.definition))
        await tx.insert(goalDefinitionVersions).values(versionValues(input.version))
        await tx.insert(goalPeriods).values(periodValues(input.period))
        await tx.insert(auditLogs).values({
          organizationId: input.definition.organizationId,
          userId: input.definition.createdBy,
          action: input.auditAction,
          resourceType: 'goal_definition',
          resourceId: input.definition.id,
          details: {
            propertyId: input.definition.propertyId,
            definitionVersionId: input.version.id,
            periodId: input.period.id,
          },
        })
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType: 'goal.definition.created',
          eventVersion: 1,
          organizationId: input.definition.organizationId,
          propertyId: input.definition.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: input.definition.id,
          payload: {
            definitionId: input.definition.id,
            definitionVersionId: input.version.id,
            periodId: input.period.id,
          },
        })
      })
    },

    async reviseDefinition(input) {
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(goalDefinitions)
          .set({
            currentVersion: input.version.version,
            updatedAt: input.version.createdAt,
          })
          .where(
            and(
              eq(goalDefinitions.organizationId, input.version.organizationId),
              eq(goalDefinitions.propertyId, input.version.propertyId),
              eq(goalDefinitions.id, input.version.definitionId),
              eq(goalDefinitions.currentVersion, input.previousVersion.version),
              eq(goalDefinitions.status, 'active'),
            ),
          )
          .returning({ id: goalDefinitions.id })
        if (!updated) throw new Error('Goal definition revision conflict')
        await tx.insert(goalDefinitionVersions).values(versionValues(input.version))
        await tx.insert(goalPeriods).values(periodValues(input.period))
        await tx.insert(auditLogs).values({
          organizationId: input.version.organizationId,
          userId: input.version.createdBy,
          action: input.auditAction,
          resourceType: 'goal_definition',
          resourceId: input.version.definitionId,
          details: {
            previousDefinitionVersionId: input.previousVersion.id,
            definitionVersionId: input.version.id,
            periodId: input.period.id,
          },
        })
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType: 'goal.definition.revised',
          eventVersion: 1,
          organizationId: input.version.organizationId,
          propertyId: input.version.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: input.version.definitionId,
          payload: {
            definitionId: input.version.definitionId,
            definitionVersionId: input.version.id,
            periodId: input.period.id,
          },
        })
      })
    },

    async changeDefinitionStatus(input) {
      return db.transaction(async (tx) => {
        const [updated] = await tx
          .update(goalDefinitions)
          .set({
            status: input.status,
            statusReason: input.reason,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(goalDefinitions.organizationId, input.organizationId),
              eq(goalDefinitions.propertyId, input.propertyId),
              eq(goalDefinitions.id, input.definitionId),
              eq(goalDefinitions.status, input.expectedCurrentStatus),
            ),
          )
          .returning()
        if (!updated) return null
        if (input.status === 'cancelled') {
          await tx
            .update(goalPeriods)
            .set({
              status: 'cancelled',
              statusReason: input.reason,
              updatedAt: input.at,
            })
            .where(
              and(
                eq(goalPeriods.organizationId, input.organizationId),
                eq(goalPeriods.propertyId, input.propertyId),
                eq(goalPeriods.definitionId, input.definitionId),
                inArray(goalPeriods.status, ['scheduled', 'open']),
              ),
            )
        }
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId,
          userId: input.actorId,
          action: `goal.definition.${input.status}`,
          resourceType: 'goal_definition',
          resourceId: input.definitionId,
          details: { reason: input.reason },
        })
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType: `goal.definition.${input.status}`,
          eventVersion: 1,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: input.definitionId,
          payload: {
            definitionId: input.definitionId,
            status: input.status,
            reason: input.reason,
          },
        })
        return mapDefinition(updated)
      })
    },

    async appendEvaluation(input) {
      return db.transaction(async (tx) => {
        const inserted = await tx
          .insert(goalEvaluations)
          .values(evaluationValues(input.evaluation))
          .onConflictDoNothing()
          .returning()
        const existing =
          inserted[0] ??
          (
            await tx
              .select()
              .from(goalEvaluations)
              .where(
                and(
                  eq(goalEvaluations.organizationId, input.evaluation.organizationId),
                  eq(goalEvaluations.propertyId, input.evaluation.propertyId),
                  eq(goalEvaluations.idempotencyKey, input.evaluation.idempotencyKey),
                ),
              )
              .limit(1)
          )[0]
        if (!existing) throw new Error('Goal evaluation insert failed')
        if (inserted[0]) {
          await tx.insert(goalRefreshReceipts).values({
            sourceEventId:
              input.evaluation.sourceEventId ?? input.evaluation.idempotencyKey,
            periodId: input.evaluation.periodId,
            organizationId: input.evaluation.organizationId,
            propertyId: input.evaluation.propertyId,
            evaluationId: input.evaluation.id,
          })
          await tx
            .update(goalPeriods)
            .set({
              evaluationWatermark: input.evaluation.evaluationWatermark,
              ...(input.closePeriod
                ? {
                    status: 'closed',
                    statusReason: input.evaluation.reason,
                    closedAt: input.evaluation.createdAt,
                  }
                : {}),
              updatedAt: input.evaluation.createdAt,
            })
            .where(
              and(
                eq(goalPeriods.organizationId, input.evaluation.organizationId),
                eq(goalPeriods.propertyId, input.evaluation.propertyId),
                eq(goalPeriods.id, input.evaluation.periodId),
              ),
            )
          await tx.insert(auditLogs).values({
            organizationId: input.evaluation.organizationId,
            userId: input.evaluation.createdBy,
            action: input.auditAction,
            resourceType: 'goal_period',
            resourceId: input.evaluation.periodId,
            details: {
              evaluationId: input.evaluation.id,
              state: input.evaluation.state,
              supersedesEvaluationId: input.evaluation.supersedesEvaluationId,
            },
          })
          await tx.insert(outboxEvents).values({
            id: input.outboxEventId,
            eventType: input.closePeriod
              ? 'goal.period.closed'
              : input.evaluation.supersedesEvaluationId
                ? 'goal.evaluation.corrected'
                : 'goal.period.evaluated',
            eventVersion: 1,
            organizationId: input.evaluation.organizationId,
            propertyId: input.evaluation.propertyId,
            sourceContext: 'goal',
            sourceAggregateId: input.evaluation.definitionId,
            payload: {
              definitionId: input.evaluation.definitionId,
              definitionVersionId: input.evaluation.definitionVersionId,
              periodId: input.evaluation.periodId,
              evaluationId: input.evaluation.id,
              state: input.evaluation.state,
              achieved: input.evaluation.achieved,
            },
          })
        }
        return mapEvaluation(existing)
      })
    },

    async appendTimezoneVersion(input) {
      return db.transaction(async (tx) => {
        const [receipt] = await tx
          .select({ sourceEventId: goalTimezoneEventReceipts.sourceEventId })
          .from(goalTimezoneEventReceipts)
          .where(
            and(
              eq(goalTimezoneEventReceipts.sourceEventId, input.sourceEventId),
              eq(goalTimezoneEventReceipts.definitionId, input.version.definitionId),
            ),
          )
          .limit(1)
        if (receipt) return 'duplicate' as const

        await tx.insert(goalDefinitionVersions).values(versionValues(input.version))
        await tx.insert(goalPeriods).values(periodValues(input.period))
        await tx
          .update(goalDefinitions)
          .set({
            currentVersion: input.version.version,
            updatedAt: input.version.createdAt,
          })
          .where(
            and(
              eq(goalDefinitions.organizationId, input.version.organizationId),
              eq(goalDefinitions.propertyId, input.version.propertyId),
              eq(goalDefinitions.id, input.version.definitionId),
              eq(goalDefinitions.currentVersion, input.previousVersion.version),
              eq(goalDefinitions.status, 'active'),
            ),
          )
        await tx.insert(goalTimezoneEventReceipts).values({
          sourceEventId: input.sourceEventId,
          definitionId: input.version.definitionId,
          organizationId: input.version.organizationId,
          propertyId: input.version.propertyId,
          propertyVersion: input.propertyVersion,
          newDefinitionVersionId: input.version.id,
          newPeriodId: input.period.id,
        })
        await tx.insert(auditLogs).values({
          organizationId: input.version.organizationId,
          userId: 'system',
          action: input.auditAction,
          resourceType: 'goal_definition',
          resourceId: input.version.definitionId,
          details: {
            sourceEventId: input.sourceEventId,
            propertyVersion: input.propertyVersion,
            definitionVersionId: input.version.id,
            periodId: input.period.id,
          },
        })
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType: 'goal.timezone_version.scheduled',
          eventVersion: 1,
          organizationId: input.version.organizationId,
          propertyId: input.version.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: input.version.definitionId,
          payload: {
            definitionId: input.version.definitionId,
            definitionVersionId: input.version.id,
            periodId: input.period.id,
            sourceEventId: input.sourceEventId,
          },
        })
        return 'applied' as const
      })
    },

    async enumerateActiveScopes() {
      return db
        .select({
          organizationId: goalDefinitions.organizationId,
          propertyId: goalDefinitions.propertyId,
          definitionId: goalDefinitions.id,
        })
        .from(goalDefinitions)
        .where(eq(goalDefinitions.status, 'active'))
    },

    async enumerateActiveScopesForProperty(organizationId, propertyId) {
      return db
        .select({
          organizationId: goalDefinitions.organizationId,
          propertyId: goalDefinitions.propertyId,
          definitionId: goalDefinitions.id,
        })
        .from(goalDefinitions)
        .where(
          and(
            eq(goalDefinitions.organizationId, organizationId),
            eq(goalDefinitions.propertyId, propertyId),
            eq(goalDefinitions.status, 'active'),
          ),
        )
    },

    async enumerateDueScopes(now) {
      return db
        .selectDistinct({
          organizationId: goalPeriods.organizationId,
          propertyId: goalPeriods.propertyId,
          definitionId: goalPeriods.definitionId,
        })
        .from(goalPeriods)
        .innerJoin(
          goalDefinitions,
          and(
            eq(goalDefinitions.organizationId, goalPeriods.organizationId),
            eq(goalDefinitions.propertyId, goalPeriods.propertyId),
            eq(goalDefinitions.id, goalPeriods.definitionId),
          ),
        )
        .where(
          and(
            eq(goalDefinitions.status, 'active'),
            inArray(goalPeriods.status, ['scheduled', 'open']),
            lte(goalPeriods.periodEnd, now),
          ),
        )
    },

    async listOpenPeriods(organizationId, propertyId, definitionId, at) {
      const rows = await db
        .select()
        .from(goalPeriods)
        .where(
          and(
            eq(goalPeriods.organizationId, organizationId),
            eq(goalPeriods.propertyId, propertyId),
            eq(goalPeriods.definitionId, definitionId),
            inArray(goalPeriods.status, ['scheduled', 'open']),
            gt(goalPeriods.periodEnd, at),
          ),
        )
        .orderBy(asc(goalPeriods.periodStart))
      return rows.map(mapPeriod)
    },
  }
}

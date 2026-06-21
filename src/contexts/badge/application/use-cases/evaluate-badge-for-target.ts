// Badge context — evaluate badge for a target

import {
  badgeId,
  type PortalId,
  type PortalGroupId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import { badgeAwarded } from '../../domain/events'
import { dayKeyInTimezone, periodToRange } from '../../application/utils'
import type { BadgeRepository } from '../ports/badge.repository'
import type {
  BadgeAward,
  BadgeDefinition,
  BadgeEvaluationResult,
  BadgeEvaluationTarget,
} from '../../domain/types'

export type EvaluateBadgeForTargetDeps = Readonly<{
  badgeRepo: BadgeRepository
  metricApi: MetricPublicApi
  events: EventBus
  clock: () => Date
}>

export type EvaluateBadgeForTargetInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  targetType: 'portal' | 'portal_group'
  targetId: PortalId | PortalGroupId
}>

export const evaluateBadgeForTarget =
  (deps: EvaluateBadgeForTargetDeps) =>
  async (
    input: EvaluateBadgeForTargetInput,
  ): Promise<ReadonlyArray<BadgeEvaluationResult>> => {
    const target: BadgeEvaluationTarget =
      input.targetType === 'portal'
        ? {
            organizationId: input.organizationId,
            targetType: 'portal',
            portalId: input.targetId as PortalId,
            propertyId: input.propertyId,
          }
        : {
            organizationId: input.organizationId,
            targetType: 'portal_group',
            portalGroupId: input.targetId as PortalGroupId,
            propertyId: input.propertyId,
          }

    const definitions = await deps.badgeRepo.listEnabledDefinitionsForOrg(
      target.organizationId,
    )

    const results: BadgeEvaluationResult[] = []
    for (const definition of definitions) {
      results.push(await evaluateBadgeDefinitionForTarget(definition, target, deps))
    }

    return results
  }

export async function evaluateBadgeDefinitionForTarget(
  definition: BadgeDefinition,
  target: BadgeEvaluationTarget,
  deps: EvaluateBadgeForTargetDeps,
): Promise<BadgeEvaluationResult> {
  if (!definition.enabled) {
    return { awarded: false, reason: 'disabled', definition }
  }

  const timezone = await deps.badgeRepo.findPropertyTimezone(
    target.organizationId,
    target.propertyId,
  )
  const targetId = target.targetType === 'portal' ? target.portalId : target.portalGroupId
  const uniqueKey = `${definition.key}:${definition.criteriaVersion}:${target.targetType}:${targetId}`
  const existing = await deps.badgeRepo.findAwardByUniqueKey(uniqueKey)
  if (existing) {
    return { awarded: false, reason: 'already_awarded', definition }
  }

  const met = await criteriaMet(definition, target, deps, timezone)
  if (!met) {
    return { awarded: false, reason: 'criteria_not_met', definition }
  }

  const now = deps.clock()
  let portalId: PortalId | null = null
  let portalGroupId: PortalGroupId | null = null
  if (target.targetType === 'portal') {
    portalId = target.portalId
  } else {
    portalGroupId = target.portalGroupId
  }
  const award: BadgeAward = {
    id: badgeId(crypto.randomUUID()),
    badgeDefinitionId: definition.id,
    criteriaVersion: definition.criteriaVersion,
    targetType: target.targetType,
    targetId,
    organizationId: target.organizationId,
    propertyId: target.propertyId,
    portalId,
    portalGroupId,
    awardedAt: now,
    uniqueKey,
    createdAt: now,
  }

  const inserted = await deps.badgeRepo.insertAward(award)
  await deps.events.emit(badgeAwarded({ occurredAt: deps.clock(), ...inserted }))

  return { awarded: true, award: inserted, definition }
}

async function criteriaMet(
  definition: BadgeDefinition,
  target: BadgeEvaluationTarget,
  deps: EvaluateBadgeForTargetDeps,
  timezone: string,
): Promise<boolean> {
  const criteria = definition.criteria
  if (criteria.type === 'streak') {
    return streakMet(criteria, target, deps, timezone)
  }

  const range = periodToRange(criteria.period, deps.clock())
  const aggregate = await deps.metricApi.queryAggregate({
    organizationId: target.organizationId,
    propertyId: target.propertyId,
    portalId: target.targetType === 'portal' ? (target.portalId ?? null) : null,
    groupId: target.targetType === 'portal_group' ? (target.portalGroupId ?? null) : null,
    metricKey: criteria.metricKey,
    periodStart: range.start,
    periodEnd: range.end,
    rollingWindowDays:
      range.period === 'last_7_days'
        ? 7
        : range.period === 'last_30_days'
          ? 30
          : range.period === 'last_90_days'
            ? 90
            : undefined,
  })

  const raw =
    criteria.aggregation === 'count'
      ? aggregate.count
      : criteria.aggregation === 'avg'
        ? aggregate.count > 0
          ? aggregate.sum / aggregate.count
          : 0
        : criteria.aggregation === 'max'
          ? aggregate.max
          : aggregate.sum

  return criteria.operator === '>='
    ? raw >= criteria.threshold
    : raw <= criteria.threshold
}

async function streakMet(
  criteria: NonNullable<BadgeDefinition['criteria']>,
  target: BadgeEvaluationTarget,
  deps: EvaluateBadgeForTargetDeps,
  timezone: string,
): Promise<boolean> {
  const days = criteria.streakDays ?? 1
  const dailyThreshold = criteria.dailyThreshold ?? criteria.threshold
  const counts = await deps.badgeRepo.queryDailyCounts({
    organizationId: target.organizationId,
    propertyId: target.propertyId,
    targetType: target.targetType,
    portalId: target.targetType === 'portal' ? target.portalId : undefined,
    portalGroupId:
      target.targetType === 'portal_group' ? target.portalGroupId : undefined,
    metricKey: criteria.metricKey,
    timezone,
    days,
  })

  let consecutive = 0
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(deps.clock())
    date.setUTCHours(0, 0, 0, 0)
    date.setUTCDate(date.getUTCDate() - offset)
    const key = dayKeyInTimezone(date, timezone)
    if ((counts.get(key) ?? 0) >= dailyThreshold) {
      consecutive += 1
    } else {
      break
    }
  }

  return consecutive >= days
}

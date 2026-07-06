// Badge context — Drizzle row mapper

import { assertLiteral } from '#/shared/domain/assert'
import type {
  BadgeDefinition,
  BadgeAward,
  BadgeAwardWithTarget,
  OrganizationBadgeEnablement,
  BadgeCriteria,
} from '../../domain/types'
import {
  badgeId,
  organizationBadgeEnablementId,
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import {
  badgeDefinitions,
  badgeAwards,
  organizationBadgeEnablements,
} from '#/shared/db/schema/badge.schema'
import { z } from 'zod/v4'
import { METRIC_KEYS } from '#/shared/domain/metric-keys'

const VALID_TARGET_SCOPES: readonly string[] = ['portal', 'portal_group']

// The `criteriaJson` column is typed `jsonb.$type<Record<string, unknown>>`
// (badge.schema.ts); narrow it at the mapper boundary instead of bare-`as`
// casting so a stale/malformed row fails loudly rather than becoming an
// invalid BadgeCriteria.
const badgeCriteriaSchema = z.object({
  type: z.enum(['threshold', 'streak', 'milestone']),
  metricKey: z.enum([...METRIC_KEYS] as [string, ...string[]]),
  operator: z.enum(['>=', '<=']),
  threshold: z.number(),
  aggregation: z.enum(['sum', 'count', 'avg', 'max']).optional(),
  period: z
    .enum([
      'today',
      'this_week',
      'this_month',
      'this_quarter',
      'all_time',
      'last_7_days',
      'last_30_days',
      'last_90_days',
    ])
    .optional(),
  streakDays: z.number().int().positive().optional(),
  dailyThreshold: z.number().optional(),
})

function parseBadgeCriteria(raw: unknown): BadgeCriteria {
  const parsed = badgeCriteriaSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid badge.criteriaJson: ${parsed.error.message}`)
  }
  return parsed.data as BadgeCriteria
}

function targetScopeFromRow(value: string): BadgeDefinition['targetScope'] {
  return assertLiteral(
    value,
    VALID_TARGET_SCOPES,
    'badge.targetScope',
  ) as BadgeDefinition['targetScope']
}

export function badgeDefinitionFromRow(
  row: typeof badgeDefinitions.$inferSelect,
): BadgeDefinition {
  return {
    id: badgeId(row.id),
    key: row.key,
    name: row.name,
    description: row.description,
    icon: row.icon,
    targetScope: targetScopeFromRow(row.targetScope),
    criteriaVersion: row.criteriaVersion,
    criteria: parseBadgeCriteria(row.criteriaJson),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function organizationBadgeEnablementFromRow(
  row: typeof organizationBadgeEnablements.$inferSelect,
): OrganizationBadgeEnablement {
  return {
    id: organizationBadgeEnablementId(row.id),
    organizationId: organizationId(row.organizationId),
    badgeDefinitionId: badgeId(row.badgeDefinitionId),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function badgeAwardFromRow(row: typeof badgeAwards.$inferSelect): BadgeAward {
  return {
    id: badgeId(row.id),
    badgeDefinitionId: badgeId(row.badgeDefinitionId),
    criteriaVersion: row.criteriaVersion,
    targetType: assertLiteral(
      row.targetType,
      VALID_TARGET_SCOPES,
      'badge.targetType',
    ) as BadgeAward['targetType'],
    targetId:
      row.targetType === 'portal' ? portalId(row.targetId) : portalGroupId(row.targetId),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    portalId: row.portalId ? portalId(row.portalId) : null,
    portalGroupId: row.portalGroupId ? portalGroupId(row.portalGroupId) : null,
    awardedAt: row.awardedAt,
    uniqueKey: row.uniqueKey,
    createdAt: row.createdAt,
  }
}

type AwardWithDefinitionRow = {
  award: typeof badgeAwards.$inferSelect
  definitionKey: string
  definitionName: string
  definitionIcon: string
  definitionDescription: string | null
  definitionCriteria: Record<string, unknown>
  definitionTargetScope: string
  definitionCriteriaVersion: number
  definitionEnabled: boolean
  definitionCreatedAt: Date
  definitionUpdatedAt: Date
  targetLabel: string | null
}

export function badgeAwardWithTargetFromRow(
  row: AwardWithDefinitionRow,
): BadgeAwardWithTarget {
  return {
    award: badgeAwardFromRow(row.award),
    definition: {
      id: badgeId(row.award.badgeDefinitionId),
      key: row.definitionKey,
      name: row.definitionName,
      description: row.definitionDescription,
      icon: row.definitionIcon,
      targetScope: targetScopeFromRow(row.definitionTargetScope),
      criteriaVersion: row.definitionCriteriaVersion,
      criteria: parseBadgeCriteria(row.definitionCriteria),
      enabled: row.definitionEnabled,
      createdAt: row.definitionCreatedAt,
      updatedAt: row.definitionUpdatedAt,
    },
    targetType: assertLiteral(
      row.award.targetType,
      VALID_TARGET_SCOPES,
      'badge.award.targetType',
    ) as BadgeAward['targetType'],
    targetId:
      row.award.targetType === 'portal'
        ? portalId(row.award.targetId)
        : portalGroupId(row.award.targetId),
    label: row.targetLabel ?? '',
  }
}

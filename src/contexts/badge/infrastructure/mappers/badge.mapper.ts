// Badge context — Drizzle row mapper

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

export function badgeDefinitionFromRow(
  row: typeof badgeDefinitions.$inferSelect,
): BadgeDefinition {
  return {
    id: badgeId(row.id),
    key: row.key,
    name: row.name,
    description: row.description,
    icon: row.icon,
    targetScope: row.targetScope as BadgeDefinition['targetScope'],
    criteriaVersion: row.criteriaVersion,
    criteria: row.criteriaJson as BadgeCriteria,
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
    targetType: row.targetType as BadgeAward['targetType'],
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
      targetScope: row.definitionTargetScope as BadgeDefinition['targetScope'],
      criteriaVersion: row.definitionCriteriaVersion,
      criteria: row.definitionCriteria as BadgeCriteria,
      enabled: row.definitionEnabled,
      createdAt: row.definitionCreatedAt,
      updatedAt: row.definitionUpdatedAt,
    },
    targetType: row.award.targetType as BadgeAward['targetType'],
    targetId:
      row.award.targetType === 'portal'
        ? portalId(row.award.targetId)
        : portalGroupId(row.award.targetId),
    label: row.targetLabel ?? '',
  }
}

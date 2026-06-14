// Badge context — domain types
// Per architecture: domain types use Readonly<> on every field.

import type {
  BadgeId,
  OrganizationBadgeEnablementId,
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type { MetricKey } from '#/shared/domain/metric-keys'

export type BadgeTargetScope = 'portal' | 'portal_group'
export type BadgeTargetType = BadgeTargetScope

export type BadgeCriteriaType = 'threshold' | 'streak' | 'milestone'
export type BadgeCriteriaOperator = '>=' | '<='
export type BadgeAggregation = 'sum' | 'count' | 'avg' | 'max'
export type BadgePeriodPreset =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_quarter'
  | 'all_time'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'

export type BadgeCriteria = Readonly<{
  type: BadgeCriteriaType
  metricKey: MetricKey
  operator: BadgeCriteriaOperator
  threshold: number
  aggregation?: BadgeAggregation
  period?: BadgePeriodPreset
  streakDays?: number
  dailyThreshold?: number
}>

export type BadgeDefinition = Readonly<{
  id: BadgeId
  key: string
  name: string
  description: string | null
  icon: string
  targetScope: BadgeTargetScope
  criteriaVersion: number
  criteria: BadgeCriteria
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}>

export type OrganizationBadgeEnablement = Readonly<{
  id: OrganizationBadgeEnablementId
  organizationId: OrganizationId
  badgeDefinitionId: BadgeId
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}>

export type BadgeAward = Readonly<{
  id: BadgeId
  badgeDefinitionId: BadgeId
  criteriaVersion: number
  targetType: BadgeTargetType
  targetId: PortalId | PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  portalGroupId: PortalGroupId | null
  awardedAt: Date
  uniqueKey: string
  createdAt: Date
}>

export type BadgeTargetLabel = Readonly<{
  targetType: BadgeTargetType
  targetId: PortalId | PortalGroupId
  label: string
}>

export type BadgeAwardWithDefinition = Readonly<{
  award: BadgeAward
  definition: BadgeDefinition
}>

export type BadgeAwardWithTarget = BadgeAwardWithDefinition & BadgeTargetLabel

export type BadgeEvaluationTarget =
  | Readonly<{
      organizationId: OrganizationId
      targetType: 'portal'
      portalId: PortalId
      propertyId: PropertyId
    }>
  | Readonly<{
      organizationId: OrganizationId
      targetType: 'portal_group'
      portalGroupId: PortalGroupId
      propertyId: PropertyId
    }>

export type BadgeEvaluationResult =
  | Readonly<{ awarded: true; award: BadgeAward; definition: BadgeDefinition }>
  | Readonly<{
      awarded: false
      reason:
        | 'already_awarded'
        | 'criteria_not_met'
        | 'disabled'
        | 'invalid_target'
        | 'skipped'
      award?: undefined
      definition?: BadgeDefinition
    }>

export type StaffBadgeVisibilityFilter = Readonly<{
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  limit?: number
}>

export type TargetBadgeVisibilityFilter = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  targetType: BadgeTargetType
  targetId: PortalId | PortalGroupId
}>

export type BadgeSeedDefinitionInput = Readonly<{
  key: string
  name: string
  description: string
  icon: string
  targetScope: BadgeTargetScope
  criteriaVersion?: number
  criteria: BadgeCriteria
  enabled?: boolean
}>

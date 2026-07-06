// Badge context — repository port

import type {
  BadgeAward,
  BadgeAwardWithTarget,
  BadgeDefinition,
  BadgeDefinitionWithOrgEnablement,
  BadgeEvaluationTarget,
  BadgeSeedDefinitionInput,
  OrganizationBadgeEnablement,
  StaffBadgeVisibilityFilter,
  TargetBadgeVisibilityFilter,
} from '../../domain/types'
import type {
  BadgeId,
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { MetricKey } from '#/shared/domain/metric-keys'

export type BadgeRepository = Readonly<{
  seedDefinitions: (
    definitions: readonly BadgeSeedDefinitionInput[],
  ) => Promise<ReadonlyArray<BadgeDefinition>>
  findDefinitionByKey: (key: string) => Promise<BadgeDefinition | null>
  listEnabledDefinitionsForOrg: (
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<BadgeDefinition>>
  listDefinitionsWithEnablement: (
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<BadgeDefinitionWithOrgEnablement>>
  findDefinition: (orgId: OrganizationId, id: BadgeId) => Promise<BadgeDefinition | null>
  listOrgIdsWithBadges: () => Promise<ReadonlyArray<OrganizationId>>
  setOrganizationEnablement: (
    orgId: OrganizationId,
    badgeDefinitionId: BadgeId,
    enabled: boolean,
  ) => Promise<OrganizationBadgeEnablement>
  isOrgDefinitionEnabled: (
    orgId: OrganizationId,
    badgeDefinitionId: BadgeId,
  ) => Promise<boolean>
  findAwardByUniqueKey: (uniqueKey: string) => Promise<BadgeAward | null>
  insertAward: (input: BadgeAward) => Promise<BadgeAward>
  listTargetAwards: (
    input: TargetBadgeVisibilityFilter,
  ) => Promise<ReadonlyArray<BadgeAwardWithTarget>>
  listStaffAwards: (
    input: StaffBadgeVisibilityFilter,
  ) => Promise<ReadonlyArray<BadgeAwardWithTarget>>
  /** Resolves the targets a staff/PM user may view badges for within a property.
   *  `hasPropertyAssignment` covers property-level access (PropertyManager);
   *  `portalIds`/`groupIds` cover assigned portals + their groups (Staff). */
  resolveStaffVisibility: (input: StaffBadgeVisibilityFilter) => Promise<{
    hasPropertyAssignment: boolean
    portalIds: ReadonlyArray<PortalId>
    groupIds: ReadonlyArray<PortalGroupId>
  }>
  listPropertiesForOrg: (orgId: OrganizationId) => Promise<ReadonlyArray<PropertyId>>
  listPortalTargets: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<PortalId>>
  listGroupTargets: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<PortalGroupId>>
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<{ portalGroupId: PortalGroupId; propertyId: PropertyId } | null>
  findPropertyTimezone: (orgId: OrganizationId, propertyId: PropertyId) => Promise<string>
  queryDailyCounts: (input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    targetType: BadgeEvaluationTarget['targetType']
    portalId?: PortalId
    portalGroupId?: PortalGroupId
    metricKey: MetricKey
    timezone: string
    days: number
  }) => Promise<ReadonlyMap<string, number>>
}>

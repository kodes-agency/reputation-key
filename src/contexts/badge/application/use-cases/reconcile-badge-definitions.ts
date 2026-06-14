// Badge context — reconcile badge definitions

import type { BadgeRepository } from '../ports/badge.repository'
import {
  evaluateBadgeDefinitionForTarget,
  type EvaluateBadgeForTargetDeps,
} from './evaluate-badge-for-target'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type ReconcileBadgeDefinitionsDeps = EvaluateBadgeForTargetDeps & {
  badgeRepo: BadgeRepository
}

export type ReconcileBadgeDefinitionsInput = Readonly<{
  organizationId?: OrganizationId
  propertyId?: PropertyId
}>

export type ReconcileBadgeDefinitionsResult = Readonly<{
  evaluated: number
  awarded: number
}>

export const reconcileBadgeDefinitions =
  (deps: ReconcileBadgeDefinitionsDeps) =>
  async (
    input: ReconcileBadgeDefinitionsInput,
  ): Promise<ReconcileBadgeDefinitionsResult> => {
    const orgIds = input.organizationId
      ? [input.organizationId]
      : await deps.badgeRepo.listOrgIdsWithBadges()

    let evaluated = 0
    let awarded = 0

    for (const organizationId of orgIds) {
      const definitions =
        await deps.badgeRepo.listEnabledDefinitionsForOrg(organizationId)
      const propertyIds = input.propertyId
        ? [input.propertyId]
        : await deps.badgeRepo.listPropertiesForOrg(organizationId)
      for (const propertyId of propertyIds) {
        const portalTargets = await deps.badgeRepo.listPortalTargets(
          organizationId,
          propertyId,
        )
        const groupTargets = await deps.badgeRepo.listGroupTargets(
          organizationId,
          propertyId,
        )

        for (const portalId of portalTargets) {
          for (const definition of definitions) {
            evaluated += 1
            const result = await evaluateBadgeDefinitionForTarget(
              definition,
              { organizationId, propertyId, targetType: 'portal', portalId },
              deps,
            )
            if (result.awarded) {
              awarded += 1
            }
          }
        }

        for (const portalGroupId of groupTargets) {
          for (const definition of definitions) {
            evaluated += 1
            const result = await evaluateBadgeDefinitionForTarget(
              definition,
              { organizationId, propertyId, targetType: 'portal_group', portalGroupId },
              deps,
            )
            if (result.awarded) {
              awarded += 1
            }
          }
        }
      }
    }

    return { evaluated, awarded }
  }

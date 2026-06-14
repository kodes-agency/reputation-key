// Badge context — set organization badge enablement use case

import type { BadgeRepository } from '../ports/badge.repository'
import type { OrganizationBadgeEnablement } from '../../domain/types'
import type { BadgeId, OrganizationId } from '#/shared/domain/ids'

export type SetOrganizationBadgeEnablementDeps = Readonly<{
  badgeRepo: BadgeRepository
}>

export type SetOrganizationBadgeEnablementInput = Readonly<{
  organizationId: OrganizationId
  badgeDefinitionId: BadgeId
  enabled: boolean
}>

export const setOrganizationBadgeEnablement =
  (deps: SetOrganizationBadgeEnablementDeps) =>
  async (
    input: SetOrganizationBadgeEnablementInput,
  ): Promise<OrganizationBadgeEnablement> => {
    return deps.badgeRepo.setOrganizationEnablement(
      input.organizationId,
      input.badgeDefinitionId,
      input.enabled,
    )
  }

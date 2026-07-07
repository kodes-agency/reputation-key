// Badge context — set organization badge enablement use case

import type { BadgeRepository } from '../ports/badge.repository'
import type { OrganizationBadgeEnablement } from '../../domain/types'
import type { BadgeId, OrganizationId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { badgeError } from '../../domain/errors'

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
    ctx: AuthContext,
  ): Promise<OrganizationBadgeEnablement> => {
    // Primary authorization gate (contexts CONTEXT.md). The server fn keeps a
    // defense-in-depth can() check, but the use case is the authoritative gate.
    if (!canForContext(ctx, 'badge.manage')) {
      throw badgeError('forbidden', 'Insufficient permissions to manage badges')
    }
    return deps.badgeRepo.setOrganizationEnablement(
      input.organizationId,
      input.badgeDefinitionId,
      input.enabled,
    )
  }

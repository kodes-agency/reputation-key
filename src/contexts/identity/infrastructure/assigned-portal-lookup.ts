import {
  portalId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import type { StaffParticipationRepository } from '../application/ports/staff-participation.repository'

/** The Portals a user is the primary responsible for, through their personal Portal. */
export const createAssignedPortalLookup =
  (
    participations: Pick<
      StaffParticipationRepository,
      'findActiveByUser' | 'listActiveResponsibilities'
    >,
  ) =>
  async (organizationId: OrganizationId, userId: UserId, propertyId: PropertyId) => {
    const active = await participations.findActiveByUser(
      organizationId,
      propertyId,
      userId,
    )
    if (!active?.personalPortalId) return []
    const responsibilities = await participations.listActiveResponsibilities(
      organizationId,
      active.id,
    )
    return responsibilities
      .filter(
        (responsibility) =>
          responsibility.kind === 'primary' &&
          responsibility.portalId === active.personalPortalId,
      )
      .map((responsibility) => portalId(responsibility.portalId))
  }

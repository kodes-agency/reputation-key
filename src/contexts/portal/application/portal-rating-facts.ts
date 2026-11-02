import {
  portalId,
  portalGroupId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { Portal } from '../domain/types'
import type { PortalRepository } from './ports/portal.repository'
import type { PortalGroupRepository } from './ports/portal-group.repository'

export type PortalRatingSubject =
  | Readonly<{ kind: 'property'; propertyId: string }>
  | Readonly<{ kind: 'portal'; portalId: string }>
  | Readonly<{ kind: 'portal_group'; portalGroupId: string }>

export type PortalRatingFact = Readonly<{
  kind?: 'personal'
  portalId: string
  portalGroupId: string | null
  publicationState: Exclude<Portal['publicationState'], 'archived'>
  skipPrivateRating: boolean
}>

type Deps = Readonly<{
  portalRepo: Pick<PortalRepository, 'findById' | 'listByProperty'>
  portalGroupRepo: Pick<PortalGroupRepository, 'findById' | 'getGroupPortalIds'>
}>

/** Current working-copy eligibility, scoped to the subject; no readiness cap or history read. */
export const createPortalRatingFacts = (deps: Deps) => ({
  listPortalRatingFacts: async (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    subject: PortalRatingSubject,
  ): Promise<readonly PortalRatingFact[]> => {
    const read = async (): Promise<readonly (Portal | null)[]> => {
      if (subject.kind === 'portal') {
        return [
          await deps.portalRepo.findById(organizationId, portalId(subject.portalId)),
        ]
      }
      if (subject.kind === 'property') {
        return subject.propertyId === propertyId
          ? deps.portalRepo.listByProperty(organizationId, propertyId)
          : []
      }
      const group = await deps.portalGroupRepo.findById(
        organizationId,
        portalGroupId(subject.portalGroupId),
      )
      if (group?.propertyId !== propertyId || group.deletedAt !== null) return []
      const ids = await deps.portalGroupRepo.getGroupPortalIds(organizationId, group.id)
      return Promise.all(ids.map((id) => deps.portalRepo.findById(organizationId, id)))
    }
    return (await read()).flatMap((portal) =>
      !portal ||
      portal.propertyId !== propertyId ||
      portal.publicationState === 'archived'
        ? []
        : [
            {
              ...(portal.kind === 'personal' ? { kind: 'personal' as const } : {}),
              portalId: portal.id,
              portalGroupId:
                subject.kind === 'portal_group' ? subject.portalGroupId : null,
              publicationState: portal.publicationState,
              skipPrivateRating: portal.skipPrivateRating,
            },
          ],
    )
  },
})

import { staffTargetProblem } from '../domain/staff-target-eligibility'
import { ratingSubjectSkipsPrivateRating } from './goal-rating-eligibility.server'
import type { PropertyFactsPublicApi } from '#/contexts/property/public-api'
import type { PortalGroupPublicApi, PortalPublicApi } from '#/contexts/portal/public-api'
import {
  organizationId as toOrganizationId,
  portalGroupId as toPortalGroupId,
  portalId as toPortalId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type { GoalSubjectNameReader } from './goal-bulk-create.server'
import type { GoalProgramSubjectReader } from '../application/use-cases/goal-program-shared'

/** Cross-context, tenant-bound subject validation for canonical Goal Programs. */
export const createGoalProgramSubjectReader = (
  propertyApi: PropertyFactsPublicApi,
  portalApi: PortalPublicApi,
  portalGroupApi: PortalGroupPublicApi,
  staffScanTargetsEnabled = false,
): GoalProgramSubjectReader & GoalSubjectNameReader => {
  /** The Portal when it is a current Portal of the Property; archived ones are not. */
  const currentPortal = async (
    organizationId: string,
    propertyId: string,
    portalId: string,
  ) => {
    const brandedPortalId = toPortalId(portalId)
    const [context, portal] = await Promise.all([
      portalApi.resolvePortalContext(brandedPortalId),
      portalApi.getPortalInfo(toOrganizationId(organizationId), brandedPortalId),
    ])
    return context?.organizationId === organizationId &&
      context.propertyId === propertyId &&
      portal !== null &&
      portal.publicationState !== 'archived'
      ? portal
      : null
  }

  return {
    ratingSubjectsSkipPrivateRating: async (organizationId, propertyId, subjects) => {
      const results = await Promise.all(
        subjects.map(async (subject) => {
          if (subject.kind === 'property') return false
          const facts = await portalApi.listPortalRatingFacts(
            toOrganizationId(organizationId),
            toPropertyId(propertyId),
            subject,
          )
          return ratingSubjectSkipsPrivateRating(facts, subject)
        }),
      )
      return results.some(Boolean)
    },
    staffTargetProblem: async (organizationId, propertyId, subject, metric) => {
      if (subject.kind === 'property') return null
      const ids =
        subject.kind === 'portal'
          ? [subject.portalId]
          : await portalGroupApi.getGroupPortalIds(
              toOrganizationId(organizationId),
              toPortalGroupId(subject.portalGroupId),
            )
      const portals = await Promise.all(
        ids.map((id) => currentPortal(organizationId, propertyId, id)),
      )
      return staffTargetProblem(
        portals.flatMap((portal) => (portal ? [portal] : [])),
        metric,
        staffScanTargetsEnabled,
      )
    },
    getTimezone: (organizationId, propertyId) =>
      propertyApi.getPropertyTimezone(
        toOrganizationId(organizationId),
        toPropertyId(propertyId),
      ),
    subjectBelongsToProperty: async (organizationId, propertyId, subject) => {
      if (subject.kind === 'property') return subject.propertyId === propertyId
      if (subject.kind === 'portal_group') {
        const group = await portalGroupApi.getGroupInfo(
          toOrganizationId(organizationId),
          toPortalGroupId(subject.portalGroupId),
        )
        return group?.propertyId === propertyId
      }
      return (await currentPortal(organizationId, propertyId, subject.portalId)) !== null
    },
    getSubjectName: async (organizationId, propertyId, subject) => {
      if (subject.kind === 'portal') {
        const portal = await currentPortal(organizationId, propertyId, subject.portalId)
        return portal?.name ?? null
      }
      const group = await portalGroupApi.getGroupInfo(
        toOrganizationId(organizationId),
        toPortalGroupId(subject.portalGroupId),
      )
      return group?.propertyId === propertyId ? group.name : null
    },
  }
}

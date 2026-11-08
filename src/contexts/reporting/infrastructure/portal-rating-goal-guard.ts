import { and, eq, gt, isNull, ne, or } from 'drizzle-orm'
import {
  goalPrograms,
  goalProgramVersions,
  goalSubjectAssignments,
  portalGroupMemberships,
  portalGroups,
  portals,
} from '#/shared/db/schema'
import type { PortalRatingGoalReadApi } from '../application/public-api'
import { findPortalRatingGoalBlock } from '../application/running-portal-rating-goal'
import { mapAssignment, mapProgram, mapVersion } from './repositories/goal-program.rows'

/** Reads the committed goal and collector set in the Portal command's transaction. */
export const createPortalRatingGoalGuard = (): Pick<
  PortalRatingGoalReadApi,
  'findPortalRatingGoalBlockInTransaction'
> => ({
  async findPortalRatingGoalBlockInTransaction(tx, input) {
    const { organizationId, propertyId, portalId, at } = input
    const rows = await tx
      .select({
        program: goalPrograms,
        version: goalProgramVersions,
        assignment: goalSubjectAssignments,
      })
      .from(goalPrograms)
      .innerJoin(
        goalSubjectAssignments,
        and(
          eq(goalSubjectAssignments.organizationId, goalPrograms.organizationId),
          eq(goalSubjectAssignments.propertyId, goalPrograms.propertyId),
          eq(goalSubjectAssignments.programId, goalPrograms.id),
        ),
      )
      .innerJoin(
        goalProgramVersions,
        and(
          eq(goalProgramVersions.organizationId, goalPrograms.organizationId),
          eq(goalProgramVersions.propertyId, goalPrograms.propertyId),
          eq(goalProgramVersions.programId, goalPrograms.id),
          eq(goalProgramVersions.id, goalSubjectAssignments.programVersionId),
        ),
      )
      .where(
        and(
          eq(goalPrograms.organizationId, organizationId),
          eq(goalPrograms.propertyId, propertyId),
          ne(goalPrograms.status, 'ended'),
          or(
            isNull(goalSubjectAssignments.effectiveTo),
            gt(goalSubjectAssignments.effectiveTo, at),
          ),
          or(
            isNull(goalProgramVersions.effectiveTo),
            gt(goalProgramVersions.effectiveTo, at),
          ),
        ),
      )
    const programs = rows.map(({ program, version, assignment }) => ({
      program: mapProgram(program),
      versions: [mapVersion(version)],
      assignments: [mapAssignment(assignment)],
    }))
    return findPortalRatingGoalBlock(
      programs,
      portalId,
      at,
      async (subject) => {
        const scope = and(
          eq(portals.organizationId, organizationId),
          eq(portals.propertyId, propertyId),
          isNull(portals.deletedAt),
          ne(portals.publicationState, 'archived'),
        )
        const facts =
          subject.kind === 'portal_group'
            ? await tx
                .select({ portal: portals })
                .from(portals)
                .innerJoin(
                  portalGroupMemberships,
                  and(
                    eq(portalGroupMemberships.organizationId, portals.organizationId),
                    eq(portalGroupMemberships.propertyId, portals.propertyId),
                    eq(portalGroupMemberships.portalId, portals.id),
                    eq(portalGroupMemberships.portalGroupId, subject.portalGroupId),
                    isNull(portalGroupMemberships.effectiveTo),
                  ),
                )
                .innerJoin(
                  portalGroups,
                  and(
                    eq(portalGroups.organizationId, portals.organizationId),
                    eq(portalGroups.propertyId, portals.propertyId),
                    eq(portalGroups.id, portalGroupMemberships.portalGroupId),
                    isNull(portalGroups.deletedAt),
                  ),
                )
                .where(scope)
            : await tx
                .select({ portal: portals })
                .from(portals)
                .where(
                  and(
                    scope,
                    subject.kind === 'portal'
                      ? eq(portals.id, subject.portalId)
                      : eq(portals.propertyId, subject.propertyId),
                  ),
                )
        return facts.flatMap(({ portal }) =>
          portal.publicationState !== 'published'
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
      false,
    )
  },
})

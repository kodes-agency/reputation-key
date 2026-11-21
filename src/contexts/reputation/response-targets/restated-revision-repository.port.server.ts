import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

/**
 * A Material Review Revision that Google only restated: the observation that
 * created it was a `material_change` whose Google `updateTime` equals the
 * previous observation's, in the same source epoch. A guest edit moves that
 * time, so no guest made the revision (the restatement rule, stage A).
 *
 * Identifiers and numbers only: no Review text, rating or reviewer.
 */
export type RestatedMaterialRevision = Readonly<{
  reviewId: ReviewId
  sourceEpoch: number
  revision: number
}>

/**
 * Review-owned read for operator tooling. It finds the revisions that were
 * created before the restatement rule existed, so Inbox can leave
 * their Response Targets out of its counts (Inbox may not read Review tables).
 * Past data only: from the rule on, such a revision is no longer created.
 */
export type ListRestatedMaterialRevisions = (
  input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
) => Promise<ReadonlyArray<RestatedMaterialRevision>>

export type RestatedRevisionQuery = Readonly<{
  listRestatedRevisions: ListRestatedMaterialRevisions
}>

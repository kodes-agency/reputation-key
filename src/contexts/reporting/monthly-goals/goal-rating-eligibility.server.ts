import type { GoalSubject } from '../domain/goal-program'

type PortalRatingFact = Readonly<{
  portalId: string
  portalGroupId: string | null
  skipPrivateRating?: boolean
}>

/** A mixed group can still count private ratings; a Property keeps its history. */
export function ratingSubjectSkipsPrivateRating(
  portals: readonly PortalRatingFact[],
  subject: GoalSubject,
): boolean {
  if (subject.kind === 'property') return false
  const members = portals.filter((portal) =>
    subject.kind === 'portal'
      ? portal.portalId === subject.portalId
      : portal.portalGroupId === subject.portalGroupId,
  )
  return (
    members.length > 0 && members.every((portal) => portal.skipPrivateRating === true)
  )
}

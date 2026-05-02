import type { GuestInteractionRepository } from '#/contexts/guest/application/ports/guest-interaction.repository'
import type { ScanEvent, Rating, Feedback } from '#/contexts/guest/domain/types'
import type { OrganizationId, PortalId } from '#/shared/domain/ids'

export type InMemoryGuestRepo = GuestInteractionRepository &
  Readonly<{
    scans: ReadonlyArray<ScanEvent>
    ratings: ReadonlyArray<Rating>
    feedback: ReadonlyArray<Feedback>
  }>

export const createInMemoryGuestRepo = (): InMemoryGuestRepo => {
  const scans: ScanEvent[] = []
  const ratings: Rating[] = []
  const feedback: Feedback[] = []

  return {
    recordScan: async (scan) => {
      scans.push(scan)
    },
    insertRating: async (rating) => {
      ratings.push(rating)
    },
    insertFeedback: async (fb) => {
      feedback.push(fb)
    },
    hasRated: async (
      _organizationId: OrganizationId,
      sessionId: string,
      _portalId: PortalId,
    ) => {
      return ratings.some((r) => r.sessionId === sessionId)
    },
    scans,
    ratings,
    feedback,
  }
}

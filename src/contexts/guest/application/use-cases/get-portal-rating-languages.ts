import type {
  GuestResponseRepository,
  GuestResponseScope,
  PortalRatingLanguageBreakdown,
} from '../ports/guest-response.repository'

export type GetPortalRatingLanguagesInput = GuestResponseScope &
  Readonly<{
    startAt: Date
    endAt: Date
  }>

export type GetPortalRatingLanguages = (
  input: GetPortalRatingLanguagesInput,
) => Promise<PortalRatingLanguageBreakdown>

/** Private ratings of one Portal over a half-open period, by page language. */
export const getPortalRatingLanguages = (
  repository: Pick<GuestResponseRepository, 'summarizePortalRatingLanguages'>,
): GetPortalRatingLanguages => {
  return async (input) => {
    if (
      Number.isNaN(input.startAt.getTime()) ||
      Number.isNaN(input.endAt.getTime()) ||
      input.startAt >= input.endAt
    ) {
      throw new Error('Guest rating languages period is invalid')
    }
    return repository.summarizePortalRatingLanguages(
      {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        portalId: input.portalId,
      },
      input.startAt,
      input.endAt,
    )
  }
}

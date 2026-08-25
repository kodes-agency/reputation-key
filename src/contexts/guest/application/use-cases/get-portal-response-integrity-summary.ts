import type {
  GuestResponseRepository,
  GuestResponseScope,
  PortalResponseIntegritySummary,
} from '../ports/guest-response.repository'

export type GetPortalResponseIntegritySummaryInput = GuestResponseScope &
  Readonly<{
    startAt: Date
    endAt: Date
  }>

export type GetPortalResponseIntegritySummary = (
  input: GetPortalResponseIntegritySummaryInput,
) => Promise<PortalResponseIntegritySummary>

export const getPortalResponseIntegritySummary = (
  repository: Pick<GuestResponseRepository, 'summarizePortalIntegrity'>,
): GetPortalResponseIntegritySummary => {
  return async (input) => {
    if (
      Number.isNaN(input.startAt.getTime()) ||
      Number.isNaN(input.endAt.getTime()) ||
      input.startAt >= input.endAt
    ) {
      throw new Error('Guest response integrity summary period is invalid')
    }
    return repository.summarizePortalIntegrity(
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

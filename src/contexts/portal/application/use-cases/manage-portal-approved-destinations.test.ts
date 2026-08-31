import { describe, expect, it, vi } from 'vitest'
import {
  organizationId,
  portalApprovedDestinationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'
import { revalidatePortalApprovedDestinations } from './manage-portal-approved-destinations'

const NOW = new Date('2026-08-27T12:00:00.000Z')
const LAST_VALIDATED = new Date('2026-08-26T12:00:00.000Z')

const candidate = {
  id: portalApprovedDestinationId('10000000-0000-4000-8000-000000000001'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId('20000000-0000-4000-8000-000000000001'),
  normalizedUri: 'https://example.com/',
  hostname: 'example.com',
  sourceType: 'custom' as const,
  approvalState: 'approved' as const,
  validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
  requestedBy: userId('user-1'),
  approvedBy: userId('admin-1'),
  approvedAt: LAST_VALIDATED,
  disabledAt: null,
  disabledReason: null,
  lastValidatedAt: LAST_VALIDATED,
  createdAt: LAST_VALIDATED,
  updatedAt: LAST_VALIDATED,
}

describe('revalidatePortalApprovedDestinations', () => {
  it('quarantines a later-unsafe destination after exact scope authorization', async () => {
    const recordNetworkValidation = vi.fn(async (input) => ({
      ...candidate,
      approvalState: 'quarantined' as const,
      approvedBy: null,
      approvedAt: null,
      disabledAt: input.result.outcome === 'unsafe' ? input.result.observedAt : null,
    }))
    const useCase = revalidatePortalApprovedDestinations({
      destinationRepo: {
        listDueForNetworkRevalidation: async () => [candidate],
        recordNetworkValidation,
      } as never,
      destinationNetworkValidator: {
        validate: async () => ({
          outcome: 'unsafe',
          reason: 'redirect_host_changed',
          observedAt: NOW,
        }),
      },
      clock: () => NOW,
    })
    const authorizeScope = vi.fn(async () => true)
    await expect(useCase({ authorizeScope })).resolves.toMatchObject({
      scanned: 1,
      quarantined: 1,
      validated: 0,
    })
    expect(authorizeScope).toHaveBeenCalledWith('org-1', candidate.propertyId)
    expect(recordNetworkValidation).toHaveBeenCalledWith({
      organizationId: candidate.organizationId,
      propertyId: candidate.propertyId,
      id: candidate.id,
      expectedLastValidatedAt: LAST_VALIDATED,
      result: {
        outcome: 'unsafe',
        reason: 'redirect_host_changed',
        observedAt: NOW,
      },
    })
  })

  it('does not mutate on transient network failure or denied scope', async () => {
    const recordNetworkValidation = vi.fn()
    const useCase = revalidatePortalApprovedDestinations({
      destinationRepo: {
        listDueForNetworkRevalidation: async () => [candidate, candidate],
        recordNetworkValidation,
      } as never,
      destinationNetworkValidator: {
        validate: async () => ({
          outcome: 'unavailable',
          reason: 'dns_unavailable',
          observedAt: NOW,
        }),
      },
      clock: () => NOW,
    })
    const authorizeScope = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    await expect(useCase({ authorizeScope })).resolves.toMatchObject({
      scanned: 2,
      unauthorized: 1,
      unavailable: 1,
    })
    expect(recordNetworkValidation).not.toHaveBeenCalled()
  })
})

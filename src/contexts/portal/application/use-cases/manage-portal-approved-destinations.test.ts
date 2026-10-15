import { describe, expect, it, vi } from 'vitest'
import {
  organizationId,
  portalApprovedDestinationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'
import type { PortalDestinationNetworkValidation } from '../ports/portal-destination-network-validator.port'
import {
  requestPortalApprovedDestination,
  revalidatePortalApprovedDestinations,
} from './manage-portal-approved-destinations'

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

/**
 * The screen an account admin adds a site on. Only the network check decides
 * the refusal here, so the portal and staff ports answer the minimum.
 */
function setupRequest(validation: PortalDestinationNetworkValidation) {
  const portal = buildTestPortal({})
  const request = vi.fn()
  const useCase = requestPortalApprovedDestination({
    portalRepo: { findById: async () => portal } as never,
    destinationRepo: { request } as never,
    destinationNetworkValidator: { validate: async () => validation },
    staffPublicApi: { accessiblePropertyIds: async () => null } as never,
    idGen: () => '30000000-0000-4000-8000-000000000001',
    clock: () => NOW,
  })
  return {
    request,
    refusal: () =>
      useCase(
        { portalId: portal.id, uri: 'https://nope.example/' },
        buildTestAuthContext({ role: 'AccountAdmin' }),
      ),
  }
}

describe('requestPortalApprovedDestination', () => {
  it('tells the admin an address that does not exist is theirs to fix', async () => {
    const { refusal, request } = setupRequest({
      outcome: 'unavailable',
      reason: 'dns_not_found',
      observedAt: NOW,
    })

    await expect(refusal()).rejects.toMatchObject({ code: 'invalid_url' })
    await expect(refusal()).rejects.toThrow(
      'We could not find that web address. Check it for a typo and try again.',
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('asks for a retry only when the check itself could not run', async () => {
    const { refusal } = setupRequest({
      outcome: 'unavailable',
      reason: 'request_unavailable',
      observedAt: NOW,
    })

    await expect(refusal()).rejects.toMatchObject({ code: 'destination_not_approved' })
    await expect(refusal()).rejects.toThrow(
      'Destination validation is temporarily unavailable. Please try again.',
    )
  })
})

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

  it('asks for the page of destinations validated ten minutes ago or earlier', async () => {
    // The job runs every fifteen minutes. An approval due only at fifteen would
    // wait for the run after next and sit at the thirty-minute cutoff the
    // public edge drops it at.
    const listDueForNetworkRevalidation = vi.fn(async () => [])
    const useCase = revalidatePortalApprovedDestinations({
      destinationRepo: { listDueForNetworkRevalidation } as never,
      destinationNetworkValidator: { validate: vi.fn() },
      clock: () => NOW,
    })

    await useCase({ authorizeScope: async () => true })

    expect(listDueForNetworkRevalidation).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 10 * 60 * 1_000),
      100,
    )
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

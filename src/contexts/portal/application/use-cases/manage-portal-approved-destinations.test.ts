import { describe, expect, it, vi } from 'vitest'
import {
  organizationId,
  portalApprovedDestinationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import {
  PORTAL_DESTINATION_VALIDATION_VERSION,
  type PortalApprovedDestination,
} from '../../domain/approved-destination'
import type { PortalDestinationNetworkValidation } from '../ports/portal-destination-network-validator.port'
import {
  disablePortalApprovedDestination,
  listPortalApprovedDestinations,
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
  nextAttemptAt: null,
  validationFailures: 0,
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

describe('listPortalApprovedDestinations', () => {
  it('lists the sites allowed for links, and no phone number or email address', async () => {
    const portal = buildTestPortal({})
    const phone = {
      ...candidate,
      id: portalApprovedDestinationId('10000000-0000-4000-8000-000000000002'),
      normalizedUri: 'tel:+15551234567',
      hostname: '+15551234567',
      sourceType: 'contact' as const,
    }
    const email = {
      ...phone,
      id: portalApprovedDestinationId('10000000-0000-4000-8000-000000000003'),
      normalizedUri: 'mailto:front@hotel.com',
      hostname: 'front@hotel.com',
    }
    const useCase = listPortalApprovedDestinations({
      portalRepo: { findById: async () => portal } as never,
      destinationRepo: { list: async () => [phone, candidate, email] } as never,
      destinationNetworkValidator: { validate: vi.fn() },
      staffPublicApi: { accessiblePropertyIds: async () => null } as never,
      idGen: () => '30000000-0000-4000-8000-000000000001',
      clock: () => NOW,
    })

    const listed = await useCase(
      { portalId: portal.id },
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(listed.destinations).toEqual([candidate])
    expect(listed.canApprove).toBe(true)
  })
})

describe('disablePortalApprovedDestination', () => {
  const setupDisable = (current: PortalApprovedDestination | null) => {
    const portal = buildTestPortal({})
    const disable = vi.fn(async () => current)
    const useCase = disablePortalApprovedDestination({
      portalRepo: { findById: async () => portal } as never,
      destinationRepo: { findById: async () => current, disable } as never,
      destinationNetworkValidator: { validate: vi.fn() },
      staffPublicApi: { accessiblePropertyIds: async () => null } as never,
      idGen: () => '30000000-0000-4000-8000-000000000001',
      clock: () => NOW,
    })
    const turnOff = () =>
      useCase(
        { portalId: portal.id, destinationId: candidate.id, reason: 'Turned off' },
        buildTestAuthContext({ role: 'AccountAdmin' }),
      )
    return { disable, turnOff }
  }

  it('refuses to turn off a phone number or an email address, and writes nothing', async () => {
    const { disable, turnOff } = setupDisable({
      ...candidate,
      normalizedUri: 'tel:+15551234567',
      hostname: '+15551234567',
      sourceType: 'contact',
    })

    await expect(turnOff()).rejects.toMatchObject({
      code: 'destination_not_approved',
      message:
        'A phone number or an email address cannot be turned off. Change or delete its tile instead.',
    })
    expect(disable).not.toHaveBeenCalled()
  })

  it('still turns off a site', async () => {
    const { disable, turnOff } = setupDisable(candidate)

    await expect(turnOff()).resolves.toEqual(candidate)
    expect(disable).toHaveBeenCalledTimes(1)
  })
})

describe('revalidatePortalApprovedDestinations', () => {
  it('drains active checks before rejecting a failed write and starts no further batch', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(NOW)
      const rows = Array.from({ length: 6 }, (_, i) => ({
        ...candidate,
        id: portalApprovedDestinationId(`destination-${i}`),
        normalizedUri: `https://example.com/${i}`,
      }))
      const failure = new Error('Validation write failed')
      const recordNetworkValidation = vi.fn(async (input) => {
        if (input.id === rows[0]!.id) throw failure
        return rows.find((row) => row.id === input.id)!
      })
      const validate = vi.fn(async (uri: string) => {
        if (uri !== rows[0]!.normalizedUri)
          await new Promise((resolve) => setTimeout(resolve, 5_000))
        return {
          outcome: 'safe' as const,
          validatedAt: new Date(),
          finalUri: uri,
          redirectCount: 0,
        }
      })
      const useCase = revalidatePortalApprovedDestinations({
        destinationRepo: {
          listDueForNetworkRevalidation: async () => rows,
          recordNetworkValidation,
        } as never,
        destinationNetworkValidator: { validate },
        clock: () => new Date(),
      })
      let settled = false
      const running = useCase({ authorizeScope: async () => true })
      const refusal = expect(running).rejects.toBe(failure)
      const completion = running.catch(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(recordNetworkValidation).toHaveBeenCalledTimes(1)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(5_000)
      await refusal
      await completion
      expect(settled).toBe(true)
      expect(validate).toHaveBeenCalledTimes(5)
      expect(recordNetworkValidation).toHaveBeenCalledTimes(5)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

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
      expectedNextAttemptAt: null,
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
      { at: NOW, excludeIds: undefined },
    )
  })

  it('schedules a transient failure without refreshing freshness and never mutates a denied scope', async () => {
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
    expect(recordNetworkValidation).toHaveBeenCalledTimes(1)
    expect(recordNetworkValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        result: {
          outcome: 'unavailable',
          nextAttemptAt: new Date(NOW.getTime() + 60_000),
        },
      }),
    )
  })

  it.each([
    [0, 1],
    [1, 2],
    [2, 4],
    [3, 8],
    [4, 15],
    [30, 15],
  ])('backs off failure count %i for %i minutes', async (validationFailures, minutes) => {
    const recordNetworkValidation = vi.fn(async () => candidate)
    const useCase = revalidatePortalApprovedDestinations({
      destinationRepo: {
        listDueForNetworkRevalidation: async () => [{ ...candidate, validationFailures }],
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
    await useCase({ authorizeScope: async () => true })
    expect(recordNetworkValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        result: {
          outcome: 'unavailable',
          nextAttemptAt: new Date(NOW.getTime() + minutes * 60_000),
        },
      }),
    )
  })
})

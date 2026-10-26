import { describe, expect, it } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { propertyId, userId } from '#/shared/domain/ids'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../domain/approved-destination'
import type { PortalApprovedDestinationRepository } from './ports/portal-approved-destination.repository'
import { resolveApprovedPortalDestination } from './resolve-approved-portal-destination'

const AT = new Date('2026-10-09T09:00:00.000Z')
const PROPERTY = propertyId('property-1')

type RequestInput = Parameters<PortalApprovedDestinationRepository['request']>[0]

type Validation = Awaited<
  ReturnType<
    import('./ports/portal-destination-network-validator.port').PortalDestinationNetworkValidator['validate']
  >
>

/** A repository that records the request and answers with the state an account admin's authority gives. */
function setup(
  validation: Validation = {
    outcome: 'safe',
    validatedAt: AT,
    finalUri: '',
    redirectCount: 0,
  },
) {
  const requests: RequestInput[] = []
  const validated: string[] = []
  const deps = {
    destinationRepo: {
      request: async (input: RequestInput) => {
        requests.push(input)
        // The repository's rule: only a custom site waits for an account admin.
        const approved = input.approveCustom || input.destination.sourceType !== 'custom'
        return {
          id: input.id,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          normalizedUri: input.destination.normalizedUri,
          hostname: input.destination.hostname,
          sourceType: input.destination.sourceType,
          approvalState: approved ? ('approved' as const) : ('pending' as const),
          validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
          requestedBy: input.requestedBy,
          approvedBy: approved ? input.requestedBy : null,
          approvedAt: approved ? input.at : null,
          disabledAt: null,
          disabledReason: null,
          lastValidatedAt: input.at,
          createdAt: input.at,
          updatedAt: input.at,
        }
      },
    },
    destinationNetworkValidator: {
      validate: async (uri: string): Promise<Validation> => {
        validated.push(uri)
        return validation.outcome === 'safe'
          ? { ...validation, finalUri: uri }
          : validation
      },
    },
    idGen: () => '20000000-0000-4000-8000-000000000001',
    clock: () => AT,
  }
  return { deps, requests, validated }
}

const input = { uri: 'https://partner.example.com/offer', propertyId: PROPERTY }

describe('resolveApprovedPortalDestination', () => {
  it('approves an account admin’s own address as it is entered', async () => {
    const { deps, requests } = setup()

    const destination = await resolveApprovedPortalDestination(
      deps,
      input,
      buildTestAuthContext({ role: 'AccountAdmin', userId: userId('admin-1') }),
    )

    expect(destination.approvalState).toBe('approved')
    expect(requests[0]?.approveCustom).toBe(true)
  })

  it('leaves a manager’s address waiting, and tells them an account admin approves it first', async () => {
    const { deps, requests } = setup()

    const refusal = resolveApprovedPortalDestination(
      deps,
      input,
      buildTestAuthContext({ role: 'PropertyManager' }),
    )

    await expect(refusal).rejects.toMatchObject({ code: 'destination_not_approved' })
    await expect(refusal).rejects.toThrow(
      'An account admin needs to approve this address first. It is waiting for them under “Sites allowed for links”; once it is approved, enter it here again.',
    )
    expect(requests[0]?.approveCustom).toBe(false)
  })

  it('tells the manager an address that does not exist is theirs to fix', async () => {
    const { deps, requests } = setup({
      outcome: 'unavailable',
      reason: 'dns_not_found',
      observedAt: AT,
    })

    const refusal = resolveApprovedPortalDestination(
      deps,
      input,
      buildTestAuthContext({ role: 'AccountAdmin', userId: userId('admin-1') }),
    )

    await expect(refusal).rejects.toMatchObject({ code: 'invalid_url' })
    await expect(refusal).rejects.toThrow(
      'We could not find that web address. Check it for a typo and try again.',
    )
    expect(requests).toHaveLength(0)
  })

  it('asks for a retry only when the check itself could not run', async () => {
    const { deps } = setup({
      outcome: 'unavailable',
      reason: 'request_unavailable',
      observedAt: AT,
    })

    await expect(
      resolveApprovedPortalDestination(
        deps,
        input,
        buildTestAuthContext({ role: 'AccountAdmin', userId: userId('admin-1') }),
      ),
    ).rejects.toThrow(
      'Destination validation is temporarily unavailable. Please try again.',
    )
  })

  it.each([
    ['+1 (555) 123-4567', 'tel:+15551234567', '+15551234567'],
    ['front@hotel.com', 'mailto:front@hotel.com', 'front@hotel.com'],
  ])(
    'approves a manager’s phone number or email address %s at once, with no network check',
    async (uri, normalizedUri, hostname) => {
      // A failing network check would refuse a website: a contact never reaches it.
      const { deps, requests, validated } = setup({
        outcome: 'unavailable',
        reason: 'request_unavailable',
        observedAt: AT,
      })

      const destination = await resolveApprovedPortalDestination(
        deps,
        { uri, propertyId: PROPERTY },
        buildTestAuthContext({ role: 'PropertyManager' }),
      )

      expect(destination).toMatchObject({
        normalizedUri,
        hostname,
        sourceType: 'contact',
        approvalState: 'approved',
      })
      expect(requests[0]?.destination).toEqual({
        normalizedUri,
        hostname,
        sourceType: 'contact',
      })
      expect(validated).toEqual([])
    },
  )

  it('refuses a phone number or email address that cannot be stored, before any write', async () => {
    const { deps, requests, validated } = setup()

    for (const uri of [
      'tel:+1555123456;ext=9',
      'mailto:front@hotel.com?bcc=spy@evil.com',
      'javascript:alert(1)',
    ]) {
      await expect(
        resolveApprovedPortalDestination(
          deps,
          { uri, propertyId: PROPERTY },
          buildTestAuthContext({ role: 'AccountAdmin', userId: userId('admin-1') }),
        ),
      ).rejects.toMatchObject({ code: 'invalid_url' })
    }
    expect(requests).toEqual([])
    expect(validated).toEqual([])
  })

  it('tells a manager a contact that is not approved cannot be used, and sends them to no list', async () => {
    const { deps } = setup()
    const turnedOff = {
      ...deps,
      destinationRepo: {
        request: async (input: RequestInput) => ({
          ...(await deps.destinationRepo.request(input)),
          approvalState: 'disabled' as const,
          approvedBy: null,
          approvedAt: null,
        }),
      },
    }

    await expect(
      resolveApprovedPortalDestination(
        turnedOff,
        { uri: '+1 555 123 4567', propertyId: PROPERTY },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toMatchObject({
      code: 'destination_not_approved',
      message: 'This phone number or email address cannot be used on this property.',
    })
  })
})

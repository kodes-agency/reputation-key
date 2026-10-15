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
  const deps = {
    destinationRepo: {
      request: async (input: RequestInput) => {
        requests.push(input)
        return {
          id: input.id,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          normalizedUri: input.destination.normalizedUri,
          hostname: input.destination.hostname,
          sourceType: input.destination.sourceType,
          approvalState: input.approveCustom
            ? ('approved' as const)
            : ('pending' as const),
          validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
          requestedBy: input.requestedBy,
          approvedBy: input.approveCustom ? input.requestedBy : null,
          approvedAt: input.approveCustom ? input.at : null,
          disabledAt: null,
          disabledReason: null,
          lastValidatedAt: input.at,
          createdAt: input.at,
          updatedAt: input.at,
        }
      },
    },
    destinationNetworkValidator: {
      validate: async (uri: string): Promise<Validation> =>
        validation.outcome === 'safe' ? { ...validation, finalUri: uri } : validation,
    },
    idGen: () => '20000000-0000-4000-8000-000000000001',
    clock: () => AT,
  }
  return { deps, requests }
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
})

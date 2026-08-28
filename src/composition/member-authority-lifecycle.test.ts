// ARC-03-T9 contract test for the member-authority seam.
//
// The adapter fans a single Identity decision out to four independent
// authorities. These tests pin that fan-out from in-memory fakes so the seam
// keeps its behavior after the repositories left the composition root's
// vocabulary.

import { describe, expect, it, vi } from 'vitest'
import type { Clock } from '#/shared/domain/clock'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import type { PropertyResponsibilityRuntime } from '#/contexts/property/application/property-responsibility-runtime'
import type { PortalResponsibilityRuntime } from '#/contexts/portal/application/portal-responsibility-runtime'
import type { InboxAssignmentRuntime } from '#/contexts/inbox/application/inbox-assignment-runtime'
import type { PropertyResponsibleManager } from '#/contexts/property/domain/property-responsible-manager'
import type { PortalResponsibleManager } from '#/contexts/portal/domain/portal-responsible-manager'
import {
  createDeferredMemberAuthorityLifecycle,
  createMemberAuthorityLifecycle,
  type MemberAuthorityLifecycleDeps,
} from './member-authority-lifecycle'

const AT = new Date('2026-03-01T00:00:00.000Z')
const clock: Clock = () => AT
const ORG = 'org-1'
const MEMBER = 'user-1'
const ACTOR = 'actor-1'

const propertyAssignment = (propertyId: string): PropertyResponsibleManager => ({
  id: `pra-${propertyId}`,
  organizationId: ORG,
  propertyId,
  userId: MEMBER,
  effectiveFrom: AT,
  effectiveTo: null,
  createdBy: ACTOR,
  endReason: null,
})

const portalAssignment = (
  propertyId: string,
  portalId: string,
): PortalResponsibleManager => ({
  id: `porm-${portalId}`,
  organizationId: ORG,
  propertyId,
  portalId,
  userId: MEMBER,
  effectiveFrom: AT,
  effectiveTo: null,
  createdBy: ACTOR,
  endReason: null,
})

function createFakes(
  seed: Readonly<{
    propertyAssignments?: readonly PropertyResponsibleManager[]
    portalAssignments?: readonly PortalResponsibleManager[]
    eligibleProperties?: readonly string[]
  }> = {},
) {
  const propertyRelease = vi.fn(async () => ({
    released: 1,
    responsibilityNeededEvents: [{ type: 'property.responsibility_needed' }] as const,
  }))
  const portalRelease = vi.fn(async () => ({
    released: 1,
    responsibilityNeededEvents: [{ type: 'portal.responsibility_needed' }] as const,
  }))
  const propertyResponsibility = {
    listActiveForUser: vi.fn(async () => seed.propertyAssignments ?? []),
    releaseForUser: propertyRelease,
  } as unknown as PropertyResponsibilityRuntime
  const portalResponsibility = {
    listActiveForUser: vi.fn(async () => seed.portalAssignments ?? []),
    releaseForUser: portalRelease,
  } as unknown as PortalResponsibilityRuntime
  const inboxAssignments = {
    releaseAssignmentsForUser: vi.fn(async () => ({ released: 2 })),
    releaseIneligibleAssignmentsForUser: vi.fn(async () => ({ released: 1 })),
  } as unknown as InboxAssignmentRuntime
  const propertyAccess = { revokeAllPropertyAccessForUser: vi.fn(async () => undefined) }
  const emit = vi.fn(async () => undefined)
  const eligible = new Set(seed.eligibleProperties ?? [])
  const deps: MemberAuthorityLifecycleDeps = {
    clock,
    propertyResponsibility,
    portalResponsibility,
    inboxAssignments,
    propertyAccess,
    emit,
    eligibility: {
      listActiveManagers: async () =>
        eligible.size > 0
          ? [
              {
                userId: MEMBER,
                role: 'PropertyManager' as const,
                propertyAccessScope: 'organization' as const,
              },
            ]
          : [],
      getAccessiblePropertyIds: async () => null,
      findActiveParticipation: async () => null,
    },
  }
  return {
    deps,
    propertyResponsibility,
    portalResponsibility,
    inboxAssignments,
    propertyAccess,
    emit,
  }
}

describe('member authority lifecycle seam', () => {
  it('releases all four authorities exactly once and publishes both fact sets', async () => {
    const fakes = createFakes()
    const lifecycle = createMemberAuthorityLifecycle(fakes.deps)

    await lifecycle.releaseMemberAuthorities(ORG, MEMBER, ACTOR)

    expect(fakes.propertyResponsibility.releaseForUser).toHaveBeenCalledTimes(1)
    expect(fakes.propertyResponsibility.releaseForUser).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: MEMBER,
      at: AT,
      endReason: 'manager_offboarded',
    })
    expect(fakes.portalResponsibility.releaseForUser).toHaveBeenCalledTimes(1)
    expect(fakes.inboxAssignments.releaseAssignmentsForUser).toHaveBeenCalledTimes(1)
    expect(fakes.inboxAssignments.releaseAssignmentsForUser).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: MEMBER,
      actorId: ACTOR,
      at: AT,
    })
    expect(fakes.propertyAccess.revokeAllPropertyAccessForUser).toHaveBeenCalledTimes(1)
    expect(fakes.emit).toHaveBeenCalledTimes(2)
  })

  it('passes a null actor through for provider lifecycle hooks', async () => {
    const fakes = createFakes()
    const lifecycle = createMemberAuthorityLifecycle(fakes.deps)

    await lifecycle.releaseMemberAuthorities(ORG, MEMBER, null)

    expect(fakes.inboxAssignments.releaseAssignmentsForUser).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null }),
    )
  })

  it('surfaces the first rejection instead of swallowing it', async () => {
    const fakes = createFakes()
    vi.mocked(fakes.portalResponsibility.releaseForUser).mockRejectedValueOnce(
      new Error('portal release failed'),
    )
    const lifecycle = createMemberAuthorityLifecycle(fakes.deps)

    await expect(lifecycle.releaseMemberAuthorities(ORG, MEMBER, ACTOR)).rejects.toThrow(
      'portal release failed',
    )
    // A failed release must not look like a successful offboarding.
    expect(fakes.propertyAccess.revokeAllPropertyAccessForUser).not.toHaveBeenCalled()
    expect(fakes.emit).not.toHaveBeenCalled()
  })

  it('reconciliation releases only the ineligible assignments', async () => {
    const fakes = createFakes({
      propertyAssignments: [
        propertyAssignment('prop-keep'),
        propertyAssignment('prop-drop'),
      ],
      portalAssignments: [
        portalAssignment('prop-keep', 'portal-keep'),
        portalAssignment('prop-drop', 'portal-drop'),
      ],
      eligibleProperties: ['prop-keep'],
    })
    // Eligibility is decided by the injected facts: only `prop-keep` resolves
    // to an active manager membership, so `prop-drop` is the ineligible one.
    const deps: MemberAuthorityLifecycleDeps = {
      ...fakes.deps,
      eligibility: {
        listActiveManagers: async () => [
          {
            userId: MEMBER,
            role: 'PropertyManager',
            propertyAccessScope: 'assigned-properties',
          },
        ],
        getAccessiblePropertyIds: async () => [toPropertyId('prop-keep')],
        findActiveParticipation: async (_org, propertyId) =>
          propertyId === 'prop-keep' ? { id: 'participation' } : null,
      },
    }
    const lifecycle = createMemberAuthorityLifecycle(deps)

    await lifecycle.reconcileResponsibleManagerEligibility(ORG, MEMBER, ACTOR)

    expect(fakes.propertyResponsibility.releaseForUser).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: MEMBER,
      propertyIds: ['prop-drop'],
      at: AT,
      endReason: 'manager_became_ineligible',
    })
    expect(fakes.portalResponsibility.releaseForUser).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: MEMBER,
      portalIds: ['portal-drop'],
      at: AT,
      endReason: 'manager_became_ineligible',
    })
    expect(
      fakes.inboxAssignments.releaseIneligibleAssignmentsForUser,
    ).toHaveBeenCalledTimes(1)
  })
})

describe('deferred member authority lifecycle binding', () => {
  it('names the seam when called before the container finished composing', async () => {
    const deferred = createDeferredMemberAuthorityLifecycle()

    await expect(
      deferred.port.releaseMemberAuthorities(ORG, MEMBER, ACTOR),
    ).rejects.toThrow('member authority lifecycle seam is not bound yet')
  })

  it('delegates once bound and refuses a second implementation', async () => {
    const deferred = createDeferredMemberAuthorityLifecycle()
    const fakes = createFakes()
    const implementation = createMemberAuthorityLifecycle(fakes.deps)

    deferred.provide(implementation)
    await deferred.port.releaseMemberAuthorities(ORG, MEMBER, ACTOR)

    expect(fakes.propertyAccess.revokeAllPropertyAccessForUser).toHaveBeenCalledTimes(1)
    expect(() => deferred.provide(implementation)).toThrow('already bound')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { OrganizationLifecycleCommandStore } from '../ports/organization-lifecycle-command-store.port'
import type { OrganizationLifecycleStatus } from '../../domain/organization-lifecycle'
import { createOrganizationLifecycle } from './organization-lifecycle'

const now = new Date('2026-08-28T09:30:00.000Z')

function status(
  overrides: Partial<OrganizationLifecycleStatus> = {},
): OrganizationLifecycleStatus {
  return {
    organizationId: 'org-1',
    state: 'closure_requested',
    revision: 1,
    closureLineageId: '18deca2e-91a7-46e4-b92b-73163568ed84',
    closureRequestedAt: now,
    recoverableUntil: new Date('2026-09-27T09:30:00.000Z'),
    irreversibleAt: null,
    closedAt: null,
    reactivationRequired: true,
    lastTransitionAt: now,
    lastActorId: 'user-1',
    lastReasonCode: 'account_admin_request',
    lastSupportEvidenceRef: 'support:CASE-42',
    ...overrides,
  }
}

function fakeStore(): OrganizationLifecycleCommandStore {
  return {
    requestClosure: vi.fn(async () => status()),
    getStatus: vi.fn(async () => status()),
    reactivate: vi.fn(async () =>
      status({ state: 'active', revision: 3, reactivationRequired: false }),
    ),
    getAuthority: vi.fn(async () => status()),
    listCandidates: vi.fn(async () => []),
    transition: vi.fn(async () => status({ state: 'closing', revision: 2 })),
    cancelClosure: vi.fn(async () =>
      status({
        state: 'active',
        revision: 2,
        reactivationRequired: true,
        lastReasonCode: 'closure_cancelled',
      }),
    ),
  }
}

describe('Organization lifecycle application API', () => {
  it('refuses to arm a closure when this deployment cannot reactivate one', async () => {
    // Requesting a closure commits an Organization-wide suspension, and
    // cancelling deliberately leaves it in place with the reactivation fence
    // set. If reactivation is not composed, one request would suspend the
    // tenant with no in-product way back — so the request is refused instead.
    const store = fakeStore()
    const lifecycle = createOrganizationLifecycle({
      store,
      clock: () => now,
      reactivationConfigured: () => false,
      refreshPolicy: async () => {},
    })

    await expect(
      lifecycle.requestClosure({
        operationId: '11111111-1111-4111-8111-111111111111',
        organizationId: 'org-1',
        actorUserId: 'user-1',
        reasonCode: 'account_admin_request',
        supportEvidenceRef: 'support:ticket-1',
      }),
    ).rejects.toMatchObject({ _tag: 'IdentityError', code: 'forbidden' })

    // Nothing was committed: the suspension is the part that cannot be undone.
    expect(store.requestClosure).not.toHaveBeenCalled()
  })

  it('uses the fixed 30-day deadline and refreshes the global suspension before returning', async () => {
    const store = fakeStore()
    const refreshPolicy = vi.fn(async () => {})
    const lifecycle = createOrganizationLifecycle({
      store,
      clock: () => now,
      reactivationConfigured: () => true,
      refreshPolicy,
    })

    await lifecycle.requestClosure({
      operationId: '18deca2e-91a7-46e4-b92b-73163568ed84',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      reasonCode: 'account_admin_request',
      supportEvidenceRef: 'support:CASE-42',
    })

    expect(store.requestClosure).toHaveBeenCalledWith(
      expect.objectContaining({
        now,
        recoverableUntil: new Date('2026-09-27T09:30:00.000Z'),
      }),
    )
    expect(refreshPolicy).toHaveBeenCalledOnce()
  })

  it('cancels only the lifecycle request and keeps reactivation explicitly blocked', async () => {
    const store = fakeStore()
    const refreshPolicy = vi.fn(async () => {})
    const lifecycle = createOrganizationLifecycle({
      store,
      clock: () => now,
      reactivationConfigured: () => true,
      refreshPolicy,
    })

    const result = await lifecycle.cancelClosure({
      operationId: 'c0f7b313-9f89-4b76-8693-dba1259af489',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      reasonCode: 'closure_cancelled',
      supportEvidenceRef: 'support:CASE-43',
    })

    expect(result).toMatchObject({ state: 'active', reactivationRequired: true })
    expect(refreshPolicy).not.toHaveBeenCalled()
  })

  it('rejects descriptive support text before persistence', async () => {
    const store = fakeStore()
    const lifecycle = createOrganizationLifecycle({
      store,
      clock: () => now,
      reactivationConfigured: () => true,
      refreshPolicy: async () => {},
    })

    await expect(
      lifecycle.requestClosure({
        operationId: '18deca2e-91a7-46e4-b92b-73163568ed84',
        organizationId: 'org-1',
        actorUserId: 'user-1',
        reasonCode: 'account_admin_request',
        supportEvidenceRef: 'Customer asked us in a long email',
      }),
    ).rejects.toThrow(/content-free identifier/)
    expect(store.requestClosure).not.toHaveBeenCalled()
  })
})

// ARC-03-T11 contract test — the Portal responsible-manager lifecycle runtime.
//
// The member-authority seam consumes this named capability instead of the
// Portal responsible-manager repository. What these tests pin is the shape of
// that capability: the two lifecycle operations delegated verbatim, nothing
// else on the returned object, and a repository failure surfaced rather than
// reported as a completed release.

import { describe, expect, it, vi } from 'vitest'
import type { PortalResponsibleManager } from '../domain/portal-responsible-manager'
import type { PortalResponsibleManagerRepository } from './ports/portal-responsible-manager.repository'
import { createPortalResponsibilityRuntime } from './portal-responsibility-runtime'

const AT = new Date('2026-03-01T00:00:00.000Z')
const ORG = 'org-1'
const MEMBER = 'user-1'
const ACTOR = 'actor-1'

const assignment = (portalId: string): PortalResponsibleManager => ({
  id: `porm-${portalId}`,
  organizationId: ORG,
  propertyId: 'prop-1',
  portalId,
  userId: MEMBER,
  effectiveFrom: AT,
  effectiveTo: null,
  createdBy: ACTOR,
  endReason: null,
})

const createRepo = (seed: readonly PortalResponsibleManager[] = []) => ({
  listActive: vi.fn<PortalResponsibleManagerRepository['listActive']>(async () => seed),
  listActiveForUser: vi.fn<PortalResponsibleManagerRepository['listActiveForUser']>(
    async () => seed,
  ),
  replace: vi.fn<PortalResponsibleManagerRepository['replace']>(async () => ({
    assignments: seed,
    revision: 2,
    becameResponsibilityNeeded: false,
  })),
  releaseForUser: vi.fn<PortalResponsibleManagerRepository['releaseForUser']>(
    async () => ({ released: seed.length }),
  ),
})

describe('createPortalResponsibilityRuntime', () => {
  it('delegates the cross-organization read verbatim and returns the repository rows', async () => {
    const repo = createRepo([assignment('portal-1'), assignment('portal-2')])
    const runtime = createPortalResponsibilityRuntime(repo)

    await expect(runtime.listActiveForUser(ORG, MEMBER)).resolves.toEqual([
      assignment('portal-1'),
      assignment('portal-2'),
    ])
    expect(repo.listActiveForUser).toHaveBeenCalledTimes(1)
    expect(repo.listActiveForUser).toHaveBeenCalledWith(ORG, MEMBER)
  })

  it('passes the release input through unchanged, including the portal narrowing', async () => {
    const repo = createRepo([assignment('portal-drop')])
    const runtime = createPortalResponsibilityRuntime(repo)

    // Reconciliation releases named portals; offboarding omits `portalIds` so
    // every assignment goes. Both shapes have to reach the repository as sent.
    await runtime.releaseForUser({
      organizationId: ORG,
      userId: MEMBER,
      portalIds: ['portal-drop'],
      at: AT,
      endReason: 'manager_became_ineligible',
    })
    await runtime.releaseForUser({
      organizationId: ORG,
      userId: MEMBER,
      at: AT,
      endReason: 'manager_offboarded',
    })

    expect(repo.releaseForUser.mock.calls.map(([input]) => input)).toEqual([
      {
        organizationId: ORG,
        userId: MEMBER,
        portalIds: ['portal-drop'],
        at: AT,
        endReason: 'manager_became_ineligible',
      },
      {
        organizationId: ORG,
        userId: MEMBER,
        at: AT,
        endReason: 'manager_offboarded',
      },
    ])
  })

  it('returns the release count the repository reports', async () => {
    const repo = createRepo([assignment('portal-1'), assignment('portal-2')])
    const runtime = createPortalResponsibilityRuntime(repo)

    await expect(
      runtime.releaseForUser({
        organizationId: ORG,
        userId: MEMBER,
        at: AT,
        endReason: 'manager_offboarded',
      }),
    ).resolves.toEqual({ released: 2 })
  })

  it('carries only the two lifecycle operations, not the rest of the repository', () => {
    const repo = createRepo()
    const runtime = createPortalResponsibilityRuntime(repo)

    // The seam's vocabulary is exactly these two. The repository's portal-scoped
    // read and its `replace` mutation are not part of this capability.
    expect(Object.keys(runtime).sort()).toEqual(['listActiveForUser', 'releaseForUser'])
    expect('listActive' in runtime).toBe(false)
    expect('replace' in runtime).toBe(false)
  })

  it('is frozen, so a holder cannot swap an operation after construction', () => {
    const runtime = createPortalResponsibilityRuntime(createRepo())

    expect(() => {
      ;(runtime as unknown as { releaseForUser: unknown }).releaseForUser = async () => ({
        released: 0,
      })
    }).toThrow(TypeError)
    expect(() => {
      ;(runtime as unknown as { replace: unknown }).replace = async () => undefined
    }).toThrow(TypeError)
  })

  it('surfaces a repository failure instead of reporting a completed release', async () => {
    const repo = createRepo()
    repo.releaseForUser.mockRejectedValueOnce(new Error('portal release failed'))
    const runtime = createPortalResponsibilityRuntime(repo)

    await expect(
      runtime.releaseForUser({
        organizationId: ORG,
        userId: MEMBER,
        at: AT,
        endReason: 'manager_offboarded',
      }),
    ).rejects.toThrow('portal release failed')
  })
})

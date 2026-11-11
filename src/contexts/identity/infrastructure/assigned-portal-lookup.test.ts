import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createAssignedPortalLookup } from './assigned-portal-lookup'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('prop-1')
const USER = userId('user-1')

const lookup = (
  active: { id: string; personalPortalId: string | null } | null,
  responsibilities: ReadonlyArray<{ kind: string; portalId: string }> = [],
) => {
  const listActiveResponsibilities = vi.fn().mockResolvedValue(responsibilities)
  const findActiveByUser = vi.fn().mockResolvedValue(active)
  return {
    listActiveResponsibilities,
    run: createAssignedPortalLookup({
      findActiveByUser,
      listActiveResponsibilities,
    } as never),
  }
}

describe('createAssignedPortalLookup', () => {
  it('is empty when the user has no active participation', async () => {
    const { run, listActiveResponsibilities } = lookup(null)
    expect(await run(ORG, USER, PROPERTY)).toEqual([])
    expect(listActiveResponsibilities).not.toHaveBeenCalled()
  })

  it('is empty when the participation has no personal Portal', async () => {
    const { run } = lookup({ id: 'p1', personalPortalId: null })
    expect(await run(ORG, USER, PROPERTY)).toEqual([])
  })

  it('returns only the primary responsibility for the personal Portal', async () => {
    const { run } = lookup({ id: 'p1', personalPortalId: 'portal-own' }, [
      { kind: 'primary', portalId: 'portal-own' },
      { kind: 'primary', portalId: 'portal-other' },
      { kind: 'backup', portalId: 'portal-own' },
    ])
    expect(await run(ORG, USER, PROPERTY)).toEqual(['portal-own'])
  })
})

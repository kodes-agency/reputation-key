// ARC-03-T9 contract test — Staff/Portal seam.
//
// Staff owns this contract; Portal satisfies it from its PUBLIC API. Before the
// seam was named, the composition root implemented `listPortalIdsByProperty` by
// reaching into Portal's repository from the Staff build — issued before the
// Portal context existed.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { StaffPortalLookupPort } from './portal-lookup.port'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('prop-1')

const inMemoryPortalLookup = (
  portals: ReadonlyArray<
    Readonly<{
      id: string
      propertyId: string
      name: string
      publicationState: 'draft' | 'published' | 'disabled' | 'archived'
    }>
  >,
): StaffPortalLookupPort =>
  Object.freeze({
    listPortalIdsByProperty: async (_orgId, pid) =>
      portals.filter((p) => p.propertyId === pid).map((p) => portalId(p.id)),
    getPortalInfo: async (_orgId, requestedPortalId) => {
      const portal = portals.find((p) => p.id === requestedPortalId)
      return portal
        ? {
            id: portalId(portal.id),
            name: portal.name,
            publicationState: portal.publicationState,
          }
        : null
    },
  })

describe('StaffPortalLookupPort contract', () => {
  const lookup = inMemoryPortalLookup([
    { id: 'portal-a', propertyId: 'prop-1', name: 'A', publicationState: 'published' },
    { id: 'portal-b', propertyId: 'prop-2', name: 'B', publicationState: 'draft' },
  ])

  it('returns only the portals belonging to the requested property', async () => {
    expect(await lookup.listPortalIdsByProperty(ORG, PROPERTY)).toEqual(['portal-a'])
  })

  it('returns an empty list rather than null for a property with no portals', async () => {
    expect(await lookup.listPortalIdsByProperty(ORG, propertyId('prop-none'))).toEqual([])
  })

  it('returns null for an unknown portal instead of throwing', async () => {
    expect(await lookup.getPortalInfo(ORG, portalId('portal-missing'))).toBeNull()
  })

  it('exposes publication state so Staff never infers it from a repository row', async () => {
    expect(await lookup.getPortalInfo(ORG, portalId('portal-b'))).toEqual({
      id: 'portal-b',
      name: 'B',
      publicationState: 'draft',
    })
  })

  it('is consumed through the port, never through a context-private hatch', () => {
    for (const consumer of [
      'src/contexts/staff/application/use-cases/list-staff-portals.ts',
      'src/contexts/staff/application/use-cases/update-staff-portals.ts',
    ]) {
      const source = readFileSync(resolve(consumer), 'utf8')
      expect(source, consumer).not.toContain('.internal.')
      expect(source, consumer).toContain('StaffPortalLookupPort')
    }
  })
})

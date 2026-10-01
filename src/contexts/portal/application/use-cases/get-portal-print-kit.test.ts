// Portal context — the print kit read (round 4, slice 45).

import { describe, expect, it } from 'vitest'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { organizationId, propertyId, type PropertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  publicationSource,
  SOURCE_HERO_ASSET_ID,
} from '../../domain/__fixtures__/publication-source'
import type { PortalPublicationSource } from '../../domain/portal-publication-source'
import { getPortalPrintKit } from './get-portal-print-kit'

const staffApi = (accessible: readonly PropertyId[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

function setup(
  options: Readonly<{
    source?: PortalPublicationSource | null
    accessible?: readonly PropertyId[] | null
  }> = {},
) {
  const portal = buildTestPortal({ name: 'Harbor lobby' })
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const read = getPortalPrintKit({
    portalRepo,
    staffPublicApi: staffApi(options.accessible ?? null),
    publicationRepo: {
      loadWorkingCopy: async () =>
        options.source === undefined ? publicationSource() : options.source,
    },
  })
  return { portal, read }
}

describe('getPortalPrintKit', () => {
  it('gives the preview the titles, languages and look of the working copy', async () => {
    const { portal, read } = setup()
    const view = await read({ portalId: portal.id }, buildTestAuthContext())
    expect(view.portalId).toBe(portal.id)
    expect(view.locales).toEqual(['en', 'bg'])
    expect(view.titles.bg).toBe('Разкажете ни за посещението си')
    expect(view.look.wordmark).toBe('HARBOR')
    expect(view.look.heroUrl).toBe(`/api/public/portal-media/${SOURCE_HERO_ASSET_ID}`)
  })

  it('carries no address: the preview draws a placeholder code', async () => {
    const { portal, read } = setup()
    const view = await read({ portalId: portal.id }, buildTestAuthContext())
    expect(JSON.stringify(view)).not.toMatch(/accessArtifact|\/p\/pt_/u)
  })

  it('refuses a caller who holds no Portal read permission', async () => {
    const { portal, read } = setup()
    await expect(
      read(
        { portalId: portal.id },
        buildTestAuthContext({ effectivePermissions: new Set() }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { portal, read } = setup({
      accessible: [propertyId('a0000000-0000-0000-0000-0000000000ff')],
    })
    await expect(
      read({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('does not find a Portal of another organization', async () => {
    const { portal, read } = setup()
    await expect(
      read(
        { portalId: portal.id },
        buildTestAuthContext({ organizationId: organizationId('org-other') }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })

  it('does not find a Portal whose working copy does not resolve', async () => {
    const { portal, read } = setup({ source: null })
    await expect(
      read({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})

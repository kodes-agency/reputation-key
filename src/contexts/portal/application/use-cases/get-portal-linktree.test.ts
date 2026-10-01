// Portal context — read the Linktree section for the editor

import { describe, expect, it } from 'vitest'
import { getPortalLinktree } from './get-portal-linktree'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { PortalApprovedDestination } from '../../domain/approved-destination'
import type { PortalLocalizedOverride } from '../ports/portal-experience.repository'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  portalApprovedDestinationId,
  portalId,
  propertyId,
  userId,
  type PropertyId,
} from '#/shared/domain/ids'

const AT = new Date('2026-10-01T12:00:00Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const override = (
  locale: PortalLocalizedOverride['locale'],
  linktreeTitle: string | null,
): PortalLocalizedOverride => ({
  id: `override-${locale}`,
  organizationId: buildTestPortal().organizationId,
  propertyId: buildTestPortal().propertyId,
  portalId: buildTestPortal().id,
  locale,
  title: null,
  shortDescription: null,
  heroImageUrl: null,
  linktreeTitle,
  version: 1,
  updatedBy: userId('user-1'),
  createdAt: AT,
  updatedAt: AT,
})

const approvedDestination = (): PortalApprovedDestination => ({
  id: portalApprovedDestinationId('20000000-0000-0000-0000-000000000001'),
  organizationId: buildTestPortal().organizationId,
  propertyId: buildTestPortal().propertyId,
  normalizedUri: 'https://avela.bg/menu',
  hostname: 'avela.bg',
  sourceType: 'custom',
  approvalState: 'approved',
  validationVersion: 'portal-destination-https-v1',
  requestedBy: userId('user-1'),
  approvedBy: userId('admin-1'),
  approvedAt: AT,
  disabledAt: null,
  disabledReason: null,
  lastValidatedAt: AT,
  createdAt: AT,
  updatedAt: AT,
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const destination = approvedDestination()
  const useCase = getPortalLinktree({
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
    experienceRepo: {
      listPortalOverrides: async () => [
        override('en', 'Around the resort'),
        override('bg', null),
      ],
    },
    destinationRepo: { list: async () => [destination] },
  })
  const portal = buildTestPortal({
    additionalGuestLocales: ['bg'],
    linktreeEnabled: true,
  })
  portalRepo.seed([portal])
  const category = buildTestPortalLinkCategory({})
  portalLinkRepo.seedCategories([category])
  const link = buildTestPortalLink({
    categoryId: category.id,
    destinationId: destination.id,
    label: 'Menu',
    iconKey: 'utensils',
  })
  portalLinkRepo.seedLinks([link])
  return { useCase, portal, portalLinkRepo, link }
}

describe('getPortalLinktree', () => {
  it('returns the switch, the titles and each link with its texts and approval', async () => {
    const { useCase, portal, link } = setup()

    const view = await useCase(
      { portalId: portal.id },
      buildTestAuthContext({ role: 'PropertyManager' }),
    )

    expect(view).toMatchObject({
      portalId: portal.id,
      enabled: true,
      maxLinks: 4,
      locales: ['en', 'bg'],
      titles: { en: 'Around the resort' },
    })
    expect(view.links).toHaveLength(1)
    expect(view.links[0]).toMatchObject({
      id: link.id,
      iconKey: 'utensils',
      // No text row yet: the link's own label stands in for the primary language.
      texts: [{ locale: 'en', label: 'Menu', line: null }],
      destination: { state: 'approved', approvedByUserId: 'admin-1' },
    })
  })

  it('reads the saved texts of every language', async () => {
    const { useCase, portal, portalLinkRepo, link } = setup()
    portalLinkRepo.saveTexts(
      link.id,
      [
        {
          locale: 'en',
          label: 'Olive Terrace menu',
          line: 'Lunch and dinner',
          provenance: null,
        },
        { locale: 'bg', label: 'Меню', line: null, provenance: null },
      ],
      { actorUserId: 'user-1', at: AT },
    )

    const view = await useCase(
      { portalId: portal.id },
      buildTestAuthContext({ role: 'PropertyManager' }),
    )

    expect(
      view.links[0]?.texts.map((text) => [text.locale, text.label, text.line]),
    ).toEqual([
      ['en', 'Olive Terrace menu', 'Lunch and dinner'],
      ['bg', 'Меню', null],
    ])
  })

  it('refuses a role that cannot read Portals', async () => {
    const { useCase, portal } = setup()

    await expect(
      useCase(
        { portalId: portal.id },
        buildTestAuthContext({ role: 'Member', effectivePermissions: new Set() }),
      ),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
  })

  it('refuses a Portal of a Property the manager is not assigned to', async () => {
    const { useCase, portal } = setup([
      propertyId('a0000000-0000-0000-0000-0000000000ff'),
    ])

    await expect(
      useCase({ portalId: portal.id }, buildTestAuthContext({ role: 'PropertyManager' })),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e))
  })

  it('reports a Portal that does not exist', async () => {
    const { useCase } = setup()

    await expect(
      useCase(
        { portalId: portalId('d0000000-0000-0000-0000-0000000000aa') },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'portal_not_found')
  })
})

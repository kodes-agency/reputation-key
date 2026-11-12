// Portal context — getPortalLanguageCoverage use case tests
import { randomUUID } from 'node:crypto'
import { getDb } from '#/shared/db'
import { createPortalLinkRepository } from '../../infrastructure/repositories/portal-link.repository'
import { describe, expect, it } from 'vitest'
import { getPortalLanguageCoverage } from './get-portal-language-coverage'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalReadsWorld } from '../../infrastructure/testing/portal-reads-world'
import { propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const world = createPortalReadsWorld('language-coverage')

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: [
    'portal_link_texts',
    'portal_links',
    'portal_link_categories',
    'portals',
    'properties',
  ],
})

const portal = world.portal()
const AT = new Date('2026-10-01T10:00:00Z')

const propertyContent = (locale: 'en' | 'bg', title: string) => ({
  id: `content-${locale}`,
  organizationId: world.orgA,
  propertyId: world.propertyA,
  locale,
  title,
  shortDescription: `${title} description`,
  version: 1,
  updatedBy: 'user-1' as never,
  createdAt: AT,
  updatedAt: AT,
})

async function setup(
  options: {
    accessible?: ReadonlyArray<PropertyId> | null
    additional?: ReadonlyArray<'bg' | 'de'>
    content?: ReturnType<typeof propertyContent>[]
    overrides?: ReadonlyArray<{
      locale: 'en' | 'bg'
      title: string | null
      shortDescription: string | null
    }>
  } = {},
) {
  const portalRepo = world.portalRepo()
  await world.seed([{ ...portal, additionalGuestLocales: options.additional ?? ['bg'] }])
  const categoryId = await world.seedCategory(portal)
  await world.seedLink(portal, {
    categoryId,
    label: 'Menu',
    texts: [{ locale: 'en', label: 'Menu', line: null }],
  })
  const portalLinkRepo = createPortalLinkRepository(getDb())
  const experienceRepo = {
    getPropertyExperience: async () => ({
      profile: null,
      content: options.content ?? [propertyContent('en', 'Avela')],
    }),
    listPortalOverrides: async () => options.overrides ?? [],
  } as unknown as PortalExperienceRepository
  const useCase = getPortalLanguageCoverage({
    portalRepo,
    portalLinkRepo,
    experienceRepo,
    staffPublicApi: staffApi(options.accessible ?? null),
  })
  return { useCase }
}

describe('getPortalLanguageCoverage', () => {
  it('reports each offered language with what is written and what is missing', async () => {
    const { useCase } = await setup()
    const coverage = await useCase(
      { portalId: portal.id },
      world.ctx({ role: 'PropertyManager' }),
    )
    expect(coverage.fallbackLocale).toBe('en')
    expect(coverage.languages.map((row) => [row.locale, row.present, row.total])).toEqual(
      [
        ['en', 3, 3],
        ['bg', 0, 3],
      ],
    )
    expect(coverage.missingTotal).toBe(3)
  })

  it('names the link a label is missing for, in the fallback language', async () => {
    const { useCase } = await setup()
    const coverage = await useCase(
      { portalId: portal.id },
      world.ctx({ role: 'PropertyManager' }),
    )
    const bg = coverage.languages[1]
    expect(bg?.missing.find((text) => text.kind === 'link_label')).toMatchObject({
      linkLabel: 'Menu',
    })
  })

  it('reads the Property wording of each language a Portal offers', async () => {
    const { useCase } = await setup({
      content: [propertyContent('en', 'Avela'), propertyContent('bg', 'Авела')],
    })
    const coverage = await useCase(
      { portalId: portal.id },
      world.ctx({ role: 'PropertyManager' }),
    )
    expect(coverage.languages[1]?.missing.map((text) => text.kind)).toEqual([
      'link_label',
    ])
  })

  it('does not count a Portal override for a language the Property has no wording for', async () => {
    const { useCase } = await setup({
      overrides: [{ locale: 'bg', title: 'Авела', shortDescription: 'До морето' }],
    })
    const coverage = await useCase(
      { portalId: portal.id },
      world.ctx({ role: 'PropertyManager' }),
    )
    expect(coverage.languages[1]?.missing.map((text) => text.kind)).toEqual([
      'title',
      'description',
      'link_label',
    ])
    // A gap in a non-primary language is copied from the primary, not blocking.
    expect(
      coverage.languages[1]?.missing.filter((text) => text.blocksPublish),
    ).toHaveLength(0)
  })

  it('refuses a caller who holds no Portal read permission', async () => {
    const { useCase } = await setup()
    await expect(
      useCase({ portalId: portal.id }, world.ctx({ effectivePermissions: new Set() })),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { useCase } = await setup({
      accessible: [propertyId(randomUUID())],
    })
    await expect(
      useCase({ portalId: portal.id }, world.ctx({ role: 'PropertyManager' })),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('does not find a Portal of another organization', async () => {
    const { useCase } = await setup()
    await expect(
      useCase(
        { portalId: portal.id },
        world.ctx({
          role: 'PropertyManager',
          organizationId: world.orgB,
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})

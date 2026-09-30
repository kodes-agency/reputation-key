// Portal context — getPortalLanguageCoverage use case tests
import { describe, expect, it } from 'vitest'
import { getPortalLanguageCoverage } from './get-portal-language-coverage'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
} from '#/shared/testing/fixtures'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL = portalId('d0000000-0000-0000-0000-000000000001')
const AT = new Date('2026-10-01T10:00:00Z')

const propertyContent = (locale: 'en' | 'bg', title: string) => ({
  id: `content-${locale}`,
  organizationId: ORG,
  propertyId: PROPERTY,
  locale,
  title,
  shortDescription: `${title} description`,
  version: 1,
  updatedBy: 'user-1' as never,
  createdAt: AT,
  updatedAt: AT,
})

function setup(
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
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([
    buildTestPortal({
      additionalGuestLocales: options.additional ?? ['bg'],
    }),
  ])
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  portalLinkRepo.seedLinks([buildTestPortalLink({ label: 'Menu' })])
  portalLinkRepo.saveTexts(
    '10000000-0000-0000-0000-000000000001',
    [{ locale: 'en', label: 'Menu', line: null, provenance: null }],
    {
      actorUserId: 'user-1',
      at: AT,
    },
  )
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
    const { useCase } = setup()
    const coverage = await useCase(
      { portalId: PORTAL },
      buildTestAuthContext({ role: 'PropertyManager' }),
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
    const { useCase } = setup()
    const coverage = await useCase(
      { portalId: PORTAL },
      buildTestAuthContext({ role: 'PropertyManager' }),
    )
    const bg = coverage.languages[1]
    expect(bg?.missing.find((text) => text.kind === 'link_label')).toMatchObject({
      linkLabel: 'Menu',
    })
  })

  it('reads the Property wording of each language a Portal offers', async () => {
    const { useCase } = setup({
      content: [propertyContent('en', 'Avela'), propertyContent('bg', 'Авела')],
    })
    const coverage = await useCase(
      { portalId: PORTAL },
      buildTestAuthContext({ role: 'PropertyManager' }),
    )
    expect(coverage.languages[1]?.missing.map((text) => text.kind)).toEqual([
      'link_label',
    ])
  })

  it('does not count a Portal override for a language the Property has no wording for', async () => {
    const { useCase } = setup({
      overrides: [{ locale: 'bg', title: 'Авела', shortDescription: 'До морето' }],
    })
    const coverage = await useCase(
      { portalId: PORTAL },
      buildTestAuthContext({ role: 'PropertyManager' }),
    )
    expect(coverage.languages[1]?.missing.map((text) => text.kind)).toEqual([
      'title',
      'description',
      'link_label',
    ])
    expect(
      coverage.languages[1]?.missing.filter((text) => text.blocksPublish),
    ).toHaveLength(2)
  })

  it('refuses a caller who holds no Portal read permission', async () => {
    const { useCase } = setup()
    await expect(
      useCase(
        { portalId: PORTAL },
        buildTestAuthContext({ effectivePermissions: new Set() }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { useCase } = setup({
      accessible: [propertyId('a0000000-0000-0000-0000-0000000000ff')],
    })
    await expect(
      useCase({ portalId: PORTAL }, buildTestAuthContext({ role: 'PropertyManager' })),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('does not find a Portal of another organization', async () => {
    const { useCase } = setup()
    await expect(
      useCase(
        { portalId: PORTAL },
        buildTestAuthContext({
          role: 'PropertyManager',
          organizationId: organizationId('org-00000000-0000-0000-0000-0000000000aa'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})

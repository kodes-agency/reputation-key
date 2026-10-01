// Portal context — save the per-language texts of a link

import { describe, expect, it } from 'vitest'
import { savePortalLinkTexts } from './save-portal-link-texts'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-10-01T12:00:00Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const outbox = createRecordedOutbox()
  const useCase = savePortalLinkTexts({
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
    commandStore: createInMemoryPortalCommandStore({
      portalRepo,
      portalLinkRepo,
      outbox,
    }),
    clock: () => FIXED_TIME,
  })
  const portal = buildTestPortal({ additionalGuestLocales: ['bg'] })
  portalRepo.seed([portal])
  const category = buildTestPortalLinkCategory({})
  portalLinkRepo.seedCategories([category])
  const link = buildTestPortalLink({ label: 'Legacy label' })
  portalLinkRepo.seedLinks([link])
  return { useCase, portalRepo, portalLinkRepo, outbox, portal, link }
}

const manager = () => buildTestAuthContext({ role: 'PropertyManager' })

describe('savePortalLinkTexts', () => {
  it('saves a text per offered language and leaves the legacy link label alone', async () => {
    const { useCase, portalLinkRepo, link } = setup()

    await useCase(
      {
        linkId: link.id,
        texts: [
          { locale: 'en', label: '  Explore  ', line: 'Maps and tips' },
          { locale: 'bg', label: 'Разгледайте', line: null },
        ],
      },
      manager(),
    )

    expect(
      portalLinkRepo
        .storedTexts()
        .map((text) => [text.locale, text.label, text.line, text.provenance]),
    ).toEqual([
      ['en', 'Explore', 'Maps and tips', null],
      ['bg', 'Разгледайте', null, null],
    ])
    expect((await portalLinkRepo.findLinkById(link.organizationId, link.id))?.label).toBe(
      'Legacy label',
    )
  })

  it('records one portal_link.updated fact carrying identifiers only', async () => {
    const { useCase, outbox, link, portal } = setup()

    await useCase(
      { linkId: link.id, texts: [{ locale: 'en', label: 'Explore' }] },
      manager(),
    )

    expect(outbox.byTag('portal_link.updated')).toEqual([
      expect.objectContaining({
        linkId: link.id,
        portalId: portal.id,
        categoryId: link.categoryId,
        occurredAt: FIXED_TIME,
      }),
    ])
    expect(JSON.stringify(outbox.byTag('portal_link.updated'))).not.toContain('Explore')
  })

  it.each([
    ['an empty label', [{ locale: 'en' as const, label: '  ' }], 'invalid_label'],
    [
      'an over-long line',
      [{ locale: 'en' as const, label: 'Ok', line: 'x'.repeat(161) }],
      'invalid_label',
    ],
    [
      'a language the Portal does not offer',
      [{ locale: 'de' as const, label: 'Ok' }],
      'locale_not_offered',
    ],
    [
      'the same language twice',
      [
        { locale: 'en' as const, label: 'One' },
        { locale: 'en' as const, label: 'Two' },
      ],
      'locale_not_offered',
    ],
    ['no texts at all', [], 'invalid_label'],
  ])('refuses %s and writes nothing', async (_name, texts, code) => {
    const { useCase, portalLinkRepo, outbox, link } = setup()

    await expect(useCase({ linkId: link.id, texts }, manager())).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === code,
    )

    expect(portalLinkRepo.storedTexts()).toEqual([])
    expect(outbox.byTag('portal_link.updated')).toEqual([])
  })

  it('refuses a role without portal.update', async () => {
    const { useCase, link } = setup()

    await expect(
      useCase(
        { linkId: link.id, texts: [{ locale: 'en', label: 'Explore' }] },
        buildTestAuthContext({ role: 'Member' }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
  })

  it('refuses a manager who is not assigned to the Property', async () => {
    const { useCase, link } = setup([])

    await expect(
      useCase(
        { linkId: link.id, texts: [{ locale: 'en', label: 'Explore' }] },
        manager(),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
  })

  it('answers link_not_found for a link of another organization', async () => {
    const { useCase, link } = setup()

    await expect(
      useCase(
        { linkId: link.id, texts: [{ locale: 'en', label: 'Explore' }] },
        buildTestAuthContext({
          role: 'PropertyManager',
          organizationId: 'org-99999999-0000-0000-0000-000000000009' as never,
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'link_not_found',
    )
  })

  it('advances the Portal revision beyond the one it read', async () => {
    const { useCase, portalRepo, portal, link } = setup()

    await useCase(
      { linkId: link.id, texts: [{ locale: 'en', label: 'Explore' }] },
      manager(),
    )

    const after = await portalRepo.findById(portal.organizationId, portal.id)
    expect(after?.updatedAt.getTime()).toBeGreaterThan(portal.updatedAt.getTime())
  })
})

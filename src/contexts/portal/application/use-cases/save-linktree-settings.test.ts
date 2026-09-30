// Portal context — save the Linktree section's switch and titles

import { describe, expect, it } from 'vitest'
import { saveLinktreeSettings } from './save-linktree-settings'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
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
  let next = 0
  const useCase = saveLinktreeSettings({
    portalRepo,
    staffPublicApi: staffApiMock(accessible),
    commandStore: createInMemoryPortalCommandStore({
      portalRepo,
      portalLinkRepo,
      outbox,
    }),
    idGen: () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, '0')}`,
    clock: () => FIXED_TIME,
  })
  const portal = buildTestPortal({ additionalGuestLocales: ['bg'] })
  portalRepo.seed([portal])
  return { useCase, portalRepo, portalLinkRepo, outbox, portal }
}

const manager = () => buildTestAuthContext({ role: 'PropertyManager' })

describe('saveLinktreeSettings', () => {
  it('turns the section off and back on', async () => {
    const { useCase, portalRepo, portal } = setup()
    expect(portal.linktreeEnabled).toBe(true)

    await useCase({ portalId: portal.id, enabled: false }, manager())
    expect(
      (await portalRepo.findById(portal.organizationId, portal.id))?.linktreeEnabled,
    ).toBe(false)

    await useCase({ portalId: portal.id, enabled: true }, manager())
    expect(
      (await portalRepo.findById(portal.organizationId, portal.id))?.linktreeEnabled,
    ).toBe(true)
  })

  it('saves a trimmed title per offered language', async () => {
    const { useCase, portalLinkRepo, portal } = setup()

    await useCase(
      {
        portalId: portal.id,
        titles: [
          { locale: 'en', title: '  Around town  ' },
          { locale: 'bg', title: 'Из града' },
        ],
      },
      manager(),
    )

    expect(portalLinkRepo.linktreeTitles(portal.id)).toEqual({
      en: 'Around town',
      bg: 'Из града',
    })
  })

  it('resets a title to the default with null or a blank', async () => {
    const { useCase, portalLinkRepo, portal } = setup()
    await useCase(
      {
        portalId: portal.id,
        titles: [
          { locale: 'en', title: 'Around town' },
          { locale: 'bg', title: 'Из града' },
        ],
      },
      manager(),
    )

    await useCase(
      {
        portalId: portal.id,
        titles: [
          { locale: 'en', title: null },
          { locale: 'bg', title: '   ' },
        ],
      },
      manager(),
    )

    expect(portalLinkRepo.linktreeTitles(portal.id)).toEqual({})
  })

  it('records one portal.updated fact that keeps the publication state and carries no text', async () => {
    const { useCase, outbox, portal } = setup()

    await useCase(
      {
        portalId: portal.id,
        enabled: false,
        titles: [{ locale: 'en', title: 'Around town' }],
      },
      manager(),
    )

    const facts = outbox.byTag('portal.updated')
    expect(facts).toEqual([
      expect.objectContaining({
        portalId: portal.id,
        previousPublicationState: portal.publicationState,
        publicationState: portal.publicationState,
        occurredAt: FIXED_TIME,
      }),
    ])
    expect(JSON.stringify(facts)).not.toContain('Around town')
  })

  it.each([
    [
      'a title over the limit',
      { titles: [{ locale: 'en' as const, title: 'x'.repeat(61) }] },
      'invalid_title',
    ],
    [
      'a language the Portal does not offer',
      { titles: [{ locale: 'de' as const, title: 'Nützlich' }] },
      'locale_not_offered',
    ],
    [
      'the same language twice',
      {
        titles: [
          { locale: 'en' as const, title: 'One' },
          { locale: 'en' as const, title: 'Two' },
        ],
      },
      'locale_not_offered',
    ],
    ['nothing to change', {}, 'invalid_title'],
  ])('refuses %s and writes nothing', async (_name, change, code) => {
    const { useCase, portalLinkRepo, outbox, portal } = setup()

    await expect(
      useCase({ portalId: portal.id, ...change }, manager()),
    ).rejects.toSatisfy((error: unknown) => isPortalError(error) && error.code === code)

    expect(portalLinkRepo.linktreeTitles(portal.id)).toEqual({})
    expect(outbox.byTag('portal.updated')).toEqual([])
  })

  it('refuses a role without portal.update', async () => {
    const { useCase, portal } = setup()

    await expect(
      useCase(
        { portalId: portal.id, enabled: false },
        buildTestAuthContext({ role: 'Member' }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
  })

  it('refuses a manager who is not assigned to the Property', async () => {
    const { useCase, portal } = setup([])

    await expect(
      useCase({ portalId: portal.id, enabled: false }, manager()),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
  })
})

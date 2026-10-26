// Portal context — update link use case tests

import { describe, it, expect, vi } from 'vitest'
import { updateLink } from './update-link'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
} from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  organizationId,
  portalMediaAssetId,
  propertyId,
  type PropertyId,
  userId,
} from '#/shared/domain/ids'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const outbox = createRecordedOutbox()
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const deps = {
    portalRepo,
    portalLinkRepo,
    mediaRepo,
    staffPublicApi: staffApiMock(accessible),
    commandStore: createInMemoryPortalCommandStore({
      portalRepo,
      portalLinkRepo,
      outbox,
    }),
    destinationRepo: {
      request: async (
        input: Parameters<
          import('../ports/portal-approved-destination.repository').PortalApprovedDestinationRepository['request']
        >[0],
      ) => ({
        id: input.id,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        normalizedUri: input.destination.normalizedUri,
        hostname: input.destination.hostname,
        sourceType: input.destination.sourceType,
        approvalState: 'approved' as const,
        validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
        requestedBy: input.requestedBy,
        approvedBy: userId('admin-1'),
        approvedAt: input.at,
        disabledAt: null,
        disabledReason: null,
        lastValidatedAt: input.at,
        createdAt: input.at,
        updatedAt: input.at,
      }),
    },
    destinationNetworkValidator: {
      validate: async (uri: string) => ({
        outcome: 'safe' as const,
        validatedAt: FIXED_TIME,
        finalUri: uri,
        redirectCount: 0,
      }),
    },
    idGen: () => '20000000-0000-4000-8000-000000000001',
    clock: () => FIXED_TIME,
  }
  const useCase = updateLink(deps)
  return { useCase, portalRepo, portalLinkRepo, outbox, mediaRepo }
}

describe('updateLink', () => {
  it('updates link label and URL', async () => {
    const { useCase, portalRepo, portalLinkRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    const updated = await useCase(
      { linkId: link.id, label: 'New Label', url: 'https://new.com' },
      ctx,
    )

    expect(updated.label).toBe('New Label')
    expect(updated.url).toBe('https://new.com/')
    expect(outbox.byTag('portal_link.updated')).toEqual([
      expect.objectContaining({
        linkId: link.id,
        occurredAt: FIXED_TIME,
        sourceAggregateVersion: new Date(FIXED_TIME.getTime() + 1).toISOString(),
      }),
    ])
  })

  it('keeps the primary-language text in step with the label, and keeps its line', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([buildTestPortal({})])
    const link = buildTestPortalLink({ label: 'Old label' })
    portalLinkRepo.seedLinks([link])
    portalLinkRepo.saveTexts(
      link.id,
      [{ locale: 'en', label: 'Old label', line: 'Open daily', provenance: null }],
      { actorUserId: 'user-1', at: FIXED_TIME },
    )

    await useCase({ linkId: link.id, label: 'New label' }, ctx)

    expect(
      portalLinkRepo
        .storedTexts()
        .map((text) => [text.locale, text.label, text.line, text.version]),
    ).toEqual([['en', 'New label', 'Open daily', 2]])
  })

  it('leaves the primary-language text and the legacy label alone when no label is sent', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([buildTestPortal({})])
    const link = buildTestPortalLink({ label: '' })
    portalLinkRepo.seedLinks([link])
    portalLinkRepo.saveTexts(
      link.id,
      [{ locale: 'en', label: 'Current wording', line: null, provenance: null }],
      { actorUserId: 'user-1', at: FIXED_TIME },
    )

    const updated = await useCase({ linkId: link.id, iconKey: 'info' }, ctx)

    expect(
      portalLinkRepo.storedTexts().map((text) => [text.locale, text.label, text.version]),
    ).toEqual([['en', 'Current wording', 1]])
    expect(updated.label).toBe('')
    expect((await portalLinkRepo.findLinkById(link.organizationId, link.id))?.label).toBe(
      '',
    )
  })

  it('creates the primary-language text for a link that never had one', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([buildTestPortal({})])
    const link = buildTestPortalLink({ label: 'Old label' })
    portalLinkRepo.seedLinks([link])

    await useCase({ linkId: link.id, label: 'New label' }, ctx)

    expect(portalLinkRepo.storedTexts().map((text) => [text.locale, text.label])).toEqual(
      [['en', 'New label']],
    )
  })

  it('refuses an icon outside the closed set with a PortalError, before any write', async () => {
    const { useCase, portalRepo, portalLinkRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([buildTestPortal({})])
    const link = buildTestPortalLink({ iconKey: 'star' })
    portalLinkRepo.seedLinks([link])

    const attempt = useCase({ linkId: link.id, iconKey: 'google' }, ctx)

    await expect(attempt).rejects.toMatchObject({ code: 'invalid_icon' })
    expect(outbox.byTag('portal_link.updated')).toEqual([])
  })

  it('clears the icon when given null', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([buildTestPortal({})])
    const link = buildTestPortalLink({ iconKey: 'star' })
    portalLinkRepo.seedLinks([link])

    const updated = await useCase({ linkId: link.id, iconKey: null }, ctx)

    expect(updated.iconKey).toBeNull()
  })

  it('rejects when the Portal revision advanced after the atomic child snapshot', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const previousRevision = new Date('2026-04-10T12:00:00.000Z')
    const portal = buildTestPortal({
      updatedAt: new Date(previousRevision.getTime() + 1),
    })
    const stale = buildTestPortalLink({ url: 'https://old.example' })
    const current = { ...stale, url: 'https://concurrent.example' }
    portalRepo.seed([portal])
    portalLinkRepo.seedLinks([current])
    vi.spyOn(portalLinkRepo, 'findLinkCommandTarget').mockResolvedValueOnce({
      link: stale,
      portalUpdatedAt: previousRevision,
    })

    await expect(
      useCase({ linkId: stale.id, label: 'New Label' }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'revision_conflict',
    )

    expect(portalLinkRepo.allLinks()[0]?.url).toBe('https://concurrent.example')
  })

  it('rejects users who cannot update', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Member' })

    await expect(useCase({ linkId: 'any', label: 'Test' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('rejects when link not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ linkId: 'nonexistent', label: 'Test' }, ctx),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'link_not_found')
  })

  it('rejects empty label', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id, label: '' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'invalid_label',
    )
  })

  it('rejects invalid URL', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id, url: 'bad-url' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'invalid_url',
    )
  })

  it('returns existing link unchanged when no fields provided', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({ label: 'Original' })
    portalLinkRepo.seedLinks([link])

    const updated = await useCase({ linkId: link.id }, ctx)

    expect(updated.label).toBe('Original')
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id, label: 'New' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    const updated = await useCase({ linkId: link.id, label: 'New' }, ctx)

    expect(updated.label).toBe('New')
  })
})

describe('updateLink tile photo', () => {
  const PHOTO = '30000000-0000-4000-8000-000000000001'
  const photo = (overrides: Parameters<typeof buildTestPortalMediaAsset>[0] = {}) =>
    buildTestPortalMediaAsset({
      id: portalMediaAssetId(PHOTO),
      purpose: 'link_image',
      ...overrides,
    })

  const arrange = (assets: ReadonlyArray<ReturnType<typeof photo>> = [photo()]) => {
    const world = setup()
    world.portalRepo.seed([buildTestPortal({})])
    const link = buildTestPortalLink({ iconKey: 'star' })
    world.portalLinkRepo.seedLinks([link])
    world.mediaRepo.seed(assets)
    return { ...world, link, ctx: buildTestAuthContext({ role: 'PropertyManager' }) }
  }

  it('puts an uploaded picture of this Property on the link', async () => {
    const { useCase, link, ctx, portalLinkRepo, outbox } = arrange()

    const updated = await useCase({ linkId: link.id, imageAssetId: PHOTO }, ctx)

    expect(updated.imageAssetId).toBe(PHOTO)
    expect(portalLinkRepo.allLinks()[0]?.imageAssetId).toBe(PHOTO)
    expect(outbox.byTag('portal_link.updated')).toHaveLength(1)
  })

  it('keeps the icon when a picture is added, and the picture when only the label changes', async () => {
    const { useCase, link, ctx } = arrange()

    const withPhoto = await useCase({ linkId: link.id, imageAssetId: PHOTO }, ctx)
    const relabelled = await useCase({ linkId: link.id, label: 'Menu' }, ctx)

    expect(withPhoto.iconKey).toBe('star')
    expect(relabelled.imageAssetId).toBe(PHOTO)
  })

  it('takes the picture off with null, in one write with the icon that replaces it', async () => {
    const { useCase, link, ctx, portalLinkRepo } = arrange()
    await useCase({ linkId: link.id, imageAssetId: PHOTO }, ctx)

    const updated = await useCase(
      { linkId: link.id, iconKey: 'map-pin', imageAssetId: null },
      ctx,
    )

    expect(updated.imageAssetId).toBeNull()
    expect(portalLinkRepo.allLinks()[0]).toMatchObject({
      iconKey: 'map-pin',
      imageAssetId: null,
    })
  })

  it.each([
    ['an asset that does not exist', []],
    [
      'an asset of another Property',
      [photo({ propertyId: propertyId('a0000000-0000-0000-0000-0000000000ff') })],
    ],
    [
      'an asset of another Organization',
      [photo({ organizationId: organizationId('org-someone-else') })],
    ],
    ['an image uploaded as a hero photo', [photo({ purpose: 'hero' })]],
    ['an image uploaded as a logo', [photo({ purpose: 'logo' })]],
    ['an image that was taken down', [photo({ status: 'taken_down' })]],
  ])('refuses %s, before any write', async (_name, assets) => {
    const { useCase, link, ctx, portalLinkRepo, outbox } = arrange(assets)

    await expect(
      useCase({ linkId: link.id, imageAssetId: PHOTO }, ctx),
    ).rejects.toMatchObject({ code: 'media_not_found' })

    expect(portalLinkRepo.allLinks()[0]?.imageAssetId ?? null).toBeNull()
    expect(outbox.byTag('portal_link.updated')).toEqual([])
  })

  it('refuses an id that is not a UUID without asking the store', async () => {
    const { useCase, link, ctx } = arrange()

    await expect(
      useCase({ linkId: link.id, imageAssetId: 'not-a-uuid' }, ctx),
    ).rejects.toMatchObject({ code: 'media_not_found' })
  })

  it('does not look the picture up when the caller left it alone', async () => {
    const { useCase, link, ctx, mediaRepo } = arrange()
    const lookup = vi.spyOn(mediaRepo, 'findById')

    await useCase({ linkId: link.id, label: 'Menu' }, ctx)

    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('updateLink to a phone number or an email address', () => {
  const arrange = (overrides: Parameters<typeof buildTestPortalLink>[0] = {}) => {
    const fixture = setup()
    fixture.portalRepo.seed([buildTestPortal({})])
    const link = buildTestPortalLink(overrides)
    fixture.portalLinkRepo.seedLinks([link])
    return { ...fixture, link, ctx: buildTestAuthContext({ role: 'PropertyManager' }) }
  }

  it('stores the number in its one form and gives a tile with no icon a phone', async () => {
    const { useCase, link, ctx } = arrange()

    const updated = await useCase({ linkId: link.id, url: '+44 20 7946 0958' }, ctx)

    expect(updated.url).toBe('tel:+442079460958')
    expect(updated.iconKey).toBe('phone')
  })

  it('gives a tile with no icon a letter for an email address', async () => {
    const { useCase, link, ctx } = arrange()

    const updated = await useCase({ linkId: link.id, url: 'mailto:front@hotel.com' }, ctx)

    expect(updated.url).toBe('mailto:front@hotel.com')
    expect(updated.iconKey).toBe('mail')
  })

  it('keeps an icon or a photo the tile already wears', async () => {
    const withIcon = arrange({ iconKey: 'concierge-bell' })
    expect(
      (
        await withIcon.useCase(
          { linkId: withIcon.link.id, url: 'front@hotel.com' },
          withIcon.ctx,
        )
      ).iconKey,
    ).toBe('concierge-bell')

    const withPhoto = arrange({
      imageAssetId: portalMediaAssetId('30000000-0000-4000-8000-000000000001'),
    })
    expect(
      (
        await withPhoto.useCase(
          { linkId: withPhoto.link.id, url: '5551234567' },
          withPhoto.ctx,
        )
      ).iconKey,
    ).toBeNull()
  })

  it.each([
    ['tel:+15551234567', 'phone', 'front@hotel.com', 'mail'],
    ['mailto:front@hotel.com', 'mail', '+15551234567', 'phone'],
    ['tel:+15551234567', 'phone', 'https://hotel.example.com/spa', null],
  ] as const)(
    'swaps the automatic icon of %s (%s) for that of %s',
    async (url, iconKey, nextUrl, nextIcon) => {
      const { useCase, link, ctx } = arrange({ url, iconKey })

      const updated = await useCase({ linkId: link.id, url: nextUrl }, ctx)

      expect(updated.iconKey).toBe(nextIcon)
    },
  )

  it('keeps an icon that is not the automatic one for the old address', async () => {
    // A phone on a website tile was chosen, and so was a letter on a phone tile.
    const onSite = arrange({ url: 'https://hotel.example.com', iconKey: 'phone' })
    expect(
      (
        await onSite.useCase(
          { linkId: onSite.link.id, url: 'front@hotel.com' },
          onSite.ctx,
        )
      ).iconKey,
    ).toBe('phone')
    const onPhone = arrange({ url: 'tel:+15551234567', iconKey: 'mail' })
    expect(
      (
        await onPhone.useCase(
          { linkId: onPhone.link.id, url: 'https://hotel.example.com' },
          onPhone.ctx,
        )
      ).iconKey,
    ).toBe('mail')
  })

  it('takes the icon asked for in the same write', async () => {
    const { useCase, link, ctx } = arrange()

    const updated = await useCase(
      { linkId: link.id, url: '5551234567', iconKey: 'info' },
      ctx,
    )

    expect(updated.iconKey).toBe('info')
  })

  it('refuses a number with an extension or an address with a second recipient', async () => {
    const { useCase, link, ctx } = arrange()

    for (const url of ['tel:+1555123456;ext=2', 'front@hotel.com,spy@evil.com']) {
      await expect(useCase({ linkId: link.id, url }, ctx)).rejects.toMatchObject({
        code: 'invalid_url',
      })
    }
  })
})

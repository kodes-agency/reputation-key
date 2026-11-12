import { describe, expect, it, vi } from 'vitest'
import { PROPERTY } from '#/shared/testing/portal-create-setup'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { portalId, propertyId } from '#/shared/domain/ids'
import { PRINT_DEFAULT_WORDING } from '#/shared/domain/portal-print-wording'
import { portalError } from '../../domain/errors'
import { ctx, setup } from '#/shared/testing/personal-portal-setup'
import {
  keepingLinkIds,
  updatePersonalGuestPage,
  type UpdatePersonalGuestPageDeps,
} from './update-personal-guest-page'

const PERSON = portalId('12345678-abcd-4000-8000-000000000011')
type Tokens = UpdatePersonalGuestPageDeps['portalTokenRepo']
const ADDRESS_THAT_RESOLVES: Tokens = {
  findResolvableSummaryForPortal: async () => ({ id: 'token' }) as never,
}
const NO_ADDRESS: Tokens = { findResolvableSummaryForPortal: async () => null }

function world(
  person: Partial<ReturnType<typeof buildTestPortal>> = {},
  options: Readonly<{ kind?: 'personal' | 'place' }> = {},
) {
  const { deps, state, source } = setup()
  const reception = buildTestPortal({
    id: portalId(source.portal.id),
    organizationId: ctx.organizationId,
    propertyId: PROPERTY,
    name: 'Reception',
    publicationState: 'published',
  })
  const page = buildTestPortal({
    id: PERSON,
    organizationId: ctx.organizationId,
    propertyId: PROPERTY,
    name: 'Polly Smith',
    publicName: 'Old name',
    kind: options.kind ?? 'personal',
    publicationState: 'published',
    ...person,
  })
  state.portalRepo.seed([reception, page])
  const publishChanges = vi.fn(async () => ({
    outcome: 'published' as const,
    snapshotId: 'snapshot',
    version: 2,
    configurationDigest: 'digest',
    activatedAt: new Date(),
  }))
  const replace = vi.fn(deps.commandStore.replacePersonalPortalContent)
  const withAddress = { ...deps, portalTokenRepo: ADDRESS_THAT_RESOLVES }
  const update = updatePersonalGuestPage({
    ...withAddress,
    commandStore: { ...deps.commandStore, replacePersonalPortalContent: replace },
    publishChanges,
  })
  return { update, replace, publishChanges, reception, page, deps: withAddress, state }
}

describe('updatePersonalGuestPage', () => {
  it('replaces the page with the source and puts it live', async () => {
    const { update, replace, publishChanges, reception } = world()
    await expect(
      update({ portalId: PERSON, sourcePortalId: reception.id }, ctx),
    ).resolves.toEqual({ outcome: 'live' })
    expect(replace).toHaveBeenCalledOnce()
    expect(replace.mock.calls[0]![0]).toMatchObject({
      portalId: PERSON,
      propertyId: PROPERTY,
      publicName: reception.publicName ?? reception.name,
      primaryGuestLocale: reception.primaryGuestLocale,
      content: { sourcePortalId: reception.id },
      sourceFence: { portalId: reception.id, updatedAt: reception.updatedAt },
    })
    expect(publishChanges).toHaveBeenCalledWith({ portalId: PERSON }, ctx)
    // Replacing before publishing, so guests never see a half-made page.
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(
      publishChanges.mock.invocationCallOrder[0]!,
    )
  })

  it('leaves a paused page paused, holding the new content', async () => {
    const { update, replace, publishChanges, reception } = world({
      publicationState: 'disabled',
    })
    await expect(
      update({ portalId: PERSON, sourcePortalId: reception.id }, ctx),
    ).resolves.toEqual({ outcome: 'saved' })
    expect(replace).toHaveBeenCalledOnce()
    expect(publishChanges).not.toHaveBeenCalled()
  })

  it('does nothing when the page is the one being copied', async () => {
    const { update, replace, publishChanges } = world()
    await expect(
      update({ portalId: PERSON, sourcePortalId: PERSON }, ctx),
    ).resolves.toEqual({ outcome: 'unchanged' })
    expect(replace).not.toHaveBeenCalled()
    expect(publishChanges).not.toHaveBeenCalled()
  })

  it.each([
    ['a Portal that is nobody’s', { kind: 'place' as const }, {}, 'forbidden'],
    [
      'an archived page',
      {},
      { publicationState: 'archived' as const },
      'portal_inactive',
    ],
  ])('refuses %s, writing nothing', async (_name, options, person, code) => {
    const { update, replace, reception } = world(person, options)
    await expect(
      update({ portalId: PERSON, sourcePortalId: reception.id }, ctx),
    ).rejects.toMatchObject({ code })
    expect(replace).not.toHaveBeenCalled()
  })

  it('refuses a source at another Property, writing nothing', async () => {
    const { update, replace, reception, state } = world()
    state.portalRepo.seed([
      {
        ...reception,
        propertyId: propertyId('a0000000-0000-0000-0000-000000000002'),
      },
    ])
    await expect(
      update({ portalId: PERSON, sourcePortalId: reception.id }, ctx),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('refuses someone who may not change the page', async () => {
    const { update, replace, reception } = world()
    await expect(
      update(
        { portalId: PERSON, sourcePortalId: reception.id },
        buildTestAuthContext({ role: 'Member', organizationId: ctx.organizationId }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('checks the gates before replacing, so a refused publish changes nothing', async () => {
    const { deps, reception, publishChanges } = world()
    const replace = vi.fn(deps.commandStore.replacePersonalPortalContent)
    await expect(
      updatePersonalGuestPage({
        ...deps,
        commandStore: { ...deps.commandStore, replacePersonalPortalContent: replace },
        propertyGoogleReviewDestinationApi: {
          getGoogleReviewDestination: async () => null,
        },
        publishChanges,
      })({ portalId: PERSON, sourcePortalId: reception.id }, ctx),
    ).rejects.toMatchObject({ code: 'google_review_destination_unavailable' })
    expect(replace).not.toHaveBeenCalled()
  })

  it.each([
    [
      'nobody is responsible for it',
      { responsibilityNeededSince: new Date() },
      ADDRESS_THAT_RESOLVES,
      'responsible_manager_ineligible',
    ],
    ['its code no longer resolves', {}, NO_ADDRESS, 'token_unavailable'],
  ])('asks first when %s, so nothing changes', async (_name, person, tokens, code) => {
    const { deps, reception, publishChanges } = world(person)
    const replace = vi.fn(deps.commandStore.replacePersonalPortalContent)
    await expect(
      updatePersonalGuestPage({
        ...deps,
        portalTokenRepo: tokens,
        commandStore: { ...deps.commandStore, replacePersonalPortalContent: replace },
        publishChanges,
      })({ portalId: PERSON, sourcePortalId: reception.id }, ctx),
    ).rejects.toMatchObject({ code })
    expect(replace).not.toHaveBeenCalled()
  })

  it('says so when publishing refuses after the replace, rather than failing outright', async () => {
    const { deps, reception } = world()
    await expect(
      updatePersonalGuestPage({
        ...deps,
        publishChanges: async () => {
          throw portalError('revision_conflict', 'The page moved. Try again.')
        },
      })({ portalId: PERSON, sourcePortalId: reception.id }, ctx),
    ).resolves.toEqual({ outcome: 'not_live', message: 'The page moved. Try again.' })
  })

  it('lets an unexpected publishing fault surface', async () => {
    const { deps, reception } = world()
    await expect(
      updatePersonalGuestPage({
        ...deps,
        publishChanges: async () => {
          throw new Error('The database went away')
        },
      })({ portalId: PERSON, sourcePortalId: reception.id }, ctx),
    ).rejects.toThrow('The database went away')
  })

  it('writes the default print wording over the page’s when the source has none of its own', async () => {
    const { update, replace, reception } = world()
    await update({ portalId: PERSON, sourcePortalId: reception.id }, ctx)
    expect(replace.mock.calls[0]![0].printWording).toEqual(PRINT_DEFAULT_WORDING)
  })

  it('refuses a source whose guest wording would name the person', async () => {
    const { deps, reception, publishChanges } = world({ name: 'Harbor' })
    await expect(
      updatePersonalGuestPage({ ...deps, publishChanges })(
        { portalId: PERSON, sourcePortalId: reception.id },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'personal_portal_name_private' })
  })
})

describe('keepingLinkIds', () => {
  const copied = (id: string, destinationId: string) => ({ id, destinationId }) as never
  const content = {
    links: [
      copied('new-menu', 'menu'),
      copied('new-spa', 'spa'),
      copied('new-bar', 'bar'),
    ],
    linkTexts: [
      { linkId: 'new-menu', locale: 'en', label: 'Menu' },
      { linkId: 'new-bar', locale: 'en', label: 'Bar' },
    ],
  } as never

  it('gives a link the id it already had at that destination, and its texts with it', () => {
    const kept = keepingLinkIds(content, [
      { id: 'old-menu', destinationId: 'menu' },
      { id: 'old-gone', destinationId: 'gone' },
      { id: 'old-legacy', destinationId: null },
    ] as never)
    expect(kept.links.map((link) => link.id)).toEqual(['old-menu', 'new-spa', 'new-bar'])
    expect(kept.linkTexts.map((text) => text.linkId)).toEqual(['old-menu', 'new-bar'])
  })

  it('uses each old id once when two links share a destination', () => {
    const kept = keepingLinkIds(
      { links: [copied('a', 'menu'), copied('b', 'menu')], linkTexts: [] } as never,
      [{ id: 'old', destinationId: 'menu' }] as never,
    )
    expect(kept.links.map((link) => link.id)).toEqual(['old', 'b'])
  })
})

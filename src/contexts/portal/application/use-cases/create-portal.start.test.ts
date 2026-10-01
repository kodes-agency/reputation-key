// Portal context — createPortal: the choices the New portal dialog makes
// (group, languages, what to start from, who is responsible, the web address).

import { describe, expect, it, vi } from 'vitest'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import {
  organizationId,
  portalApprovedDestinationId,
  portalGroupId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
} from '#/shared/domain/ids'
import { isPortalError, portalError } from '../../domain/errors'
import type { PortalGroup } from '../../domain/types'
import {
  PORTAL_DESTINATION_VALIDATION_VERSION,
  type PortalApprovedDestination,
} from '../../domain/approved-destination'
import {
  CLOCK,
  CREATOR,
  OTHER_PROPERTY,
  PROPERTY,
  setupCreatePortal,
} from '#/shared/testing/portal-create-setup'

const ctx = buildTestAuthContext({ role: 'PropertyManager' })
const base = { propertyId: String(PROPERTY) }
const GROUP = portalGroupId('90000000-0000-0000-0000-000000000001')
const SOURCE = portalId('d0000000-0000-0000-0000-0000000000a1')
const DESTINATION = portalApprovedDestinationId('de000000-0000-0000-0000-000000000001')

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
  try {
    await run
  } catch (error) {
    return isPortalError(error) ? error.code : 'not-a-portal-error'
  }
  return undefined
}

const destinationOf = (
  id: typeof DESTINATION,
  approvalState: PortalApprovedDestination['approvalState'],
): PortalApprovedDestination => ({
  id,
  organizationId: ctx.organizationId,
  propertyId: PROPERTY,
  normalizedUri: `https://example.com/${id}`,
  hostname: 'example.com',
  sourceType: 'custom',
  approvalState,
  validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
  requestedBy: CREATOR as never,
  approvedBy: null,
  approvedAt: null,
  disabledAt: null,
  disabledReason: null,
  lastValidatedAt: CLOCK,
  createdAt: CLOCK,
  updatedAt: CLOCK,
})

const groupOf = (patch: Partial<PortalGroup> = {}): PortalGroup => ({
  id: GROUP,
  organizationId: ctx.organizationId,
  propertyId: PROPERTY,
  name: 'Pool side',
  sortKey: null,
  createdBy: null,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-02T00:00:00Z'),
  deletedAt: null,
  ...patch,
})

describe('createPortal web address', () => {
  it('gives a name whose address is taken the next free numbered address', async () => {
    const { useCase, portalRepo } = setupCreatePortal()
    portalRepo.seed([
      buildTestPortal({ id: 'p-1', slug: 'rooftop-pool', propertyId: PROPERTY }),
      buildTestPortal({ id: 'p-2', slug: 'rooftop-pool-2', propertyId: PROPERTY }),
    ])
    const portal = await useCase({ ...base, name: 'Rooftop pool' }, ctx)
    expect(portal.slug).toBe('rooftop-pool-3')
  })

  it.each(['Рецепция', 'Басейн на покрива', 'A', '☕☕'])(
    'gives a portal named %j an address from its own id, which the manager never sees',
    async (name) => {
      const { useCase } = setupCreatePortal()
      const portal = await useCase({ ...base, name }, ctx)
      expect(portal.slug).toBe(
        `portal-${String(portal.id).replaceAll('-', '').slice(0, 8)}`,
      )
    },
  )

  it('creates every Cyrillic portal at once, however many the Property already holds', async () => {
    const { useCase, portalRepo } = setupCreatePortal()
    // Fifty-one portals named in Cyrillic: a counter would have run out of addresses.
    for (let n = 0; n < 51; n += 1) await useCase({ ...base, name: `Басейн ${n}` }, ctx)
    expect(portalRepo.all()).toHaveLength(51)
    expect(new Set(portalRepo.all().map((portal) => portal.slug)).size).toBe(51)
  })

  it('looks the id-based address up once when it is free', async () => {
    const { useCase, portalRepo } = setupCreatePortal()
    const slugExists = vi.spyOn(portalRepo, 'slugExists')
    await useCase({ ...base, name: 'Рецепция' }, ctx)
    expect(slugExists).toHaveBeenCalledTimes(1)
  })

  it('takes a longer slice of the id when the short address is held', async () => {
    const { useCase, portalRepo } = setupCreatePortal()
    // The id the next create will get is the first one the setup hands out.
    portalRepo.seed([
      buildTestPortal({
        id: 'p-held',
        slug: 'portal-d0000000',
        propertyId: PROPERTY,
      }),
    ])
    const portal = await useCase({ ...base, name: 'Рецепция' }, ctx)
    expect(portal.slug).toBe('portal-d00000000000')
  })

  it('does not mistake a Latin portal named Portal for a fallback address', async () => {
    const { useCase } = setupCreatePortal()
    const latin = await useCase({ ...base, name: 'Portal' }, ctx)
    const cyrillic = await useCase({ ...base, name: 'Портал' }, ctx)
    expect(latin.slug).toBe('portal')
    expect(cyrillic.slug).not.toBe('portal')
  })

  it('says the address ran out, not that the name exists, when fifty numbered ones are taken', async () => {
    const { useCase, portalRepo } = setupCreatePortal()
    portalRepo.seed(
      Array.from({ length: 50 }, (_, n) =>
        buildTestPortal({
          id: `p-${n}`,
          slug: n === 0 ? 'pool' : `pool-${n + 1}`,
          propertyId: PROPERTY,
        }),
      ),
    )
    const error = await useCase({ ...base, name: 'Pool' }, ctx).catch((e: unknown) => e)
    expect(isPortalError(error) && error.code).toBe('slug_taken')
    expect((error as Error).message).toMatch(/address/i)
    expect((error as Error).message).not.toMatch(/name already exists/i)
  })

  it('keeps the plain address when it is free', async () => {
    const { useCase } = setupCreatePortal()
    expect((await useCase({ ...base, name: 'Rooftop pool' }, ctx)).slug).toBe(
      'rooftop-pool',
    )
  })

  it('takes the next free address when another create took it between the check and the commit', async () => {
    const { useCase, portalRepo, commandStore } = setupCreatePortal()
    const commit = commandStore.createPortal
    let first = true
    const racing = vi
      .spyOn(commandStore, 'createPortal')
      .mockImplementation(async (command) => {
        if (first) {
          first = false
          // The other create commits 'rooftop-pool' just before this one does.
          portalRepo.seed([
            buildTestPortal({ id: 'p-race', slug: 'rooftop-pool', propertyId: PROPERTY }),
          ])
          throw portalError('slug_taken', 'a portal with this slug already exists')
        }
        await commit(command)
      })
    const portal = await useCase({ ...base, name: 'Rooftop pool' }, ctx)
    expect(portal.slug).toBe('rooftop-pool-2')
    expect(racing).toHaveBeenCalledTimes(2)
  })

  it('does not retry an address the manager typed', async () => {
    const { useCase, commandStore } = setupCreatePortal()
    const racing = vi
      .spyOn(commandStore, 'createPortal')
      .mockRejectedValue(
        portalError('slug_taken', 'a portal with this slug already exists'),
      )
    expect(await codeOf(useCase({ ...base, name: 'Pool', slug: 'my-pool' }, ctx))).toBe(
      'slug_taken',
    )
    expect(racing).toHaveBeenCalledTimes(1)
  })

  it('still refuses an address the manager typed that is already taken', async () => {
    const { useCase, portalRepo } = setupCreatePortal()
    portalRepo.seed([
      buildTestPortal({ id: 'p-1', slug: 'custom', propertyId: PROPERTY }),
    ])
    expect(await codeOf(useCase({ ...base, name: 'Other', slug: 'custom' }, ctx))).toBe(
      'slug_taken',
    )
  })
})

describe('createPortal group', () => {
  it('puts the new portal in the group in the same commit and records the fact', async () => {
    const { useCase, portalGroupRepo, outbox, groupHistory } = setupCreatePortal()
    portalGroupRepo.seed(groupOf())

    const portal = await useCase({ ...base, name: 'Pool', groupId: String(GROUP) }, ctx)

    expect(
      await portalGroupRepo.findPortalMembership(ctx.organizationId, portal.id),
    ).toBe(GROUP)
    const [added] = outbox.byTag('portal_group.portal_added')
    expect(added).toMatchObject({ portalGroupId: GROUP, portalId: portal.id })
    // The group revision moves past the one the command read.
    expect(added?.sourceAggregateVersion).toBe('2026-04-10T12:00:00.000Z')
    // Like every other way into a group, creation leaves an 'added' history entry.
    expect(groupHistory).toEqual([
      expect.objectContaining({
        portalGroupId: GROUP,
        kind: 'portal_added',
        portalId: portal.id,
        actorUserId: ctx.userId,
      }),
    ])
  })

  it('leaves nothing behind when the group changed after it was read', async () => {
    const { useCase, portalGroupRepo, portalRepo, outbox, commandStore, groupHistory } =
      setupCreatePortal()
    portalGroupRepo.seed(groupOf())
    const commit = commandStore.createPortal
    vi.spyOn(commandStore, 'createPortal').mockImplementation(async (command) => {
      // Another change to the group lands between the read and the commit.
      await portalGroupRepo.update(ctx.organizationId, GROUP, {
        updatedAt: new Date('2026-04-03T00:00:00Z'),
      })
      await commit(command)
    })
    expect(
      await codeOf(useCase({ ...base, name: 'Pool', groupId: String(GROUP) }, ctx)),
    ).toBe('revision_conflict')
    expect(portalRepo.all()).toHaveLength(0)
    expect(outbox.facts).toHaveLength(0)
    expect(groupHistory).toHaveLength(0)
  })

  it('leaves the portal out of every group when none is chosen', async () => {
    const { useCase, portalGroupRepo, outbox } = setupCreatePortal()
    const portal = await useCase({ ...base, name: 'Pool' }, ctx)
    expect(
      await portalGroupRepo.findPortalMembership(ctx.organizationId, portal.id),
    ).toBeNull()
    expect(outbox.byTag('portal_group.portal_added')).toHaveLength(0)
  })

  it.each([
    ['an unknown group', undefined],
    ['an archived group', groupOf({ deletedAt: new Date('2026-04-05T00:00:00Z') })],
    ['a group of another Property', groupOf({ propertyId: OTHER_PROPERTY })],
    [
      'a group of another organization',
      groupOf({ organizationId: organizationId('org-other-000000000000000000000000') }),
    ],
  ])('refuses %s and creates nothing', async (_label, group) => {
    const { useCase, portalGroupRepo, portalRepo, outbox } = setupCreatePortal()
    if (group) portalGroupRepo.seed(group)
    expect(
      await codeOf(useCase({ ...base, name: 'Pool', groupId: String(GROUP) }, ctx)),
    ).toBe('group_not_found')
    expect(portalRepo.all()).toHaveLength(0)
    expect(outbox.facts).toHaveLength(0)
  })
})

describe('createPortal languages', () => {
  it('starts from the Property defaults, the first being the primary', async () => {
    const { useCase } = setupCreatePortal({ propertyDefaults: ['bg', 'en'] })
    const portal = await useCase({ ...base, name: 'Pool' }, ctx)
    expect([portal.primaryGuestLocale, portal.additionalGuestLocales]).toEqual([
      'bg',
      ['en'],
    ])
  })

  it('starts in English when the Property has no defaults', async () => {
    const { useCase } = setupCreatePortal()
    const portal = await useCase({ ...base, name: 'Pool' }, ctx)
    expect([portal.primaryGuestLocale, portal.additionalGuestLocales]).toEqual(['en', []])
  })

  it('uses the languages the manager chose over the defaults', async () => {
    const { useCase } = setupCreatePortal({ propertyDefaults: ['bg', 'en'] })
    const portal = await useCase({ ...base, name: 'Pool', guestLocales: ['en'] }, ctx)
    expect([portal.primaryGuestLocale, portal.additionalGuestLocales]).toEqual(['en', []])
  })

  it('refuses a language that is not offered yet', async () => {
    const { useCase, portalRepo } = setupCreatePortal()
    expect(
      await codeOf(
        useCase({ ...base, name: 'Pool', guestLocales: ['en', 'de'] as never }, ctx),
      ),
    ).toBe('locale_not_offered')
    expect(portalRepo.all()).toHaveLength(0)
  })
})

describe('createPortal responsible managers', () => {
  const OTHER = 'user-00000000-0000-0000-0000-000000000002'
  const managers = [
    { userId: CREATOR, role: 'PropertyManager' as const },
    { userId: OTHER, role: 'AccountAdmin' as const },
  ]

  it('takes the managers named, when they are eligible', async () => {
    const { useCase, commandStore } = setupCreatePortal({ managers })
    const spy = vi.spyOn(commandStore, 'createPortal')
    const portal = await useCase(
      { ...base, name: 'Pool', responsibleManagerUserIds: [OTHER] },
      ctx,
    )
    expect(spy.mock.calls[0]?.[0].initialResponsibleManagerIds).toEqual([OTHER])
    expect(portal.responsibilityNeededSince).toBeNull()
  })

  it('records every manager named, not only the first', async () => {
    const { useCase, initialManagers } = setupCreatePortal({ managers })
    const portal = await useCase(
      { ...base, name: 'Pool', responsibleManagerUserIds: [CREATOR, OTHER] },
      ctx,
    )
    expect(initialManagers.get(String(portal.id))).toEqual([CREATOR, OTHER])
  })

  it('refuses a manager who is not eligible for the Property', async () => {
    const { useCase, portalRepo } = setupCreatePortal({ managers })
    expect(
      await codeOf(
        useCase(
          { ...base, name: 'Pool', responsibleManagerUserIds: ['user-stranger'] },
          ctx,
        ),
      ),
    ).toBe('responsible_manager_ineligible')
    expect(portalRepo.all()).toHaveLength(0)
  })

  it('refuses the same manager twice', async () => {
    const { useCase } = setupCreatePortal({ managers })
    expect(
      await codeOf(
        useCase(
          { ...base, name: 'Pool', responsibleManagerUserIds: [OTHER, OTHER] },
          ctx,
        ),
      ),
    ).toBe('responsible_manager_ineligible')
  })

  it('starts with nobody responsible, and says so, when the list is empty', async () => {
    const { useCase, outbox } = setupCreatePortal({ managers })
    const portal = await useCase(
      { ...base, name: 'Pool', responsibleManagerUserIds: [] },
      ctx,
    )
    expect(portal.responsibilityNeededSince).toEqual(CLOCK)
    expect(outbox.byTag('portal.responsibility_became_needed')).toHaveLength(1)
  })

  it('makes the creator responsible by default', async () => {
    const { useCase, commandStore } = setupCreatePortal({ managers })
    const spy = vi.spyOn(commandStore, 'createPortal')
    await useCase({ ...base, name: 'Pool' }, ctx)
    expect(spy.mock.calls[0]?.[0].initialResponsibleManagerIds).toEqual([CREATOR])
  })
})

describe('createPortal start from', () => {
  const seedSource = (
    setup: ReturnType<typeof setupCreatePortal>,
    propertyId = PROPERTY,
  ) => {
    const source = buildTestPortal({
      id: String(SOURCE),
      propertyId,
      slug: 'source',
      primaryGuestLocale: 'en',
      additionalGuestLocales: ['bg'],
      description: 'Welcome to the pool',
    })
    const category = buildTestPortalLinkCategory({
      id: portalLinkCategoryId('c0000000-0000-0000-0000-00000000000a'),
      portalId: source.id,
      sortKey: 'a0',
    })
    const link = buildTestPortalLink({
      id: portalLinkId('10000000-0000-0000-0000-000000000001'),
      portalId: source.id,
      categoryId: category.id,
      destinationId: DESTINATION,
      legacyDestinationState: 'migrated',
      label: 'Menu',
    })
    setup.seedDestinations([destinationOf(DESTINATION, 'approved')])
    setup.portalRepo.seed([source])
    setup.portalLinkRepo.seedCategories([category])
    setup.portalLinkRepo.seedLinks([link])
    setup.portalLinkRepo.saveTexts(
      String(link.id),
      [
        { locale: 'en', label: 'Menu', line: null, provenance: null },
        { locale: 'bg', label: 'Меню', line: null, provenance: null },
      ],
      { actorUserId: CREATOR, at: CLOCK },
    )
    setup.seedSourceOverrides(source.id, [
      {
        id: 'ov-1',
        organizationId: source.organizationId,
        propertyId,
        portalId: source.id,
        locale: 'en',
        title: 'Pool',
        shortDescription: null,
        heroImageUrl: null,
        linktreeTitle: 'Good to know',
        version: 1,
        updatedBy: CREATOR as never,
        createdAt: CLOCK,
        updatedAt: CLOCK,
      },
    ])
    return { source, link }
  }

  it('copies wording, links, link texts and languages of another portal', async () => {
    const setup = setupCreatePortal({ propertyDefaults: ['en'] })
    const { source, link } = seedSource(setup)

    const portal = await setup.useCase(
      { ...base, name: 'Copy', startFrom: { kind: 'portal', portalId: String(SOURCE) } },
      ctx,
    )

    expect(portal.id).not.toBe(source.id)
    expect(portal.description).toBe('Welcome to the pool')
    expect([portal.primaryGuestLocale, portal.additionalGuestLocales]).toEqual([
      'en',
      ['bg'],
    ])
    const links = await setup.portalLinkRepo.listAllLinks(ctx.organizationId, portal.id)
    expect(links).toHaveLength(1)
    expect(links[0]?.id).not.toBe(link.id)
    expect(links[0]?.destinationId).toBe(DESTINATION)
    const texts = await setup.portalLinkRepo.listLinkTexts(
      ctx.organizationId,
      portal.id,
      'en',
    )
    expect(texts.map((t) => [t.locale, t.label])).toEqual([
      ['en', 'Menu'],
      ['bg', 'Меню'],
    ])
    expect(setup.copiedOverrides.get(String(portal.id))).toEqual([
      expect.objectContaining({
        locale: 'en',
        title: 'Pool',
        linktreeTitle: 'Good to know',
      }),
    ])
    // The source itself is untouched.
    expect(
      await setup.portalLinkRepo.listAllLinks(ctx.organizationId, source.id),
    ).toHaveLength(1)
  })

  it('takes only the languages chosen, even when copying', async () => {
    const setup = setupCreatePortal()
    seedSource(setup)
    const portal = await setup.useCase(
      {
        ...base,
        name: 'Copy',
        guestLocales: ['en'],
        startFrom: { kind: 'portal', portalId: String(SOURCE) },
      },
      ctx,
    )
    expect(portal.additionalGuestLocales).toEqual([])
    const texts = await setup.portalLinkRepo.listLinkTexts(
      ctx.organizationId,
      portal.id,
      'en',
    )
    expect(texts.map((t) => t.locale)).toEqual(['en'])
  })

  it('copies no code, publication or responsible manager', async () => {
    const setup = setupCreatePortal()
    seedSource(setup)
    const spy = vi.spyOn(setup.commandStore, 'createPortal')
    await setup.useCase(
      { ...base, name: 'Copy', startFrom: { kind: 'portal', portalId: String(SOURCE) } },
      ctx,
    )
    const command = spy.mock.calls[0]?.[0]
    expect(command?.initialResponsibleManagerIds).toEqual([CREATOR])
    expect(command?.portal.publicationState).toBe('draft')
    expect(Object.keys(command?.copiedContent ?? {}).sort()).toEqual([
      'categories',
      'linkTexts',
      'links',
      'overrides',
      'sourcePortalId',
    ])
  })

  it('carries nothing when it starts from the Property wording', async () => {
    const setup = setupCreatePortal()
    seedSource(setup)
    const spy = vi.spyOn(setup.commandStore, 'createPortal')
    const portal = await setup.useCase(
      { ...base, name: 'Fresh', startFrom: { kind: 'property' } },
      ctx,
    )
    expect(spy.mock.calls[0]?.[0].copiedContent).toBeUndefined()
    expect(portal.description).toBeNull()
  })

  it('copies only links whose destination is approved, so a disabled one does not take a slot', async () => {
    const setup = setupCreatePortal()
    const { source } = seedSource(setup)
    const destinationId = (n: number) =>
      portalApprovedDestinationId(`de000000-0000-0000-0000-00000000010${n}`)
    const disabled = destinationId(1)
    const quarantined = destinationId(2)
    const pending = destinationId(3)
    const approved = [4, 5, 6, 7].map((n) =>
      portalApprovedDestinationId(`de000000-0000-0000-0000-00000000010${n}`),
    )
    setup.seedDestinations([
      destinationOf(disabled, 'disabled'),
      destinationOf(quarantined, 'quarantined'),
      destinationOf(pending, 'pending'),
      ...approved.map((id) => destinationOf(id, 'approved')),
    ])
    const category = (
      await setup.portalLinkRepo.listCategories(ctx.organizationId, source.id)
    )[0]
    const extra = [disabled, quarantined, pending, ...approved].map(
      (destination, index) =>
        buildTestPortalLink({
          id: portalLinkId(`10000000-0000-0000-0000-00000000010${index}`),
          portalId: source.id,
          categoryId: category?.id,
          destinationId: destination,
          legacyDestinationState: 'migrated',
          label: `Extra ${index}`,
          // The seeded 'Menu' link sorts first; these follow, retired ones first.
          sortKey: `b${index}`,
        }),
    )
    setup.portalLinkRepo.seedLinks(extra)

    const portal = await setup.useCase(
      { ...base, name: 'Copy', startFrom: { kind: 'portal', portalId: String(SOURCE) } },
      ctx,
    )

    const links = await setup.portalLinkRepo.listAllLinks(ctx.organizationId, portal.id)
    expect(links.map((link) => link.destinationId).sort()).toEqual(
      [DESTINATION, approved[0], approved[1], approved[2]].sort(),
    )
  })

  it('refuses an archived portal as a starting point', async () => {
    const setup = setupCreatePortal()
    const { source } = seedSource(setup)
    setup.portalRepo.seed([{ ...source, publicationState: 'archived' }])
    expect(
      await codeOf(
        setup.useCase(
          {
            ...base,
            name: 'Copy',
            startFrom: { kind: 'portal', portalId: String(SOURCE) },
          },
          ctx,
        ),
      ),
    ).toBe('portal_inactive')
    expect(setup.portalRepo.all()).toHaveLength(1)
  })

  it('refuses a portal of another Property', async () => {
    const setup = setupCreatePortal({ accessible: [PROPERTY, OTHER_PROPERTY] })
    seedSource(setup, OTHER_PROPERTY)
    expect(
      await codeOf(
        setup.useCase(
          {
            ...base,
            name: 'Copy',
            startFrom: { kind: 'portal', portalId: String(SOURCE) },
          },
          ctx,
        ),
      ),
    ).toBe('portal_not_found')
  })

  it('refuses a portal that does not exist', async () => {
    const { useCase, portalRepo } = setupCreatePortal()
    expect(
      await codeOf(
        useCase(
          { ...base, name: 'Copy', startFrom: { kind: 'portal', portalId: 'nope' } },
          ctx,
        ),
      ),
    ).toBe('portal_not_found')
    expect(portalRepo.all()).toHaveLength(0)
  })

  it('refuses when the caller has no access to the Property of the portal being copied', async () => {
    const setup = setupCreatePortal({ accessible: [PROPERTY] })
    seedSource(setup, OTHER_PROPERTY)
    expect(
      await codeOf(
        setup.useCase(
          {
            ...base,
            name: 'Copy',
            startFrom: { kind: 'portal', portalId: String(SOURCE) },
          },
          ctx,
        ),
      ),
    ).toBe('forbidden')
  })
})

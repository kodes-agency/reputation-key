// The create-Portal use cases over the real repositories and the atomic command
// store on PostgreSQL: the languages, responsible managers and starting point
// the New portal dialog chooses, and the options it reads.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { PropertyId } from '#/shared/domain/ids'
import { getPortalCreationOptions } from './get-portal-creation-options.server'
import {
  PORTAL_CREATION_TABLES,
  seedCreationCategory,
  seedCreationDestination,
  seedCreationLink,
  seedCreationPortal,
  seedCreationResponsibleManager,
  seedCreationToken,
  type CreationManager,
} from '../infrastructure/testing/portal-creation-world'
import { codeOf } from './portal-creation-queries.test-fixtures'
import {
  base,
  CATEGORY,
  CLOCK,
  createCreateUseCaseHarness,
  ctx,
  CREATOR,
  MENU_DESTINATION,
  MENU_LINK,
  MISSING,
  ORG_A,
  ORG_B,
  OTHER_MANAGER,
  OTHER_PROPERTY,
  PROPERTY,
  PROPERTY_B,
  seedCreateUseCaseProperties,
  SOURCE,
  SOURCE_B,
  TEST_ORGANIZATIONS,
  type WorldOptions,
} from './portal-create-use-case.test-fixtures'
import { seedPortalLookOverride } from './portal-working-copy-seed.test-fixtures'

const { getPool } = setupIntegrationDb({
  ...TEST_ORGANIZATIONS,
  tables: PORTAL_CREATION_TABLES,
})
const { world, withBrand, rows, countOf, portalRows, factsOf } =
  createCreateUseCaseHarness(getPool)

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedCreateUseCaseProperties(getPool())
})

describe.sequential('createPortal languages', () => {
  const languagesOf = (portal: {
    primaryGuestLocale: string
    additionalGuestLocales: readonly string[]
  }) => [portal.primaryGuestLocale, portal.additionalGuestLocales]

  it('starts from the Property defaults, the first being the primary', async () => {
    await withBrand(['bg', 'en'])
    const { create } = world()
    const portal = await create({ ...base, name: 'Pool' }, ctx)
    expect(languagesOf(portal)).toEqual(['bg', ['en']])
    expect(
      await rows(
        `SELECT primary_guest_locale, additional_guest_locales FROM portals WHERE id = $1`,
        portal.id,
      ),
    ).toEqual([{ primary_guest_locale: 'bg', additional_guest_locales: ['en'] }])
  })

  it('starts in English when the Property has no defaults', async () => {
    const { create } = world()
    expect(languagesOf(await create({ ...base, name: 'Pool' }, ctx))).toEqual(['en', []])
  })

  it('uses the languages the manager chose over the defaults', async () => {
    await withBrand(['bg', 'en'])
    const { create } = world()
    const portal = await create({ ...base, name: 'Pool', guestLocales: ['en'] }, ctx)
    expect(languagesOf(portal)).toEqual(['en', []])
  })

  it('creates a Portal in German with French beside it', async () => {
    const { create } = world()
    const portal = await create(
      { ...base, name: 'Pool', guestLocales: ['de', 'fr'] },
      ctx,
    )
    expect(languagesOf(portal)).toEqual(['de', ['fr']])
  })

  it('refuses a language that is not a guest language', async () => {
    const { create } = world()
    expect(
      await codeOf(
        create({ ...base, name: 'Pool', guestLocales: ['en', 'pt'] as never }, ctx),
      ),
    ).toBe('locale_not_offered')
    expect(await portalRows()).toEqual([])
  })
})

describe.sequential('createPortal responsible managers', () => {
  const managers: readonly CreationManager[] = [
    { userId: CREATOR, role: 'PropertyManager' },
    { userId: OTHER_MANAGER, role: 'AccountAdmin' },
  ]
  const managersOf = async (portalId: string) =>
    (
      await rows(
        `SELECT user_id, created_by FROM portal_responsible_managers
         WHERE organization_id = $1 AND portal_id = $2 ORDER BY user_id`,
        ORG_A,
        portalId,
      )
    ).map((row) => row.user_id)

  it('takes the managers named, when they are eligible', async () => {
    const { create } = world({ managers })
    const portal = await create(
      { ...base, name: 'Pool', responsibleManagerUserIds: [OTHER_MANAGER] },
      ctx,
    )
    expect(await managersOf(portal.id)).toEqual([OTHER_MANAGER])
    expect(portal.responsibilityNeededSince).toBeNull()
  })

  it('records every manager named, not only the first', async () => {
    const { create } = world({ managers })
    const portal = await create(
      { ...base, name: 'Pool', responsibleManagerUserIds: [CREATOR, OTHER_MANAGER] },
      ctx,
    )
    expect(await managersOf(portal.id)).toEqual([CREATOR, OTHER_MANAGER].sort())
    expect(
      await rows(
        `SELECT DISTINCT created_by FROM portal_responsible_managers WHERE portal_id = $1`,
        portal.id,
      ),
    ).toEqual([{ created_by: CREATOR }])
  })

  it.each([
    ['refuses a manager who is not eligible for the Property', ['user-stranger']],
    ['refuses the same manager twice', [OTHER_MANAGER, OTHER_MANAGER]],
  ])('%s', async (_title, responsibleManagerUserIds) => {
    const { create } = world({ managers })
    expect(
      await codeOf(create({ ...base, name: 'Pool', responsibleManagerUserIds }, ctx)),
    ).toBe('responsible_manager_ineligible')
    expect(await portalRows()).toEqual([])
  })

  it('starts with nobody responsible, and says so, when the list is empty', async () => {
    const { create } = world({ managers })
    const portal = await create(
      { ...base, name: 'Pool', responsibleManagerUserIds: [] },
      ctx,
    )
    expect(portal.responsibilityNeededSince).toEqual(CLOCK)
    expect(await managersOf(portal.id)).toEqual([])
    expect(await factsOf('portal.responsibility_became_needed')).toHaveLength(1)
  })

  it('makes the creator responsible by default', async () => {
    const { create } = world({ managers })
    const portal = await create({ ...base, name: 'Pool' }, ctx)
    expect(await managersOf(portal.id)).toEqual([CREATOR])
  })
})

describe.sequential('createPortal start from', () => {
  type SourceOptions = Readonly<{
    organizationId?: typeof ORG_A | typeof ORG_B
    property?: PropertyId
    portalId?: string
    publicationState?: 'published' | 'archived'
  }>

  async function seedSource(options: SourceOptions = {}) {
    const organization = options.organizationId ?? ORG_A
    const property = options.property ?? PROPERTY
    const portalId = options.portalId ?? SOURCE
    await seedCreationPortal(getPool(), {
      organizationId: organization,
      propertyId: property,
      portalId,
      slug: 'source',
      name: 'Source',
      description: 'Welcome to the pool',
      primaryGuestLocale: 'en',
      additionalGuestLocales: ['bg'],
      publicationState: options.publicationState ?? 'published',
    })
    await seedCreationCategory(getPool(), {
      organizationId: organization,
      portalId,
      categoryId: CATEGORY,
    })
    await seedCreationDestination(getPool(), {
      organizationId: organization,
      propertyId: property,
      destinationId: MENU_DESTINATION,
      approvalState: 'approved',
    })
    await seedCreationLink(getPool(), {
      organizationId: organization,
      propertyId: property,
      portalId,
      categoryId: CATEGORY,
      linkId: MENU_LINK,
      destinationId: MENU_DESTINATION,
      label: 'Menu',
      sortKey: 'a0',
      texts: [
        { locale: 'en', label: 'Menu' },
        { locale: 'bg', label: 'Меню' },
      ],
    })
    await getPool().query(
      `INSERT INTO portal_localized_overrides
         (id, organization_id, property_id, portal_id, locale, title, linktree_title,
          version, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'en', 'Pool', 'Good to know', 1, 'seed-manager', $5, $5)`,
      [randomUUID(), organization, property, portalId, CLOCK],
    )
  }

  const copyOf = (portalId = SOURCE) => ({
    startFrom: { kind: 'portal' as const, portalId },
  })

  const newPortalRows = (table: string, portalId: string, order: string) =>
    rows(
      `SELECT * FROM ${table} WHERE organization_id = $1 AND portal_id = $2 ORDER BY ${order}`,
      ORG_A,
      portalId,
    )

  it('copies wording, links, link texts and languages of another portal', async () => {
    await withBrand(['en'])
    const { create } = world()
    await seedSource()

    const portal = await create({ ...base, name: 'Copy', ...copyOf() }, ctx)

    expect(portal.id).not.toBe(SOURCE)
    expect(portal.description).toBe('Welcome to the pool')
    expect([portal.primaryGuestLocale, portal.additionalGuestLocales]).toEqual([
      'en',
      ['bg'],
    ])
    const links = await newPortalRows('portal_links', portal.id, 'sort_key')
    expect(links).toHaveLength(1)
    expect(links[0].id).not.toBe(MENU_LINK)
    expect(links[0].destination_id).toBe(MENU_DESTINATION)
    const texts = await newPortalRows('portal_link_texts', portal.id, 'locale')
    expect(texts.map((text) => [text.locale, text.label])).toEqual([
      ['bg', 'Меню'],
      ['en', 'Menu'],
    ])
    expect(
      (await newPortalRows('portal_localized_overrides', portal.id, 'locale')).map(
        (row) => [row.locale, row.title, row.linktree_title],
      ),
    ).toEqual([['en', 'Pool', 'Good to know']])
    // The source itself is untouched.
    expect(await newPortalRows('portal_links', SOURCE, 'sort_key')).toHaveLength(1)
    expect(await newPortalRows('portal_link_texts', SOURCE, 'locale')).toHaveLength(2)
  })

  it('takes only the languages chosen, even when copying', async () => {
    const { create } = world()
    await seedSource()
    const portal = await create(
      { ...base, name: 'Copy', guestLocales: ['en'], ...copyOf() },
      ctx,
    )
    expect(portal.additionalGuestLocales).toEqual([])
    const texts = await newPortalRows('portal_link_texts', portal.id, 'locale')
    expect(texts.map((text) => text.locale)).toEqual(['en'])
  })

  it('copies no code, publication or responsible manager', async () => {
    const { create } = world()
    await seedSource()
    await seedCreationResponsibleManager(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: SOURCE,
      userId: 'user-source-manager',
    })
    await seedCreationToken({
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: SOURCE,
      tokenId: 'c1a70000-0000-4000-8000-000000000001',
      identifier: 'createuse-source-code',
    })

    const portal = await create({ ...base, name: 'Copy', ...copyOf() }, ctx)

    expect(
      (await newPortalRows('portal_responsible_managers', portal.id, 'user_id')).map(
        (row) => row.user_id,
      ),
    ).toEqual([CREATOR])
    expect(portal.publicationState).toBe('draft')
    expect(await newPortalRows('portal_tokens', portal.id, 'id')).toEqual([])
    expect(await newPortalRows('portal_publication_snapshots', portal.id, 'id')).toEqual(
      [],
    )
    expect(
      await newPortalRows('portal_publication_activations', portal.id, 'id'),
    ).toEqual([])
  })

  it('carries the source’s own look, also when a property manager creates the portal', async () => {
    await withBrand(['en'], 6)
    const { create } = world()
    await seedSource()
    await seedPortalLookOverride(
      getPool(),
      { organizationId: ORG_A, propertyId: PROPERTY, portalId: SOURCE },
      {
        photo: { mode: 'none' },
        colours: {
          accent: '#2F855A',
          backgroundMode: 'auto',
          backgroundColour: '#0B1F14',
        },
        lookVersion: 9,
      },
    )

    const portal = await create({ ...base, name: 'Copy', ...copyOf() }, ctx)

    const [look] = await newPortalRows('portal_look_overrides', portal.id, 'portal_id')
    expect(look).toMatchObject({
      photo_mode: 'none',
      colours_mode: 'own',
      primary_color: '#2F855A',
      identity_mode: 'inherit',
      look_version: 7,
    })
  })

  it('gives the new portal no look of its own when the source follows the property look', async () => {
    await withBrand(['en'], 6)
    const { create } = world()
    await seedSource()
    const portal = await create({ ...base, name: 'Copy', ...copyOf() }, ctx)
    expect(await newPortalRows('portal_look_overrides', portal.id, 'portal_id')).toEqual(
      [],
    )
  })

  it('carries nothing when it starts from the Property wording', async () => {
    const { create } = world()
    await seedSource()
    const portal = await create(
      { ...base, name: 'Fresh', startFrom: { kind: 'property' } },
      ctx,
    )
    expect(portal.description).toBeNull()
    expect(await newPortalRows('portal_links', portal.id, 'id')).toEqual([])
    expect(await newPortalRows('portal_localized_overrides', portal.id, 'id')).toEqual([])
    expect(await newPortalRows('portal_link_texts', portal.id, 'id')).toEqual([])
  })

  it('copies only links whose destination is approved, so a disabled one does not take a slot', async () => {
    const { create } = world()
    await seedSource()
    const destinationId = (n: number) => `c1a60000-0000-4000-8000-00000000010${n}`
    const states = [
      'disabled',
      'quarantined',
      'pending',
      'approved',
      'approved',
      'approved',
      'approved',
    ] as const
    for (const [index, state] of states.entries()) {
      await seedCreationDestination(getPool(), {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        destinationId: destinationId(index + 1),
        approvalState: state,
      })
      // The seeded 'Menu' link sorts first; these follow, retired ones first.
      await seedCreationLink(getPool(), {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: SOURCE,
        categoryId: CATEGORY,
        linkId: `c1a50000-0000-4000-8000-00000000010${index}`,
        destinationId: destinationId(index + 1),
        label: `Extra ${index}`,
        sortKey: `b${index}`,
        texts: [
          { locale: 'en', label: `Extra ${index}` },
          { locale: 'bg', label: `Допълнение ${index}` },
        ],
      })
    }

    const portal = await create({ ...base, name: 'Copy', ...copyOf() }, ctx)

    const links = await newPortalRows('portal_links', portal.id, 'sort_key')
    expect(links.map((link) => link.destination_id).sort()).toEqual(
      [MENU_DESTINATION, destinationId(4), destinationId(5), destinationId(6)].sort(),
    )
  })

  it.each([
    [
      'refuses an archived portal as a starting point',
      {},
      { publicationState: 'archived' } as SourceOptions,
      SOURCE,
      'portal_inactive',
      1,
      0,
    ],
    [
      'refuses a portal of another Property',
      { accessible: [PROPERTY, OTHER_PROPERTY] },
      { property: OTHER_PROPERTY } as SourceOptions,
      SOURCE,
      'portal_not_found',
      1,
      0,
    ],
    [
      'refuses a portal that does not exist',
      {},
      undefined,
      MISSING,
      'portal_not_found',
      0,
      0,
    ],
    [
      'refuses when the caller has no access to the Property of the portal being copied',
      { accessible: [PROPERTY] },
      { property: OTHER_PROPERTY } as SourceOptions,
      SOURCE,
      'forbidden',
      1,
      0,
    ],
    [
      'refuses a portal of another organization and leaves it untouched',
      { accessible: [PROPERTY, PROPERTY_B] },
      {
        organizationId: ORG_B,
        property: PROPERTY_B,
        portalId: SOURCE_B,
      } as SourceOptions,
      SOURCE_B,
      'portal_not_found',
      0,
      1,
    ],
  ] as const)(
    '%s',
    async (_title, options, source, sourceId, code, inOrganizationA, inOrganizationB) => {
      const { create } = world({ ...options } as WorldOptions)
      if (source) await seedSource({ ...source })
      expect(
        await codeOf(create({ ...base, name: 'Copy', ...copyOf(sourceId) }, ctx)),
      ).toBe(code)
      expect(await portalRows(ORG_A)).toHaveLength(inOrganizationA)
      expect(await portalRows(ORG_B)).toHaveLength(inOrganizationB)
      expect(await countOf('outbox_events', ORG_B)).toBe(0)
    },
  )
})

describe.sequential('getPortalCreationOptions', () => {
  const optionsFor = (options: WorldOptions = {}) => {
    const { deps } = world(options)
    return getPortalCreationOptions({
      propertyApi: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      identityPublicApi: deps.identityPublicApi,
      experienceRepo: deps.experienceRepo,
    })
  }

  it('offers the Property default languages, first as primary', async () => {
    await withBrand(['bg', 'en'])
    const result = await optionsFor()(base, ctx)
    expect(result.defaultGuestLocales).toEqual(['bg', 'en'])
  })

  it('falls back to English when the Property has no default', async () => {
    expect((await optionsFor()(base, ctx)).defaultGuestLocales).toEqual(['en'])
  })

  it('offers every Property default that is a guest language, German included', async () => {
    await withBrand(['de', 'bg'])
    expect((await optionsFor()(base, ctx)).defaultGuestLocales).toEqual(['de', 'bg'])
  })

  it('lists the managers eligible for the Property and says whether the caller is one', async () => {
    const result = await optionsFor({
      managers: [
        { userId: CREATOR, role: 'PropertyManager' },
        { userId: 'user-admin', role: 'AccountAdmin' },
      ],
    })(base, ctx)
    expect(result.eligibleManagerUserIds).toEqual([CREATOR, 'user-admin'])
    expect(result.creatorIsEligible).toBe(true)
  })

  it('says so when the caller is not an eligible manager', async () => {
    const result = await optionsFor({
      managers: [{ userId: 'user-admin', role: 'AccountAdmin' }],
    })(base, ctx)
    expect(result.creatorIsEligible).toBe(false)
  })

  it.each([
    [
      'refuses a role that cannot create portals',
      {},
      base,
      buildTestAuthContext({ organizationId: ORG_A, role: 'Member' }),
      'forbidden',
    ],
    [
      'refuses a Property the caller is not assigned to',
      { accessible: [OTHER_PROPERTY] },
      base,
      ctx,
      'forbidden',
    ],
    [
      'refuses a Property that does not exist',
      {},
      { propertyId: MISSING },
      ctx,
      'property_not_found',
    ],
    [
      'refuses a Property of another organization',
      { accessible: [PROPERTY, PROPERTY_B] },
      { propertyId: String(PROPERTY_B) },
      ctx,
      'property_not_found',
    ],
  ] as const)('%s', async (_title, options, input, caller, code) => {
    expect(await codeOf(optionsFor({ ...options } as WorldOptions)(input, caller))).toBe(
      code,
    )
  })
})

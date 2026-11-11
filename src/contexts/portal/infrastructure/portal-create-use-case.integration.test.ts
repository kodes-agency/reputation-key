// The create-Portal use cases over the real repositories and the atomic command
// store on PostgreSQL, for two Organizations: what the New portal dialog chooses
// (address, group, languages, managers, what to start from), what a refusal
// leaves behind (nothing) and what a success records (rows and outbox facts).

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId, userId, type PropertyId } from '#/shared/domain/ids'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { isPortalError } from '../domain/errors'
import { createPortal } from '../application/use-cases/create-portal'
import { getPortalCreationOptions } from '../application/use-cases/get-portal-creation-options'
import {
  createPortalCreationDeps,
  PORTAL_CREATION_TABLES,
  seedCreationCategory,
  seedCreationDestination,
  seedCreationGroup,
  seedCreationLink,
  seedCreationPortal,
  seedCreationProperty,
  seedCreationResponsibleManager,
  seedCreationToken,
  type CreationManager,
} from './testing/portal-creation-world'
import { seedPortalLookOverride } from './testing/portal-working-copy-seed'

const ORG_A = organizationId('org-createuse-0000-0000-000000000001')
const ORG_B = organizationId('org-createuse-0000-0000-000000000002')
const PROPERTY = propertyId('c1a10000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('c1a10000-0000-4000-8000-000000000002')
const PROPERTY_B = propertyId('c1a10000-0000-4000-8000-00000000000b')
const GROUP = 'c1a20000-0000-4000-8000-000000000001'
const GROUP_B = 'c1a20000-0000-4000-8000-00000000000b'
const SOURCE = 'c1a30000-0000-4000-8000-0000000000a1'
const SOURCE_B = 'c1a30000-0000-4000-8000-0000000000b1'
const CATEGORY = 'c1a40000-0000-4000-8000-00000000000a'
const MENU_LINK = 'c1a50000-0000-4000-8000-000000000001'
const MENU_DESTINATION = 'c1a60000-0000-4000-8000-000000000001'
const ID_PREFIX = 'c1d10000'
const CLOCK = new Date('2026-10-01T12:00:00.000Z')
const CREATOR = userId('user-createuse-0000-0000-000000000001')
const OTHER_MANAGER = 'user-createuse-0000-0000-000000000002'
const MISSING = 'c1a90000-0000-4000-8000-0000000000ff'

const ctx = buildTestAuthContext({
  organizationId: ORG_A,
  userId: CREATOR,
  role: 'PropertyManager',
})
const base = { propertyId: String(PROPERTY) }

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: PORTAL_CREATION_TABLES,
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  for (const [org, property] of [
    [ORG_A, PROPERTY],
    [ORG_A, OTHER_PROPERTY],
    [ORG_B, PROPERTY_B],
  ] as const) {
    await seedCreationProperty(getPool(), { organizationId: org, propertyId: property })
  }
})

type WorldOptions = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  managers?: readonly CreationManager[]
}>

function world(options: WorldOptions = {}) {
  const { deps } = createPortalCreationDeps({
    pool: getPool(),
    idPrefix: ID_PREFIX,
    clock: CLOCK,
    accessible: options.accessible === undefined ? [PROPERTY] : options.accessible,
    managers: options.managers ?? [{ userId: CREATOR, role: 'PropertyManager' }],
    ratingGoalGuard: createPortalRatingGoalGuard(),
  })
  return { deps, create: createPortal(deps) }
}

const withBrand = (
  defaultGuestLocales: readonly string[],
  lookVersion = 1,
  property: PropertyId = PROPERTY,
) =>
  getPool()
    .query(`DELETE FROM properties WHERE id = $1`, [property])
    .then(() =>
      seedCreationProperty(getPool(), {
        organizationId: ORG_A,
        propertyId: property,
        brand: { displayName: 'Harbor', defaultGuestLocales, lookVersion },
      }),
    )

const rows = async (sql: string, ...values: unknown[]) =>
  (await getPool().query(sql, values)).rows

const portalRows = (org = ORG_A) =>
  rows(
    `SELECT id, slug, name, publication_state FROM portals WHERE organization_id = $1 ORDER BY slug`,
    org,
  )

const countOf = async (table: string, org = ORG_A) =>
  Number(
    (
      await rows(
        `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`,
        org,
      )
    )[0].n,
  )

const factsOf = (tag: string, org = ORG_A) =>
  rows(
    `SELECT payload FROM outbox_events WHERE organization_id = $1 AND event_type = $2`,
    org,
    tag,
  ).then((found) => found.map((row) => row.payload))

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
  try {
    await run
  } catch (error) {
    return isPortalError(error) ? error.code : 'not-a-portal-error'
  }
  return undefined
}

describe.sequential('createPortal', () => {
  it('creates a portal with defaults when optional fields are omitted', async () => {
    const { create } = world()

    const portal = await create({ ...base, name: 'My Portal' }, ctx)

    expect(portal.slug).toBe('my-portal')
    expect(portal.theme.primaryColor).toBe('#6366F1')
    expect(portal.publicationState).toBe('draft')
    expect(portal.entityType).toBe('property')
    expect(portal.entityId).toBe(portal.propertyId)
    expect(portal.privateFeedbackThreshold).toBe(3)
    expect(portal.skipPrivateRating).toBe(false)
    expect(portal.createdBy).toBe(ctx.userId)
    expect(portal.responsibilityNeededSince).toBeNull()
    expect(await portalRows()).toEqual([
      expect.objectContaining({ id: portal.id, slug: 'my-portal' }),
    ])
    expect(await portalRows(ORG_B)).toEqual([])
  })

  it('creates a portal with custom slug and theme', async () => {
    const { create } = world({ accessible: null })

    const portal = await create(
      {
        ...base,
        name: 'My Portal',
        slug: 'custom-slug',
        theme: { primaryColor: '#FF5500' },
        privateFeedbackThreshold: 4,
        skipPrivateRating: true,
      },
      buildTestAuthContext({
        organizationId: ORG_A,
        userId: CREATOR,
        role: 'AccountAdmin',
      }),
    )

    expect(portal.slug).toBe('custom-slug')
    expect(portal.theme.primaryColor).toBe('#FF5500')
    expect(portal.publicationState).toBe('draft')
    expect(portal.privateFeedbackThreshold).toBe(4)
    expect(portal.skipPrivateRating).toBe(true)
    const [stored] = await rows(
      `SELECT slug, theme, private_feedback_threshold, skip_private_rating
       FROM portals WHERE id = $1`,
      portal.id,
    )
    expect(stored).toEqual({
      slug: 'custom-slug',
      theme: { primaryColor: '#FF5500' },
      private_feedback_threshold: 4,
      skip_private_rating: true,
    })
  })

  it('rejects users who cannot create portals', async () => {
    const { create } = world()
    expect(
      await codeOf(
        create(
          { ...base, name: 'Test' },
          buildTestAuthContext({ organizationId: ORG_A, role: 'Member' }),
        ),
      ),
    ).toBe('forbidden')
    expect(await portalRows()).toEqual([])
  })

  it('rejects when the property does not exist', async () => {
    const { create } = world()
    expect(await codeOf(create({ propertyId: MISSING, name: 'Test' }, ctx))).toBe(
      'property_not_found',
    )
    expect(await portalRows()).toEqual([])
  })

  it('refuses a property of another organization and writes nothing in either', async () => {
    const { create } = world({ accessible: [PROPERTY, PROPERTY_B] })
    expect(
      await codeOf(create({ propertyId: String(PROPERTY_B), name: 'Test' }, ctx)),
    ).toBe('property_not_found')
    expect(await portalRows(ORG_A)).toEqual([])
    expect(await portalRows(ORG_B)).toEqual([])
    expect(await countOf('outbox_events', ORG_B)).toBe(0)
  })

  it('rejects a typed slug that is already taken at the property', async () => {
    const { create } = world()
    await seedCreationPortal(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: randomUUID(),
      slug: 'my-portal',
    })

    expect(
      await codeOf(create({ ...base, name: 'Another name', slug: 'my-portal' }, ctx)),
    ).toBe('slug_taken')
    expect(await portalRows()).toHaveLength(1)
  })

  it('does not treat an address held in another organization as taken', async () => {
    const { create } = world()
    await seedCreationPortal(getPool(), {
      organizationId: ORG_B,
      propertyId: PROPERTY_B,
      portalId: randomUUID(),
      slug: 'my-portal',
    })

    const portal = await create({ ...base, name: 'Mine', slug: 'my-portal' }, ctx)

    expect(portal.slug).toBe('my-portal')
    expect(await portalRows(ORG_B)).toHaveLength(1)
  })

  it('records a portal.created outbox fact on success', async () => {
    const { create } = world()

    const portal = await create({ ...base, name: 'My Portal' }, ctx)

    const emitted = await factsOf('portal.created')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      portalId: portal.id,
      propertyId: PROPERTY,
      publicationState: 'draft',
      sourceAggregateVersion: CLOCK.toISOString(),
    })
    expect(emitted[0]).not.toHaveProperty('name')
    expect(emitted[0]).not.toHaveProperty('slug')
    expect(await factsOf('portal.created', ORG_B)).toEqual([])
  })

  it('rejects invalid name', async () => {
    const { create } = world()
    expect(await codeOf(create({ ...base, name: '' }, ctx))).toBe('invalid_name')
    expect(await portalRows()).toEqual([])
  })

  it('rejects invalid theme color', async () => {
    const { create } = world()
    expect(
      await codeOf(
        create({ ...base, name: 'Test', theme: { primaryColor: 'not-a-color' } }, ctx),
      ),
    ).toBe('invalid_theme')
    expect(await portalRows()).toEqual([])
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { create } = world({ accessible: [] })
    expect(await codeOf(create({ ...base, name: 'Test' }, ctx))).toBe('forbidden')
    expect(await portalRows()).toEqual([])
  })

  it('rejects PropertyManager assigned only to another property of the organization', async () => {
    const { create } = world({ accessible: [OTHER_PROPERTY] })
    expect(await codeOf(create({ ...base, name: 'Test' }, ctx))).toBe('forbidden')
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { create } = world({ accessible: [PROPERTY] })

    const portal = await create({ ...base, name: 'Test' }, ctx)

    expect(portal.name).toBe('Test')
    expect(await portalRows()).toHaveLength(1)
    // A grant alone makes the creator the initial Responsible Manager, so
    // nothing is "needed".
    expect(portal.responsibilityNeededSince).toBeNull()
    expect(await factsOf('portal.responsibility_became_needed')).toHaveLength(0)
  })

  it('creates a visible responsibility-needed state when the creator holds no current grant', async () => {
    // The session is an AccountAdmin (Organization-wide access), but the
    // creator's current membership is a PropertyManager whose grants do not
    // list the Property, so they cannot be the initial Responsible Manager.
    const { create } = world({ accessible: [] })

    const portal = await create(
      { ...base, name: 'Needs owner' },
      buildTestAuthContext({
        organizationId: ORG_A,
        userId: CREATOR,
        role: 'AccountAdmin',
      }),
    )

    expect(portal.responsibilityNeededSince).toEqual(CLOCK)
    expect(await factsOf('portal.responsibility_became_needed')).toEqual([
      expect.objectContaining({
        portalId: portal.id,
        organizationId: ORG_A,
        propertyId: PROPERTY,
      }),
    ])
    expect(
      await rows(
        `SELECT responsibility_needed_since FROM portals WHERE id = $1`,
        portal.id,
      ),
    ).toEqual([{ responsibility_needed_since: CLOCK }])
  })

  it('does not raise a recovery alert when the creator becomes the default manager', async () => {
    const { create } = world()
    await create({ ...base, name: 'Owned' }, ctx)
    expect(await factsOf('portal.responsibility_became_needed')).toHaveLength(0)
  })
})

describe.sequential('createPortal web address', () => {
  const held = (slug: string, property: PropertyId = PROPERTY) =>
    seedCreationPortal(getPool(), {
      organizationId: ORG_A,
      propertyId: property,
      portalId: randomUUID(),
      slug,
    })

  it('gives a name whose address is taken the next free numbered address', async () => {
    const { create } = world()
    await held('rooftop-pool')
    await held('rooftop-pool-2')
    expect((await create({ ...base, name: 'Rooftop pool' }, ctx)).slug).toBe(
      'rooftop-pool-3',
    )
  })

  it.each(['Рецепция', 'Басейн на покрива', 'A', '☕☕'])(
    'gives a portal named %j an address from its own id, which the manager never sees',
    async (name) => {
      const { create } = world()
      const portal = await create({ ...base, name }, ctx)
      expect(portal.slug).toBe(
        `portal-${String(portal.id).replaceAll('-', '').slice(0, 8)}`,
      )
    },
  )

  it('creates every Cyrillic portal at once, however many the Property already holds', async () => {
    const { create } = world()
    // Fifty-one portals named in Cyrillic: a counter would have run out of addresses.
    for (let n = 0; n < 51; n += 1) await create({ ...base, name: `Басейн ${n}` }, ctx)
    const stored = await portalRows()
    expect(stored).toHaveLength(51)
    expect(new Set(stored.map((portal) => portal.slug)).size).toBe(51)
  })

  it('looks the id-based address up once when it is free', async () => {
    const { create, deps } = world()
    const slugExists = vi.spyOn(deps.portalRepo, 'slugExists')
    await create({ ...base, name: 'Рецепция' }, ctx)
    expect(slugExists).toHaveBeenCalledTimes(1)
  })

  it('takes a longer slice of the id when the short address is held', async () => {
    const { create } = world()
    // The id the next create gets is the first one the world hands out.
    await held(`portal-${ID_PREFIX}`)
    const portal = await create({ ...base, name: 'Рецепция' }, ctx)
    expect(portal.slug).toBe(`portal-${ID_PREFIX}0000`)
  })

  it('does not mistake a Latin portal named Portal for a fallback address', async () => {
    const { create } = world()
    const latin = await create({ ...base, name: 'Portal' }, ctx)
    const cyrillic = await create({ ...base, name: 'Портал' }, ctx)
    expect(latin.slug).toBe('portal')
    expect(cyrillic.slug).not.toBe('portal')
  })

  it('says the address ran out, not that the name exists, when fifty numbered ones are taken', async () => {
    const { create } = world()
    for (let n = 0; n < 50; n += 1) await held(n === 0 ? 'pool' : `pool-${n + 1}`)
    const error = await create({ ...base, name: 'Pool' }, ctx).catch((e: unknown) => e)
    expect(isPortalError(error) && error.code).toBe('slug_taken')
    expect((error as Error).message).toMatch(/address/i)
    expect((error as Error).message).not.toMatch(/name already exists/i)
    expect(await portalRows()).toHaveLength(50)
  })

  it('keeps the plain address when it is free', async () => {
    const { create } = world()
    expect((await create({ ...base, name: 'Rooftop pool' }, ctx)).slug).toBe(
      'rooftop-pool',
    )
  })

  it('takes the next free address when another create took it between the check and the commit', async () => {
    const { create, deps } = world()
    const commit = deps.commandStore.createPortal.bind(deps.commandStore)
    let first = true
    const racing = vi
      .spyOn(deps.commandStore, 'createPortal')
      .mockImplementation(async (command) => {
        if (first) {
          first = false
          // The other create commits 'rooftop-pool' just before this one does.
          await held('rooftop-pool')
        }
        await commit(command)
      })
    const portal = await create({ ...base, name: 'Rooftop pool' }, ctx)
    expect(portal.slug).toBe('rooftop-pool-2')
    expect(racing).toHaveBeenCalledTimes(2)
    expect((await portalRows()).map((row) => row.slug)).toEqual([
      'rooftop-pool',
      'rooftop-pool-2',
    ])
  })

  it('does not retry an address the manager typed', async () => {
    const { create, deps } = world()
    const commit = deps.commandStore.createPortal.bind(deps.commandStore)
    const racing = vi
      .spyOn(deps.commandStore, 'createPortal')
      .mockImplementation(async (command) => {
        await held('my-pool')
        await commit(command)
      })
    expect(await codeOf(create({ ...base, name: 'Pool', slug: 'my-pool' }, ctx))).toBe(
      'slug_taken',
    )
    expect(racing).toHaveBeenCalledTimes(1)
    expect(await portalRows()).toHaveLength(1)
  })

  it('still refuses an address the manager typed that is already taken', async () => {
    const { create } = world()
    await held('custom')
    expect(await codeOf(create({ ...base, name: 'Other', slug: 'custom' }, ctx))).toBe(
      'slug_taken',
    )
  })

  it('lets two properties of the organization hold the same address', async () => {
    const { create } = world({ accessible: [PROPERTY, OTHER_PROPERTY] })
    await held('lobby', OTHER_PROPERTY)
    expect((await create({ ...base, name: 'Lobby' }, ctx)).slug).toBe('lobby')
  })
})

describe.sequential('createPortal group', () => {
  const groupAt = new Date('2026-04-02T00:00:00.000Z')

  it('puts the new portal in the group in the same commit and records the fact', async () => {
    const { create } = world()
    await seedCreationGroup(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      groupId: GROUP,
      updatedAt: groupAt,
    })

    const portal = await create({ ...base, name: 'Pool', groupId: GROUP }, ctx)

    expect(
      await rows(
        `SELECT portal_id, portal_group_id FROM portal_group_memberships
         WHERE organization_id = $1 AND effective_to IS NULL`,
        ORG_A,
      ),
    ).toEqual([{ portal_id: portal.id, portal_group_id: GROUP }])
    const [added] = await factsOf('portal_group.portal_added')
    expect(added).toMatchObject({ portalGroupId: GROUP, portalId: portal.id })
    // The group revision moves past the one the command read.
    expect(added.sourceAggregateVersion).toBe(CLOCK.toISOString())
    expect(
      await rows(`SELECT updated_at FROM portal_groups WHERE id = $1`, GROUP),
    ).toEqual([{ updated_at: CLOCK }])
    // Like every other way into a group, creation leaves an 'added' history entry.
    expect(
      await rows(
        `SELECT portal_group_id, kind, portal_id, actor_user_id
         FROM portal_group_history WHERE organization_id = $1`,
        ORG_A,
      ),
    ).toEqual([
      {
        portal_group_id: GROUP,
        kind: 'portal_added',
        portal_id: portal.id,
        actor_user_id: ctx.userId,
      },
    ])
  })

  it('leaves nothing behind when the group changed after it was read', async () => {
    const { create, deps } = world()
    await seedCreationGroup(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      groupId: GROUP,
      updatedAt: groupAt,
    })
    const commit = deps.commandStore.createPortal.bind(deps.commandStore)
    vi.spyOn(deps.commandStore, 'createPortal').mockImplementation(async (command) => {
      // Another change to the group lands between the read and the commit.
      await getPool().query(`UPDATE portal_groups SET updated_at = $2 WHERE id = $1`, [
        GROUP,
        new Date('2026-04-03T00:00:00.000Z'),
      ])
      await commit(command)
    })
    expect(await codeOf(create({ ...base, name: 'Pool', groupId: GROUP }, ctx))).toBe(
      'revision_conflict',
    )
    expect(await portalRows()).toEqual([])
    expect(await countOf('outbox_events')).toBe(0)
    expect(await countOf('portal_group_history')).toBe(0)
    expect(await countOf('portal_group_memberships')).toBe(0)
  })

  it('leaves the portal out of every group when none is chosen', async () => {
    const { create } = world()
    await create({ ...base, name: 'Pool' }, ctx)
    expect(await countOf('portal_group_memberships')).toBe(0)
    expect(await factsOf('portal_group.portal_added')).toHaveLength(0)
  })

  it.each([
    ['an unknown group', async () => {}],
    [
      'an archived group',
      () =>
        seedCreationGroup(getPool(), {
          organizationId: ORG_A,
          propertyId: PROPERTY,
          groupId: GROUP,
          updatedAt: groupAt,
          deletedAt: new Date('2026-04-05T00:00:00.000Z'),
        }),
    ],
    [
      'a group of another Property',
      () =>
        seedCreationGroup(getPool(), {
          organizationId: ORG_A,
          propertyId: OTHER_PROPERTY,
          groupId: GROUP,
          updatedAt: groupAt,
        }),
    ],
    [
      'a group of another organization',
      () =>
        seedCreationGroup(getPool(), {
          organizationId: ORG_B,
          propertyId: PROPERTY_B,
          groupId: GROUP,
          updatedAt: groupAt,
        }),
    ],
  ])('refuses %s and creates nothing', async (_label, seed) => {
    const { create } = world()
    await seed()
    expect(await codeOf(create({ ...base, name: 'Pool', groupId: GROUP }, ctx))).toBe(
      'group_not_found',
    )
    expect(await portalRows()).toEqual([])
    expect(await countOf('outbox_events')).toBe(0)
    expect(await countOf('portal_group_memberships', ORG_B)).toBe(0)
  })

  it('names the group of another organization only to its own', async () => {
    const { create } = world()
    await seedCreationGroup(getPool(), {
      organizationId: ORG_B,
      propertyId: PROPERTY_B,
      groupId: GROUP_B,
      updatedAt: groupAt,
    })
    expect(await codeOf(create({ ...base, name: 'Pool', groupId: GROUP_B }, ctx))).toBe(
      'group_not_found',
    )
    expect(
      await rows(`SELECT updated_at FROM portal_groups WHERE id = $1`, GROUP_B),
    ).toEqual([{ updated_at: groupAt }])
  })
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

  it('refuses a manager who is not eligible for the Property', async () => {
    const { create } = world({ managers })
    expect(
      await codeOf(
        create(
          { ...base, name: 'Pool', responsibleManagerUserIds: ['user-stranger'] },
          ctx,
        ),
      ),
    ).toBe('responsible_manager_ineligible')
    expect(await portalRows()).toEqual([])
  })

  it('refuses the same manager twice', async () => {
    const { create } = world({ managers })
    expect(
      await codeOf(
        create(
          {
            ...base,
            name: 'Pool',
            responsibleManagerUserIds: [OTHER_MANAGER, OTHER_MANAGER],
          },
          ctx,
        ),
      ),
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

  it('refuses an archived portal as a starting point', async () => {
    const { create } = world()
    await seedSource({ publicationState: 'archived' })
    expect(await codeOf(create({ ...base, name: 'Copy', ...copyOf() }, ctx))).toBe(
      'portal_inactive',
    )
    expect(await portalRows()).toHaveLength(1)
  })

  it('refuses a portal of another Property', async () => {
    const { create } = world({ accessible: [PROPERTY, OTHER_PROPERTY] })
    await seedSource({ property: OTHER_PROPERTY })
    expect(await codeOf(create({ ...base, name: 'Copy', ...copyOf() }, ctx))).toBe(
      'portal_not_found',
    )
  })

  it('refuses a portal that does not exist', async () => {
    const { create } = world()
    expect(await codeOf(create({ ...base, name: 'Copy', ...copyOf(MISSING) }, ctx))).toBe(
      'portal_not_found',
    )
    expect(await portalRows()).toEqual([])
  })

  it('refuses when the caller has no access to the Property of the portal being copied', async () => {
    const { create } = world({ accessible: [PROPERTY] })
    await seedSource({ property: OTHER_PROPERTY })
    expect(await codeOf(create({ ...base, name: 'Copy', ...copyOf() }, ctx))).toBe(
      'forbidden',
    )
  })

  it('refuses a portal of another organization and leaves it untouched', async () => {
    const { create } = world({ accessible: [PROPERTY, PROPERTY_B] })
    await seedSource({ organizationId: ORG_B, property: PROPERTY_B, portalId: SOURCE_B })
    expect(
      await codeOf(create({ ...base, name: 'Copy', ...copyOf(SOURCE_B) }, ctx)),
    ).toBe('portal_not_found')
    expect(await portalRows(ORG_A)).toEqual([])
    expect(await portalRows(ORG_B)).toHaveLength(1)
    expect(await countOf('outbox_events', ORG_B)).toBe(0)
  })
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

  it('refuses a role that cannot create portals', async () => {
    expect(
      await codeOf(
        optionsFor()(
          base,
          buildTestAuthContext({ organizationId: ORG_A, role: 'Member' }),
        ),
      ),
    ).toBe('forbidden')
  })

  it('refuses a Property the caller is not assigned to', async () => {
    expect(await codeOf(optionsFor({ accessible: [OTHER_PROPERTY] })(base, ctx))).toBe(
      'forbidden',
    )
  })

  it('refuses a Property that does not exist', async () => {
    expect(await codeOf(optionsFor()({ propertyId: MISSING }, ctx))).toBe(
      'property_not_found',
    )
  })

  it('refuses a Property of another organization', async () => {
    expect(
      await codeOf(
        optionsFor({ accessible: [PROPERTY, PROPERTY_B] })(
          { propertyId: String(PROPERTY_B) },
          ctx,
        ),
      ),
    ).toBe('property_not_found')
  })
})

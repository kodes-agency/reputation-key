// The create-Portal use case over the real repositories and the atomic command
// store on PostgreSQL, for two Organizations: what a refusal leaves behind
// (nothing), what a success records (rows and outbox facts), the web address
// and the group the New portal dialog chooses.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { PropertyId } from '#/shared/domain/ids'
import { isPortalError } from '../domain/errors'
import {
  PORTAL_CREATION_TABLES,
  seedCreationGroup,
  seedCreationPortal,
} from '../infrastructure/testing/portal-creation-world'
import { codeOf } from './portal-creation-queries.test-fixtures'
import {
  base,
  CLOCK,
  createCreateUseCaseHarness,
  ctx,
  CREATOR,
  GROUP,
  GROUP_B,
  ID_PREFIX,
  MISSING,
  ORG_A,
  ORG_B,
  OTHER_PROPERTY,
  PROPERTY,
  PROPERTY_B,
  seedCreateUseCaseProperties,
  TEST_ORGANIZATIONS,
  type WorldOptions,
} from './portal-create-use-case.test-fixtures'

const { getPool } = setupIntegrationDb({
  ...TEST_ORGANIZATIONS,
  tables: PORTAL_CREATION_TABLES,
})
const { world, rows, countOf, portalRows, factsOf } = createCreateUseCaseHarness(getPool)

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedCreateUseCaseProperties(getPool())
})

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

  const member = buildTestAuthContext({ organizationId: ORG_A, role: 'Member' })
  it.each([
    [
      'rejects users who cannot create portals',
      {},
      { name: 'Test' },
      member,
      'forbidden',
    ],
    [
      'rejects when the property does not exist',
      {},
      { propertyId: MISSING, name: 'Test' },
      ctx,
      'property_not_found',
    ],
    ['rejects invalid name', {}, { name: '' }, ctx, 'invalid_name'],
    [
      'rejects invalid theme color',
      {},
      { name: 'Test', theme: { primaryColor: 'not-a-color' } },
      ctx,
      'invalid_theme',
    ],
    [
      'rejects PropertyManager without assignment to the property',
      { accessible: [] },
      { name: 'Test' },
      ctx,
      'forbidden',
    ],
    [
      'rejects PropertyManager assigned only to another property of the organization',
      { accessible: [OTHER_PROPERTY] },
      { name: 'Test' },
      ctx,
      'forbidden',
    ],
  ] as const)('%s', async (_title, options, input, caller, code) => {
    const { create } = world({ ...options } as WorldOptions)
    expect(await codeOf(create({ ...base, ...input }, caller))).toBe(code)
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

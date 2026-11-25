// The Portal intents for settings, address and languages over the real repositories
// and the atomic command store on PostgreSQL, for two Organizations: what each one
// commits and what a refusal leaves behind (nothing).

import { beforeEach, describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { isPortalError } from '../domain/errors'
import { codeOf } from './portal-creation-queries.test-fixtures'
import {
  asRole,
  createIntentsHarness,
  INTENT_TABLES,
  manager,
  seedIntentProperties,
  TEST_ORGANIZATIONS,
  world,
  CLOCK,
  MISSING,
  NEXT,
  ORG_A,
  ORG_B,
  PROPERTY,
  PROPERTY_B,
  PORTAL,
  PORTAL_B,
  MANAGER,
} from './portal-intents.test-fixtures'

const { getPool } = setupIntegrationDb({
  ...TEST_ORGANIZATIONS,
  tables: INTENT_TABLES,
})
const {
  rows,
  portalRow,
  outboxCount,
  factsOf,
  snapshotsOf,
  activationsOf,
  footprint,
  seedPortal,
} = createIntentsHarness(getPool)

beforeEach(async () => {
  await seedIntentProperties(getPool())
})

describe.sequential('portal intents', () => {
  it('updates name and theme', async () => {
    const { settings } = world()
    await seedPortal({ name: 'Old Name' })

    const updated = await settings(
      { portalId: PORTAL, name: 'New Name', theme: { primaryColor: '#FF5500' } },
      manager,
    )

    expect(updated.name).toBe('New Name')
    expect(updated.theme.primaryColor).toBe('#FF5500')
    expect(await portalRow()).toMatchObject({
      name: 'New Name',
      theme: { primaryColor: '#FF5500' },
    })
  })

  it('rejects users who cannot edit', async () => {
    const { settings } = world()
    await seedPortal()
    const before = await footprint()
    expect(
      await codeOf(settings({ portalId: PORTAL, name: 'Test' }, asRole('Member'))),
    ).toBe('forbidden')
    expect(await footprint()).toEqual(before)
  })

  it('rejects update to non-existent portal', async () => {
    const { settings } = world()
    expect(await codeOf(settings({ portalId: MISSING, name: 'Test' }, manager))).toBe(
      'portal_not_found',
    )
  })

  it('treats a Portal of another organization as unknown and leaves it alone', async () => {
    const { settings, publish, archive } = world()
    await seedPortal({ id: PORTAL_B, org: ORG_B, property: PROPERTY_B, name: 'Theirs' })
    const admin = asRole('AccountAdmin')
    for (const run of [
      () => settings({ portalId: PORTAL_B, name: 'Mine now' }, admin),
      () => publish({ portalId: PORTAL_B }, admin),
      () => archive({ portalId: PORTAL_B }, admin),
    ]) {
      expect(await codeOf(run())).toBe('portal_not_found')
    }
    expect(await portalRow(PORTAL_B)).toMatchObject({
      name: 'Theirs',
      slug: 'test-portal',
      publication_state: 'draft',
    })
    expect(await outboxCount(ORG_B)).toBe(0)
  })

  it('reports an invalid publication transition for an archived Portal', async () => {
    const { publish } = world()
    await seedPortal({ state: 'archived' })
    expect(await codeOf(publish({ portalId: PORTAL }, manager))).toBe(
      'invalid_publication_transition',
    )
  })

  it('restores an archived Portal to Disabled without a destination or publication activation', async () => {
    const { restore, calls } = world()
    await seedPortal({ state: 'archived', atClock: true })

    const restored = await restore({ portalId: PORTAL }, manager)

    expect(restored.publicationState).toBe('disabled')
    expect((await portalRow()).publication_state).toBe('disabled')
    expect(calls.destination).toBe(0)
    expect(await snapshotsOf()).toEqual([])
    expect(await activationsOf()).toEqual([])
    expect(await factsOf('portal.restored')).toEqual([
      expect.objectContaining({
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PORTAL,
        userId: MANAGER,
        sourceAggregateVersion: NEXT.toISOString(),
        occurredAt: CLOCK.toISOString(),
      }),
    ])
  })

  it('archives a Portal with a dedicated actor-attributed lifecycle fact', async () => {
    const { archive } = world()
    await seedPortal({ state: 'disabled', atClock: true })

    const archived = await archive({ portalId: PORTAL }, asRole('AccountAdmin'))

    expect(archived.publicationState).toBe('archived')
    expect((await portalRow()).publication_state).toBe('archived')
    expect(await factsOf('portal.archived')).toEqual([
      expect.objectContaining({
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PORTAL,
        userId: MANAGER,
        sourceAggregateVersion: NEXT.toISOString(),
        occurredAt: CLOCK.toISOString(),
      }),
    ])
  })

  // Archive is the Portal's removal: it asks `portal.delete`, the permission
  // the Portals pages offer Archive on, whichever command carries it.
  it.each(['draft', 'published', 'disabled'] as const)(
    'refuses a PropertyManager archiving a %s Portal and writes nothing',
    async (state) => {
      const { archive, writes } = world()
      await seedPortal({ state })
      const before = await footprint()

      await expect(archive({ portalId: PORTAL }, manager)).rejects.toMatchObject({
        _tag: 'PortalError',
        code: 'forbidden',
        message: 'this role cannot archive portals',
      })

      expect(writes()).toBe(0)
      expect(await footprint()).toEqual(before)
      expect((await portalRow()).publication_state).toBe(state)
    },
  )

  it('still lets a PropertyManager take a live page down: Disable is an update', async () => {
    const { disable } = world()
    await seedPortal({ state: 'published' })

    const disabled = await disable({ portalId: PORTAL }, manager)

    expect(disabled.publicationState).toBe('disabled')
    expect(await activationsOf()).toEqual([
      expect.objectContaining({ kind: 'publish', deactivation_reason: 'disabled' }),
    ])
  })

  it('keeps an archived Portal read-only until it is restored', async () => {
    const { settings } = world()
    await seedPortal({ state: 'archived', name: 'Archived Reception' })
    const before = await footprint()

    expect(
      await codeOf(
        settings({ portalId: PORTAL, name: 'Edited while archived' }, manager),
      ),
    ).toBe('portal_inactive')

    expect(await footprint()).toEqual(before)
    expect(await portalRow()).toMatchObject({
      name: 'Archived Reception',
      publication_state: 'archived',
    })
  })

  it('restores without touching the retained configuration', async () => {
    const { restore } = world()
    await seedPortal({ state: 'archived', description: 'Retained configuration' })

    await restore({ portalId: PORTAL }, manager)

    expect(await portalRow()).toMatchObject({
      publication_state: 'disabled',
      description: 'Retained configuration',
    })
  })

  it('keeps occurrence time from the clock while allocating a later revision', async () => {
    const { settings, writes } = world()
    await seedPortal({ atClock: true })

    await settings({ portalId: PORTAL, name: 'Updated' }, manager)

    const emitted = await factsOf('portal.updated')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      propertyId: PROPERTY,
      previousPublicationState: 'draft',
      publicationState: 'draft',
      sourceAggregateVersion: NEXT.toISOString(),
      occurredAt: CLOCK.toISOString(),
    })
    expect(emitted[0]).not.toHaveProperty('name')
    expect(emitted[0]).not.toHaveProperty('slug')
    expect((await portalRow()).updated_at).toEqual(NEXT)
    expect(writes()).toBe(1)
    // A settings edit carries no lifecycle fact.
    expect(await outboxCount()).toBe(1)
  })

  it('rejects update with empty name', async () => {
    const { settings } = world()
    await seedPortal({ name: 'Valid Name' })
    expect(await codeOf(settings({ portalId: PORTAL, name: '' }, manager))).toBe(
      'invalid_name',
    )
    expect((await portalRow()).name).toBe('Valid Name')
  })

  it('rejects update with invalid theme', async () => {
    const { settings } = world()
    await seedPortal()
    expect(
      await codeOf(
        settings({ portalId: PORTAL, theme: { primaryColor: 'bad' } }, manager),
      ),
    ).toBe('invalid_theme')
  })

  it('returns existing portal unchanged when no fields are different', async () => {
    const { settings, writes } = world()
    await seedPortal({ name: 'Same Name' })

    const result = await settings({ portalId: PORTAL, name: 'Same Name' }, manager)

    expect(result.name).toBe('Same Name')
    expect(await factsOf('portal.updated')).toHaveLength(0)
    expect(writes()).toBe(0)
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { settings } = world({ accessible: [] })
    await seedPortal({ name: 'Name' })
    expect(await codeOf(settings({ portalId: PORTAL, name: 'X' }, manager))).toBe(
      'forbidden',
    )
    expect((await portalRow()).name).toBe('Name')
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { settings } = world({ accessible: [PROPERTY] })
    await seedPortal({ name: 'Old' })
    expect((await settings({ portalId: PORTAL, name: 'New' }, manager)).name).toBe('New')
  })

  it('clears the hero image when heroImageUrl is null', async () => {
    const { settings } = world()
    await seedPortal({ heroImageUrl: 'https://cdn.example.com/hero.jpg' })

    const updated = await settings({ portalId: PORTAL, heroImageUrl: null }, manager)

    expect(updated.heroImageUrl).toBeNull()
    expect((await portalRow()).hero_image_url).toBeNull()
  })

  it('rejects a caller-supplied hero image URL', async () => {
    const { settings } = world()
    await seedPortal({ heroImageUrl: 'https://cdn.example.com/old.jpg' })

    const error = await settings(
      {
        portalId: PORTAL,
        heroImageUrl: 'https://cdn.example.com/new.jpg',
      } as unknown as Parameters<typeof settings>[0],
      manager,
    ).catch((e: unknown) => e)

    expect(isPortalError(error) && error.code).toBe('invalid_url')
    expect((await portalRow()).hero_image_url).toBe('https://cdn.example.com/old.jpg')
  })

  it('leaves the hero image untouched when heroImageUrl is absent', async () => {
    const { settings } = world()
    await seedPortal({ heroImageUrl: 'https://cdn.example.com/hero.jpg' })

    const updated = await settings({ portalId: PORTAL, name: 'Renamed' }, manager)

    expect(updated.heroImageUrl).toBe('https://cdn.example.com/hero.jpg')
    expect((await portalRow()).hero_image_url).toBe('https://cdn.example.com/hero.jpg')
  })
})

describe.sequential('changePortalLanguages', () => {
  it('records the locale-set fact when the languages change', async () => {
    const { languages } = world()
    await seedPortal()

    const updated = await languages(
      { portalId: PORTAL, primaryGuestLocale: 'en', additionalGuestLocales: ['bg'] },
      manager,
    )

    expect(updated.additionalGuestLocales).toEqual(['bg'])
    expect((await portalRow()).additional_guest_locales).toEqual(['bg'])
    const facts = await rows(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1 AND payload->>'portalId' = $2 AND event_type <> 'portal.updated'`,
      ORG_A,
      PORTAL,
    )
    expect(facts.map((fact) => fact.payload)).toEqual([
      expect.objectContaining({
        portalId: PORTAL,
        primaryGuestLocale: 'en',
        additionalGuestLocales: ['bg'],
      }),
    ])
  })

  it('refuses a repeat of the primary language and writes nothing', async () => {
    const { languages, writes } = world()
    await seedPortal()
    const before = await footprint()
    await expect(
      languages({ portalId: PORTAL, additionalGuestLocales: ['en'] }, manager),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })

  it('keeps an archived Portal read-only', async () => {
    const { languages } = world()
    await seedPortal({ state: 'archived' })
    await expect(
      languages({ portalId: PORTAL, additionalGuestLocales: ['bg'] }, manager),
    ).rejects.toMatchObject({ code: 'portal_inactive' })
  })
})

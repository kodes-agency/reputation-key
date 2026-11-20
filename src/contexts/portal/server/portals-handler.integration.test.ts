// Portal server functions (reads, state changes, go-live and archive), called
// as signed-in members over PostgreSQL with the real tenant resolution,
// execution policy and Portal scope. Each refusal is asserted on the Portal row
// it leaves.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import type { TestMember, TestPortal } from '#/shared/testing/server-function-harness'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getPortalReview } from './portal-review'
import {
  listPortalResponsibleManagers,
  updatePortalResponsibleManagers,
} from './portal-responsible-managers'
import {
  archivePortal,
  changePortalLanguages,
  changePortalSlug,
  disablePortal,
  getPortal,
  getPortalHistory,
  getPortalPublicationHistory,
  issuePortalToken,
  listPortalOverview,
  listPortals,
  publishPortal,
  restorePortal,
  rotatePortalToken,
  updatePortalSettings,
} from './portals'

const harness = setupServerFunctionHarness({
  env: { PORTAL_ADDRESS_ENCRYPTION_KEYS: `1:${'44'.repeat(32)}` },
  cleanupTables: [
    ...PORTAL_SEED_CLEANUP_TABLES,
    'portal_responsible_managers',
    'portal_pending_content_changes',
    'portal_page_edits',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
  ],
})

const MISSING_PORTAL = '00000000-0000-4000-8000-0000000000aa'

// Commands fence on the revision they read, which a JS Date holds to the millisecond.
async function wholeMilliseconds<T extends TestPortal>(portal: T): Promise<T> {
  await harness
    .pool()
    .query(
      `UPDATE portals SET updated_at = date_trunc('milliseconds', updated_at) WHERE id = $1`,
      [portal.id],
    )
  return portal
}

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const ungranted = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization, { reviewDestination: true })
  const portal = await wholeMilliseconds(await harness.seedPortal(property))
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, ungranted, member, property, portal }
}

async function stranger() {
  const elsewhere = await harness.seedOrganization()
  return harness.seedMember(elsewhere, 'AccountAdmin')
}

const portalRow = async (portal: TestPortal) =>
  (
    await harness
      .pool()
      .query<{ publication_state: string; deleted_at: Date | null }>(
        `SELECT publication_state, deleted_at FROM portals WHERE id = $1`,
        [portal.id],
      )
  ).rows[0]

/** Every column, to show that a refused command changed nothing. */
const wholeRow = async (portal: TestPortal) =>
  (await harness.pool().query(`SELECT * FROM portals WHERE id = $1`, [portal.id])).rows[0]

const outboxCount = async (organizationId: string) =>
  Number(
    (
      await harness
        .pool()
        .query<{ count: string }>(
          `SELECT count(*) FROM outbox_events WHERE organization_id = $1`,
          [organizationId],
        )
    ).rows[0]?.count,
  )

const DRAFT = { publication_state: 'draft', deleted_at: null }

afterEach(resetCapabilityPolicyStore)

const switchOff = (capability: string) =>
  initCapabilityPolicyStore({
    isCapabilityKilled: (cap) => cap === capability,
    isOrgSuspended: () => false,
  })

type Hotel = Awaited<ReturnType<typeof hotel>>

type Command = Readonly<{
  name: string
  /** Whether a PropertyManager granted on the Property may run it. */
  managerMayRun: boolean
  prepare: (hotel: Hotel) => Promise<TestPortal>
  run: (portalId: string) => Promise<unknown>
  /** What the Portal row says once the command has run. */
  changed: Readonly<Record<string, unknown>>
}>

const draft = (h: Hotel) => Promise.resolve(h.portal)
const published = async (h: Hotel) =>
  wholeMilliseconds(await harness.seedPublishedPortal(h.property))
const archived = async (h: Hotel) => {
  await harness
    .pool()
    .query(`UPDATE portals SET publication_state = 'archived' WHERE id = $1`, [
      h.portal.id,
    ])
  return h.portal
}

const COMMANDS: readonly Command[] = [
  {
    name: 'updatePortalSettings',
    managerMayRun: true,
    prepare: draft,
    run: (portalId) => updatePortalSettings({ data: { portalId, name: 'Renamed' } }),
    changed: { name: 'Renamed' },
  },
  {
    name: 'changePortalSlug',
    managerMayRun: true,
    prepare: draft,
    run: (portalId) => changePortalSlug({ data: { portalId, slug: 'new-slug' } }),
    changed: { slug: 'new-slug' },
  },
  {
    name: 'changePortalLanguages',
    managerMayRun: true,
    prepare: draft,
    run: (portalId) =>
      changePortalLanguages({
        data: {
          portalId,
          primaryGuestLocale: 'bg',
          additionalGuestLocales: ['en'],
        },
      }),
    changed: { primary_guest_locale: 'bg', additional_guest_locales: ['en'] },
  },
  {
    name: 'disablePortal',
    managerMayRun: true,
    prepare: published,
    run: (portalId) => disablePortal({ data: { portalId } }),
    changed: { publication_state: 'disabled' },
  },
  {
    name: 'archivePortal',
    managerMayRun: false,
    prepare: draft,
    run: (portalId) => archivePortal({ data: { portalId } }),
    changed: { publication_state: 'archived' },
  },
  {
    name: 'restorePortal',
    managerMayRun: true,
    prepare: archived,
    run: (portalId) => restorePortal({ data: { portalId } }),
    changed: { publication_state: 'disabled' },
  },
]

describe.each(COMMANDS)('$name', (command) => {
  it('changes the Portal for an Account Admin', async () => {
    const h = await hotel()
    const portal = await command.prepare(h)

    await harness.callAs(h.admin, () => command.run(portal.id))

    expect(await wholeRow(portal)).toMatchObject(command.changed)
  })

  it(
    command.managerMayRun
      ? 'changes the Portal for a PropertyManager granted on the Property'
      : 'refuses a PropertyManager, even one granted on the Property, and leaves the Portal as it was',
    async () => {
      const h = await hotel()
      const portal = await command.prepare(h)
      const before = await wholeRow(portal)

      const outcome = harness.callAs(h.manager, () => command.run(portal.id))

      if (command.managerMayRun) {
        await outcome
        expect(await wholeRow(portal)).toMatchObject(command.changed)
      } else {
        await expect(outcome).rejects.toMatchObject({
          code: 'permission_denied',
          status: 403,
        })
        expect(await wholeRow(portal)).toEqual(before)
      }
    },
  )

  it('refuses a PropertyManager without a grant and leaves the Portal and its facts untouched', async () => {
    const h = await hotel()
    const portal = await command.prepare(h)
    const before = await wholeRow(portal)
    const facts = await outboxCount(h.organization.id)

    await expect(
      harness.callAs(h.ungranted, () => command.run(portal.id)),
    ).rejects.toMatchObject({
      code: command.managerMayRun ? 'scope_denied' : 'permission_denied',
      status: 403,
    })

    expect(await wholeRow(portal)).toEqual(before)
    expect(await outboxCount(h.organization.id)).toBe(facts)
  })

  it('refuses a Member', async () => {
    const h = await hotel()
    const portal = await command.prepare(h)
    const before = await wholeRow(portal)

    await expect(
      harness.callAs(h.member, () => command.run(portal.id)),
    ).rejects.toMatchObject({ code: 'beta_role_inactive', status: 403 })

    expect(await wholeRow(portal)).toEqual(before)
  })

  it('answers a missing Portal and another Organization’s Portal alike, and changes nothing', async () => {
    const h = await hotel()
    const portal = await command.prepare(h)
    const before = await wholeRow(portal)
    const outsider = await stranger()

    await expect(
      harness.callAs(h.admin, () => command.run(MISSING_PORTAL)),
    ).rejects.toMatchObject({
      name: 'PortalError',
      code: 'portal_not_found',
      status: 404,
    })
    await expect(
      harness.callAs(outsider, () => command.run(portal.id)),
    ).rejects.toMatchObject({
      name: 'PortalError',
      code: 'portal_not_found',
      status: 404,
    })

    expect(await wholeRow(portal)).toEqual(before)
  })
})

describe('Portal command refusals on the wire', () => {
  it('refuses a slug already in use with its status and message', async () => {
    const { admin, property, portal } = await hotel()
    const other = await wholeMilliseconds(
      await harness.seedPortal(property, { name: 'Other' }),
    )
    const taken = (await wholeRow(other)).slug as string

    await expect(
      harness.callAs(admin, () =>
        changePortalSlug({ data: { portalId: portal.id, slug: taken } }),
      ),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'slug_taken', status: 409 })
  })

  it('refuses an invalid slug', async () => {
    const { admin, portal } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        changePortalSlug({ data: { portalId: portal.id, slug: 'Not A Slug!' } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_slug', status: 400 })
  })

  it('refuses to disable a draft', async () => {
    const { admin, portal } = await hotel()

    await expect(
      harness.callAs(admin, () => disablePortal({ data: { portalId: portal.id } })),
    ).rejects.toMatchObject({ code: 'invalid_publication_transition', status: 409 })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })

  it('refuses to edit an archived Portal', async () => {
    const h = await hotel()
    const portal = await archived(h)

    await expect(
      harness.callAs(h.admin, () =>
        updatePortalSettings({ data: { portalId: portal.id, name: 'Renamed' } }),
      ),
    ).rejects.toMatchObject({ code: 'portal_inactive', status: 410 })
  })
})

describe('getPortal', () => {
  it('reads the Portal and its address status as an Account Admin and a granted PropertyManager', async () => {
    const { admin, manager, portal } = await hotel()

    for (const caller of [admin, manager]) {
      await expect(
        harness.callAs(caller, () => getPortal({ data: { portalId: portal.id } })),
      ).resolves.toHaveProperty('portal.id', portal.id)
    }
  })

  it('refuses a PropertyManager without a grant, a Member, and another Organization', async () => {
    const { ungranted, member, portal } = await hotel()
    const outsider = await stranger()

    await expect(
      harness.callAs(ungranted, () => getPortal({ data: { portalId: portal.id } })),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    await expect(
      harness.callAs(member, () => getPortal({ data: { portalId: portal.id } })),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      harness.callAs(outsider, () => getPortal({ data: { portalId: portal.id } })),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })
})

async function twoProperties() {
  const h = await hotel()
  const garden = await harness.seedProperty(h.organization, { name: 'Garden House' })
  const gardenPortal = await harness.seedPortal(garden, { name: 'Garden' })
  return { ...h, garden, gardenPortal }
}

const ids = (list: ReadonlyArray<{ id: string }>) => list.map((p) => p.id).sort()

describe('listPortals', () => {
  it('lists the Portals of every Property of the Organization, and none of another Organization', async () => {
    const { admin, portal, gardenPortal } = await twoProperties()
    const elsewhere = await harness.seedOrganization()
    const outsider = await harness.seedMember(elsewhere, 'AccountAdmin')
    const theirs = await harness.seedPortal(await harness.seedProperty(elsewhere))

    const { portals } = await harness.callAs(admin, () => listPortals({ data: {} }))

    expect(ids(portals)).toEqual([portal.id, gardenPortal.id].sort())
    const theirList = await harness.callAs(outsider, () => listPortals({ data: {} }))
    expect(ids(theirList.portals)).toEqual([theirs.id])
  })

  it('narrows to one Property when asked', async () => {
    const { admin, garden, gardenPortal } = await twoProperties()

    const { portals } = await harness.callAs(admin, () =>
      listPortals({ data: { propertyId: garden.id } }),
    )

    expect(ids(portals)).toEqual([gardenPortal.id])
  })

  it('lists only the Properties a PropertyManager is granted on', async () => {
    const { manager, portal } = await twoProperties()

    const { portals } = await harness.callAs(manager, () => listPortals({ data: {} }))

    expect(ids(portals)).toEqual([portal.id])
  })

  it('refuses a Property the caller has no grant on, and a Member', async () => {
    const { manager, member, garden } = await twoProperties()

    await expect(
      harness.callAs(manager, () => listPortals({ data: { propertyId: garden.id } })),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    await expect(
      harness.callAs(member, () => listPortals({ data: {} })),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('listPortalOverview', () => {
  const rowIds = (list: ReadonlyArray<{ portalId: string }>) =>
    list.map((row) => row.portalId).sort()

  it('reads one Property’s rows, or the Organization’s', async () => {
    const { admin, garden, portal, gardenPortal } = await twoProperties()

    const one = await harness.callAs(admin, () =>
      listPortalOverview({ data: { propertyId: garden.id } }),
    )
    const all = await harness.callAs(admin, () => listPortalOverview({ data: {} }))

    expect(rowIds(one.portals)).toEqual([gardenPortal.id])
    expect(rowIds(all.portals)).toEqual([portal.id, gardenPortal.id].sort())
  })

  it('narrows the Organization read to the Properties a PropertyManager may read', async () => {
    const { manager, portal } = await twoProperties()

    const all = await harness.callAs(manager, () => listPortalOverview({ data: {} }))

    expect(rowIds(all.portals)).toEqual([portal.id])
  })

  it('refuses a Property the caller may not read, with no rows', async () => {
    const { manager, garden } = await twoProperties()

    await expect(
      harness.callAs(manager, () =>
        listPortalOverview({ data: { propertyId: garden.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })
})

describe('Portal history reads', () => {
  async function liveHotel() {
    const h = await hotel()
    const live = await harness.seedPublishedPortal(h.property)
    return { ...h, live }
  }

  it('reads the publication history for a granted caller', async () => {
    const { manager, live } = await liveHotel()

    const history = await harness.callAs(manager, () =>
      getPortalPublicationHistory({ data: { portalId: live.id } }),
    )

    expect(history).toMatchObject({
      current: { version: 1, deactivatedAt: null },
      priorActivations: [],
      hasPendingChanges: expect.any(Boolean),
      nextCursor: null,
    })
  })

  it('refuses the publication history to an ungranted PropertyManager and another Organization', async () => {
    const { ungranted, live } = await liveHotel()
    const outsider = await stranger()

    await expect(
      harness.callAs(ungranted, () =>
        getPortalPublicationHistory({ data: { portalId: live.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    await expect(
      harness.callAs(outsider, () =>
        getPortalPublicationHistory({ data: { portalId: live.id } }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })

  it('reads the merged history, honours limit and filter, and starts over on a cursor it did not issue', async () => {
    const { admin, live } = await liveHotel()
    const read = (data: Record<string, unknown>) =>
      harness.callAs(admin, () =>
        getPortalHistory({ data: { portalId: live.id, ...data } }),
      )

    const everything = await read({})
    const limited = await read({ limit: 1 })
    const codes = await read({ filter: 'codes' })
    const restarted = await read({ cursor: 'not-a-cursor' })

    expect(everything.entries.length).toBeGreaterThan(0)
    expect(limited.entries).toHaveLength(1)
    expect(codes.entries.length).toBeGreaterThan(0)
    expect(codes.entries.length).toBeLessThanOrEqual(everything.entries.length)
    expect(restarted).toEqual(everything)
  })

  it('refuses the merged history to an ungranted PropertyManager', async () => {
    const { ungranted, live } = await liveHotel()

    await expect(
      harness.callAs(ungranted, () => getPortalHistory({ data: { portalId: live.id } })),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })
})

describe('rotatePortalToken', () => {
  it('refuses a PropertyManager without a grant and writes no code', async () => {
    const { ungranted, portal } = await hotel()

    await expect(
      harness.callAs(ungranted, () =>
        rotatePortalToken({ data: { portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })

    const { rows } = await harness
      .pool()
      .query(`SELECT 1 FROM portal_tokens WHERE portal_id = $1`, [portal.id])
    expect(rows).toEqual([])
  })
})

describe('publishPortal', () => {
  /** A draft that passes every gate: wording, owner, verified destination and an address. */
  async function readyHotel() {
    const h = await hotel()
    const at = new Date(Date.now() - 5000)
    await harness.pool().query(
      `INSERT INTO property_portal_brand_profiles
         (id, organization_id, property_id, display_name, background_mode, look_version,
          primary_color, background_color, text_color, version, updated_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'Harbor', 'auto', 1, '#1D4ED8', '#101820',
               '#111827', 1, 'harness', $3, $3)`,
      [h.organization.id, h.property.id, at],
    )
    for (const locale of ['en', 'bg']) {
      await harness.pool().query(
        `INSERT INTO property_portal_brand_contents
           (id, organization_id, property_id, locale, title, short_description, version,
            updated_by, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'Harbor Hotel', 'Welcome', 1, 'harness', $4, $4)`,
        [h.organization.id, h.property.id, locale, at],
      )
    }
    const portalId = h.portal.id
    const { revision } = await harness.callAs(h.admin, () =>
      listPortalResponsibleManagers({ data: { portalId } }),
    )
    await harness.callAs(h.admin, () =>
      updatePortalResponsibleManagers({
        data: {
          portalId,
          managerUserIds: [h.manager.userId],
          expectedRevision: revision,
        },
      }),
    )
    await harness.callAs(h.admin, () => issuePortalToken({ data: { portalId } }))
    return h
  }

  const digestOf = (caller: TestMember, portalId: string) =>
    harness
      .callAs(caller, () => getPortalReview({ data: { portalId } }))
      .then((review) => review.reviewDigest ?? 'none')

  it('takes the Portal live on the digest the manager reviewed', async () => {
    const { admin, portal } = await readyHotel()
    const reviewedDigest = await digestOf(admin, portal.id)

    await harness.callAs(admin, () =>
      publishPortal({ data: { portalId: portal.id, reviewedDigest } }),
    )

    expect((await portalRow(portal))?.publication_state).toBe('published')
  })

  it('refuses a stale digest with a conflict and leaves the Portal a draft', async () => {
    const { admin, portal } = await readyHotel()

    await expect(
      harness.callAs(admin, () =>
        publishPortal({ data: { portalId: portal.id, reviewedDigest: 'stale-digest' } }),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict', status: 409 })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })

  it('refuses go-live without a reviewed digest and leaves the Portal a draft', async () => {
    const { admin, portal } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        publishPortal({ data: { portalId: portal.id } as never }),
      ),
    ).rejects.toThrow(/reviewedDigest/)

    expect(await portalRow(portal)).toEqual(DRAFT)
  })

  it('refuses a PropertyManager without a grant and leaves the Portal a draft', async () => {
    const { ungranted, portal } = await hotel()

    await expect(
      harness.callAs(ungranted, () =>
        publishPortal({
          data: { portalId: portal.id, reviewedDigest: 'reviewed-digest' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })

  it("answers not found for another Organization's Portal and leaves it untouched", async () => {
    const { portal } = await hotel()
    const otherAdmin = await stranger()

    await expect(
      harness.callAs(otherAdmin, () =>
        publishPortal({
          data: { portalId: portal.id, reviewedDigest: 'reviewed-digest' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })
})

describe('Portal writes switched off', () => {
  it('refuses go-live and leaves the Portal a draft', async () => {
    const { admin, portal } = await hotel()
    switchOff('portal.write')

    await expect(
      harness.callAs(admin, () =>
        publishPortal({
          data: { portalId: portal.id, reviewedDigest: 'reviewed-digest' },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })

  it('refuses archiving and leaves the Portal a draft', async () => {
    const { admin, portal } = await hotel()
    switchOff('portal.write')

    await expect(
      harness.callAs(admin, () => archivePortal({ data: { portalId: portal.id } })),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })
})

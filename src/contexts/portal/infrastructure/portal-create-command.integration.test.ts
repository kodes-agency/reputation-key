// Create-Portal command against real PostgreSQL (round 4, slice 26): the Portal,
// its managers, its group membership and everything copied from another Portal
// commit together or not at all, and a copy never reaches codes, publications
// or managers of its source.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalApprovedDestinationId,
  portalGroupId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  portalAddedToGroup,
  portalCreated,
  portalResponsibilityNeeded,
} from '../domain/events'
import type { Portal } from '../domain/types'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { planPortalContentCopy } from '../application/portal-content-copy'
import type { CreatePortalCommand } from '../application/ports/portal-command-store.port'
import { createPortalLinkRepository } from './repositories/portal-link.repository'
import { createPortalRepository } from './repositories/portal.repository'
import { createPortalApprovedDestinationRepository } from './repositories/portal-approved-destination.repository'

const ORG_A = organizationId('org-portalcreate-0000-0000-000000000001')
const ORG_B = organizationId('org-portalcreate-0000-0000-000000000002')
const PROPERTY_A = propertyId('9a000000-0000-4000-8000-000000000001')
const SOURCE = portalId('9b000000-0000-4000-8000-000000000001')
const TARGET = portalId('9b000000-0000-4000-8000-000000000002')
const GROUP = portalGroupId('9f000000-0000-4000-8000-000000000001')
const DESTINATION = portalApprovedDestinationId('9d000000-0000-4000-8000-000000000001')
const CREATOR = userId('creator-portalcreate-000000000000001')
const OTHER_MANAGER = userId('other-portalcreate-0000000000000001')
const CREATED_AT = new Date('2026-10-01T10:00:00.000Z')
const GROUP_UPDATED_AT = new Date('2026-10-01T09:00:00.000Z')
const NOW = new Date('2026-10-01T11:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_link_texts',
    'portal_localized_overrides',
    'portal_links',
    'portal_link_categories',
    'portal_approved_destinations',
    'portal_health_intervals',
    'portal_group_memberships',
    'portal_groups',
    'portal_responsible_managers',
    'outbox_events',
    'portals',
    'properties',
  ],
})

const store = () => createAtomicPortalCommandStore(getDb())

const portalOf = (overrides: Partial<Portal>) =>
  buildTestPortal({
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    entityId: PROPERTY_A,
    createdBy: CREATOR,
    createdAt: NOW,
    updatedAt: NOW,
    publicationState: 'draft',
    ...overrides,
  })

const factsFor = (portal: Portal, hasManager: boolean) => ({
  event: portalCreated({
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    publicationState: portal.publicationState,
    sourceAggregateVersion: portal.updatedAt.toISOString(),
    occurredAt: portal.createdAt,
  }),
  ...(hasManager
    ? {}
    : {
        responsibilityNeededEvent: portalResponsibilityNeeded({
          portalId: portal.id,
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          sourceAggregateVersion: portal.updatedAt.toISOString(),
          occurredAt: portal.createdAt,
        }),
      }),
})

/** Rows of a table in the organization, optionally only those whose column holds a value. */
const count = async (table: string, column?: string, value?: string) => {
  const extra = column ? ` AND ${column}::text = $2` : ''
  const params = column ? [ORG_A, value] : [ORG_A]
  const result = await getPool().query(
    `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1${extra}`,
    params,
  )
  return Number(result.rows[0].n)
}

const membershipFor = (
  portal: Portal,
  revision = new Date(GROUP_UPDATED_AT.getTime() + 1),
) => ({
  portalGroupId: GROUP,
  expectedGroupUpdatedAt: GROUP_UPDATED_AT,
  revision,
  event: portalAddedToGroup({
    portalGroupId: GROUP,
    portalId: portal.id,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    sourceAggregateVersion: revision.toISOString(),
    occurredAt: portal.createdAt,
  }),
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  const q = (text: string, values: unknown[]) => getPool().query(text, values)
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Avela Resort', 'avela-resort', 'UTC', $3, $3)`,
    [PROPERTY_A, ORG_A, CREATED_AT],
  )
  await q(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Pool side', $4, $4)`,
    [GROUP, ORG_A, PROPERTY_A, GROUP_UPDATED_AT],
  )
})

describe.sequential('create Portal command (real PostgreSQL)', () => {
  it('writes every named manager as responsible, recorded against the creator', async () => {
    const portal = portalOf({ id: TARGET, name: 'Pool', slug: 'pool' })
    await store().createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerIds: [CREATOR, OTHER_MANAGER],
      ...factsFor(portal, true),
    })
    const rows = await getPool().query(
      `SELECT user_id, created_by FROM portal_responsible_managers
       WHERE organization_id = $1 ORDER BY user_id`,
      [ORG_A],
    )
    expect(rows.rows).toEqual([
      { user_id: CREATOR, created_by: CREATOR },
      { user_id: OTHER_MANAGER, created_by: CREATOR },
    ])
  })

  it('refuses the same manager twice and writes nothing', async () => {
    const portal = portalOf({ id: TARGET, name: 'Pool', slug: 'pool' })
    await expect(
      store().createPortal({
        organizationId: ORG_A,
        portal,
        initialResponsibleManagerIds: [CREATOR, CREATOR],
        ...factsFor(portal, true),
      }),
    ).rejects.toMatchObject({ code: 'responsible_manager_ineligible' })
    expect(await count('portals')).toBe(0)
  })

  it('puts the Portal in its group in the same commit and moves the group revision', async () => {
    const portal = portalOf({ id: TARGET, name: 'Pool', slug: 'pool' })
    const membership = membershipFor(portal)
    await store().createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerIds: [CREATOR],
      groupMembership: membership,
      ...factsFor(portal, true),
    })
    const memberships = await getPool().query(
      `SELECT portal_id, portal_group_id, effective_from, created_by
       FROM portal_group_memberships WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(memberships.rows).toEqual([
      {
        portal_id: TARGET,
        portal_group_id: GROUP,
        effective_from: NOW,
        created_by: CREATOR,
      },
    ])
    const group = await getPool().query(
      'SELECT updated_at FROM portal_groups WHERE id = $1',
      [GROUP],
    )
    expect(group.rows[0].updated_at).toEqual(membership.revision)
    const facts = await getPool().query(
      `SELECT event_type FROM outbox_events WHERE organization_id = $1 ORDER BY event_type`,
      [ORG_A],
    )
    expect(facts.rows.map((row) => row.event_type)).toEqual([
      'portal.created',
      'portal_group.portal_added',
    ])
  })

  it('rolls the Portal back when the group changed since it was read', async () => {
    await getPool().query('UPDATE portal_groups SET updated_at = $2 WHERE id = $1', [
      GROUP,
      new Date(GROUP_UPDATED_AT.getTime() + 5_000),
    ])
    const portal = portalOf({ id: TARGET, name: 'Pool', slug: 'pool' })
    await expect(
      store().createPortal({
        organizationId: ORG_A,
        portal,
        initialResponsibleManagerIds: [CREATOR],
        groupMembership: membershipFor(portal),
        ...factsFor(portal, true),
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    expect(await count('portals')).toBe(0)
    expect(await count('portal_responsible_managers')).toBe(0)
    expect(await count('portal_group_memberships')).toBe(0)
    expect(await count('outbox_events')).toBe(0)
  })

  it('says the address is taken when another Portal holds it at the Property', async () => {
    const first = portalOf({ id: SOURCE, name: 'Pool', slug: 'pool' })
    await store().createPortal({
      organizationId: ORG_A,
      portal: first,
      initialResponsibleManagerIds: [CREATOR],
      ...factsFor(first, true),
    })
    const second = portalOf({ id: TARGET, name: 'Pool', slug: 'pool' })
    await expect(
      store().createPortal({
        organizationId: ORG_A,
        portal: second,
        initialResponsibleManagerIds: [CREATOR],
        ...factsFor(second, true),
      }),
    ).rejects.toMatchObject({ code: 'slug_taken' })
    expect(await count('portals', 'id', TARGET)).toBe(0)
  })

  it('refuses a membership fact that names another group', async () => {
    const portal = portalOf({ id: TARGET, name: 'Pool', slug: 'pool' })
    const membership = membershipFor(portal)
    await expect(
      store().createPortal({
        organizationId: ORG_A,
        portal,
        initialResponsibleManagerIds: [CREATOR],
        groupMembership: { ...membership, portalGroupId: portalGroupId(randomUUID()) },
        ...factsFor(portal, true),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await count('portals')).toBe(0)
  })
})

describe.sequential('create Portal command: copied content (real PostgreSQL)', () => {
  async function seedSource() {
    const source = portalOf({
      id: SOURCE,
      name: 'Source',
      slug: 'source',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      description: 'Welcome to the pool',
      primaryGuestLocale: 'en',
      additionalGuestLocales: ['bg'],
      linktreeEnabled: false,
    })
    await store().createPortal({
      organizationId: ORG_A,
      portal: source,
      initialResponsibleManagerIds: [OTHER_MANAGER],
      ...factsFor(source, true),
    })
    const q = (text: string, values: unknown[]) => getPool().query(text, values)
    await q(
      `INSERT INTO portal_approved_destinations (
         id, organization_id, property_id, normalized_uri, hostname, source_type,
         approval_state, validation_version, requested_by, approved_by, approved_at,
         last_validated_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'https://example.test/menu', 'example.test', 'recognized',
                 'approved', 'portal-destination-https-v1', $4, $4, now(), now(), now(), now())`,
      [DESTINATION, ORG_A, PROPERTY_A, CREATOR],
    )
    const categoryId = randomUUID()
    const linkId = randomUUID()
    await q(
      `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                           created_at, updated_at)
       VALUES ($1, $2, $3, 'Food', 'a0', $4, $4)`,
      [categoryId, SOURCE, ORG_A, CREATED_AT],
    )
    await q(
      `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                                 label, destination_id, legacy_destination_state, icon_key,
                                 sort_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Menu', $6, 'migrated', 'map-pin', 'a0', $7, $7)`,
      [linkId, categoryId, SOURCE, ORG_A, PROPERTY_A, DESTINATION, CREATED_AT],
    )
    await q(
      `INSERT INTO portal_link_texts (organization_id, property_id, portal_id, link_id, locale,
                                      label, line, version, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'en', 'Menu', 'Today', 1, $5, $6, $6),
              ($1, $2, $3, $4, 'bg', 'Меню', NULL, 1, $5, $6, $6)`,
      [ORG_A, PROPERTY_A, SOURCE, linkId, CREATOR, CREATED_AT],
    )
    await q(
      `INSERT INTO portal_localized_overrides (id, organization_id, property_id, portal_id,
                                               locale, title, linktree_title, version,
                                               updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'en', 'Pool', 'Good to know', 1, $5, $6, $6)`,
      [randomUUID(), ORG_A, PROPERTY_A, SOURCE, CREATOR, CREATED_AT],
    )
    return { source, linkId }
  }

  async function copyCommand(alreadySeeded = false): Promise<CreatePortalCommand> {
    const seeded = alreadySeeded ? null : await seedSource()
    const db = getDb()
    const portalRepo = createPortalRepository(db)
    const linkRepo = createPortalLinkRepository(db, () => NOW)
    const loaded = (await portalRepo.findById(ORG_A, SOURCE)) ?? seeded?.source
    if (!loaded) throw new Error('expected the source Portal')
    const [categories, links, linkTexts, destinations] = await Promise.all([
      linkRepo.listCategories(ORG_A, SOURCE),
      linkRepo.listAllLinks(ORG_A, SOURCE),
      linkRepo.listLinkTexts(ORG_A, SOURCE, 'en'),
      createPortalApprovedDestinationRepository(db).list(ORG_A, PROPERTY_A),
    ])
    let n = 0
    const plan = planPortalContentCopy({
      source: {
        portal: loaded,
        overrides: [
          {
            id: 'unused',
            organizationId: ORG_A,
            propertyId: PROPERTY_A,
            portalId: SOURCE,
            locale: 'en',
            title: 'Pool',
            shortDescription: null,
            heroImageUrl: null,
            linktreeTitle: 'Good to know',
            version: 1,
            updatedBy: CREATOR,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
          },
        ],
        categories,
        links,
        linkTexts,
        approvedDestinationIds: new Set<string>(
          destinations
            .filter((destination) => destination.approvalState === 'approved')
            .map((destination) => destination.id),
        ),
      },
      target: { portalId: TARGET, locales: { primary: 'en', additional: ['bg'] } },
      idGen: () => randomUUID().replace(/^.{8}/, String((n += 1)).padStart(8, '0')),
      now: NOW,
    })
    const portal = portalOf({
      id: TARGET,
      name: 'Copy',
      slug: 'copy',
      description: plan.settings.description,
      linktreeEnabled: plan.settings.linktreeEnabled,
      primaryGuestLocale: 'en',
      additionalGuestLocales: ['bg'],
    })
    return {
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerIds: [CREATOR],
      copiedContent: plan.content,
      ...factsFor(portal, true),
    }
  }

  it('copies wording, links and texts to the new Portal and leaves the source alone', async () => {
    const command = await copyCommand()
    await store().createPortal(command)

    const target = await getPool().query(
      `SELECT description, linktree_enabled FROM portals WHERE id = $1`,
      [TARGET],
    )
    expect(target.rows[0]).toEqual({
      description: 'Welcome to the pool',
      linktree_enabled: false,
    })
    const links = await getPool().query(
      `SELECT l.label, l.destination_id, l.icon_key, c.title AS category, l.id
       FROM portal_links l JOIN portal_link_categories c ON c.id = l.category_id
       WHERE l.portal_id = $1`,
      [TARGET],
    )
    expect(links.rows).toEqual([
      expect.objectContaining({
        label: 'Menu',
        destination_id: DESTINATION,
        icon_key: 'map-pin',
        category: 'Food',
      }),
    ])
    const texts = await getPool().query(
      `SELECT locale, label, line FROM portal_link_texts WHERE portal_id = $1 ORDER BY locale`,
      [TARGET],
    )
    expect(texts.rows).toEqual([
      { locale: 'bg', label: 'Меню', line: null },
      { locale: 'en', label: 'Menu', line: 'Today' },
    ])
    const overrides = await getPool().query(
      `SELECT locale, title, linktree_title FROM portal_localized_overrides WHERE portal_id = $1`,
      [TARGET],
    )
    expect(overrides.rows).toEqual([
      { locale: 'en', title: 'Pool', linktree_title: 'Good to know' },
    ])
    // The source keeps its own rows.
    expect(await count('portal_links', 'portal_id', SOURCE)).toBe(1)
    expect(links.rows[0]?.id).not.toBe(command.copiedContent?.sourcePortalId)
  })

  it('copies only links whose destination is approved, whatever other links the source holds', async () => {
    await seedSource()
    const q = (text: string, values: unknown[]) => getPool().query(text, values)
    const category = (
      await q('SELECT id FROM portal_link_categories WHERE portal_id = $1', [SOURCE])
    ).rows[0]?.id
    const states = ['disabled', 'quarantined', 'approved', 'approved', 'approved']
    for (const [index, state] of states.entries()) {
      const destination = randomUUID()
      await q(
        `INSERT INTO portal_approved_destinations (
           id, organization_id, property_id, normalized_uri, hostname, source_type,
           approval_state, validation_version, requested_by, approved_by, approved_at,
           last_validated_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'example.test', 'recognized',
                   $5, 'portal-destination-https-v1', $6, $6, now(), now(), now(), now())`,
        [
          destination,
          ORG_A,
          PROPERTY_A,
          `https://example.test/extra-${index}`,
          state,
          CREATOR,
        ],
      )
      const link = randomUUID()
      await q(
        `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                                   label, destination_id, legacy_destination_state, icon_key,
                                   sort_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'migrated', 'map-pin', $8, $9, $9)`,
        [
          link,
          category,
          SOURCE,
          ORG_A,
          PROPERTY_A,
          `Extra ${index} ${state}`,
          destination,
          `b${index}`,
          CREATED_AT,
        ],
      )
      await q(
        `INSERT INTO portal_link_texts (organization_id, property_id, portal_id, link_id, locale,
                                        label, line, version, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'en', $5, NULL, 1, $6, $7, $7)`,
        [ORG_A, PROPERTY_A, SOURCE, link, `Extra ${index} ${state}`, CREATOR, CREATED_AT],
      )
    }

    await store().createPortal(await copyCommand(true))

    const copied = await getPool().query(
      `SELECT label FROM portal_links WHERE portal_id = $1 ORDER BY sort_key`,
      [TARGET],
    )
    expect(copied.rows.map((row) => row.label)).toEqual([
      'Menu',
      'Extra 2 approved',
      'Extra 3 approved',
      'Extra 4 approved',
    ])
  })

  it('takes nothing from the source beyond its content: no managers, codes or publications', async () => {
    const command = await copyCommand()
    await store().createPortal(command)
    const managers = await getPool().query(
      `SELECT user_id FROM portal_responsible_managers WHERE portal_id = $1`,
      [TARGET],
    )
    expect(managers.rows).toEqual([{ user_id: CREATOR }])
    for (const table of [
      'portal_tokens',
      'portal_access_artifacts',
      'portal_publication_snapshots',
      'portal_publication_activations',
    ]) {
      expect(await count(table, 'portal_id', TARGET)).toBe(0)
    }
    const state = await getPool().query(
      'SELECT publication_state FROM portals WHERE id = $1',
      [TARGET],
    )
    expect(state.rows[0].publication_state).toBe('draft')
  })

  it('rolls back the Portal when a copied link points at a destination of another Property', async () => {
    const command = await copyCommand()
    const copied = command.copiedContent
    if (!copied) throw new Error('expected copied content')
    const strayDestination = portalApprovedDestinationId(randomUUID())
    await expect(
      store().createPortal({
        ...command,
        copiedContent: {
          ...copied,
          links: copied.links.map((link) => ({
            ...link,
            destinationId: strayDestination,
          })),
        },
      }),
    ).rejects.toThrow(/Failed query/)
    expect(await count('portals', 'id', TARGET)).toBe(0)
    expect(await count('portal_link_categories', 'portal_id', TARGET)).toBe(0)
  })

  it('refuses copied rows that belong to another Portal', async () => {
    const command = await copyCommand()
    const copied = command.copiedContent
    if (!copied) throw new Error('expected copied content')
    await expect(
      store().createPortal({
        ...command,
        copiedContent: {
          ...copied,
          categories: copied.categories.map((category) => ({
            ...category,
            portalId: SOURCE,
          })),
        },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a copy whose link has no text in the primary language', async () => {
    const command = await copyCommand()
    const copied = command.copiedContent
    if (!copied) throw new Error('expected copied content')
    await expect(
      store().createPortal({
        ...command,
        copiedContent: {
          ...copied,
          linkTexts: copied.linkTexts.filter((text) => text.locale !== 'en'),
        },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

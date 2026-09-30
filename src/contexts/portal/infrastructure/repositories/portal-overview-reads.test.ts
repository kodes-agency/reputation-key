// The batched reads behind the Portals overview (round 4, slice 23).
//
// Each read answers for a set of Portals in one statement. Every test plants a
// second, fully populated tenant first, so a dropped organization conjunct
// shows up as another tenant's Portal in the answer, and compares the batch
// with the single-Portal read it stands in for, so the two cannot drift.

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { getDb } from '#/shared/db'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  type PortalId,
} from '#/shared/domain/ids'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { listPortalOverview } from '../../application/use-cases/list-portal-overview'
import { createPortalRepository } from './portal.repository'
import { createPortalGroupRepository } from './portal-group.repository'
import { createPortalHealthRepository } from './portal-health.repository'
import { createPortalPublicationRepository } from './portal-publication.repository'
import { createPortalResponsibleManagerRepository } from './portal-responsible-manager.repository'
import { createPortalTokenRepository } from './portal-token.repository'
import { issueToken, rotateToken } from '../../domain/portal-token'

const ORG = organizationId('org-portal-overview-reads')
const ORG_OTHER = organizationId('org-portal-overview-other')
const PROPERTY = propertyId('ee000000-0000-4000-8000-000000000001')
const PROPERTY_OTHER = propertyId('ee000000-0000-4000-8000-000000000002')
// A live, grouped, staffed, tokened Portal with pending changes.
const FULL = portalId('ee000000-0000-4000-8000-000000000011')
// Draft, nothing else.
const BARE = portalId('ee000000-0000-4000-8000-000000000012')
// Was grouped, was staffed, token revoked: only history remains.
const FORMER = portalId('ee000000-0000-4000-8000-000000000013')
const OTHER_TENANT_PORTAL = portalId('ee000000-0000-4000-8000-000000000021')
const GROUP = portalGroupId('ee000000-0000-4000-8000-000000000031')
const GROUP_OTHER = portalGroupId('ee000000-0000-4000-8000-000000000032')
const GROUP_FORMER = portalGroupId('ee000000-0000-4000-8000-000000000033')
const START = new Date('2026-09-01T10:00:00.000Z')
const LATER = new Date('2026-09-02T10:00:00.000Z')
const NOW = new Date('2026-09-10T12:00:00.000Z')
const ALL_PORTALS: readonly PortalId[] = [FULL, BARE, FORMER, OTHER_TENANT_PORTAL]

let pool: Pool

const hash = (name: string) =>
  createHash('sha256').update(`portal-overview-reads:${name}`).digest('hex')

const tables = [
  'portal_pending_content_changes',
  'portal_health_intervals',
  'portal_responsible_managers',
  'portal_group_memberships',
  'portal_groups',
  'portal_access_artifacts',
  'portal_tokens',
  'portals',
]

async function clean() {
  for (const table of tables) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
      [ORG, ORG_OTHER],
    ])
  }
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  for (const org of [ORG, ORG_OTHER]) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, NOW()) ON CONFLICT (id) DO NOTHING`,
      [org],
    )
  }
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Overview Property', 'overview-property', 'UTC', NOW(), NOW()),
            ($2, $4, 'Overview Other', 'overview-other', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, PROPERTY_OTHER, ORG, ORG_OTHER],
  )
})

afterAll(async () => {
  await clean()
  await pool.query('DELETE FROM properties WHERE id = ANY($1)', [
    [PROPERTY, PROPERTY_OTHER],
  ])
  await deleteTestOrganizations(pool, [ORG, ORG_OTHER])
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, theme, publication_state, created_at, updated_at)
     VALUES ($1, $5, $7::uuid, 'property', $7::text, 'Full', 'full', '{"primaryColor":"#123456"}'::jsonb, 'published', NOW(), NOW()),
            ($2, $5, $7::uuid, 'property', $7::text, 'Bare', 'bare', '{"primaryColor":"#123456"}'::jsonb, 'draft', NOW(), NOW()),
            ($3, $5, $7::uuid, 'property', $7::text, 'Former', 'former', '{"primaryColor":"#123456"}'::jsonb, 'published', NOW(), NOW()),
            ($4, $6, $8::uuid, 'property', $8::text, 'Other', 'other', '{"primaryColor":"#123456"}'::jsonb, 'published', NOW(), NOW())`,
    [FULL, BARE, FORMER, OTHER_TENANT_PORTAL, ORG, ORG_OTHER, PROPERTY, PROPERTY_OTHER],
  )
})

async function seedGroups() {
  const repo = createPortalGroupRepository(getDb())
  const group = (id: typeof GROUP, org: typeof ORG, property: typeof PROPERTY) => ({
    id,
    organizationId: org,
    propertyId: property,
    name: `Group ${id.slice(-2)}`,
    sortKey: null,
    createdAt: START,
    updatedAt: START,
    deletedAt: null,
  })
  await repo.insert(ORG, group(GROUP, ORG, PROPERTY))
  await repo.insert(ORG, group(GROUP_FORMER, ORG, PROPERTY))
  await repo.insert(ORG_OTHER, group(GROUP_OTHER, ORG_OTHER, PROPERTY_OTHER))
  await repo.addPortal(ORG, GROUP, FULL, START, 'owner')
  await repo.addPortal(ORG, GROUP_FORMER, FORMER, START, 'owner')
  await repo.removePortal(ORG, GROUP_FORMER, FORMER, LATER, 'moved')
  await repo.addPortal(ORG_OTHER, GROUP_OTHER, OTHER_TENANT_PORTAL, START, 'owner')
  return repo
}

describe('portal group repository — listGroupsForPortals', () => {
  it('answers with the group each Portal is in, matching the single read', async () => {
    const repo = await seedGroups()

    const rows = await repo.listGroupsForPortals(ORG, ALL_PORTALS, NOW)

    expect(rows.map((row) => [row.portalId, row.group.id])).toEqual([[FULL, GROUP]])
    for (const pid of [FULL, BARE, FORMER]) {
      const single = await repo.findGroupForPortal(ORG, pid, NOW)
      expect(rows.find((row) => row.portalId === pid)?.group.id ?? null).toBe(
        single?.id ?? null,
      )
    }
  })

  it('places a Portal in the group it held at the moment asked', async () => {
    const repo = await seedGroups()

    const before = await repo.listGroupsForPortals(
      ORG,
      [FORMER],
      new Date(START.getTime() + 1),
    )
    const after = await repo.listGroupsForPortals(ORG, [FORMER], NOW)

    expect(before.map((row) => row.group.id)).toEqual([GROUP_FORMER])
    expect(after).toEqual([])
  })

  it('drops a group once it is archived, and keeps it at the moment before', async () => {
    const repo = await seedGroups()
    await getDb()
      .update(portalGroups)
      .set({ deletedAt: LATER })
      .where(eq(portalGroups.id, GROUP))
    const before = new Date(START.getTime() + 1)

    const rows = await repo.listGroupsForPortals(ORG, [FULL], before)
    const after = await repo.listGroupsForPortals(ORG, [FULL], NOW)

    expect(rows.map((row) => row.group.id)).toEqual([GROUP])
    expect((await repo.findGroupForPortal(ORG, FULL, before))?.id).toBe(GROUP)
    expect(after).toEqual([])
    await expect(repo.findGroupForPortal(ORG, FULL, NOW)).resolves.toBeNull()
  })

  it('never answers for another tenant Portal', async () => {
    const repo = await seedGroups()

    await expect(
      repo.listGroupsForPortals(ORG, [OTHER_TENANT_PORTAL], NOW),
    ).resolves.toEqual([])
    await expect(
      repo.listGroupsForPortals(ORG_OTHER, [OTHER_TENANT_PORTAL], NOW),
    ).resolves.toHaveLength(1)
  })

  it('answers nothing for no Portals', async () => {
    const repo = await seedGroups()
    await expect(repo.listGroupsForPortals(ORG, [], NOW)).resolves.toEqual([])
  })
})

describe('portal health repository — listCurrentForPortals', () => {
  const transition = (
    pid: PortalId,
    org: typeof ORG,
    property: typeof PROPERTY,
    health: Readonly<{
      status: 'healthy' | 'degraded' | 'unavailable'
      reason: 'operational' | 'publication_draft' | 'responsibility_needed'
    }>,
    at: Date,
  ) =>
    createPortalHealthRepository(getDb()).transition({
      id: crypto.randomUUID(),
      organizationId: org,
      propertyId: property,
      portalId: pid,
      health,
      sourceVersion: at.toISOString(),
      effectiveAt: at,
      observedAt: at,
    })

  it('answers with the current interval of each Portal, matching the single read', async () => {
    const repo = createPortalHealthRepository(getDb())
    await transition(
      FULL,
      ORG,
      PROPERTY,
      { status: 'degraded', reason: 'responsibility_needed' },
      START,
    )
    await transition(
      FULL,
      ORG,
      PROPERTY,
      { status: 'healthy', reason: 'operational' },
      LATER,
    )
    await transition(
      BARE,
      ORG,
      PROPERTY,
      { status: 'unavailable', reason: 'publication_draft' },
      START,
    )
    await transition(
      OTHER_TENANT_PORTAL,
      ORG_OTHER,
      PROPERTY_OTHER,
      { status: 'healthy', reason: 'operational' },
      START,
    )

    const rows = await repo.listCurrentForPortals(ORG, ALL_PORTALS)

    expect(rows.map((row) => [row.portalId, row.status, row.reason]).sort()).toEqual([
      [FULL, 'healthy', 'operational'],
      [BARE, 'unavailable', 'publication_draft'],
    ])
    for (const pid of [FULL, BARE, FORMER]) {
      const single = await repo.getCurrent(ORG, PROPERTY, pid)
      expect(rows.find((row) => row.portalId === pid)).toEqual(single ?? undefined)
    }
  })

  it('answers nothing for no Portals', async () => {
    await expect(
      createPortalHealthRepository(getDb()).listCurrentForPortals(ORG, []),
    ).resolves.toEqual([])
  })
})

describe('portal publication repository — countOpenPendingContentChanges', () => {
  const change = (
    org: typeof ORG,
    property: typeof PROPERTY,
    pid: PortalId,
    kind: string,
    key: string,
  ) =>
    pool.query(
      `INSERT INTO portal_pending_content_changes
         (organization_id, property_id, portal_id, change_kind, change_key, source_version, changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [org, property, pid, kind, key, `${kind}:${key}`, START],
    )

  it('counts the open changes of each Portal, matching the single read', async () => {
    const repo = createPortalPublicationRepository(getDb())
    await change(ORG, PROPERTY, FULL, 'portal_configuration', 'all')
    await change(ORG, PROPERTY, FULL, 'portal_links', 'all')
    await change(ORG, PROPERTY, BARE, 'property_brand_profile', 'all')
    await change(
      ORG_OTHER,
      PROPERTY_OTHER,
      OTHER_TENANT_PORTAL,
      'portal_configuration',
      'all',
    )

    const rows = await repo.countOpenPendingContentChanges(ORG, ALL_PORTALS)

    expect(rows.map((row) => [row.portalId, row.count]).sort()).toEqual([
      [FULL, 2],
      [BARE, 1],
    ])
    for (const pid of [FULL, BARE, FORMER]) {
      const single = await repo.listOpenPendingContentChanges?.(ORG, PROPERTY, pid)
      expect(rows.find((row) => row.portalId === pid)?.count ?? 0).toBe(single?.length)
    }
  })

  it('answers nothing for no Portals', async () => {
    await expect(
      createPortalPublicationRepository(getDb()).countOpenPendingContentChanges(ORG, []),
    ).resolves.toEqual([])
  })
})

describe('portal responsible manager repository — listActiveForPortals', () => {
  const manager = (
    org: typeof ORG,
    property: typeof PROPERTY,
    pid: PortalId,
    user: string,
    to: Date | null = null,
  ) =>
    pool.query(
      `INSERT INTO portal_responsible_managers
         (organization_id, property_id, portal_id, user_id, effective_from, effective_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'owner')`,
      [org, property, pid, user, START, to],
    )

  it('answers with the active managers of each Portal, matching the single read', async () => {
    const repo = createPortalResponsibleManagerRepository(getDb())
    await manager(ORG, PROPERTY, FULL, 'user-b')
    await manager(ORG, PROPERTY, FULL, 'user-a')
    await manager(ORG, PROPERTY, FORMER, 'user-c', LATER)
    await manager(ORG_OTHER, PROPERTY_OTHER, OTHER_TENANT_PORTAL, 'user-z')

    const rows = await repo.listActiveForPortals(ORG, ALL_PORTALS)

    expect(rows.map((row) => [row.portalId, row.userId])).toEqual([
      [FULL, 'user-a'],
      [FULL, 'user-b'],
    ])
    for (const pid of [FULL, BARE, FORMER]) {
      const single = await repo.listActive(ORG, pid)
      expect(rows.filter((row) => row.portalId === pid)).toEqual(single)
    }
  })

  it('answers nothing for no Portals', async () => {
    await expect(
      createPortalResponsibleManagerRepository(getDb()).listActiveForPortals(ORG, []),
    ).resolves.toEqual([])
  })
})

describe('portal token repository — findResolvableSummariesForPortals', () => {
  const token = (
    id: string,
    org: typeof ORG,
    property: typeof PROPERTY,
    pid: PortalId,
    version: number,
  ) =>
    issueToken({
      id,
      organizationId: org,
      propertyId: property,
      portalId: pid,
      tokenIdentifier: `overview-${id.slice(-4)}`,
      tokenHash: hash(id),
      tokenKeyVersion: 1,
      version,
      now: START,
    })

  it('summarises the live token of each Portal, matching the single read', async () => {
    const repo = createPortalTokenRepository(getDb())
    const current = token('ee000000-0000-4000-8000-000000000041', ORG, PROPERTY, FULL, 1)
    await repo.insert(current)
    const rotation = rotateToken(
      current,
      {
        id: 'ee000000-0000-4000-8000-000000000042',
        tokenIdentifier: 'overview-rotated',
        tokenHash: hash('rotated'),
        tokenKeyVersion: 1,
        version: 2,
      },
      2_592_000_000,
      START,
    )
    if (!('oldToken' in rotation)) throw new Error('rotation failed')
    await repo.saveRotation(rotation)
    const revoked = token(
      'ee000000-0000-4000-8000-000000000043',
      ORG,
      PROPERTY,
      FORMER,
      1,
    )
    await repo.insert(revoked)
    await repo.revokeForPortal({
      organizationId: ORG,
      portalId: FORMER,
      revokedBy: 'owner',
      reason: 'leaked',
      at: LATER,
    })
    await repo.insert(
      token(
        'ee000000-0000-4000-8000-000000000044',
        ORG_OTHER,
        PROPERTY_OTHER,
        OTHER_TENANT_PORTAL,
        1,
      ),
    )

    const rows = await repo.findResolvableSummariesForPortals(ORG, ALL_PORTALS, START)

    // The newest resolvable token governs, as in the single read; the revoked
    // Portal and the Portal with no token have none.
    expect(rows.map((row) => [row.portalId, row.version])).toEqual([[FULL, 2]])
    // The newer token carries no grace; the window is the outgoing token's.
    expect(rows[0]?.gracePeriodEnds).toEqual(new Date(START.getTime() + 2_592_000_000))
    for (const pid of [FULL, BARE, FORMER]) {
      const single = await repo.findResolvableSummaryForPortal(ORG, pid, START)
      expect(rows.find((row) => row.portalId === pid)).toEqual(
        single ? { ...single, portalId: pid } : undefined,
      )
    }
  })

  it('reports the outgoing grace for one Portal and not another, in one answer', async () => {
    const repo = createPortalTokenRepository(getDb())
    const rotate = async (pid: PortalId, suffix: string, grace: number) => {
      const old = token(
        `ee000000-0000-4000-8000-0000000001${suffix}0`,
        ORG,
        PROPERTY,
        pid,
        1,
      )
      await repo.insert(old)
      const rotation = rotateToken(
        old,
        {
          id: `ee000000-0000-4000-8000-0000000001${suffix}1`,
          tokenIdentifier: `overview-out-${suffix}`,
          tokenHash: hash(`out-${suffix}`),
          tokenKeyVersion: 1,
          version: 2,
        },
        grace,
        START,
      )
      if (!('oldToken' in rotation)) throw new Error('rotation failed')
      await repo.saveRotation(rotation)
    }
    await rotate(FULL, '1', 60_000)
    await rotate(BARE, '2', 120_000)
    await repo.insert(
      token('ee000000-0000-4000-8000-000000000153', ORG, PROPERTY, FORMER, 1),
    )

    const rows = await repo.findResolvableSummariesForPortals(
      ORG,
      [FULL, BARE, FORMER],
      START,
    )

    const graceOf = (pid: PortalId) =>
      rows.find((row) => row.portalId === pid)?.gracePeriodEnds
    expect(graceOf(FULL)).toEqual(new Date(START.getTime() + 60_000))
    expect(graceOf(BARE)).toEqual(new Date(START.getTime() + 120_000))
    expect(graceOf(FORMER)).toBeNull()
    for (const pid of [FULL, BARE, FORMER]) {
      const single = await repo.findResolvableSummaryForPortal(ORG, pid, START)
      expect(rows.find((row) => row.portalId === pid)).toEqual({
        ...single,
        portalId: pid,
      })
    }
  })

  it('reports one row per Portal however many access artifacts its token holds', async () => {
    const repo = createPortalTokenRepository(getDb())
    const full = token('ee000000-0000-4000-8000-000000000061', ORG, PROPERTY, FULL, 1)
    const bare = token('ee000000-0000-4000-8000-000000000062', ORG, PROPERTY, BARE, 1)
    await repo.insert(full)
    await repo.insert(bare)
    const artifact = (
      id: string,
      pid: PortalId,
      tokenId: string,
      channel: 'qr' | 'nfc',
      retired: boolean,
    ) =>
      pool.query(
        `INSERT INTO portal_access_artifacts
           (id, organization_id, property_id, portal_id, portal_token_id, channel, status, published_at, retired_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          ORG,
          PROPERTY,
          pid,
          tokenId,
          channel,
          retired ? 'retired' : 'published',
          START,
          retired ? LATER : null,
        ],
      )
    await artifact('ee000000-0000-4000-8000-000000000071', FULL, full.id, 'qr', false)
    await artifact('ee000000-0000-4000-8000-000000000072', FULL, full.id, 'nfc', false)
    await artifact('ee000000-0000-4000-8000-000000000073', BARE, bare.id, 'qr', true)

    const rows = await repo.findResolvableSummariesForPortals(ORG, [FULL, BARE], START)

    expect(
      rows.map((row) => [row.portalId, row.hasPublishedAccessArtifact]).sort(),
    ).toEqual(
      [
        [FULL, true],
        [BARE, false],
      ].sort(),
    )
    for (const pid of [FULL, BARE]) {
      const single = await repo.findResolvableSummaryForPortal(ORG, pid, START)
      expect(rows.find((row) => row.portalId === pid)).toEqual({
        ...single,
        portalId: pid,
      })
    }
  })

  it('stops counting a rotated token once its grace window closes', async () => {
    const repo = createPortalTokenRepository(getDb())
    const current = token('ee000000-0000-4000-8000-000000000045', ORG, PROPERTY, FULL, 1)
    const rotation = rotateToken(
      current,
      {
        id: 'ee000000-0000-4000-8000-000000000046',
        tokenIdentifier: 'overview-grace',
        tokenHash: hash('grace'),
        tokenKeyVersion: 1,
        version: 2,
      },
      60_000,
      START,
    )
    if (!('oldToken' in rotation)) throw new Error('rotation failed')
    await repo.insert(rotation.oldToken)

    await expect(
      repo.findResolvableSummariesForPortals(ORG, [FULL], START),
    ).resolves.toHaveLength(1)
    await expect(
      repo.findResolvableSummariesForPortals(ORG, [FULL], LATER),
    ).resolves.toEqual([])
  })

  it('answers nothing for no Portals', async () => {
    await expect(
      createPortalTokenRepository(getDb()).findResolvableSummariesForPortals(
        ORG,
        [],
        NOW,
      ),
    ).resolves.toEqual([])
  })
})

describe('listPortalOverview over the real repositories', () => {
  it('assembles each Portal from the batched reads and shows nothing of another tenant', async () => {
    const db = getDb()
    const portalGroupRepo = await seedGroups()
    const portalTokenRepo = createPortalTokenRepository(db)
    const healthRepo = createPortalHealthRepository(db)
    await healthRepo.transition({
      id: crypto.randomUUID(),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: FULL,
      health: { status: 'degraded', reason: 'responsibility_needed' },
      sourceVersion: 'v1',
      effectiveAt: START,
      observedAt: START,
    })
    await pool.query(
      `INSERT INTO portal_pending_content_changes
         (organization_id, property_id, portal_id, change_kind, change_key, source_version, changed_at)
       VALUES ($1, $2, $3, 'portal_links', 'all', 'v1', $4)`,
      [ORG, PROPERTY, FULL, START],
    )
    await pool.query(
      `INSERT INTO portal_responsible_managers
         (organization_id, property_id, portal_id, user_id, effective_from, created_by)
       VALUES ($1, $2, $3, 'user-a', $4, 'owner')`,
      [ORG, PROPERTY, FULL, START],
    )
    await portalTokenRepo.insert(
      issueToken({
        id: 'ee000000-0000-4000-8000-000000000051',
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: FULL,
        tokenIdentifier: 'overview-e2e',
        tokenHash: hash('e2e'),
        tokenKeyVersion: 1,
        version: 1,
        now: START,
      }),
    )
    const useCase = listPortalOverview({
      portalRepo: createPortalRepository(db),
      portalHealthRepo: healthRepo,
      publicationRepo: createPortalPublicationRepository(db),
      portalGroupRepo,
      managerRepo: createPortalResponsibleManagerRepository(db),
      portalTokenRepo,
      staffPublicApi: {
        getAccessiblePropertyIds: async () => null,
        getAssignedPortals: async () => [],
      },
      clock: () => NOW,
    })

    const rows = await useCase(
      { scope: 'organization' },
      buildTestAuthContext({ organizationId: ORG, role: 'AccountAdmin' }),
    )

    expect(rows.map((row) => [row.name, row.publicationState])).toEqual([
      ['Bare', 'draft'],
      ['Former', 'published'],
      ['Full', 'published'],
    ])
    const full = rows.find((row) => row.portalId === FULL)
    expect(full).toMatchObject({
      health: { status: 'degraded', reason: 'responsibility_needed' },
      pendingChangeCount: 1,
      group: { id: GROUP },
      responsibleManagerUserIds: ['user-a'],
      token: { hasActiveToken: true, version: 1 },
    })
    expect(rows.find((row) => row.portalId === BARE)).toMatchObject({
      health: null,
      pendingChangeCount: 0,
      group: null,
      responsibleManagerUserIds: [],
      token: { hasActiveToken: false },
    })
  })
})

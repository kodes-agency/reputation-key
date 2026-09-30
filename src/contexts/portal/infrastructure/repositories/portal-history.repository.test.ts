import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { historyBoundFor, HISTORY_KEY_PREFIX } from '../../domain/portal-history'
import { createPortalHealthRepository } from './portal-health.repository'
import { createPortalHistoryRepository } from './portal-history.repository'

const ORG = organizationId('org-portal-history-000000000001')
const OTHER_ORG = organizationId('org-portal-history-000000000002')
const PROPERTY = propertyId('c5a00000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('c5a00000-0000-4000-8000-000000000002')
const PORTAL = portalId('c5b00000-0000-4000-8000-000000000001')
const OTHER_PORTAL = portalId('c5b00000-0000-4000-8000-000000000002')
const T0 = new Date('2026-09-01T10:00:00.000Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'portal_health_intervals',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_access_artifacts',
    'portal_tokens',
    'portals',
    'properties',
  ],
})

const activationId = (n: number) =>
  `c5c00000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const tokenId = (n: number) =>
  `c5d00000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const healthId = (n: number) =>
  `c5e00000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

async function seedPortals() {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'History Property', 'history-property', 'UTC', $5, $5),
            ($2, $4, 'Other History Property', 'other-history-property', 'UTC', $5, $5)`,
    [PROPERTY, OTHER_PROPERTY, ORG, OTHER_ORG, T0],
  )
  await getPool().query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state, created_at, updated_at)
     VALUES ($1, $3, $5::uuid, 'property', $5::text, 'History Portal', 'history-portal', 'published', $7, $7),
            ($2, $4, $6::uuid, 'property', $6::text, 'Other Portal', 'other-portal', 'published', $7, $7)`,
    [PORTAL, OTHER_PORTAL, ORG, OTHER_ORG, PROPERTY, OTHER_PROPERTY, T0],
  )
}

/** Snapshot v`version` for `portal`, then one activation pointing at it. */
async function seedActivation(
  n: number,
  input: Readonly<{
    org: string
    property: string
    portal: string
    version: number
    kind?: 'publish' | 'rollback'
    by: string
    when: Date
    sequence: number
    /** Only one activation per portal may be open; the rest were replaced. */
    open?: boolean
  }>,
) {
  // One snapshot per (portal, version): a rollback re-uses the older version's.
  const portalTail = input.portal.slice(-2)
  const snapshotId = `c5f00000-0000-4000-80${portalTail}-0000000000${String(input.version).padStart(2, '0')}`
  await getPool().query(
    `INSERT INTO portal_publication_snapshots
       (id, organization_id, property_id, portal_id, version, configuration_digest,
        configuration, guest_locale, language_pack_version, private_feedback_threshold,
        destination_uri, destination_retrieved_at, destination_source_epoch,
        destination_profile_version, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
             'https://search.google.com/local/writereview?placeid=history', $7, 1, 1, $8, $7)
     ON CONFLICT DO NOTHING`,
    [
      snapshotId,
      input.org,
      input.property,
      input.portal,
      input.version,
      `${input.version % 10}`.repeat(64),
      input.when,
      input.by,
    ],
  )
  await getPool().query(
    `INSERT INTO portal_publication_activations
       (id, organization_id, property_id, portal_id, snapshot_id, activation_sequence,
        kind, activated_by, activated_at, deactivated_at, deactivation_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      activationId(n),
      input.org,
      input.property,
      input.portal,
      snapshotId,
      input.sequence,
      input.kind ?? 'publish',
      input.by,
      input.when,
      input.open ? null : input.when,
      input.open ? null : 'replaced',
    ],
  )
}

async function seedToken(
  n: number,
  input: Readonly<{
    org: string
    property: string
    portal: string
    version: number
    issuedAt: Date
    revokedAt?: Date
    revokedBy?: string
    reason?: string
    graceEnds?: Date
  }>,
) {
  await getPool().query(
    `INSERT INTO portal_tokens
       (id, organization_id, property_id, portal_id, token_identifier, token_hash,
        token_key_version, version, status, issued_at, grace_period_ends,
        revoked_at, revoked_by, revoked_reason, retired_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12, $13, $11)`,
    [
      tokenId(n),
      input.org,
      input.property,
      input.portal,
      `hist${String(n).padStart(20, '0')}`,
      `d${String(n).padStart(2, '0')}`.padEnd(64, 'e'),
      input.version,
      input.revokedAt ? 'revoked' : input.graceEnds ? 'rotating' : 'active',
      input.issuedAt,
      input.graceEnds ?? null,
      input.revokedAt ?? null,
      input.revokedBy ?? null,
      input.reason ?? null,
    ],
  )
}

beforeEach(seedPortals)

describe.sequential('Portal history repository (real PostgreSQL)', () => {
  it('lists publications newest first with the version, kind and actor, for one portal only', async () => {
    await seedActivation(1, {
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      version: 1,
      by: 'georgi',
      when: at(10),
      sequence: 1,
    })
    await seedActivation(2, {
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      version: 1,
      kind: 'rollback',
      by: 'elena',
      when: at(30),
      sequence: 2,
      open: true,
    })
    await seedActivation(3, {
      org: OTHER_ORG,
      property: OTHER_PROPERTY,
      portal: OTHER_PORTAL,
      version: 1,
      by: 'stranger',
      when: at(20),
      sequence: 1,
      open: true,
    })
    const repo = createPortalHistoryRepository(getDb())

    const rows = await repo.listPublicationEvents(ORG, PROPERTY, PORTAL, {
      bound: null,
      limit: 10,
    })

    expect(rows).toEqual([
      {
        activationId: activationId(2),
        version: 1,
        kind: 'rollback',
        activatedBy: 'elena',
        activatedAt: at(30),
      },
      {
        activationId: activationId(1),
        version: 1,
        kind: 'publish',
        activatedBy: 'georgi',
        activatedAt: at(10),
      },
    ])
    await expect(
      repo.listPublicationEvents(OTHER_ORG, PROPERTY, PORTAL, { bound: null, limit: 10 }),
    ).resolves.toEqual([])
    await expect(
      repo.listPublicationEvents(ORG, OTHER_PROPERTY, PORTAL, { bound: null, limit: 10 }),
    ).resolves.toEqual([])
  })

  it('pages activations that share an instant without skipping or repeating one', async () => {
    const tie = at(10)
    for (const n of [1, 2, 3, 4]) {
      await seedActivation(n, {
        org: ORG,
        property: PROPERTY,
        portal: PORTAL,
        version: n,
        by: 'georgi',
        when: tie,
        sequence: n,
      })
    }
    await seedActivation(5, {
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      version: 5,
      by: 'georgi',
      when: at(20),
      sequence: 5,
      open: true,
    })
    const repo = createPortalHistoryRepository(getDb())

    const seen: string[] = []
    let position: { at: Date; key: string } | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const rows = await repo.listPublicationEvents(ORG, PROPERTY, PORTAL, {
        bound: historyBoundFor(HISTORY_KEY_PREFIX.publication, position),
        limit: 2,
      })
      if (rows.length === 0) break
      seen.push(...rows.map((row) => row.activationId))
      const last = rows[rows.length - 1]!
      position = {
        at: last.activatedAt,
        key: `${HISTORY_KEY_PREFIX.publication}${last.activationId}`,
      }
    }

    expect(seen).toEqual([5, 4, 3, 2, 1].map(activationId))
  })

  it('lists issued addresses with the facts about the one before', async () => {
    await seedToken(1, {
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      version: 1,
      issuedAt: at(5),
      graceEnds: at(9_000),
    })
    await seedToken(2, {
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      version: 2,
      issuedAt: at(50),
    })
    await seedToken(3, {
      org: OTHER_ORG,
      property: OTHER_PROPERTY,
      portal: OTHER_PORTAL,
      version: 1,
      issuedAt: at(60),
    })
    const repo = createPortalHistoryRepository(getDb())

    const rows = await repo.listCodeIssuances(ORG, PROPERTY, PORTAL, {
      bound: null,
      limit: 10,
    })

    expect(rows).toEqual([
      {
        tokenId: tokenId(2),
        version: 2,
        issuedAt: at(50),
        predecessor: { revokedAt: null, gracePeriodEnds: at(9_000) },
      },
      { tokenId: tokenId(1), version: 1, issuedAt: at(5), predecessor: null },
    ])
  })

  it('folds one "turn off all codes" act into a single revocation', async () => {
    await seedToken(1, {
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      version: 1,
      issuedAt: at(5),
      revokedAt: at(40),
      revokedBy: 'elena',
      reason: 'Card lost',
    })
    await seedToken(2, {
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      version: 2,
      issuedAt: at(6),
      revokedAt: at(40),
      revokedBy: 'elena',
      reason: 'Card lost',
    })
    await seedToken(3, {
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      version: 3,
      issuedAt: at(50),
      revokedAt: at(70),
      revokedBy: 'georgi',
      reason: 'Replaced again',
    })
    await seedToken(4, {
      org: OTHER_ORG,
      property: OTHER_PROPERTY,
      portal: OTHER_PORTAL,
      version: 1,
      issuedAt: at(5),
      revokedAt: at(80),
      revokedBy: 'stranger',
      reason: 'x',
    })
    const repo = createPortalHistoryRepository(getDb())

    const all = await repo.listCodeRevocations(ORG, PROPERTY, PORTAL, {
      bound: null,
      limit: 10,
    })
    const older = await repo.listCodeRevocations(ORG, PROPERTY, PORTAL, {
      bound: historyBoundFor(
        HISTORY_KEY_PREFIX.codeRevoked,
        { at: at(70), key: `${HISTORY_KEY_PREFIX.codeRevoked}${at(70).getTime()}` },
        true,
      ),
      limit: 10,
    })

    expect(all).toEqual([
      { revokedAt: at(70), revokedBy: 'georgi', reason: 'Replaced again' },
      { revokedAt: at(40), revokedBy: 'elena', reason: 'Card lost' },
    ])
    expect(older).toEqual([
      { revokedAt: at(40), revokedBy: 'elena', reason: 'Card lost' },
    ])
  })

  it('reads health history in bounded pages, newest first, for one portal only', async () => {
    const health = createPortalHealthRepository(getDb())
    const transitions = [
      [1, 'unavailable', 'publication_draft', 0],
      [2, 'healthy', 'operational', 10],
      [3, 'degraded', 'responsibility_needed', 20],
    ] as const
    for (const [n, status, reason, minutes] of transitions) {
      await health.transition({
        id: healthId(n),
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        health: { status, reason },
        sourceVersion: `v${n}`,
        effectiveAt: at(minutes),
        observedAt: at(minutes),
      })
    }
    await health.transition({
      id: healthId(9),
      organizationId: OTHER_ORG,
      propertyId: OTHER_PROPERTY,
      portalId: OTHER_PORTAL,
      health: { status: 'healthy', reason: 'operational' },
      sourceVersion: 'other',
      effectiveAt: at(15),
      observedAt: at(15),
    })

    const first = await health.listHistory(ORG, PROPERTY, PORTAL, 2)
    const second = await health.listHistory(
      ORG,
      PROPERTY,
      PORTAL,
      2,
      historyBoundFor(HISTORY_KEY_PREFIX.health, {
        at: at(10),
        key: `${HISTORY_KEY_PREFIX.health}${healthId(2)}`,
      }),
    )

    expect(first.map((row) => row.id)).toEqual([healthId(3), healthId(2)])
    expect(second.map((row) => row.id)).toEqual([healthId(1)])
  })
})

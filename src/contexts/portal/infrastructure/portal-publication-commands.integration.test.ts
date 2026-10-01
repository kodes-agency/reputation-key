// Publish changes while live (round 4, slice 20): the live activation closes as
// `replaced` and a new snapshot and activation open in ONE commit, under the
// Property publication fence and the Portal fence. Real PostgreSQL, because
// only a real transaction can prove the all-or-nothing, the lock order and the
// uniqueness of the live activation.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { portalLinkCategoryId, userId } from '#/shared/domain/ids'
import {
  portalLinkCategoryCreated,
  portalPublicationPublished,
  portalUpdated,
} from '../domain/events'
import { buildPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import type { RepublishPortalCommand } from '../application/ports/portal-command-store.port'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import { seedPortalWorkingCopy } from './testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from './testing/portal-working-copy-scenarios'

const SCENARIO = COMPLETE_SCENARIO
const MANAGER = userId('manager-republish-000000000000001')
const SEEDED_AT = new Date('2026-08-26T10:00:00.000Z')
const PUBLISHED_AT = new Date('2026-08-26T11:00:00.000Z')
const EDITED_AT = new Date('2026-08-26T12:00:00.000Z')
const REPUBLISH_AT = new Date('2026-08-26T13:00:00.000Z')
const FIRST_SNAPSHOT = '6d000000-0000-4000-8000-000000000001'
const FIRST_ACTIVATION = '6e000000-0000-4000-8000-000000000001'
const DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=republish',
  retrievedAt: SEEDED_AT,
  sourceEpoch: 1,
  profileVersion: 1,
} as const

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_texts',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

const store = () => createAtomicPortalCommandStore(getDb())

const readWorkingCopy = async () => {
  const source = await createPortalPublicationRepository(getDb()).loadWorkingCopy(
    SCENARIO.organizationId,
    SCENARIO.portalId,
  )
  if (!source) throw new Error('the scenario has no working copy')
  return source
}

function snapshotOf(
  source: Awaited<ReturnType<typeof readWorkingCopy>>,
  input: Readonly<{ id: string; version: number; at: Date }>,
) {
  return buildPortalPublicationSnapshot({
    id: input.id,
    portalId: SCENARIO.portalId,
    organizationId: SCENARIO.organizationId,
    propertyId: SCENARIO.propertyId,
    version: input.version,
    source,
    destination: DESTINATION,
    createdBy: MANAGER,
    createdAt: input.at,
  })
}

/** The first publication, through the ordinary publish path. */
async function publishFirstVersion(): Promise<void> {
  const snapshot = snapshotOf(await readWorkingCopy(), {
    id: FIRST_SNAPSHOT,
    version: 1,
    at: PUBLISHED_AT,
  })
  await store().updatePortal({
    organizationId: SCENARIO.organizationId,
    propertyId: SCENARIO.propertyId,
    portalId: SCENARIO.portalId,
    actorUserId: MANAGER,
    expectedUpdatedAt: SEEDED_AT,
    revision: PUBLISHED_AT,
    occurredAt: PUBLISHED_AT,
    patch: { publicationState: 'published' },
    publication: {
      kind: 'publish',
      snapshot,
      activation: {
        id: FIRST_ACTIVATION,
        organizationId: SCENARIO.organizationId,
        propertyId: SCENARIO.propertyId,
        portalId: SCENARIO.portalId,
        snapshotId: snapshot.id,
        activationSequence: 1,
        kind: 'publish',
        activatedBy: MANAGER,
        activatedAt: PUBLISHED_AT,
        deactivatedAt: null,
        deactivationReason: null,
      },
    },
    lifecycleEvent: portalPublicationPublished({
      organizationId: SCENARIO.organizationId,
      propertyId: SCENARIO.propertyId,
      portalId: SCENARIO.portalId,
      publicationSnapshotId: snapshot.id,
      publicationVersion: 1,
      publicationDigest: snapshot.configurationDigest,
      userId: MANAGER,
      sourceAggregateVersion: PUBLISHED_AT.toISOString(),
      occurredAt: PUBLISHED_AT,
    }),
    event: portalUpdated({
      portalId: SCENARIO.portalId,
      organizationId: SCENARIO.organizationId,
      propertyId: SCENARIO.propertyId,
      previousPublicationState: 'draft',
      publicationState: 'published',
      sourceAggregateVersion: PUBLISHED_AT.toISOString(),
      occurredAt: PUBLISHED_AT,
    }),
  })
}

/** The Property changes its wording: the draft moves, the Portal row does not. */
const changeWording = (title: string) =>
  getPool().query(
    `UPDATE property_portal_brand_contents SET title = $2
      WHERE property_id = $1 AND locale = 'bg'`,
    [SCENARIO.propertyId, title],
  )

async function republishCommand(
  overrides: Partial<RepublishPortalCommand> & { suffix?: string } = {},
): Promise<RepublishPortalCommand> {
  const { suffix = '2', ...rest } = overrides
  const at = rest.occurredAt ?? REPUBLISH_AT
  const snapshot = snapshotOf(await readWorkingCopy(), {
    id: `6d000000-0000-4000-8000-00000000000${suffix}`,
    version: 2,
    at,
  })
  const revision = rest.revision ?? at
  return {
    organizationId: SCENARIO.organizationId,
    propertyId: SCENARIO.propertyId,
    portalId: SCENARIO.portalId,
    actorUserId: MANAGER,
    expectedUpdatedAt: PUBLISHED_AT,
    revision,
    occurredAt: at,
    snapshot,
    activation: {
      id: `6e000000-0000-4000-8000-00000000000${suffix}`,
      organizationId: SCENARIO.organizationId,
      propertyId: SCENARIO.propertyId,
      portalId: SCENARIO.portalId,
      snapshotId: snapshot.id,
      activationSequence: 2,
      kind: 'publish',
      activatedBy: MANAGER,
      activatedAt: at,
      deactivatedAt: null,
      deactivationReason: null,
    },
    lifecycleEvent: portalPublicationPublished({
      organizationId: SCENARIO.organizationId,
      propertyId: SCENARIO.propertyId,
      portalId: SCENARIO.portalId,
      publicationSnapshotId: snapshot.id,
      publicationVersion: snapshot.version,
      publicationDigest: snapshot.configurationDigest,
      userId: MANAGER,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt: at,
    }),
    event: portalUpdated({
      portalId: SCENARIO.portalId,
      organizationId: SCENARIO.organizationId,
      propertyId: SCENARIO.propertyId,
      previousPublicationState: 'published',
      publicationState: 'published',
      sourceAggregateVersion: revision.toISOString(),
      occurredAt: at,
    }),
    ...rest,
  }
}

const activations = async () =>
  (
    await getPool().query(
      `SELECT a.activation_sequence AS sequence, s.version, a.kind,
              a.activated_at, a.deactivated_at, a.deactivation_reason
         FROM portal_publication_activations a
         JOIN portal_publication_snapshots s ON s.id = a.snapshot_id
        WHERE a.organization_id = $1 AND a.portal_id = $2
        ORDER BY a.activation_sequence`,
      [WORKING_COPY_ORG, SCENARIO.portalId],
    )
  ).rows

const portalRow = async () =>
  (
    await getPool().query(
      `SELECT publication_state, updated_at FROM portals
        WHERE organization_id = $1 AND id = $2`,
      [WORKING_COPY_ORG, SCENARIO.portalId],
    )
  ).rows[0]

const factTypes = async () =>
  (
    await getPool().query(
      `SELECT event_type FROM outbox_events WHERE organization_id = $1
        ORDER BY event_type`,
      [WORKING_COPY_ORG],
    )
  ).rows.map((row) => row.event_type)

const LIVE_ONLY_FIRST = [
  {
    sequence: 1,
    version: 1,
    kind: 'publish',
    activated_at: PUBLISHED_AT,
    deactivated_at: null,
    deactivation_reason: null,
  },
]

describe.sequential('republishPortal (real PostgreSQL)', () => {
  beforeEach(async () => {
    await seedPortalWorkingCopy(getPool(), SCENARIO)
    await publishFirstVersion()
  })

  it('closes the live activation as replaced and opens the next in one commit', async () => {
    await changeWording('Хотел Рила, обновен')
    const command = await republishCommand()

    await store().republishPortal(command)

    expect(await activations()).toEqual([
      {
        sequence: 1,
        version: 1,
        kind: 'publish',
        activated_at: PUBLISHED_AT,
        deactivated_at: REPUBLISH_AT,
        deactivation_reason: 'replaced',
      },
      {
        sequence: 2,
        version: 2,
        kind: 'publish',
        activated_at: REPUBLISH_AT,
        deactivated_at: null,
        deactivation_reason: null,
      },
    ])
    expect(await portalRow()).toEqual({
      publication_state: 'published',
      updated_at: REPUBLISH_AT,
    })
    const stored = await getPool().query(
      `SELECT configuration_digest, configuration #>> '{localizedContent,bg,title,value}' AS title
         FROM portal_publication_snapshots WHERE id = $1`,
      [command.snapshot.id],
    )
    expect(stored.rows).toEqual([
      {
        configuration_digest: command.snapshot.configurationDigest,
        title: 'Хотел Рила, обновен',
      },
    ])
  })

  it('serves the new version: the repository resolves it as the live one', async () => {
    await changeWording('Хотел Рила, обновен')
    const command = await republishCommand()

    await store().republishPortal(command)

    const live = await createPortalPublicationRepository(getDb()).findActiveForPortal(
      SCENARIO.organizationId,
      SCENARIO.portalId,
    )
    expect(live?.id).toBe(command.snapshot.id)
    expect(live?.version).toBe(2)
  })

  it('records the publication fact and portal.updated, and nothing of the content', async () => {
    await changeWording('Хотел Рила, обновен')
    const command = await republishCommand()

    await store().republishPortal(command)

    expect(await factTypes()).toEqual([
      'portal.publication.published',
      'portal.publication.published',
      'portal.updated',
      'portal.updated',
    ])
    const { rows } = await getPool().query(
      `SELECT payload FROM outbox_events
        WHERE organization_id = $1 AND id = $2`,
      [WORKING_COPY_ORG, command.lifecycleEvent.eventId],
    )
    expect(rows[0].payload).toMatchObject({
      publicationSnapshotId: command.snapshot.id,
      publicationVersion: 2,
      publicationDigest: command.snapshot.configurationDigest,
      userId: MANAGER,
    })
    expect(JSON.stringify(rows[0].payload)).not.toContain('Хотел')
    expect(JSON.stringify(rows[0].payload)).not.toContain(DESTINATION.uri)
  })

  it('resolves every open pending change against the new snapshot', async () => {
    await getPool().query(
      `INSERT INTO portal_pending_content_changes
         (organization_id, property_id, portal_id, change_kind, change_key,
          source_version, changed_at)
       VALUES ($1, $2, $3, 'property_brand_content', 'bg', 'v1', $4),
              ($1, $2, $3, 'portal_links', 'all', 'v2', $4)`,
      [WORKING_COPY_ORG, SCENARIO.propertyId, SCENARIO.portalId, EDITED_AT],
    )
    const command = await republishCommand()

    await store().republishPortal(command)

    const { rows } = await getPool().query(
      `SELECT resolved_snapshot_id, resolved_at FROM portal_pending_content_changes
        WHERE organization_id = $1`,
      [WORKING_COPY_ORG],
    )
    expect(rows).toEqual([
      { resolved_snapshot_id: command.snapshot.id, resolved_at: REPUBLISH_AT },
      { resolved_snapshot_id: command.snapshot.id, resolved_at: REPUBLISH_AT },
    ])
  })

  it('refuses a stale Portal revision and writes nothing', async () => {
    await getPool().query(`UPDATE portals SET updated_at = $2 WHERE id = $1`, [
      SCENARIO.portalId,
      EDITED_AT,
    ])
    const command = await republishCommand()

    await expect(store().republishPortal(command)).rejects.toMatchObject({
      code: 'revision_conflict',
    })

    expect(await activations()).toEqual(LIVE_ONLY_FIRST)
    expect(await factTypes()).toEqual(['portal.publication.published', 'portal.updated'])
  })

  it('refuses a snapshot of a working copy that has since moved, and writes nothing', async () => {
    const command = await republishCommand()
    await changeWording('Changed after the snapshot was built')

    await expect(store().republishPortal(command)).rejects.toMatchObject({
      code: 'revision_conflict',
    })

    expect(await activations()).toEqual(LIVE_ONLY_FIRST)
    expect(await portalRow()).toEqual({
      publication_state: 'published',
      updated_at: PUBLISHED_AT,
    })
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS count FROM portal_publication_snapshots`,
    )
    expect(rows[0].count).toBe(1)
  })

  it('rolls everything back when the publication fact cannot be recorded', async () => {
    const command = await republishCommand()
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal.publication.published', 1, '{}'::jsonb, $2, $3,
               'portal', $4, $5)`,
      [
        command.lifecycleEvent.eventId,
        WORKING_COPY_ORG,
        SCENARIO.propertyId,
        SCENARIO.portalId,
        REPUBLISH_AT,
      ],
    )

    await expect(store().republishPortal(command)).rejects.toBeDefined()

    expect(await activations()).toEqual(LIVE_ONLY_FIRST)
    expect(await portalRow()).toEqual({
      publication_state: 'published',
      updated_at: PUBLISHED_AT,
    })
    const { rows } = await getPool().query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND id = $2`,
      [WORKING_COPY_ORG, command.event.eventId],
    )
    expect(rows).toHaveLength(0)
  })

  it.each(['draft', 'disabled', 'archived'])(
    'refuses a Portal that is %s, which is not a republish',
    async (state) => {
      await getPool().query(`UPDATE portals SET publication_state = $2 WHERE id = $1`, [
        SCENARIO.portalId,
        state,
      ])
      // The activation is left open on purpose, so that only the state of the
      // Portal itself can refuse the command.
      const command = await republishCommand()

      await expect(store().republishPortal(command)).rejects.toMatchObject({
        code: 'revision_conflict',
      })
      expect(await activations()).toEqual(LIVE_ONLY_FIRST)

      const { rows } = await getPool().query(
        `SELECT count(*)::int AS count FROM portal_publication_snapshots`,
      )
      expect(rows[0].count).toBe(1)
    },
  )

  it('refuses a published Portal with no live activation instead of inventing one', async () => {
    await getPool().query(
      `UPDATE portal_publication_activations
          SET deactivated_at = $2, deactivation_reason = 'disabled'
        WHERE portal_id = $1`,
      [SCENARIO.portalId, EDITED_AT],
    )
    const command = await republishCommand()

    await expect(store().republishPortal(command)).rejects.toMatchObject({
      code: 'revision_conflict',
    })
    expect(await portalRow()).toEqual({
      publication_state: 'published',
      updated_at: PUBLISHED_AT,
    })
  })

  it('refuses a command whose scope is another organisation’s', async () => {
    const command = await republishCommand()

    await expect(
      store().republishPortal({ ...command, organizationId: WORKING_COPY_OTHER_ORG }),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })

    expect(await activations()).toEqual(LIVE_ONLY_FIRST)
  })

  describe('refuses an inconsistent command before opening a transaction', () => {
    it('a fact that quotes another snapshot', async () => {
      const command = await republishCommand()
      const other = await republishCommand({ suffix: '3' })

      await expect(
        store().republishPortal({ ...command, lifecycleEvent: other.lifecycleEvent }),
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(await activations()).toEqual(LIVE_ONLY_FIRST)
    })

    it('a fact by another person than the snapshot names', async () => {
      const command = await republishCommand()

      await expect(
        store().republishPortal({ ...command, actorUserId: userId('someone-else') }),
      ).rejects.toMatchObject({ code: 'forbidden' })
    })

    it('an activation that is not for the snapshot', async () => {
      const command = await republishCommand()

      await expect(
        store().republishPortal({
          ...command,
          activation: { ...command.activation, snapshotId: FIRST_SNAPSHOT },
        }),
      ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    })

    it('an activation of another Portal', async () => {
      const command = await republishCommand()

      await expect(
        store().republishPortal({
          ...command,
          activation: {
            ...command.activation,
            portalId: '10000000-0000-4000-8000-000000000999',
          },
        }),
      ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    })

    it('a revision that does not advance', async () => {
      const command = await republishCommand()

      await expect(
        store().republishPortal({
          ...command,
          expectedUpdatedAt: REPUBLISH_AT,
        }),
      ).rejects.toMatchObject({ code: 'revision_conflict' })
    })

    it('a Portal update fact that is not Published to Published', async () => {
      const command = await republishCommand()

      await expect(
        store().republishPortal({
          ...command,
          event: portalUpdated({
            portalId: SCENARIO.portalId,
            organizationId: SCENARIO.organizationId,
            propertyId: SCENARIO.propertyId,
            previousPublicationState: 'draft',
            publicationState: 'published',
            sourceAggregateVersion: REPUBLISH_AT.toISOString(),
            occurredAt: REPUBLISH_AT,
          }),
        }),
      ).rejects.toMatchObject({ code: 'forbidden' })
    })
  })

  it('lets exactly one of two competing republishes win', async () => {
    await changeWording('Хотел Рила, обновен')
    const first = await republishCommand({ suffix: '2' })
    const second = await republishCommand({
      suffix: '3',
      occurredAt: new Date(REPUBLISH_AT.getTime() + 1_000),
    })

    const [a, b] = await Promise.allSettled([
      store().republishPortal(first),
      store().republishPortal(second),
    ])

    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
    const loser = a.status === 'rejected' ? a : b
    expect(loser).toMatchObject({ reason: { code: 'revision_conflict' } })
    const rows = await activations()
    expect(rows).toHaveLength(2)
    expect(rows.filter((row) => row.deactivated_at === null)).toHaveLength(1)
  })

  it('takes the Portal fence like a content edit: the edit that commits first wins', async () => {
    const category = {
      id: portalLinkCategoryId('7a000000-0000-4000-8000-000000000001'),
      portalId: SCENARIO.portalId,
      organizationId: SCENARIO.organizationId,
      title: 'Local guides',
      sortKey: 'a1',
      createdAt: EDITED_AT,
      updatedAt: EDITED_AT,
    }
    const republish = await republishCommand()
    const lockClass = 43_822
    const lockObject = 9
    const pool = getPool()
    const gate = await pool.connect()
    const pending: Promise<unknown>[] = []
    let gateOpen = false
    try {
      await pool.query(`
        DROP TRIGGER IF EXISTS portal_republish_lock_order_gate ON portals;
        DROP FUNCTION IF EXISTS portal_republish_lock_order_gate();
        CREATE FUNCTION portal_republish_lock_order_gate()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          IF NEW.id = '${SCENARIO.portalId}'
             AND NEW.updated_at = TIMESTAMPTZ '${EDITED_AT.toISOString()}'
          THEN
            PERFORM pg_advisory_xact_lock(${lockClass}, ${lockObject});
          END IF;
          RETURN NEW;
        END;
        $function$;
        CREATE TRIGGER portal_republish_lock_order_gate
          BEFORE UPDATE ON portals
          FOR EACH ROW EXECUTE FUNCTION portal_republish_lock_order_gate();
      `)
      await gate.query('BEGIN')
      gateOpen = true
      await gate.query('SELECT pg_advisory_xact_lock($1, $2)', [lockClass, lockObject])

      const edit = store().createPortalLinkCategory({
        organizationId: SCENARIO.organizationId,
        actorUserId: MANAGER,
        propertyId: SCENARIO.propertyId,
        portalId: SCENARIO.portalId,
        expectedPortalUpdatedAt: PUBLISHED_AT,
        category,
        revision: EDITED_AT,
        occurredAt: EDITED_AT,
        event: portalLinkCategoryCreated({
          portalId: SCENARIO.portalId,
          categoryId: category.id,
          organizationId: SCENARIO.organizationId,
          propertyId: SCENARIO.propertyId,
          sourceAggregateVersion: EDITED_AT.toISOString(),
          occurredAt: EDITED_AT,
        }),
      })
      pending.push(edit)
      await waitFor('the edit to hold the Portal row', async () => {
        const waits = await pool.query<{ waiters: number }>(
          `SELECT COUNT(*)::int AS waiters FROM pg_locks
            WHERE locktype = 'advisory' AND granted = false
              AND classid::bigint = $1 AND objid::bigint = $2`,
          [lockClass, lockObject],
        )
        return waits.rows[0]?.waiters === 1
      })

      const publish = store().republishPortal(republish)
      pending.push(publish)
      await waitFor('both Portal updates to be lock-blocked', async () => {
        const waits = await pool.query<{ waiters: number }>(`
          SELECT COUNT(*)::int AS waiters FROM pg_stat_activity
           WHERE datname = current_database()
             AND cardinality(pg_blocking_pids(pid)) > 0
             AND query ILIKE '%update "portals"%'`)
        return (waits.rows[0]?.waiters ?? 0) >= 2
      })

      await gate.query('COMMIT')
      gateOpen = false
      const [editResult, publishResult] = await Promise.allSettled([edit, publish])
      pending.length = 0

      expect(editResult).toMatchObject({ status: 'fulfilled' })
      expect(publishResult).toMatchObject({
        status: 'rejected',
        reason: { code: 'revision_conflict' },
      })
      expect(await activations()).toEqual(LIVE_ONLY_FIRST)
      expect(await portalRow()).toEqual({
        publication_state: 'published',
        updated_at: EDITED_AT,
      })
    } finally {
      if (gateOpen) await gate.query('ROLLBACK')
      await Promise.allSettled(pending)
      gate.release()
      await pool.query(`
        DROP TRIGGER IF EXISTS portal_republish_lock_order_gate ON portals;
        DROP FUNCTION IF EXISTS portal_republish_lock_order_gate();
      `)
    }
  })

  it('waits for the Property publication fence that a first publication or a Property edit holds', async () => {
    await changeWording('Хотел Рила, обновен')
    const command = await republishCommand()
    const pool = getPool()
    const gate = await pool.connect()
    let gateOpen = false
    let republish: Promise<void> | null = null
    try {
      await gate.query('BEGIN')
      gateOpen = true
      await gate.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `portal-publication:${WORKING_COPY_ORG}:${SCENARIO.propertyId}`,
      ])
      let settled = false
      republish = store()
        .republishPortal(command)
        .finally(() => {
          settled = true
        })
      await waitFor('the republish to wait for the Property fence', async () => {
        const waits = await pool.query<{ waiters: number }>(`
          SELECT COUNT(*)::int AS waiters FROM pg_stat_activity
           WHERE datname = current_database()
             AND wait_event_type = 'Lock' AND wait_event = 'advisory'`)
        return (waits.rows[0]?.waiters ?? 0) === 1
      })

      expect(settled).toBe(false)
      expect(await activations()).toEqual(LIVE_ONLY_FIRST)
      await gate.query('COMMIT')
      gateOpen = false
      await republish
      expect((await activations()).map((row) => row.version)).toEqual([1, 2])
    } finally {
      if (gateOpen) await gate.query('ROLLBACK')
      await republish?.catch(() => undefined)
      gate.release()
    }
  })

  it('after an edit that went in first, a republish built on the new revision commits', async () => {
    await changeWording('Хотел Рила, обновен')
    await getPool().query(`UPDATE portals SET updated_at = $2 WHERE id = $1`, [
      SCENARIO.portalId,
      EDITED_AT,
    ])
    const command = await republishCommand({ expectedUpdatedAt: EDITED_AT })

    await store().republishPortal(command)

    expect((await activations()).map((row) => row.version)).toEqual([1, 2])
  })
})

async function waitFor(
  description: string,
  condition: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

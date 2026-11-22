// ARC-01 — Portal authoritative state and lifecycle facts share one commit.
//
// These tests use real PostgreSQL because a mocked transaction cannot prove
// that a constraint/fact failure rolls back Portal state and token revocation.

import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { portalId } from '#/shared/domain/ids'
import {
  portalDeleted,
  portalResponsibilityNeeded,
  portalTokenRevoked,
  portalUpdated,
} from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store.server'
import {
  COMMIT_TOKEN_HASH,
  CREATED_AT,
  createdFact,
  DELETED_AT,
  hasDatabaseErrorCode,
  makePortal,
  MANAGER,
  ORG_A,
  pageEditRows,
  PORTAL_A,
  PROPERTY_A,
  publicationMutation,
  publicationPublishedFact,
  ROLLBACK_TOKEN_HASH,
  seedStoredPortal,
  setupPortalCommandStoreTestDb,
  UPDATED_AT,
  waitForDatabaseCondition,
} from './portal-command-store.test-fixtures'

const { getPool } = setupPortalCommandStoreTestDb()

describe.sequential('Portal command store (real PostgreSQL)', () => {
  it('creates Portal state, initial responsibility, and both lifecycle facts atomically', async () => {
    const portal = makePortal({ responsibilityNeededSince: CREATED_AT })
    const created = createdFact(portal)
    const responsibility = portalResponsibilityNeeded({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: portal.updatedAt.toISOString(),
      occurredAt: CREATED_AT,
    })

    await createAtomicPortalCommandStore(
      getDb(),
      createPortalRatingGoalGuard(),
    ).createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerIds: [],
      event: created,
      responsibilityNeededEvent: responsibility,
    })

    const portalRows = await getPool().query(
      `SELECT id, responsibility_needed_since
       FROM portals WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(portalRows.rows).toHaveLength(1)
    expect(portalRows.rows[0].responsibility_needed_since).toEqual(CREATED_AT)
    const facts = await getPool().query(
      `SELECT id, event_type, event_version FROM outbox_events
       WHERE organization_id = $1 ORDER BY event_type`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([
      { id: created.eventId, event_type: 'portal.created', event_version: 1 },
      {
        id: responsibility.eventId,
        event_type: 'portal.responsibility_became_needed',
        event_version: 2,
      },
    ])
  })

  it('rolls back Portal creation when any required fact cannot be recorded', async () => {
    const portal = makePortal()
    const ghost = {
      ...createdFact(portal),
      _tag: 'portal.ghost',
    } as unknown as ReturnType<typeof createdFact>

    await expect(
      createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard()).createPortal(
        {
          organizationId: ORG_A,
          portal,
          initialResponsibleManagerIds: [MANAGER],
          event: ghost,
        },
      ),
    ).rejects.toThrow(/Event type portal\.ghost:v1 is not registered/)

    const state = await getPool().query(
      'SELECT id FROM portals WHERE organization_id = $1',
      [ORG_A],
    )
    const managers = await getPool().query(
      'SELECT id FROM portal_responsible_managers WHERE organization_id = $1',
      [ORG_A],
    )
    expect(state.rows).toHaveLength(0)
    expect(managers.rows).toHaveLength(0)
  })

  it('publishes Portal state and exact immutable snapshot evidence atomically', async () => {
    const { store, portal } = await seedStoredPortal({ publicationState: 'draft' })
    const event = portalUpdated({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      previousPublicationState: 'draft',
      publicationState: 'published',
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    const publication = publicationMutation(portal, { name: 'Reception Gateway' })
    const lifecycleEvent = publicationPublishedFact(portal, publication, UPDATED_AT)

    await store.updatePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: portal.id,
      actorUserId: MANAGER,
      expectedUpdatedAt: CREATED_AT,
      revision: UPDATED_AT,
      occurredAt: UPDATED_AT,
      patch: {
        name: 'Reception Gateway',
        publicationState: 'published',
      },
      publication,
      lifecycleEvent,
      event,
    })

    const state = await getPool().query(
      `SELECT name, publication_state, updated_at
       FROM portals WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(state.rows[0]).toEqual({
      name: 'Reception Gateway',
      publication_state: 'published',
      updated_at: UPDATED_AT,
    })
    const fact = await getPool().query(
      `SELECT id, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'portal.updated'`,
      [ORG_A],
    )
    expect(fact.rows).toHaveLength(1)
    expect(fact.rows[0]).toMatchObject({
      id: event.eventId,
      payload: {
        portalId: PORTAL_A,
        propertyId: PROPERTY_A,
        previousPublicationState: 'draft',
        publicationState: 'published',
        sourceAggregateVersion: UPDATED_AT.toISOString(),
      },
    })
    expect(fact.rows[0].payload).not.toHaveProperty('name')
    expect(fact.rows[0].payload).not.toHaveProperty('slug')
    const publicationFact = await getPool().query(
      `SELECT id, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'portal.publication.published'`,
      [ORG_A],
    )
    expect(publicationFact.rows).toEqual([
      {
        id: lifecycleEvent.eventId,
        payload: expect.objectContaining({
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          portalId: PORTAL_A,
          publicationSnapshotId: publication.snapshot.id,
          publicationVersion: 1,
          publicationDigest: publication.snapshot.configurationDigest,
          userId: MANAGER,
          sourceAggregateVersion: UPDATED_AT.toISOString(),
          occurredAt: UPDATED_AT.toISOString(),
        }),
      },
    ])
    expect(publicationFact.rows[0].payload).not.toHaveProperty('name')
    expect(publicationFact.rows[0].payload).not.toHaveProperty('destinationUri')
    const publications = await getPool().query(
      `SELECT s.version, s.configuration_digest, a.activation_sequence,
              a.deactivated_at
       FROM portal_publication_snapshots s
       JOIN portal_publication_activations a ON a.snapshot_id = s.id
       WHERE s.organization_id = $1 AND s.portal_id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(publications.rows).toEqual([
      {
        version: 1,
        configuration_digest: publication.snapshot.configurationDigest,
        activation_sequence: 1,
        deactivated_at: null,
      },
    ])
    // A name changed in the same command that publishes it is still an edit of
    // the page, made by that person; publishing itself adds no entry.
    expect(await pageEditRows()).toEqual([
      {
        portal_id: PORTAL_A,
        change_kind: 'portal_configuration',
        change_key: 'settings:name',
        actor_user_id: MANAGER,
        occurred_at: UPDATED_AT,
        previous_text: 'Reception',
        new_text: 'Reception Gateway',
        edit_count: 1,
      },
    ])
  })

  it('records who edited the working copy in the page-edit ledger, draft or published', async () => {
    const { store, portal } = await seedStoredPortal({ publicationState: 'draft' })

    await store.updatePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: portal.id,
      actorUserId: MANAGER,
      expectedUpdatedAt: CREATED_AT,
      revision: UPDATED_AT,
      occurredAt: UPDATED_AT,
      patch: { name: 'Reception Gateway' },
      event: portalUpdated({
        portalId: portal.id,
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        previousPublicationState: 'draft',
        publicationState: 'draft',
        sourceAggregateVersion: UPDATED_AT.toISOString(),
        occurredAt: UPDATED_AT,
      }),
    })

    expect(await pageEditRows()).toEqual([
      {
        portal_id: PORTAL_A,
        change_kind: 'portal_configuration',
        change_key: 'settings:name',
        actor_user_id: MANAGER,
        occurred_at: UPDATED_AT,
        previous_text: 'Reception',
        new_text: 'Reception Gateway',
        edit_count: 1,
      },
    ])
  })

  it('names each setting that changed, keeps wording only for the name and description, and skips what stayed', async () => {
    const { store, portal } = await seedStoredPortal({ publicationState: 'draft' })

    await store.updatePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: portal.id,
      actorUserId: MANAGER,
      expectedUpdatedAt: CREATED_AT,
      revision: UPDATED_AT,
      occurredAt: UPDATED_AT,
      // The name is sent again unchanged, as an autosave of the whole form does.
      patch: {
        name: portal.name,
        description: 'Scan to tell us how your stay was',
        slug: 'reception-desk',
        privateFeedbackThreshold: 2,
      },
      event: portalUpdated({
        portalId: portal.id,
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        previousPublicationState: 'draft',
        publicationState: 'draft',
        sourceAggregateVersion: UPDATED_AT.toISOString(),
        occurredAt: UPDATED_AT,
      }),
    })

    expect(
      (await pageEditRows()).map((row) => [
        row.change_key,
        row.previous_text,
        row.new_text,
      ]),
    ).toEqual([
      ['settings:description', null, 'Scan to tell us how your stay was'],
      ['settings:feedback_threshold', null, null],
      ['settings:slug', null, null],
    ])
  })

  it('says the address is taken when a slug change meets another Portal at the Property, and changes nothing', async () => {
    const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
    const holder = makePortal()
    const other = makePortal({
      id: portalId('6b000000-0000-4000-8000-000000000002'),
      name: 'Lobby',
      slug: 'lobby',
      publicationState: 'draft',
    })
    for (const portal of [holder, other]) {
      await store.createPortal({
        organizationId: ORG_A,
        portal,
        initialResponsibleManagerIds: [MANAGER],
        event: createdFact(portal),
      })
    }

    await expect(
      store.updatePortal({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: other.id,
        actorUserId: MANAGER,
        expectedUpdatedAt: CREATED_AT,
        revision: UPDATED_AT,
        occurredAt: UPDATED_AT,
        patch: { slug: holder.slug },
        event: portalUpdated({
          portalId: other.id,
          organizationId: other.organizationId,
          propertyId: other.propertyId,
          previousPublicationState: 'draft',
          publicationState: 'draft',
          sourceAggregateVersion: UPDATED_AT.toISOString(),
          occurredAt: UPDATED_AT,
        }),
      }),
    ).rejects.toMatchObject({ code: 'slug_taken' })

    const stored = await getPool().query(
      `SELECT slug, updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
      [ORG_A, other.id],
    )
    expect(stored.rows).toEqual([{ slug: 'lobby', updated_at: CREATED_AT }])
    expect(await pageEditRows()).toEqual([])
  })

  it('rolls back Portal state and snapshot activation when the dedicated publication fact conflicts', async () => {
    const { store, portal } = await seedStoredPortal({ publicationState: 'draft' })
    const publication = publicationMutation(portal, { name: portal.name })
    const lifecycleEvent = publicationPublishedFact(portal, publication, UPDATED_AT)
    const event = portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: 'draft',
      publicationState: 'published',
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal.publication.published', 1, '{}'::jsonb, $2, $3,
               'portal', $4, $5)`,
      [lifecycleEvent.eventId, ORG_A, PROPERTY_A, PORTAL_A, UPDATED_AT],
    )

    await expect(
      store.updatePortal({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        actorUserId: MANAGER,
        expectedUpdatedAt: CREATED_AT,
        revision: UPDATED_AT,
        occurredAt: UPDATED_AT,
        patch: { publicationState: 'published' },
        publication,
        lifecycleEvent,
        event,
      }),
    ).rejects.toSatisfy((error: unknown) => hasDatabaseErrorCode(error, '23505'))

    const state = await getPool().query(
      `SELECT publication_state, updated_at FROM portals
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    const snapshots = await getPool().query(
      `SELECT id FROM portal_publication_snapshots
       WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, PORTAL_A],
    )
    const genericFact = await getPool().query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, event.eventId],
    )
    expect(state.rows).toEqual([{ publication_state: 'draft', updated_at: CREATED_AT }])
    expect(snapshots.rows).toHaveLength(0)
    expect(genericFact.rows).toHaveLength(0)
  })

  it('uses one Portal-first lock order for concurrent publishing and content edits', async () => {
    const { store, portal } = await seedStoredPortal({ publicationState: 'draft' })

    const contentAt = UPDATED_AT
    const publishAt = new Date('2026-08-26T10:06:00.000Z')
    const contentEvent = portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: 'draft',
      publicationState: 'draft',
      sourceAggregateVersion: contentAt.toISOString(),
      occurredAt: contentAt,
    })
    const publishEvent = portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: 'draft',
      publicationState: 'published',
      sourceAggregateVersion: publishAt.toISOString(),
      occurredAt: publishAt,
    })
    const publishMutation = publicationMutation(portal, {
      name: portal.name,
      at: publishAt,
    })
    const lockClass = 43_821
    const lockObject = 7
    const pool = getPool()
    const gate = await pool.connect()
    const pending: Promise<unknown>[] = []
    let gateOpen = false

    try {
      await pool.query(`
        DROP TRIGGER IF EXISTS portal_command_lock_order_gate ON portals;
        DROP FUNCTION IF EXISTS portal_command_lock_order_gate();
        CREATE FUNCTION portal_command_lock_order_gate()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          IF NEW.organization_id = '${ORG_A}'
             AND NEW.id = '${PORTAL_A}'
             AND NEW.updated_at = TIMESTAMPTZ '${contentAt.toISOString()}'
          THEN
            PERFORM pg_advisory_xact_lock(${lockClass}, ${lockObject});
          END IF;
          RETURN NEW;
        END;
        $function$;
        CREATE TRIGGER portal_command_lock_order_gate
          BEFORE UPDATE ON portals
          FOR EACH ROW EXECUTE FUNCTION portal_command_lock_order_gate();
      `)
      await gate.query('BEGIN')
      gateOpen = true
      await gate.query('SELECT pg_advisory_xact_lock($1, $2)', [lockClass, lockObject])

      const content = store.savePortalLinktreeSettings({
        organizationId: ORG_A,
        actorUserId: MANAGER,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        expectedPortalUpdatedAt: CREATED_AT,
        enabled: false,
        revision: contentAt,
        occurredAt: contentAt,
        event: contentEvent,
      })
      pending.push(content)
      await waitForDatabaseCondition(
        'the content writer to hold the Portal row',
        async () => {
          const waits = await pool.query<{ waiters: number }>(
            `SELECT COUNT(*)::int AS waiters
           FROM pg_locks
           WHERE locktype = 'advisory'
             AND granted = false
             AND classid::bigint = $1
             AND objid::bigint = $2`,
            [lockClass, lockObject],
          )
          return waits.rows[0]?.waiters === 1
        },
      )

      const publish = store.updatePortal({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        actorUserId: MANAGER,
        expectedUpdatedAt: CREATED_AT,
        revision: publishAt,
        occurredAt: publishAt,
        patch: { publicationState: 'published' },
        publication: publishMutation,
        lifecycleEvent: publicationPublishedFact(portal, publishMutation, publishAt),
        event: publishEvent,
      })
      pending.push(publish)
      await waitForDatabaseCondition(
        'both Portal updates to be lock-blocked',
        async () => {
          const waits = await pool.query<{ waiters: number }>(`
          SELECT COUNT(*)::int AS waiters
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND cardinality(pg_blocking_pids(pid)) > 0
            AND query ILIKE '%update "portals"%'
        `)
          return (waits.rows[0]?.waiters ?? 0) >= 2
        },
      )

      await gate.query('COMMIT')
      gateOpen = false
      const [contentResult, publishResult] = await Promise.allSettled([content, publish])
      pending.length = 0

      expect(contentResult).toMatchObject({ status: 'fulfilled' })
      expect(publishResult).toMatchObject({
        status: 'rejected',
        reason: { _tag: 'PortalError', code: 'revision_conflict' },
      })
      const state = await pool.query(
        `SELECT p.publication_state, p.updated_at, p.linktree_enabled
         FROM portals p
         WHERE p.organization_id = $1 AND p.id = $2`,
        [ORG_A, PORTAL_A],
      )
      expect(state.rows).toEqual([
        {
          publication_state: 'draft',
          updated_at: contentAt,
          linktree_enabled: false,
        },
      ])
    } finally {
      if (gateOpen) await gate.query('ROLLBACK')
      await Promise.allSettled(pending)
      gate.release()
      await pool.query(`
        DROP TRIGGER IF EXISTS portal_command_lock_order_gate ON portals;
        DROP FUNCTION IF EXISTS portal_command_lock_order_gate();
      `)
    }
  })

  it('rolls back archive and token revocation when one fact conflicts', async () => {
    const { store, portal } = await seedStoredPortal({ publicationState: 'published' })
    await getPool().query(
      `INSERT INTO portal_tokens
         (id, organization_id, property_id, portal_id, token_identifier,
          token_hash, token_key_version, version, status, issued_at)
       VALUES ($1, $2, $3, $4, 'portalcmdtoken01', $5, 1, 1, 'active', $6)`,
      [
        '6c000000-0000-4000-8000-000000000001',
        ORG_A,
        PROPERTY_A,
        PORTAL_A,
        ROLLBACK_TOKEN_HASH,
        CREATED_AT,
      ],
    )
    const deleted = portalDeleted({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })
    const revoked = portalTokenRevoked({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal.token.revoked', 1, '{}'::jsonb, $2, $3,
               'portal', $4, $5)`,
      [revoked.eventId, ORG_A, PROPERTY_A, PORTAL_A, DELETED_AT],
    )

    await expect(
      store.deletePortal({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        expectedUpdatedAt: CREATED_AT,
        revokedBy: MANAGER,
        reason: 'portal archived',
        revision: DELETED_AT,
        occurredAt: DELETED_AT,
        event: deleted,
        tokenRevokedEvent: revoked,
      }),
    ).rejects.toSatisfy((error: unknown) => hasDatabaseErrorCode(error, '23505'))

    const state = await getPool().query(
      `SELECT deleted_at, updated_at FROM portals
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    const token = await getPool().query(
      `SELECT status, revoked_at FROM portal_tokens
       WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, PORTAL_A],
    )
    const deleteFact = await getPool().query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, deleted.eventId],
    )
    expect(state.rows[0]).toEqual({ deleted_at: null, updated_at: CREATED_AT })
    expect(token.rows[0]).toEqual({ status: 'active', revoked_at: null })
    expect(deleteFact.rows).toHaveLength(0)
  })

  it('commits archive, token revocation, and both facts as one replay-unique set', async () => {
    const { store, portal } = await seedStoredPortal({ publicationState: 'published' })
    await getPool().query(
      `INSERT INTO portal_tokens
         (id, organization_id, property_id, portal_id, token_identifier,
          token_hash, token_key_version, version, status, issued_at,
          encrypted_raw_token, address_encryption_key_version)
       VALUES ($1, $2, $3, $4, 'portalcmdtoken02', $5, 1, 1, 'active', $6,
               'sealed-address', 1)`,
      [
        '6c000000-0000-4000-8000-000000000002',
        ORG_A,
        PROPERTY_A,
        PORTAL_A,
        COMMIT_TOKEN_HASH,
        CREATED_AT,
      ],
    )
    const deleted = portalDeleted({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })
    const revoked = portalTokenRevoked({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })

    const result = await store.deletePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedUpdatedAt: CREATED_AT,
      revokedBy: MANAGER,
      reason: 'portal archived',
      revision: DELETED_AT,
      occurredAt: DELETED_AT,
      event: deleted,
      tokenRevokedEvent: revoked,
    })

    expect(result).toEqual({ revoked: 1 })
    const state = await getPool().query(
      `SELECT deleted_at, updated_at FROM portals
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    const token = await getPool().query(
      `SELECT status, revoked_at, revoked_reason, encrypted_raw_token,
              address_encryption_key_version
       FROM portal_tokens WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, PORTAL_A],
    )
    const facts = await getPool().query(
      `SELECT id, event_type FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN ('portal.deleted', 'portal.token.revoked')
       ORDER BY event_type`,
      [ORG_A],
    )
    expect(state.rows[0]).toEqual({ deleted_at: DELETED_AT, updated_at: DELETED_AT })
    // A deleted Portal keeps no readable address (ADR 0064).
    expect(token.rows[0]).toEqual({
      status: 'revoked',
      revoked_at: DELETED_AT,
      revoked_reason: 'portal archived',
      encrypted_raw_token: null,
      address_encryption_key_version: null,
    })
    expect(facts.rows).toEqual([
      { id: deleted.eventId, event_type: 'portal.deleted' },
      { id: revoked.eventId, event_type: 'portal.token.revoked' },
    ])
  })
})

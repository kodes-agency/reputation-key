// ARC-01 — Portal authoritative state and lifecycle facts share one commit.
//
// These tests use real PostgreSQL because a mocked transaction cannot prove
// that a constraint/fact failure rolls back Portal state and token revocation.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { EventBus } from '#/shared/events/event-bus'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  portalCreated,
  portalDeleted,
  portalGroupDeleted,
  portalResponsibilityNeeded,
  portalTokenRevoked,
  portalUpdated,
} from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { buildPortalPublicationSnapshot } from '../application/portal-publication-snapshot'

const ORG_A = organizationId('org-portalcmd-0000-0000-000000000001')
const ORG_B = organizationId('org-portalcmd-0000-0000-000000000002')
const PROPERTY_A = propertyId('6a000000-0000-4000-8000-000000000001')
const PORTAL_A = portalId('6b000000-0000-4000-8000-000000000001')
const GROUP_A = portalGroupId('6f000000-0000-4000-8000-000000000001')
const MANAGER = userId('manager-portalcmd-00000000000000001')
const CREATED_AT = new Date('2026-08-26T10:00:00.000Z')
const GROUP_UPDATED_AT = new Date('2026-08-26T10:02:00.000Z')
const UPDATED_AT = new Date('2026-08-26T10:05:00.000Z')
const DELETED_AT = new Date('2026-08-26T10:10:00.000Z')
const ROLLBACK_TOKEN_HASH =
  'a2b9f990dcff2405f6b5a14b6ab414aff9e0f9d17f3b35f1c1ba558583c9e1e0'
const COMMIT_TOKEN_HASH =
  'ab496f49215a28de0ad1c0b924d63b3a027945e1d0fa6282db999a063bd44894'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_group_memberships',
    'portal_groups',
    'portal_tokens',
    'portal_responsible_managers',
    'outbox_events',
    'portals',
    'properties',
  ],
})

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

const makePortal = (overrides: Parameters<typeof buildTestPortal>[0] = {}) =>
  buildTestPortal({
    id: PORTAL_A,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    entityId: PROPERTY_A,
    name: 'Reception',
    slug: 'reception',
    createdBy: MANAGER,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  })

const createdFact = (portal = makePortal()) =>
  portalCreated({
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    publicationState: portal.publicationState,
    sourceAggregateVersion: portal.updatedAt.toISOString(),
    occurredAt: portal.createdAt,
  })

async function seedPortalGroupMembership(): Promise<void> {
  const portal = makePortal()
  await createAtomicPortalCommandStore(getDb(), silentEvents).createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerId: MANAGER,
    event: createdFact(portal),
  })
  await getPool().query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Front Desk', $4, $5)`,
    [GROUP_A, ORG_A, PROPERTY_A, CREATED_AT, GROUP_UPDATED_AT],
  )
  await getPool().query(
    `INSERT INTO portal_group_memberships
       (organization_id, property_id, portal_id, portal_group_id,
        effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ORG_A, PROPERTY_A, PORTAL_A, GROUP_A, CREATED_AT, MANAGER],
  )
}

const ORG_NAME = `Test Org t-${String(ORG_A).replace(/-/gu, '')}`

function publicationMutation(
  portal: ReturnType<typeof makePortal>,
  input: Readonly<{
    name: string
    version?: number
    activationSequence?: number
    snapshotId?: string
    activationId?: string
    at?: Date
  }>,
) {
  const at = input.at ?? UPDATED_AT
  const snapshot = buildPortalPublicationSnapshot({
    id: input.snapshotId ?? '6d000000-0000-4000-8000-000000000001',
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    version: input.version ?? 1,
    source: {
      portal: {
        id: portal.id,
        name: input.name,
        slug: portal.slug,
        description: portal.description,
        heroImageUrl: portal.heroImageUrl,
        theme: portal.theme,
        organizationName: ORG_NAME,
      },
      categories: [],
      links: [],
      privateFeedbackThreshold: portal.privateFeedbackThreshold,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
    },
    destination: {
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=portal-command',
      retrievedAt: CREATED_AT,
      sourceEpoch: 1,
      profileVersion: 1,
    },
    createdBy: MANAGER,
    createdAt: at,
  })
  return {
    kind: 'publish' as const,
    snapshot,
    activation: {
      id: input.activationId ?? '6e000000-0000-4000-8000-000000000001',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      snapshotId: snapshot.id,
      activationSequence: input.activationSequence ?? 1,
      kind: 'publish' as const,
      activatedBy: MANAGER,
      activatedAt: at,
      deactivatedAt: null,
      deactivationReason: null,
    },
  }
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Portal Command Property', 'portal-command-property', 'UTC', $3, $3)`,
    [PROPERTY_A, ORG_A, CREATED_AT],
  )
})

describe.sequential('Portal command store (real PostgreSQL)', () => {
  it('creates Portal state, initial responsibility, and both lifecycle facts atomically', async () => {
    const portal = makePortal({ responsibilityNeededSince: CREATED_AT })
    const created = createdFact(portal)
    const responsibility = portalResponsibilityNeeded({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      occurredAt: CREATED_AT,
    })

    await createAtomicPortalCommandStore(getDb(), silentEvents).createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: null,
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
      `SELECT id, event_type FROM outbox_events
       WHERE organization_id = $1 ORDER BY event_type`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([
      { id: created.eventId, event_type: 'portal.created' },
      {
        id: responsibility.eventId,
        event_type: 'portal.responsibility_became_needed',
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
      createAtomicPortalCommandStore(getDb(), silentEvents).createPortal({
        organizationId: ORG_A,
        portal,
        initialResponsibleManagerId: MANAGER,
        event: ghost,
      }),
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

  it('updates Portal state and one identifier-only versioned fact atomically', async () => {
    const portal = makePortal({ publicationState: 'draft' })
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
    const event = portalUpdated({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      previousPublicationState: 'draft',
      publicationState: 'published',
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })

    await store.updatePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: portal.id,
      expectedUpdatedAt: CREATED_AT,
      patch: {
        name: 'Reception Gateway',
        publicationState: 'published',
        updatedAt: UPDATED_AT,
      },
      publication: publicationMutation(portal, { name: 'Reception Gateway' }),
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
        configuration_digest: publicationMutation(portal, { name: 'Reception Gateway' })
          .snapshot.configurationDigest,
        activation_sequence: 1,
        deactivated_at: null,
      },
    ])
  })

  it('rolls back archive and token revocation when one fact conflicts', async () => {
    const portal = makePortal({ publicationState: 'published' })
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
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
        at: DELETED_AT,
        event: deleted,
        tokenRevokedEvent: revoked,
      }),
    ).rejects.toThrow()

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
    const portal = makePortal({ publicationState: 'published' })
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
    await getPool().query(
      `INSERT INTO portal_tokens
         (id, organization_id, property_id, portal_id, token_identifier,
          token_hash, token_key_version, version, status, issued_at)
       VALUES ($1, $2, $3, $4, 'portalcmdtoken02', $5, 1, 1, 'active', $6)`,
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
      occurredAt: DELETED_AT,
    })

    const result = await store.deletePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedUpdatedAt: CREATED_AT,
      revokedBy: MANAGER,
      reason: 'portal archived',
      at: DELETED_AT,
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
      `SELECT status, revoked_at, revoked_reason FROM portal_tokens
       WHERE organization_id = $1 AND portal_id = $2`,
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
    expect(token.rows[0]).toEqual({
      status: 'revoked',
      revoked_at: DELETED_AT,
      revoked_reason: 'portal archived',
    })
    expect(facts.rows).toEqual([
      { id: deleted.eventId, event_type: 'portal.deleted' },
      { id: revoked.eventId, event_type: 'portal.token.revoked' },
    ])
  })

  it('commits Portal Group archive, membership closure, and lifecycle fact together', async () => {
    await seedPortalGroupMembership()
    const event = portalGroupDeleted({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      occurredAt: DELETED_AT,
    })
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)

    await store.deletePortalGroup({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalGroupId: GROUP_A,
      expectedUpdatedAt: GROUP_UPDATED_AT,
      at: DELETED_AT,
      event,
    })

    const group = await getPool().query(
      `SELECT deleted_at, updated_at FROM portal_groups
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const membership = await getPool().query(
      `SELECT effective_to, end_reason FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2`,
      [ORG_A, GROUP_A],
    )
    const fact = await getPool().query(
      `SELECT id, event_type FROM outbox_events
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, event.eventId],
    )
    expect(group.rows).toEqual([{ deleted_at: DELETED_AT, updated_at: DELETED_AT }])
    expect(membership.rows).toEqual([
      { effective_to: DELETED_AT, end_reason: 'group_archived' },
    ])
    expect(fact.rows).toEqual([{ id: event.eventId, event_type: 'portal_group.deleted' }])
  })

  it('rolls back Portal Group archive and membership closure when its fact fails', async () => {
    await seedPortalGroupMembership()
    const event = portalGroupDeleted({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      occurredAt: DELETED_AT,
    })
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal_group.deleted', 1, '{}'::jsonb, $2, $3,
               'portal', $4, $5)`,
      [event.eventId, ORG_A, PROPERTY_A, GROUP_A, DELETED_AT],
    )
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)

    await expect(
      store.deletePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        at: DELETED_AT,
        event,
      }),
    ).rejects.toThrow()

    const group = await getPool().query(
      `SELECT deleted_at, updated_at FROM portal_groups
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const membership = await getPool().query(
      `SELECT effective_to, end_reason FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2`,
      [ORG_A, GROUP_A],
    )
    expect(group.rows).toEqual([{ deleted_at: null, updated_at: GROUP_UPDATED_AT }])
    expect(membership.rows).toEqual([{ effective_to: null, end_reason: null }])
  })

  it('rejects a stale Portal Group delete without changing membership or recording a fact', async () => {
    await seedPortalGroupMembership()
    const event = portalGroupDeleted({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      occurredAt: DELETED_AT,
    })

    await expect(
      createAtomicPortalCommandStore(getDb(), silentEvents).deletePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: CREATED_AT,
        at: DELETED_AT,
        event,
      }),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'revision_conflict' })

    const group = await getPool().query(
      `SELECT deleted_at, updated_at FROM portal_groups
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const membership = await getPool().query(
      `SELECT effective_to FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2`,
      [ORG_A, GROUP_A],
    )
    const fact = await getPool().query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND id = $2`,
      [ORG_A, event.eventId],
    )
    expect(group.rows).toEqual([{ deleted_at: null, updated_at: GROUP_UPDATED_AT }])
    expect(membership.rows).toEqual([{ effective_to: null }])
    expect(fact.rows).toHaveLength(0)
  })

  it('retains the Portal Group state and durable fact when local post-commit delivery fails', async () => {
    await seedPortalGroupMembership()
    const event = portalGroupDeleted({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      occurredAt: DELETED_AT,
    })
    const unavailableLocalEvents: EventBus = {
      on: () => {},
      emit: async () => {
        throw new Error('local delivery unavailable')
      },
      clear: () => {},
    }

    await createAtomicPortalCommandStore(
      getDb(),
      unavailableLocalEvents,
    ).deletePortalGroup({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalGroupId: GROUP_A,
      expectedUpdatedAt: GROUP_UPDATED_AT,
      at: DELETED_AT,
      event,
    })

    const group = await getPool().query(
      `SELECT deleted_at FROM portal_groups
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const fact = await getPool().query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND id = $2`,
      [ORG_A, event.eventId],
    )
    expect(group.rows).toEqual([{ deleted_at: DELETED_AT }])
    expect(fact.rows).toEqual([{ id: event.eventId }])
  })
})

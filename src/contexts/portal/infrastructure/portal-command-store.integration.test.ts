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
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  portalCreated,
  portalDeleted,
  portalAddedToGroup,
  portalGroupCreated,
  portalGroupDeleted,
  portalGroupUpdated,
  portalLinkCategoryCreated,
  portalLinkCategoryReordered,
  portalLinkCreated,
  portalLinkReordered,
  portalRemovedFromGroup,
  portalResponsibilityNeeded,
  portalTokenRevoked,
  portalTokenIssued,
  portalTokenRotated,
  portalUpdated,
} from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { buildPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import { issueToken, rotateToken } from '../domain/portal-token'

const ORG_A = organizationId('org-portalcmd-0000-0000-000000000001')
const ORG_B = organizationId('org-portalcmd-0000-0000-000000000002')
const PROPERTY_A = propertyId('6a000000-0000-4000-8000-000000000001')
const PORTAL_A = portalId('6b000000-0000-4000-8000-000000000001')
const GROUP_A = portalGroupId('6f000000-0000-4000-8000-000000000001')
const GROUP_B = portalGroupId('6f000000-0000-4000-8000-000000000002')
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
    'portal_links',
    'portal_link_categories',
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

  it('rolls back a new Portal Group and all initial memberships when one fact conflicts', async () => {
    const portal = makePortal()
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
    const group = {
      id: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Front Desk',
      sortKey: null,
      createdAt: GROUP_UPDATED_AT,
      updatedAt: GROUP_UPDATED_AT,
      deletedAt: null,
    } as const
    const created = portalGroupCreated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: group.name,
      sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      occurredAt: GROUP_UPDATED_AT,
    })
    const added = portalAddedToGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      occurredAt: GROUP_UPDATED_AT,
    })
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal_group.portal_added', 1, '{}'::jsonb, $2, $3,
               'portal_group', $4, $5)`,
      [added.eventId, ORG_A, PROPERTY_A, GROUP_A, GROUP_UPDATED_AT],
    )

    await expect(
      store.createPortalGroup({
        organizationId: ORG_A,
        group,
        memberships: [
          {
            portalId: PORTAL_A,
            createdBy: MANAGER,
          },
        ],
        events: [created, added],
      }),
    ).rejects.toThrow()

    const persistedGroup = await getPool().query(
      `SELECT id FROM portal_groups WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const memberships = await getPool().query(
      `SELECT id FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2`,
      [ORG_A, GROUP_A],
    )
    const createdOutbox = await getPool().query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND id = $2`,
      [ORG_A, created.eventId],
    )
    expect(persistedGroup.rows).toHaveLength(0)
    expect(memberships.rows).toHaveLength(0)
    expect(createdOutbox.rows).toHaveLength(0)
  })

  it('commits a new Portal Group, initial membership, and content-free facts together', async () => {
    const portal = makePortal()
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
    const group = {
      id: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Front Desk',
      sortKey: null,
      createdAt: GROUP_UPDATED_AT,
      updatedAt: GROUP_UPDATED_AT,
      deletedAt: null,
    } as const
    const created = portalGroupCreated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: group.name,
      sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      occurredAt: GROUP_UPDATED_AT,
    })
    const added = portalAddedToGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      occurredAt: GROUP_UPDATED_AT,
    })

    await store.createPortalGroup({
      organizationId: ORG_A,
      group,
      memberships: [{ portalId: PORTAL_A, createdBy: MANAGER }],
      events: [created, added],
    })

    const state = await getPool().query(
      `SELECT g.name, g.updated_at, m.portal_id
       FROM portal_groups g
       JOIN portal_group_memberships m ON m.portal_group_id = g.id
       WHERE g.organization_id = $1 AND g.id = $2`,
      [ORG_A, GROUP_A],
    )
    const facts = await getPool().query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type LIKE 'portal_group.%'
       ORDER BY event_type`,
      [ORG_A],
    )
    expect(state.rows).toEqual([
      { name: 'Front Desk', updated_at: GROUP_UPDATED_AT, portal_id: PORTAL_A },
    ])
    expect(facts.rows).toHaveLength(2)
    for (const fact of facts.rows) {
      expect(fact.payload).toMatchObject({
        propertyId: PROPERTY_A,
        sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      })
      expect(fact.payload).not.toHaveProperty('name')
    }
  })

  it('rejects a stale Portal Group rename without changing state or recording its fact', async () => {
    await seedPortalGroupMembership()
    const event = portalGroupUpdated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Guest Services',
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })

    await expect(
      createAtomicPortalCommandStore(getDb(), silentEvents).updatePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: CREATED_AT,
        name: 'Guest Services',
        at: UPDATED_AT,
        event,
      }),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'revision_conflict' })

    const group = await getPool().query(
      `SELECT name, updated_at FROM portal_groups
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const fact = await getPool().query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND id = $2`,
      [ORG_A, event.eventId],
    )
    expect(group.rows).toEqual([{ name: 'Front Desk', updated_at: GROUP_UPDATED_AT }])
    expect(fact.rows).toHaveLength(0)
  })

  it('rolls back a new link category and the Portal revision when its fact conflicts', async () => {
    const portal = makePortal()
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
    const category = {
      id: portalLinkCategoryId('7a000000-0000-4000-8000-000000000001'),
      portalId: PORTAL_A,
      organizationId: ORG_A,
      title: 'Local guides',
      sortKey: 'a0',
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    }
    const event = portalLinkCategoryCreated({
      portalId: PORTAL_A,
      categoryId: category.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal_link_category.created', 1, '{}'::jsonb, $2, $3,
               'portal_link_category', $4, $5)`,
      [event.eventId, ORG_A, PROPERTY_A, PORTAL_A, UPDATED_AT],
    )

    await expect(
      store.createPortalLinkCategory({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        expectedPortalUpdatedAt: CREATED_AT,
        category,
        at: UPDATED_AT,
        event,
      }),
    ).rejects.toThrow()

    const categories = await getPool().query(
      `SELECT id FROM portal_link_categories
       WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, PORTAL_A],
    )
    const portalState = await getPool().query(
      `SELECT updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(categories.rows).toHaveLength(0)
    expect(portalState.rows).toEqual([{ updated_at: CREATED_AT }])
  })

  it('rolls back token issuance and the Portal revision when its fact conflicts', async () => {
    const portal = makePortal()
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
    const token = issueToken({
      id: '7b000000-0000-4000-8000-000000000001',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      tokenIdentifier: 'atomicissuetoken01',
      tokenHash: COMMIT_TOKEN_HASH,
      tokenKeyVersion: 1,
      version: 1,
      now: UPDATED_AT,
    })
    const event = portalTokenIssued({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      tokenIdentifier: token.tokenIdentifier,
      version: token.version,
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal.token.issued', 1, '{}'::jsonb, $2, $3,
               'portal', $4, $5)`,
      [event.eventId, ORG_A, PROPERTY_A, PORTAL_A, UPDATED_AT],
    )

    await expect(
      store.issuePortalToken({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        expectedPortalUpdatedAt: CREATED_AT,
        token,
        at: UPDATED_AT,
        event,
      }),
    ).rejects.toThrow()

    const tokens = await getPool().query(
      `SELECT id FROM portal_tokens WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, PORTAL_A],
    )
    const portalState = await getPool().query(
      `SELECT updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(tokens.rows).toHaveLength(0)
    expect(portalState.rows).toEqual([{ updated_at: CREATED_AT }])
  })

  it('serializes concurrent Portal Group renames through one aggregate revision', async () => {
    await seedPortalGroupMembership()
    const firstEvent = portalGroupUpdated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Guest Services',
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    const secondEvent = portalGroupUpdated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Reception Team',
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    const results = await Promise.allSettled([
      store.updatePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        name: 'Guest Services',
        at: UPDATED_AT,
        event: firstEvent,
      }),
      store.updatePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        name: 'Reception Team',
        at: DELETED_AT,
        event: secondEvent,
      }),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { _tag: 'PortalError', code: 'revision_conflict' },
    })
    const facts = await getPool().query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [ORG_A, [firstEvent.eventId, secondEvent.eventId]],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('commits membership add and removal with each fenced Portal Group fact', async () => {
    const portal = makePortal()
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
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
    const added = portalAddedToGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    await store.addPortalToGroup({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      expectedUpdatedAt: GROUP_UPDATED_AT,
      at: UPDATED_AT,
      changedBy: MANAGER,
      event: added,
    })
    const removed = portalRemovedFromGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })
    await store.removePortalFromGroup({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      expectedUpdatedAt: UPDATED_AT,
      at: DELETED_AT,
      changedBy: MANAGER,
      event: removed,
    })

    const membership = await getPool().query(
      `SELECT effective_from, effective_to, end_reason
       FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2 AND portal_id = $3`,
      [ORG_A, GROUP_A, PORTAL_A],
    )
    const group = await getPool().query(
      `SELECT updated_at FROM portal_groups WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const facts = await getPool().query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN ('portal_group.portal_added', 'portal_group.portal_removed')
       ORDER BY event_type`,
      [ORG_A],
    )
    expect(membership.rows).toEqual([
      {
        effective_from: UPDATED_AT,
        effective_to: DELETED_AT,
        end_reason: 'removed_from_group',
      },
    ])
    expect(group.rows).toEqual([{ updated_at: DELETED_AT }])
    expect(facts.rows).toEqual([
      {
        event_type: 'portal_group.portal_added',
        payload: expect.objectContaining({
          propertyId: PROPERTY_A,
          sourceAggregateVersion: UPDATED_AT.toISOString(),
        }),
      },
      {
        event_type: 'portal_group.portal_removed',
        payload: expect.objectContaining({
          propertyId: PROPERTY_A,
          sourceAggregateVersion: DELETED_AT.toISOString(),
        }),
      },
    ])
  })

  it('serializes competing group additions for the same Portal', async () => {
    const portal = makePortal()
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
    await getPool().query(
      `INSERT INTO portal_groups
         (id, organization_id, property_id, name, created_at, updated_at)
       VALUES ($1, $3, $4, 'Front Desk', $5, $5),
              ($2, $3, $4, 'Guest Services', $5, $5)`,
      [GROUP_A, GROUP_B, ORG_A, PROPERTY_A, GROUP_UPDATED_AT],
    )
    const firstEvent = portalAddedToGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    const secondEvent = portalAddedToGroup({
      portalGroupId: GROUP_B,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })

    const results = await Promise.allSettled([
      store.addPortalToGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        portalId: PORTAL_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        at: UPDATED_AT,
        changedBy: MANAGER,
        event: firstEvent,
      }),
      store.addPortalToGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_B,
        portalId: PORTAL_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        at: DELETED_AT,
        changedBy: MANAGER,
        event: secondEvent,
      }),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { _tag: 'PortalError', code: 'portal_already_grouped' },
    })
    const activeMemberships = await getPool().query(
      `SELECT portal_group_id FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_id = $2 AND effective_to IS NULL`,
      [ORG_A, PORTAL_A],
    )
    expect(activeMemberships.rows).toHaveLength(1)
    const facts = await getPool().query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [ORG_A, [firstEvent.eventId, secondEvent.eventId]],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('commits category/link creation and reorder facts against one Portal revision chain', async () => {
    const portal = makePortal()
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
    const categoryAt = UPDATED_AT
    const linkAt = new Date('2026-08-26T10:06:00.000Z')
    const categoryReorderAt = new Date('2026-08-26T10:07:00.000Z')
    const linkReorderAt = new Date('2026-08-26T10:08:00.000Z')
    const category = {
      id: portalLinkCategoryId('7a000000-0000-4000-8000-000000000001'),
      portalId: PORTAL_A,
      organizationId: ORG_A,
      title: 'Local guides',
      sortKey: 'a0',
      createdAt: categoryAt,
      updatedAt: categoryAt,
    }
    const categoryCreated = portalLinkCategoryCreated({
      portalId: PORTAL_A,
      categoryId: category.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: categoryAt.toISOString(),
      occurredAt: categoryAt,
    })
    await store.createPortalLinkCategory({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: CREATED_AT,
      category,
      at: categoryAt,
      event: categoryCreated,
    })
    const link = {
      id: portalLinkId('7c000000-0000-4000-8000-000000000001'),
      categoryId: category.id,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      label: 'City guide',
      url: 'https://example.test/guide',
      iconKey: null,
      sortKey: 'a0',
      createdAt: linkAt,
      updatedAt: linkAt,
    }
    const linkCreated = portalLinkCreated({
      portalId: PORTAL_A,
      linkId: link.id,
      categoryId: category.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: linkAt.toISOString(),
      occurredAt: linkAt,
    })
    await store.createPortalLink({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: categoryAt,
      link,
      at: linkAt,
      event: linkCreated,
    })
    const categoryReordered = portalLinkCategoryReordered({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: categoryReorderAt.toISOString(),
      occurredAt: categoryReorderAt,
    })
    await store.reorderPortalLinkCategories({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: linkAt,
      updates: [{ id: category.id, sortKey: 'b0' }],
      at: categoryReorderAt,
      event: categoryReordered,
    })
    const linkReordered = portalLinkReordered({
      portalId: PORTAL_A,
      categoryId: category.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: linkReorderAt.toISOString(),
      occurredAt: linkReorderAt,
    })
    await store.reorderPortalLinks({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: categoryReorderAt,
      categoryId: category.id,
      updates: [{ id: link.id, sortKey: 'b0' }],
      at: linkReorderAt,
      event: linkReordered,
    })

    const state = await getPool().query(
      `SELECT p.updated_at, c.sort_key AS category_sort_key, l.sort_key AS link_sort_key
       FROM portals p
       JOIN portal_link_categories c ON c.portal_id = p.id
       JOIN portal_links l ON l.portal_id = p.id AND l.category_id = c.id
       WHERE p.organization_id = $1 AND p.id = $2`,
      [ORG_A, PORTAL_A],
    )
    const facts = await getPool().query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type LIKE 'portal_link%'
       ORDER BY created_at, event_type`,
      [ORG_A],
    )
    expect(state.rows).toEqual([
      {
        updated_at: linkReorderAt,
        category_sort_key: 'b0',
        link_sort_key: 'b0',
      },
    ])
    expect(facts.rows).toHaveLength(4)
    for (const fact of facts.rows) {
      expect(fact.payload).toMatchObject({ propertyId: PROPERTY_A })
      expect(fact.payload).toHaveProperty('sourceAggregateVersion')
      expect(fact.payload).not.toHaveProperty('title')
      expect(fact.payload).not.toHaveProperty('label')
      expect(fact.payload).not.toHaveProperty('url')
    }
  })

  it('commits issue, rotation, and replay-safe revocation as one revision chain', async () => {
    const portal = makePortal()
    const store = createAtomicPortalCommandStore(getDb(), silentEvents)
    await store.createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerId: MANAGER,
      event: createdFact(portal),
    })
    const issueAt = UPDATED_AT
    const rotateAt = new Date('2026-08-26T10:06:00.000Z')
    const revokeAt = new Date('2026-08-26T10:07:00.000Z')
    const firstToken = issueToken({
      id: '7b000000-0000-4000-8000-000000000001',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      tokenIdentifier: 'atomicissuetoken01',
      tokenHash: COMMIT_TOKEN_HASH,
      tokenKeyVersion: 1,
      version: 1,
      now: issueAt,
    })
    const issued = portalTokenIssued({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      tokenIdentifier: firstToken.tokenIdentifier,
      version: firstToken.version,
      sourceAggregateVersion: issueAt.toISOString(),
      occurredAt: issueAt,
    })
    await store.issuePortalToken({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: CREATED_AT,
      token: firstToken,
      at: issueAt,
      event: issued,
    })
    const rotation = rotateToken(
      firstToken,
      {
        id: '7b000000-0000-4000-8000-000000000002',
        tokenIdentifier: 'atomicrotatetoken02',
        tokenHash: ROLLBACK_TOKEN_HASH,
        tokenKeyVersion: 1,
        version: 2,
      },
      15 * 60 * 1000,
      rotateAt,
    )
    if (!('oldToken' in rotation)) throw new Error('rotation fixture must be valid')
    const rotated = portalTokenRotated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousVersion: 1,
      version: 2,
      gracePeriodEnds: rotation.oldToken.gracePeriodEnds!,
      sourceAggregateVersion: rotateAt.toISOString(),
      occurredAt: rotateAt,
    })
    await store.rotatePortalToken({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: issueAt,
      oldToken: rotation.oldToken,
      newToken: rotation.newToken,
      at: rotateAt,
      event: rotated,
    })
    const revoked = portalTokenRevoked({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: revokeAt.toISOString(),
      occurredAt: revokeAt,
    })
    const revokeCommand = {
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: rotateAt,
      revokedBy: MANAGER,
      reason: 'compromised print',
      at: revokeAt,
      event: revoked,
    } as const
    await expect(store.revokePortalTokens(revokeCommand)).resolves.toEqual({
      revoked: 2,
    })
    await expect(store.revokePortalTokens(revokeCommand)).resolves.toEqual({
      revoked: 0,
    })

    const tokens = await getPool().query(
      `SELECT version, status, revoked_at FROM portal_tokens
       WHERE organization_id = $1 AND portal_id = $2 ORDER BY version`,
      [ORG_A, PORTAL_A],
    )
    const facts = await getPool().query(
      `SELECT event_type FROM outbox_events
       WHERE organization_id = $1 AND event_type LIKE 'portal.token.%'
       ORDER BY event_type`,
      [ORG_A],
    )
    expect(tokens.rows).toEqual([
      { version: 1, status: 'revoked', revoked_at: revokeAt },
      { version: 2, status: 'revoked', revoked_at: revokeAt },
    ])
    expect(facts.rows).toEqual([
      { event_type: 'portal.token.issued' },
      { event_type: 'portal.token.revoked' },
      { event_type: 'portal.token.rotated' },
    ])
  })
})

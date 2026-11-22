// Portal command store against real PostgreSQL: archive, restore, rollback, token and Linktree facts.

import { describe, expect, it } from 'vitest'

import {
  portalArchived,
  portalPublicationRolledBack,
  portalRestored,
  portalTokenIssued,
  portalTokenRevoked,
  portalTokenRotated,
  portalUpdated,
} from '../domain/events'

import { issueToken, rotateToken } from '../domain/portal-token'
import {
  COMMIT_TOKEN_HASH,
  CREATED_AT,
  hasDatabaseErrorCode,
  MANAGER,
  ORG_A,
  PORTAL_A,
  PROPERTY_A,
  publicationMutation,
  publicationPublishedFact,
  ROLLBACK_TOKEN_HASH,
  accessArtifactCommandParts,
  seedStoredPortal,
  setupPortalCommandStoreTestDb,
  UPDATED_AT,
} from './portal-command-store.test-fixtures'

const { getPool } = setupPortalCommandStoreTestDb()

describe.sequential('Portal command store (real PostgreSQL)', () => {
  it('rejects archive when portal.updated is supplied without its dedicated semantic fact', async () => {
    const { store } = await seedStoredPortal({ publicationState: 'disabled' })
    const genericEvent = portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: 'disabled',
      publicationState: 'archived',
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })

    await expect(
      store.updatePortal({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        actorUserId: MANAGER,
        expectedUpdatedAt: CREATED_AT,
        revision: UPDATED_AT,
        occurredAt: UPDATED_AT,
        patch: { publicationState: 'archived' },
        event: genericEvent,
      }),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'forbidden' })

    const state = await getPool().query(
      `SELECT publication_state, updated_at FROM portals
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    const transitionFacts = await getPool().query(
      `SELECT event_type FROM outbox_events
       WHERE organization_id = $1
         AND (id = $2 OR event_type = 'portal.archived')`,
      [ORG_A, genericEvent.eventId],
    )
    expect(state.rows).toEqual([
      { publication_state: 'disabled', updated_at: CREATED_AT },
    ])
    expect(transitionFacts.rows).toHaveLength(0)
  })

  it('commits archive and restore facts once while stale replay changes nothing', async () => {
    const { store } = await seedStoredPortal({ publicationState: 'disabled' })
    const archived = portalArchived({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      userId: MANAGER,
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    const archiveUpdated = portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: 'disabled',
      publicationState: 'archived',
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    const archiveCommand = {
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      actorUserId: MANAGER,
      expectedUpdatedAt: CREATED_AT,
      revision: UPDATED_AT,
      occurredAt: UPDATED_AT,
      patch: { publicationState: 'archived' as const },
      lifecycleEvent: archived,
      event: archiveUpdated,
    }

    await store.updatePortal(archiveCommand)
    await expect(store.updatePortal(archiveCommand)).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'revision_conflict',
    })

    const restoredAt = new Date(UPDATED_AT.getTime() + 60_000)
    const restored = portalRestored({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      userId: MANAGER,
      sourceAggregateVersion: restoredAt.toISOString(),
      occurredAt: restoredAt,
    })
    await store.updatePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      actorUserId: MANAGER,
      expectedUpdatedAt: UPDATED_AT,
      revision: restoredAt,
      occurredAt: restoredAt,
      patch: { publicationState: 'disabled' },
      lifecycleEvent: restored,
      event: portalUpdated({
        portalId: PORTAL_A,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        previousPublicationState: 'archived',
        publicationState: 'disabled',
        sourceAggregateVersion: restoredAt.toISOString(),
        occurredAt: restoredAt,
      }),
    })

    const state = await getPool().query(
      `SELECT publication_state, updated_at FROM portals
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    const facts = await getPool().query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN ('portal.archived', 'portal.restored')
       ORDER BY event_type`,
      [ORG_A],
    )
    expect(state.rows).toEqual([
      { publication_state: 'disabled', updated_at: restoredAt },
    ])
    expect(facts.rows).toEqual([
      {
        event_type: 'portal.archived',
        payload: expect.objectContaining({
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          portalId: PORTAL_A,
          userId: MANAGER,
          sourceAggregateVersion: UPDATED_AT.toISOString(),
          occurredAt: UPDATED_AT.toISOString(),
        }),
      },
      {
        event_type: 'portal.restored',
        payload: expect.objectContaining({
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          portalId: PORTAL_A,
          userId: MANAGER,
          sourceAggregateVersion: restoredAt.toISOString(),
          occurredAt: restoredAt.toISOString(),
        }),
      },
    ])
    for (const fact of facts.rows) {
      expect(fact.payload).not.toHaveProperty('name')
      expect(fact.payload).not.toHaveProperty('destinationUri')
    }
  })

  it('rolls back to an earlier immutable snapshot with one exact target fact', async () => {
    const { store, portal } = await seedStoredPortal({ publicationState: 'draft' })

    const publishedV1At = UPDATED_AT
    const publicationV1 = publicationMutation(portal, {
      name: portal.name,
      version: 1,
      activationSequence: 1,
      snapshotId: '6d000000-0000-4000-8000-000000000011',
      activationId: '6e000000-0000-4000-8000-000000000011',
      at: publishedV1At,
    })
    await store.updatePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      actorUserId: MANAGER,
      expectedUpdatedAt: CREATED_AT,
      revision: publishedV1At,
      occurredAt: publishedV1At,
      patch: { publicationState: 'published' },
      publication: publicationV1,
      lifecycleEvent: publicationPublishedFact(portal, publicationV1, publishedV1At),
      event: portalUpdated({
        portalId: PORTAL_A,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        previousPublicationState: 'draft',
        publicationState: 'published',
        sourceAggregateVersion: publishedV1At.toISOString(),
        occurredAt: publishedV1At,
      }),
    })

    const disabledAt = new Date(publishedV1At.getTime() + 60_000)
    await store.updatePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      actorUserId: MANAGER,
      expectedUpdatedAt: publishedV1At,
      revision: disabledAt,
      occurredAt: disabledAt,
      patch: { publicationState: 'disabled' },
      publication: { kind: 'deactivate', reason: 'disabled', at: disabledAt },
      event: portalUpdated({
        portalId: PORTAL_A,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        previousPublicationState: 'published',
        publicationState: 'disabled',
        sourceAggregateVersion: disabledAt.toISOString(),
        occurredAt: disabledAt,
      }),
    })

    const disabledPortal = {
      ...portal,
      publicationState: 'disabled' as const,
      updatedAt: disabledAt,
    }
    const publishedV2At = new Date(disabledAt.getTime() + 60_000)
    const publicationV2 = publicationMutation(disabledPortal, {
      name: portal.name,
      version: 2,
      activationSequence: 2,
      snapshotId: '6d000000-0000-4000-8000-000000000012',
      activationId: '6e000000-0000-4000-8000-000000000012',
      at: publishedV2At,
    })
    await store.updatePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      actorUserId: MANAGER,
      expectedUpdatedAt: disabledAt,
      revision: publishedV2At,
      occurredAt: publishedV2At,
      patch: { publicationState: 'published' },
      publication: publicationV2,
      lifecycleEvent: publicationPublishedFact(
        disabledPortal,
        publicationV2,
        publishedV2At,
      ),
      event: portalUpdated({
        portalId: PORTAL_A,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        previousPublicationState: 'disabled',
        publicationState: 'published',
        sourceAggregateVersion: publishedV2At.toISOString(),
        occurredAt: publishedV2At,
      }),
    })

    const rolledBackAt = new Date(publishedV2At.getTime() + 60_000)
    const rolledBack = portalPublicationRolledBack({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      publicationSnapshotId: publicationV1.snapshot.id,
      publicationVersion: publicationV1.snapshot.version,
      publicationDigest: publicationV1.snapshot.configurationDigest,
      userId: MANAGER,
      sourceAggregateVersion: rolledBackAt.toISOString(),
      occurredAt: rolledBackAt,
    })
    const rollbackUpdated = portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: 'published',
      publicationState: 'published',
      sourceAggregateVersion: rolledBackAt.toISOString(),
      occurredAt: rolledBackAt,
    })
    const rollbackCommand = {
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      actorUserId: MANAGER,
      expectedUpdatedAt: publishedV2At,
      revision: rolledBackAt,
      occurredAt: rolledBackAt,
      patch: {},
      publication: {
        kind: 'rollback' as const,
        snapshotId: publicationV1.snapshot.id,
        snapshotVersion: publicationV1.snapshot.version,
        publicationDigest: publicationV1.snapshot.configurationDigest,
        activation: {
          id: '6e000000-0000-4000-8000-000000000013',
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          portalId: PORTAL_A,
          snapshotId: publicationV1.snapshot.id,
          activationSequence: 3,
          kind: 'rollback' as const,
          activatedBy: MANAGER,
          activatedAt: rolledBackAt,
          deactivatedAt: null,
          deactivationReason: null,
        },
      },
      lifecycleEvent: rolledBack,
      event: rollbackUpdated,
    }

    await store.updatePortal(rollbackCommand)
    await expect(store.updatePortal(rollbackCommand)).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'revision_conflict',
    })

    const active = await getPool().query(
      `SELECT s.id, s.version, s.configuration_digest
       FROM portal_publication_activations a
       JOIN portal_publication_snapshots s ON s.id = a.snapshot_id
       WHERE a.organization_id = $1 AND a.portal_id = $2
         AND a.deactivated_at IS NULL`,
      [ORG_A, PORTAL_A],
    )
    const facts = await getPool().query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'portal.publication.rolled_back'`,
      [ORG_A],
    )
    expect(active.rows).toEqual([
      {
        id: publicationV1.snapshot.id,
        version: 1,
        configuration_digest: publicationV1.snapshot.configurationDigest,
      },
    ])
    expect(facts.rows).toEqual([
      {
        payload: expect.objectContaining({
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          portalId: PORTAL_A,
          publicationSnapshotId: publicationV1.snapshot.id,
          publicationVersion: 1,
          publicationDigest: publicationV1.snapshot.configurationDigest,
          userId: MANAGER,
          sourceAggregateVersion: rolledBackAt.toISOString(),
          occurredAt: rolledBackAt.toISOString(),
        }),
      },
    ])

    // Making a later version live again (slice 36): the version that was live
    // before the restore comes back as one more activation, not a rewrite.
    const rolledForwardAt = new Date(rolledBackAt.getTime() + 60_000)
    await store.updatePortal({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      actorUserId: MANAGER,
      expectedUpdatedAt: rolledBackAt,
      revision: rolledForwardAt,
      occurredAt: rolledForwardAt,
      patch: {},
      publication: {
        kind: 'rollback' as const,
        snapshotId: publicationV2.snapshot.id,
        snapshotVersion: publicationV2.snapshot.version,
        publicationDigest: publicationV2.snapshot.configurationDigest,
        activation: {
          id: '6e000000-0000-4000-8000-000000000014',
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          portalId: PORTAL_A,
          snapshotId: publicationV2.snapshot.id,
          activationSequence: 4,
          kind: 'rollback' as const,
          activatedBy: MANAGER,
          activatedAt: rolledForwardAt,
          deactivatedAt: null,
          deactivationReason: null,
        },
      },
      lifecycleEvent: portalPublicationRolledBack({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        publicationSnapshotId: publicationV2.snapshot.id,
        publicationVersion: publicationV2.snapshot.version,
        publicationDigest: publicationV2.snapshot.configurationDigest,
        userId: MANAGER,
        sourceAggregateVersion: rolledForwardAt.toISOString(),
        occurredAt: rolledForwardAt,
      }),
      event: portalUpdated({
        portalId: PORTAL_A,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        previousPublicationState: 'published',
        publicationState: 'published',
        sourceAggregateVersion: rolledForwardAt.toISOString(),
        occurredAt: rolledForwardAt,
      }),
    })
    const forward = await getPool().query(
      `SELECT s.version, a.activation_sequence, a.deactivated_at IS NULL AS open
       FROM portal_publication_activations a
       JOIN portal_publication_snapshots s ON s.id = a.snapshot_id
       WHERE a.organization_id = $1 AND a.portal_id = $2
       ORDER BY a.activation_sequence`,
      [ORG_A, PORTAL_A],
    )
    expect(forward.rows).toEqual([
      { version: 1, activation_sequence: 1, open: false },
      { version: 2, activation_sequence: 2, open: false },
      { version: 1, activation_sequence: 3, open: false },
      { version: 2, activation_sequence: 4, open: true },
    ])
  })

  it('rolls back a Linktree switch and the Portal revision when its fact conflicts', async () => {
    const { store, portal } = await seedStoredPortal()
    const event = portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: portal.publicationState,
      publicationState: portal.publicationState,
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal.updated', 1, '{}'::jsonb, $2, $3,
               'portal', $4, $5)`,
      [event.eventId, ORG_A, PROPERTY_A, PORTAL_A, UPDATED_AT],
    )

    await expect(
      store.savePortalLinktreeSettings({
        organizationId: ORG_A,
        actorUserId: MANAGER,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        expectedPortalUpdatedAt: CREATED_AT,
        enabled: false,
        revision: UPDATED_AT,
        occurredAt: UPDATED_AT,
        event,
      }),
    ).rejects.toSatisfy((error: unknown) => hasDatabaseErrorCode(error, '23505'))

    const portalState = await getPool().query(
      `SELECT updated_at, linktree_enabled FROM portals
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(portalState.rows).toEqual([{ updated_at: CREATED_AT, linktree_enabled: true }])
  })

  it('rolls back token issuance and the Portal revision when its fact conflicts', async () => {
    const { store } = await seedStoredPortal()
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
        issuedBy: MANAGER,
        sealedAddress: null,
        ...accessArtifactCommandParts(
          token,
          '7c000000-0000-4000-8000-000000000001',
          UPDATED_AT,
        ),
        revision: UPDATED_AT,
        occurredAt: UPDATED_AT,
        event,
      }),
    ).rejects.toSatisfy((error: unknown) => hasDatabaseErrorCode(error, '23505'))

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

  it('commits issue, rotation, and replay-safe revocation as one revision chain', async () => {
    const { store } = await seedStoredPortal()
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
      issuedBy: MANAGER,
      sealedAddress: { ciphertext: 'sealed-first', keyVersion: 1 },
      ...accessArtifactCommandParts(
        firstToken,
        '7c000000-0000-4000-8000-000000000002',
        issueAt,
      ),
      revision: issueAt,
      occurredAt: issueAt,
      event: issued,
    })
    const afterIssue = await getPool().query(
      `SELECT issued_by, encrypted_raw_token, address_encryption_key_version
       FROM portal_tokens WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(afterIssue.rows).toEqual([
      {
        issued_by: MANAGER,
        encrypted_raw_token: 'sealed-first',
        address_encryption_key_version: 1,
      },
    ])
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
      issuedBy: MANAGER,
      sealedAddress: { ciphertext: 'sealed-second', keyVersion: 2 },
      ...accessArtifactCommandParts(
        rotation.newToken,
        '7c000000-0000-4000-8000-000000000003',
        rotateAt,
      ),
      revision: rotateAt,
      occurredAt: rotateAt,
      event: rotated,
    })
    // Replacing seals the new address and clears the outgoing one's.
    const afterRotate = await getPool().query(
      `SELECT version, status, issued_by, encrypted_raw_token,
              address_encryption_key_version
       FROM portal_tokens WHERE organization_id = $1 AND portal_id = $2
       ORDER BY version`,
      [ORG_A, PORTAL_A],
    )
    expect(afterRotate.rows).toEqual([
      {
        version: 1,
        status: 'rotating',
        issued_by: MANAGER,
        encrypted_raw_token: null,
        address_encryption_key_version: null,
      },
      {
        version: 2,
        status: 'active',
        issued_by: MANAGER,
        encrypted_raw_token: 'sealed-second',
        address_encryption_key_version: 2,
      },
    ])
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
      revision: revokeAt,
      occurredAt: revokeAt,
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
    // Stopping every code clears the last sealed address.
    const sealedAfterRevoke = await getPool().query(
      `SELECT count(*)::int AS sealed FROM portal_tokens
       WHERE organization_id = $1 AND portal_id = $2
         AND (encrypted_raw_token IS NOT NULL OR address_encryption_key_version IS NOT NULL)`,
      [ORG_A, PORTAL_A],
    )
    expect(sealedAfterRevoke.rows).toEqual([{ sealed: 0 }])
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

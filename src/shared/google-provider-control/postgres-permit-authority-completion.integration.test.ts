import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import { createGoogleDisconnectRevokeRepository } from '#/contexts/integration/connections/google-disconnect-revoke-repository.server'
import {
  admissionBindings,
  currentPermissionVersion,
  insertAdmittedPermit,
} from '#/shared/testing/google-permit-seed'
import {
  CLEANUP_PERMIT_ID,
  CONNECTION_ID,
  DISCONNECT_ATTEMPT_ID,
  DISCONNECT_PERMIT_ID,
  ORGANIZATION_ID,
  PERMIT_ID,
  USER_ID,
  authority,
  compiledCleanup,
  harness,
  loadSnapshot,
  readPermit,
  seedUnlinkedCleanupPermit,
  usePermitAuthorityHarness,
} from '#/shared/testing/postgres-permit-authority.test-fixtures'

usePermitAuthorityHarness()

describe('Postgres Google admission permit authority', () => {
  it('commits only the started revision and its code-only provider outcome', async () => {
    const adapter = authority()
    const snapshot = await loadSnapshot(PERMIT_ID)
    await expect(adapter.start(snapshot)).resolves.toBe('started')

    await adapter.complete(
      snapshot.permitId,
      snapshot.authorityRevision,
      'rate_limited',
      5_000,
    )
    expect(
      await readPermit(
        PERMIT_ID,
        'state, correlation_id, completed_at IS NOT NULL AS completed',
      ),
    ).toEqual({
      state: 'completed',
      correlation_id: 'rate_limited:retry_after_5000',
      completed: true,
    })
  })

  it('does not complete after immutable permit scope changes', async () => {
    const adapter = authority()
    const snapshot = await loadSnapshot(PERMIT_ID)
    await expect(adapter.start(snapshot)).resolves.toBe('started')
    await harness.pool.query(
      `UPDATE authorization_execution_permits
          SET operation_key = 'tampered-operation'
        WHERE id = $1`,
      [PERMIT_ID],
    )

    await expect(
      adapter.complete(snapshot.permitId, snapshot.authorityRevision, 'success', null),
    ).rejects.toThrow('changed before completion')
  })

  it('fences rather than completing after the operation deadline', async () => {
    const adapter = authority()
    const snapshot = await loadSnapshot(PERMIT_ID)
    await expect(adapter.start(snapshot)).resolves.toBe('started')
    await harness.pool.query(
      `UPDATE authorization_execution_permits
          SET started_at = now() - interval '60 seconds',
              operation_deadline_at = now() - interval '30 seconds'
        WHERE id = $1`,
      [PERMIT_ID],
    )

    await expect(
      adapter.complete(snapshot.permitId, snapshot.authorityRevision, 'success', null),
    ).rejects.toThrow('changed before completion')
    expect(await readPermit(PERMIT_ID, 'state, correlation_id')).toEqual({
      state: 'fenced',
      correlation_id: 'operation_deadline_elapsed',
    })
  })

  it('refuses a revoke permit without a live Disconnect receipt', async () => {
    await seedUnlinkedCleanupPermit()
    const snapshot = await loadSnapshot(CLEANUP_PERMIT_ID, 'cleanup permit snapshot')

    await expect(authority().start(snapshot)).resolves.toBe('changed')
    const result = await harness.pool.query(
      'SELECT state, started_at FROM authorization_execution_permits WHERE id = $1',
      [CLEANUP_PERMIT_ID],
    )
    expect(result.rows).toEqual([{ state: 'fenced', started_at: null }])
  })

  it('acquires one disconnect cleanup permit and reconciles a started crash without resending', async () => {
    const { pool } = harness
    const activatedAt = new Date()
    const cleanupDeadlineAt = new Date(activatedAt.getTime() + 60_000)
    const repository = createGoogleDisconnectRevokeRepository(getDb())
    const authorization = {
      capability: 'property.import_gbp_v2' as const,
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: null,
      connectionId: googleConnectionId(CONNECTION_ID),
      initiatorUserId: USER_ID,
      expectedCredentialGeneration: 1,
      authorizationVector: Object.freeze({
        executionPolicyVersion: 'beta-local-2',
        principalKind: 'user',
        role: 'AccountAdmin',
        permissionVersion: await currentPermissionVersion(pool, ORGANIZATION_ID),
        permissionDigest: 'd'.repeat(64),
        connectionLifecycleVersion: 1,
        connectionAccessVersion: 1,
        credentialGeneration: 1,
      }),
      disconnectRevoke: Object.freeze({
        attemptId: DISCONNECT_ATTEMPT_ID,
        cleanupDeadlineAtMs: cleanupDeadlineAt.getTime(),
      }),
    }
    const dispatch = {
      attemptId: DISCONNECT_ATTEMPT_ID,
      cleanupWorkPermitId: DISCONNECT_PERMIT_ID,
      authorization,
      credentialBinding: compiledCleanup.admission.credentialBinding,
      now: activatedAt,
    }
    await expect(
      repository.prepare({
        attemptId: DISCONNECT_ATTEMPT_ID,
        authorization,
        credentialBinding: compiledCleanup.admission.credentialBinding,
        cleanupDeadlineAt,
        now: activatedAt,
      }),
    ).resolves.toMatchObject({ ok: true })
    await pool.query('DELETE FROM authorization_execution_permits WHERE id = $1', [
      PERMIT_ID,
    ])
    await insertAdmittedPermit(pool, {
      id: DISCONNECT_PERMIT_ID,
      capability: 'property.import_gbp_v2',
      organizationId: ORGANIZATION_ID,
      connectionId: CONNECTION_ID,
      initiatorUserId: USER_ID,
      operationKey: 'provider.oauth.revoke',
      compiled: compiledCleanup,
      vector: {
        ...authorization.authorizationVector,
        ...admissionBindings(compiledCleanup),
      },
      admittedAt: activatedAt,
    })

    const acquisitions = await Promise.all([
      repository.acquireDispatch(dispatch),
      repository.acquireDispatch(dispatch),
    ])
    expect(acquisitions.filter((result) => result.ok)).toHaveLength(1)
    expect(acquisitions.filter((result) => !result.ok)).toHaveLength(1)

    const snapshot = await loadSnapshot(DISCONNECT_PERMIT_ID, 'disconnect permit')
    const starts = await Promise.all([
      authority().start(snapshot),
      authority().start(snapshot),
    ])
    expect(starts.sort()).toEqual(['changed', 'started'])
    await pool.query(
      `UPDATE authorization_execution_permits
          SET state = 'fenced', fenced_at = $2,
              correlation_id = 'operation_deadline_elapsed'
        WHERE id = $1`,
      [DISCONNECT_PERMIT_ID, cleanupDeadlineAt],
    )

    await expect(
      repository.reconcileElapsed({
        now: new Date(cleanupDeadlineAt.getTime() + 1),
        limit: 10,
      }),
    ).resolves.toEqual({
      visited: 1,
      confirmedNotSent: 0,
      cleanupAmbiguous: 1,
    })
    const result = await pool.query(
      `SELECT connection.status, connection.credential_use_state,
              connection.google_subject, connection.encrypted_refresh_token,
              receipt.payload->>'state' AS state,
              receipt.payload->>'credentialBinding' AS credential_binding
         FROM google_connections AS connection
         JOIN idempotency_receipts AS receipt
           ON receipt.scope = 'google_disconnect_revoke'
          AND receipt.payload->>'organizationId' = connection.organization_id
          AND receipt.payload->>'connectionId' = connection.id::text
        WHERE receipt.key = $1`,
      [DISCONNECT_ATTEMPT_ID],
    )
    expect(result.rows[0]).toEqual({
      status: 'disconnected',
      credential_use_state: 'none',
      google_subject: null,
      encrypted_refresh_token: 'redacted',
      state: 'cleanup_ambiguous',
      credential_binding: null,
    })
  })
})

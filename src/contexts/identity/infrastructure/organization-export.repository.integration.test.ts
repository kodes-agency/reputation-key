import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { OrganizationExportRepository } from '../application/ports/organization-export.port'
import { createOrganizationExportRepository } from './organization-export.repository'

const NOW = new Date('2026-08-28T12:00:00.000Z')
const organizations = new Set<string>()
const requests = new Set<string>()
const users = new Set<string>()
let lease: TestLease
let db: Database
let repository: OrganizationExportRepository

async function deleteExportFixtures(requestIds: readonly string[]): Promise<void> {
  if (requestIds.length === 0) return
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `ALTER TABLE organization_export_retrieval_issuances
       DISABLE TRIGGER organization_export_retrieval_issuances_update_delete_guard`,
    )
    await client.query(
      `DELETE FROM organization_export_retrieval_issuances
       WHERE export_id = ANY($1::uuid[])`,
      [requestIds],
    )
    await client.query(
      `ALTER TABLE organization_export_retrieval_issuances
       ENABLE ALWAYS TRIGGER organization_export_retrieval_issuances_update_delete_guard`,
    )
    await client.query('DELETE FROM organization_exports WHERE id = ANY($1::uuid[])', [
      requestIds,
    ])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function requestInput() {
  const id = randomUUID()
  const organizationId = `org-export-${randomUUID()}`
  const requestedBy = `admin-${randomUUID()}`
  requests.add(id)
  organizations.add(organizationId)
  users.add(requestedBy)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Export fixture', $1, $2)`,
    [organizationId, NOW],
  )
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Export actor', $2, true, $3, $3)`,
    [requestedBy, `${requestedBy}@example.test`, NOW],
  )
  await lease.pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [`member-${id}`, requestedBy, organizationId, NOW],
  )
  return {
    id,
    organizationId,
    requestedBy,
    asOf: NOW,
    objectExpiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
  }
}

async function addBackupOwner(organizationId: string): Promise<void> {
  const userId = `backup-owner-${randomUUID()}`
  users.add(userId)
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Backup export owner', $2, true, $3, $3)`,
    [userId, `${userId}@example.test`, NOW],
  )
  await lease.pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [`member-${randomUUID()}`, userId, organizationId, NOW],
  )
}

const COVERAGE_SHA = 'a'.repeat(64)
const MANIFEST_SHA = 'b'.repeat(64)
const ARCHIVE_SHA = 'c'.repeat(64)

const objectKeyFor = (id: string) => `private/organization-exports/${id}.zip`

/**
 * Publish an export the way production does: durable pre-egress evidence
 * FIRST, then the upload confirmation. `ready` is no longer reachable from
 * `generating`, so every fixture must pass through `egress_pending`.
 */
async function publishReady(
  id: string,
  claimedRevision: number,
  at: Date = NOW,
): Promise<number> {
  const pending = await repository.recordPreEgressEvidence({
    id,
    expectedRevision: claimedRevision,
    coverageSha256: COVERAGE_SHA,
    manifestSha256: MANIFEST_SHA,
    archiveSha256: ARCHIVE_SHA,
    objectKey: objectKeyFor(id),
    now: at,
  })
  const ready = await repository.completeGeneration({
    id,
    expectedRevision: pending.revision,
    coverageSha256: COVERAGE_SHA,
    manifestSha256: MANIFEST_SHA,
    archiveSha256: ARCHIVE_SHA,
    objectKey: objectKeyFor(id),
    encryptionEvidenceRef: `s3:aes256:${ARCHIVE_SHA}`,
    now: at,
  })
  return ready.revision
}

async function auditActions(organizationId: string): Promise<string[]> {
  const rows = await lease.pool.query(
    `SELECT action FROM audit_logs
     WHERE organization_id = $1
     ORDER BY created_at, action`,
    [organizationId],
  )
  return rows.rows.map((row) => String(row.action))
}

describe.sequential('PostgreSQL Organization Export authority', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool)
    repository = createOrganizationExportRepository(db)
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const organizationId of organizations) {
      await lease.pool.query('DELETE FROM audit_logs WHERE organization_id = $1', [
        organizationId,
      ])
    }
    await deleteExportFixtures([...requests])
    for (const organizationId of organizations) {
      await executeWithLastOwnerGuardDisabled(db, [
        sql`DELETE FROM member WHERE "organizationId" = ${organizationId}`,
      ])
      await lease.pool.query(
        'DELETE FROM organization_lifecycle_command_receipts WHERE organization_id = $1',
        [organizationId],
      )
      await lease.pool.query(
        'DELETE FROM organization_lifecycle_authority WHERE organization_id = $1',
        [organizationId],
      )
      await lease.pool.query('DELETE FROM organization WHERE id = $1', [organizationId])
    }
    for (const userId of users) {
      await lease.pool.query('DELETE FROM "user" WHERE id = $1', [userId])
    }
    organizations.clear()
    requests.clear()
    users.clear()
  })

  it('idempotently binds a request and writes one content-free request audit', async () => {
    const input = await requestInput()

    const first = await repository.request(input)
    const replay = await repository.request({
      ...input,
      asOf: new Date(NOW.getTime() + 1000),
      objectExpiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000 + 1000),
    })

    expect(first).toMatchObject({ state: 'requested', revision: 1 })
    expect(replay).toEqual(first)
    expect(await auditActions(input.organizationId)).toEqual(['privacy_request.received'])
    await expect(
      repository.request({ ...input, requestedBy: `other-${randomUUID()}` }),
    ).rejects.toThrow(/current AccountAdmin/)
  })

  it('claims one generation lease, records immutable archive evidence, and consumes one retrieval', async () => {
    const input = await requestInput()
    await repository.request(input)
    const claimed = await repository.claimNextGeneration({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
    })
    expect(claimed).toMatchObject({
      id: input.id,
      state: 'generating',
      revision: 2,
    })
    // generating (2) -> egress_pending (3) -> ready (4)
    const readyRevision = await publishReady(
      input.id,
      claimed!.revision,
      new Date(NOW.getTime() + 1000),
    )
    expect(readyRevision).toBe(4)

    const operationId = randomUUID()
    const retrievalExpiresAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    const issued = await repository.issueRetrieval({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: input.requestedBy,
      operationId,
      tokenDigest: 'd'.repeat(64),
      expiresAt: retrievalExpiresAt,
      now: NOW,
    })
    const replay = await repository.issueRetrieval({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: input.requestedBy,
      operationId,
      tokenDigest: 'd'.repeat(64),
      expiresAt: new Date(retrievalExpiresAt.getTime() - 1000),
      now: new Date(NOW.getTime() + 1000),
    })
    expect(replay).toEqual(issued)

    const retrieved = await repository.consumeRetrieval({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: input.requestedBy,
      tokenDigest: 'd'.repeat(64),
      now: new Date(NOW.getTime() + 2000),
    })
    expect(retrieved).toMatchObject({
      state: 'retrieved',
      revision: 6,
      retrievalTokenDigest: null,
    })
    await expect(
      repository.consumeRetrieval({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: input.requestedBy,
        tokenDigest: 'd'.repeat(64),
        now: new Date(NOW.getTime() + 3000),
      }),
    ).rejects.toThrow(/unavailable/)
    expect(await auditActions(input.organizationId)).toEqual([
      'privacy_request.received',
      'sensitive_data.exported',
      'sensitive_data.accessed',
    ])

    const replacementId = randomUUID()
    requests.add(replacementId)
    await expect(
      repository.request({
        id: replacementId,
        organizationId: input.organizationId,
        requestedBy: input.requestedBy,
        asOf: new Date(NOW.getTime() + 3000),
        objectExpiresAt: new Date(NOW.getTime() + 3000 + 7 * 24 * 60 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ id: replacementId, state: 'requested', revision: 1 })
  })

  it('reclaims an expired generation lease without concurrent duplicate authority', async () => {
    const input = await requestInput()
    await repository.request(input)
    const first = await repository.claimNextGeneration({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 1000),
    })
    const reclaimed = await repository.claimNextGeneration({
      now: new Date(NOW.getTime() + 1000),
      leaseExpiresAt: new Date(NOW.getTime() + 2000),
    })

    expect(first).toMatchObject({ id: input.id, revision: 2 })
    expect(reclaimed).toMatchObject({ id: input.id, revision: 3 })
    await expect(
      repository.recordPreEgressEvidence({
        id: input.id,
        expectedRevision: first!.revision,
        coverageSha256: COVERAGE_SHA,
        manifestSha256: MANIFEST_SHA,
        archiveSha256: ARCHIVE_SHA,
        objectKey: objectKeyFor(input.id),
        now: new Date(NOW.getTime() + 2000),
      }),
    ).rejects.toThrow(/authority changed/)
    await expect(
      repository.completeGeneration({
        id: input.id,
        expectedRevision: first!.revision,
        coverageSha256: COVERAGE_SHA,
        manifestSha256: MANIFEST_SHA,
        archiveSha256: ARCHIVE_SHA,
        objectKey: objectKeyFor(input.id),
        encryptionEvidenceRef: `s3:aes256:${ARCHIVE_SHA}`,
        now: new Date(NOW.getTime() + 2000),
      }),
    ).rejects.toThrow(/authority changed/)
  })

  it('records pre-egress evidence as a compare-and-set that is idempotent on exact replay', async () => {
    const input = await requestInput()
    await repository.request(input)
    const claimed = await repository.claimNextGeneration({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
    })

    const evidence = {
      id: input.id,
      expectedRevision: claimed!.revision,
      coverageSha256: COVERAGE_SHA,
      manifestSha256: MANIFEST_SHA,
      archiveSha256: ARCHIVE_SHA,
      objectKey: objectKeyFor(input.id),
      now: NOW,
    }
    const pending = await repository.recordPreEgressEvidence(evidence)
    expect(pending).toMatchObject({
      state: 'egress_pending',
      revision: 3,
      coverageSha256: COVERAGE_SHA,
      manifestSha256: MANIFEST_SHA,
      archiveSha256: ARCHIVE_SHA,
      objectKey: objectKeyFor(input.id),
      encryptionEvidenceRef: null,
    })
    expect(pending.preEgressRecordedAt).toEqual(NOW)

    // Exact retry after an ambiguous outcome is a no-op, so a caller that
    // does not know whether its write landed can simply repeat it.
    const replay = await repository.recordPreEgressEvidence({
      ...evidence,
      now: new Date(NOW.getTime() + 1000),
    })
    expect(replay).toEqual(pending)

    // A DIFFERENT archive claiming the same revision means a second bundle
    // was built for one historical request.
    await expect(
      repository.recordPreEgressEvidence({ ...evidence, archiveSha256: 'd'.repeat(64) }),
    ).rejects.toThrow(/already bound/)
    await expect(
      repository.recordPreEgressEvidence({
        ...evidence,
        objectKey: objectKeyFor(randomUUID()),
      }),
    ).rejects.toThrow(/already bound/)

    // Completion may only confirm the persisted digests, never replace them.
    await expect(
      repository.completeGeneration({
        id: input.id,
        expectedRevision: pending.revision,
        coverageSha256: 'e'.repeat(64),
        manifestSha256: MANIFEST_SHA,
        archiveSha256: ARCHIVE_SHA,
        objectKey: objectKeyFor(input.id),
        encryptionEvidenceRef: `s3:aes256:${ARCHIVE_SHA}`,
        now: NOW,
      }),
    ).rejects.toThrow(/does not match/)

    const stored = await lease.pool.query(
      `SELECT state, coverage_sha256, archive_sha256, encryption_evidence_ref
       FROM organization_exports WHERE id = $1`,
      [input.id],
    )
    expect(stored.rows[0]).toEqual({
      state: 'egress_pending',
      coverage_sha256: COVERAGE_SHA,
      archive_sha256: ARCHIVE_SHA,
      encryption_evidence_ref: null,
    })
  })

  it('re-claims an expired egress_pending lease in place so recovery never rebuilds', async () => {
    const input = await requestInput()
    await repository.request(input)
    const claimed = await repository.claimNextGeneration({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 1000),
    })
    await repository.recordPreEgressEvidence({
      id: input.id,
      expectedRevision: claimed!.revision,
      coverageSha256: COVERAGE_SHA,
      manifestSha256: MANIFEST_SHA,
      archiveSha256: ARCHIVE_SHA,
      objectKey: objectKeyFor(input.id),
      now: NOW,
    })

    // The process is killed here — the upload outcome is unknown.
    const resumed = await repository.claimNextGeneration({
      now: new Date(NOW.getTime() + 2000),
      leaseExpiresAt: new Date(NOW.getTime() + 3000),
    })

    expect(resumed).toMatchObject({
      id: input.id,
      // Never back to 'generating': that would license rebuilding a later
      // live snapshot and presenting it as the original archive.
      state: 'egress_pending',
      revision: 4,
      coverageSha256: COVERAGE_SHA,
      manifestSha256: MANIFEST_SHA,
      archiveSha256: ARCHIVE_SHA,
      objectKey: objectKeyFor(input.id),
      egressRecoveryAttempts: 1,
    })

    const ready = await repository.completeGeneration({
      id: input.id,
      expectedRevision: resumed!.revision,
      coverageSha256: COVERAGE_SHA,
      manifestSha256: MANIFEST_SHA,
      archiveSha256: ARCHIVE_SHA,
      objectKey: objectKeyFor(input.id),
      encryptionEvidenceRef: `s3:aes256:${ARCHIVE_SHA}`,
      now: new Date(NOW.getTime() + 3000),
    })
    expect(ready).toMatchObject({ state: 'ready', revision: 5 })
  })

  it('retains pre-egress digests when generation fails after evidence was committed', async () => {
    const input = await requestInput()
    await repository.request(input)
    const claimed = await repository.claimNextGeneration({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 1000),
    })
    const pending = await repository.recordPreEgressEvidence({
      id: input.id,
      expectedRevision: claimed!.revision,
      coverageSha256: COVERAGE_SHA,
      manifestSha256: MANIFEST_SHA,
      archiveSha256: ARCHIVE_SHA,
      objectKey: objectKeyFor(input.id),
      now: NOW,
    })

    await repository.failGeneration({
      id: input.id,
      expectedRevision: pending.revision,
      errorCode: 'egress_evidence_mismatch',
      now: new Date(NOW.getTime() + 1000),
    })

    const rows = await lease.pool.query(
      `SELECT state, last_error_code, coverage_sha256, manifest_sha256,
              archive_sha256, object_key, encryption_evidence_ref
       FROM organization_exports WHERE id = $1`,
      [input.id],
    )
    // The digests are the evidence of what this request produced; a failure
    // must not erase them.
    expect(rows.rows[0]).toEqual({
      state: 'failed',
      last_error_code: 'egress_evidence_mismatch',
      coverage_sha256: COVERAGE_SHA,
      manifest_sha256: MANIFEST_SHA,
      archive_sha256: ARCHIVE_SHA,
      object_key: objectKeyFor(input.id),
      encryption_evidence_ref: null,
    })
  })

  it('refuses a direct-SQL jump from generating straight to ready', async () => {
    const input = await requestInput()
    await repository.request(input)
    await repository.claimNextGeneration({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 1000),
    })

    await expect(
      lease.pool.query(
        `UPDATE organization_exports
         SET state = 'ready', revision = revision + 1,
             generation_lease_expires_at = NULL,
             coverage_sha256 = $2, manifest_sha256 = $3, archive_sha256 = $4,
             object_key = $5, encryption_evidence_ref = $6, updated_at = now()
         WHERE id = $1`,
        [
          input.id,
          COVERAGE_SHA,
          MANIFEST_SHA,
          ARCHIVE_SHA,
          objectKeyFor(input.id),
          `s3:aes256:${ARCHIVE_SHA}`,
        ],
      ),
    ).rejects.toThrow(/invalid organization export state transition/)
  })

  it('replaces an expired retrieval authority while the encrypted object remains valid', async () => {
    const input = await requestInput()
    await repository.request(input)
    const claimed = await repository.claimNextGeneration({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 1000),
    })
    await publishReady(input.id, claimed!.revision)
    await expect(
      lease.pool.query(
        `INSERT INTO organization_export_retrieval_issuances (
           export_id, organization_id, export_revision, operation_id,
           token_digest, issued_at, expires_at, created_at
         ) VALUES ($1, $2, 5, $3, $4, $5, $6, $5)`,
        [
          input.id,
          input.organizationId,
          randomUUID(),
          '9'.repeat(64),
          NOW,
          new Date(NOW.getTime() + 1000),
        ],
      ),
    ).rejects.toThrow(/was not co-committed/)
    const firstOperationId = randomUUID()
    const first = await repository.issueRetrieval({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: input.requestedBy,
      operationId: firstOperationId,
      tokenDigest: 'd'.repeat(64),
      expiresAt: new Date(NOW.getTime() + 1000),
      now: NOW,
    })
    expect(first).toMatchObject({ state: 'retrieval_issued', revision: 5 })

    const reissuedAt = new Date(NOW.getTime() + 1000)
    await expect(
      repository.issueRetrieval({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: input.requestedBy,
        operationId: firstOperationId,
        tokenDigest: 'd'.repeat(64),
        expiresAt: new Date(reissuedAt.getTime() + 24 * 60 * 60 * 1000),
        now: reissuedAt,
      }),
    ).rejects.toThrow(/must rotate authority/)
    const secondOperationId = randomUUID()
    const secondExpiresAt = new Date(reissuedAt.getTime() + 1000)
    const second = await repository.issueRetrieval({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: input.requestedBy,
      operationId: secondOperationId,
      tokenDigest: 'e'.repeat(64),
      expiresAt: secondExpiresAt,
      now: reissuedAt,
    })
    expect(second).toMatchObject({
      state: 'retrieval_issued',
      revision: 6,
      retrievalOperationId: secondOperationId,
      retrievalTokenDigest: 'e'.repeat(64),
    })
    await expect(
      repository.consumeRetrieval({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: input.requestedBy,
        tokenDigest: 'd'.repeat(64),
        now: new Date(reissuedAt.getTime() + 1),
      }),
    ).rejects.toThrow(/unavailable/)

    await expect(
      lease.pool.query(
        `UPDATE organization_exports
         SET revision = revision + 1,
             retrieval_operation_id = $2,
             retrieval_token_digest = $3,
             retrieval_issued_at = $4,
             retrieval_expires_at = $5,
             updated_at = $4
         WHERE id = $1`,
        [
          input.id,
          firstOperationId,
          'd'.repeat(64),
          secondExpiresAt,
          new Date(secondExpiresAt.getTime() + 1000),
        ],
      ),
    ).rejects.toThrow(/issuance evidence is missing/)
    await expect(
      repository.issueRetrieval({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: input.requestedBy,
        operationId: firstOperationId,
        tokenDigest: 'd'.repeat(64),
        expiresAt: new Date(secondExpiresAt.getTime() + 1000),
        now: secondExpiresAt,
      }),
    ).rejects.toThrow(/already issued/)

    const thirdOperationId = randomUUID()
    const third = await repository.issueRetrieval({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: input.requestedBy,
      operationId: thirdOperationId,
      tokenDigest: 'f'.repeat(64),
      expiresAt: new Date(secondExpiresAt.getTime() + 1000),
      now: secondExpiresAt,
    })
    expect(third).toMatchObject({
      state: 'retrieval_issued',
      revision: 7,
      retrievalOperationId: thirdOperationId,
      retrievalTokenDigest: 'f'.repeat(64),
    })
    await expect(
      repository.consumeRetrieval({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: input.requestedBy,
        tokenDigest: 'f'.repeat(64),
        now: new Date(secondExpiresAt.getTime() + 1),
      }),
    ).resolves.toMatchObject({ state: 'retrieved', revision: 8 })

    const history = await lease.pool.query(
      `SELECT operation_id, token_digest
       FROM organization_export_retrieval_issuances
       WHERE export_id = $1
       ORDER BY export_revision`,
      [input.id],
    )
    expect(history.rows).toEqual([
      { operation_id: firstOperationId, token_digest: 'd'.repeat(64) },
      { operation_id: secondOperationId, token_digest: 'e'.repeat(64) },
      { operation_id: thirdOperationId, token_digest: 'f'.repeat(64) },
    ])
    await expect(
      lease.pool.query(
        `UPDATE organization_export_retrieval_issuances
         SET token_digest = $2
         WHERE export_id = $1 AND operation_id = $3`,
        [input.id, 'a'.repeat(64), firstOperationId],
      ),
    ).rejects.toThrow(/append-only/)
    await expect(
      lease.pool.query(
        `DELETE FROM organization_export_retrieval_issuances
         WHERE export_id = $1`,
        [input.id],
      ),
    ).rejects.toThrow(/append-only/)
    await expect(
      lease.pool.query('TRUNCATE organization_export_retrieval_issuances'),
    ).rejects.toThrow(/append-only/)
  })

  it('moves an expired object through deletion pending to verified deletion', async () => {
    const input = await requestInput()
    await repository.request(input)
    const claimed = await repository.claimNextGeneration({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 1000),
    })
    await publishReady(input.id, claimed!.revision, new Date(NOW.getTime() + 1000))
    const pending = await repository.claimNextExpiredDeletion({
      now: input.objectExpiresAt,
    })
    expect(pending).toMatchObject({ state: 'delete_pending', revision: 5 })
    await repository.completeDeletion({
      id: input.id,
      expectedRevision: pending!.revision,
      deletionEvidenceRef: `s3:delete-verified:${input.id}`,
      now: input.objectExpiresAt,
    })
    const rows = await lease.pool.query(
      'SELECT state, revision, deleted_at FROM organization_exports WHERE id = $1',
      [input.id],
    )
    expect(rows.rows[0]).toMatchObject({ state: 'deleted', revision: 6 })
    expect(rows.rows[0]!.deleted_at).toEqual(input.objectExpiresAt)
  })

  it('rechecks current AccountAdmin authority in the same transaction as request and retrieval access', async () => {
    const deniedRequest = await requestInput()
    await addBackupOwner(deniedRequest.organizationId)
    await lease.pool.query('UPDATE member SET role = $1 WHERE "userId" = $2', [
      'admin',
      deniedRequest.requestedBy,
    ])
    await expect(repository.request(deniedRequest)).rejects.toThrow(
      /current AccountAdmin/,
    )

    const input = await requestInput()
    await repository.request(input)
    const claimed = await repository.claimNextGeneration({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 1000),
    })
    await publishReady(input.id, claimed!.revision, new Date(NOW.getTime() + 1000))
    const operationId = randomUUID()
    await repository.issueRetrieval({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: input.requestedBy,
      operationId,
      tokenDigest: 'd'.repeat(64),
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      now: NOW,
    })
    await addBackupOwner(input.organizationId)
    await lease.pool.query('UPDATE member SET role = $1 WHERE "userId" = $2', [
      'admin',
      input.requestedBy,
    ])
    await expect(
      repository.consumeRetrieval({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: input.requestedBy,
        tokenDigest: 'd'.repeat(64),
        now: new Date(NOW.getTime() + 2000),
      }),
    ).rejects.toThrow(/current AccountAdmin/)
  })
})

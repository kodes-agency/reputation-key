import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  OrganizationExportRepository,
  OrganizationExportStatus,
} from '../ports/organization-export.port'
import type { OrganizationExportBundle } from '../organization-export-contract'
import {
  ORGANIZATION_EXPORT_FORMAT_VERSION,
  ORGANIZATION_EXPORT_LINK_TTL_MS,
  ORGANIZATION_EXPORT_OBJECT_TTL_MS,
} from '../organization-export-contract'
import { createOrganizationExportService } from './organization-export'

const NOW = new Date('2026-08-28T12:00:00.000Z')
const REQUEST_ID = '18deca2e-91a7-46e4-b92b-73163568ed84'
const ARCHIVE = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])
const ARCHIVE_SHA = createHash('sha256').update(ARCHIVE).digest('hex')
/** States that exist before any pre-egress evidence has been committed. */
const PRE_EGRESS_STATES = new Set<OrganizationExportStatus['state']>([
  'requested',
  'generating',
])

function status(
  state: OrganizationExportStatus['state'],
  revision: number,
  overrides: Partial<OrganizationExportStatus> = {},
): OrganizationExportStatus {
  return {
    id: REQUEST_ID,
    organizationId: 'org-1',
    requestedBy: 'admin-1',
    state,
    revision,
    asOf: NOW,
    objectExpiresAt: new Date(NOW.getTime() + ORGANIZATION_EXPORT_OBJECT_TTL_MS),
    generationLeaseExpiresAt: null,
    coverageSha256: PRE_EGRESS_STATES.has(state) ? null : 'b'.repeat(64),
    manifestSha256: PRE_EGRESS_STATES.has(state) ? null : 'c'.repeat(64),
    archiveSha256: PRE_EGRESS_STATES.has(state) ? null : ARCHIVE_SHA,
    objectKey: PRE_EGRESS_STATES.has(state)
      ? null
      : `private/organization-exports/${REQUEST_ID}.zip`,
    encryptionEvidenceRef:
      PRE_EGRESS_STATES.has(state) || state === 'egress_pending' ? null : 's3:kms:key-v1',
    retrievalOperationId: null,
    retrievalTokenDigest: null,
    retrievalExpiresAt: null,
    retrievedAt: null,
    deletedAt: null,
    lastErrorCode: null,
    preEgressRecordedAt: PRE_EGRESS_STATES.has(state) ? null : NOW,
    egressRecoveryAttempts: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function repository() {
  let current = status('requested', 1)
  let consumed = false
  const value: OrganizationExportRepository = {
    findCurrentForOrganization: vi.fn(async () => current),
    request: vi.fn(async (input) => {
      current = status('requested', 1, {
        id: input.id,
        organizationId: input.organizationId,
        requestedBy: input.requestedBy,
        asOf: input.asOf,
        objectExpiresAt: input.objectExpiresAt,
      })
      return current
    }),
    claimNextGeneration: vi.fn(async ({ leaseExpiresAt }) => {
      current = status('generating', 2, { generationLeaseExpiresAt: leaseExpiresAt })
      return current
    }),
    recordPreEgressEvidence: vi.fn(async (input) => {
      current = status('egress_pending', 3, {
        generationLeaseExpiresAt: current.generationLeaseExpiresAt,
        coverageSha256: input.coverageSha256,
        manifestSha256: input.manifestSha256,
        archiveSha256: input.archiveSha256,
        objectKey: input.objectKey,
        preEgressRecordedAt: input.now,
      })
      return current
    }),
    completeGeneration: vi.fn(async () => {
      current = status('ready', 4)
      return current
    }),
    failGeneration: vi.fn(async () => {}),
    issueRetrieval: vi.fn(async (input) => {
      current = status('retrieval_issued', 4, {
        retrievalTokenDigest: input.tokenDigest,
        retrievalOperationId: input.operationId,
        retrievalExpiresAt: input.expiresAt,
      })
      return current
    }),
    consumeRetrieval: vi.fn(async (input) => {
      if (consumed || current.retrievalTokenDigest !== input.tokenDigest) {
        throw new Error('retrieval unavailable')
      }
      consumed = true
      current = status('retrieved', 5, {
        retrievalTokenDigest: null,
        retrievalOperationId: current.retrievalOperationId,
        retrievalExpiresAt: null,
        retrievedAt: input.now,
      })
      return current
    }),
    claimNextExpiredDeletion: vi.fn(async () => {
      current = status('delete_pending', 6)
      return current
    }),
    completeDeletion: vi.fn(async () => {}),
  }
  return value
}

const bundle: OrganizationExportBundle = {
  version: ORGANIZATION_EXPORT_FORMAT_VERSION,
  asOf: NOW,
  coverageSha256: 'b'.repeat(64),
  manifestSha256: 'c'.repeat(64),
  entries: [
    {
      path: 'manifest.json',
      mediaType: 'application/json',
      classification: 'tenant_visible',
      bytes: Buffer.from('{}'),
    },
  ],
  manifest: {
    version: ORGANIZATION_EXPORT_FORMAT_VERSION,
    asOf: NOW.toISOString(),
    entries: [],
  },
}

function harness(input: { authorized?: boolean; archive?: Uint8Array } = {}) {
  const repo = repository()
  const storage = {
    putEncrypted: vi.fn(async () => ({
      outcome: 'stored' as const,
      encryptionEvidenceRef: 's3:kms:key-v1',
    })),
    verifyStored: vi.fn(async () => ({
      outcome: 'present_exact' as const,
      encryptionEvidenceRef: 's3:kms:key-v1',
    })),
    readEncrypted: vi.fn(async () => input.archive ?? ARCHIVE),
    delete: vi.fn(async () => ({ deletionEvidenceRef: 's3:deleted:request-1' })),
  }
  return {
    repo,
    storage,
    value: createOrganizationExportService({
      repository: repo,
      contributors: [],
      archiveWriter: { writeZip: vi.fn(async () => input.archive ?? ARCHIVE) },
      storage,
      authority: {
        isCurrentAccountAdmin: vi.fn(async () => input.authorized ?? true),
      },
      deriveRetrievalSecret: () =>
        Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      clock: () => NOW,
      buildBundle: vi.fn(async () => bundle),
    }),
  }
}

describe('Organization Export service', () => {
  it('accepts requests only from a current AccountAdmin and fixes seven-day expiry', async () => {
    const allowed = harness()
    await expect(
      allowed.value.request({
        requestId: REQUEST_ID,
        organizationId: 'org-1',
        actorUserId: 'admin-1',
      }),
    ).resolves.toMatchObject({ state: 'requested' })
    expect(allowed.repo.request).toHaveBeenCalledWith(
      expect.objectContaining({
        asOf: NOW,
        objectExpiresAt: new Date(NOW.getTime() + ORGANIZATION_EXPORT_OBJECT_TTL_MS),
      }),
    )

    const denied = harness({ authorized: false })
    await expect(
      denied.value.request({
        requestId: REQUEST_ID,
        organizationId: 'org-1',
        actorUserId: 'manager-1',
      }),
    ).rejects.toThrow(/current AccountAdmin/)
    expect(denied.repo.request).not.toHaveBeenCalled()
  })

  it('stores only a private ZIP through the encryption-required storage seam', async () => {
    const flow = harness()

    await expect(flow.value.generateNext()).resolves.toMatchObject({
      request: { state: 'ready' },
    })
    expect(flow.storage.putEncrypted).toHaveBeenCalledWith({
      objectKey: `private/organization-exports/${REQUEST_ID}.zip`,
      bytes: ARCHIVE,
      archiveSha256: ARCHIVE_SHA,
      contentType: 'application/zip',
      deleteAfter: new Date(NOW.getTime() + ORGANIZATION_EXPORT_OBJECT_TTL_MS),
    })
    expect(flow.repo.completeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        archiveSha256: ARCHIVE_SHA,
        manifestSha256: 'c'.repeat(64),
        encryptionEvidenceRef: 's3:kms:key-v1',
      }),
    )
  })

  it('commits pre-egress evidence before the archive leaves the process', async () => {
    const flow = harness()
    const calls: string[] = []
    // The ports are Readonly, so order is observed by wrapping rather than by
    // assigning onto the frozen harness objects.
    const recordPreEgressEvidence = vi.fn<typeof flow.repo.recordPreEgressEvidence>(
      async (input) => {
        calls.push('recordPreEgressEvidence')
        return status('egress_pending', 3, {
          generationLeaseExpiresAt: new Date(NOW.getTime() + 900_000),
          objectKey: input.objectKey,
          preEgressRecordedAt: input.now,
        })
      },
    )
    const repository = { ...flow.repo, recordPreEgressEvidence }
    const put = flow.storage.putEncrypted
    const storage = {
      ...flow.storage,
      putEncrypted: vi.fn(async (...args: Parameters<typeof put>) => {
        calls.push('putEncrypted')
        return put(...args)
      }) as typeof put,
    }

    const generated = await createOrganizationExportService({
      repository,
      contributors: [],
      archiveWriter: { writeZip: vi.fn(async () => ARCHIVE) },
      storage,
      authority: { isCurrentAccountAdmin: vi.fn(async () => true) },
      deriveRetrievalSecret: () =>
        Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      clock: () => NOW,
      buildBundle: vi.fn(async () => bundle),
    }).generateNext()

    // Order is the whole point: the digests must be durable BEFORE egress, or
    // a crash right after the upload leaves untracked bytes in the bucket.
    expect(calls).toEqual(['recordPreEgressEvidence', 'putEncrypted'])
    expect(recordPreEgressEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 2,
        archiveSha256: ARCHIVE_SHA,
        coverageSha256: 'b'.repeat(64),
        manifestSha256: 'c'.repeat(64),
        objectKey: `private/organization-exports/${REQUEST_ID}.zip`,
      }),
    )
    expect(generated?.recovered).toBe(false)
    expect(generated?.bundle).toBe(bundle)
  })

  it('rejects a writer that does not return ZIP bytes and records a content-free failure', async () => {
    const flow = harness({ archive: Uint8Array.from([1, 2, 3, 4]) })

    await expect(flow.value.generateNext()).rejects.toThrow(/did not produce a ZIP/)
    expect(flow.storage.putEncrypted).not.toHaveBeenCalled()
    expect(flow.repo.failGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'invalid_archive' }),
    )
  })

  it('issues a 256-bit, digest-only 24-hour token and consumes it exactly once', async () => {
    const flow = harness()
    const issued = await flow.value.issueRetrieval({
      requestId: REQUEST_ID,
      operationId: 'c0f7b313-9f89-4b76-8693-dba1259af489',
      organizationId: 'org-1',
      actorUserId: 'admin-1',
    })

    expect(issued.expiresAt).toEqual(
      new Date(NOW.getTime() + ORGANIZATION_EXPORT_LINK_TTL_MS),
    )
    expect(issued.token).not.toHaveLength(64)
    expect(flow.repo.issueRetrieval).toHaveBeenCalledWith(
      expect.objectContaining({ tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    )
    expect(flow.repo.issueRetrieval).not.toHaveBeenCalledWith(
      expect.objectContaining({ tokenDigest: issued.token }),
    )

    await expect(
      flow.value.retrieve({
        requestId: REQUEST_ID,
        organizationId: 'org-1',
        actorUserId: 'admin-1',
        token: issued.token,
      }),
    ).resolves.toEqual(ARCHIVE)
    await expect(
      flow.value.retrieve({
        requestId: REQUEST_ID,
        organizationId: 'org-1',
        actorUserId: 'admin-1',
        token: issued.token,
      }),
    ).rejects.toThrow(/retrieval unavailable/)
  })

  it('deletes expired storage before recording content-free deletion evidence', async () => {
    const flow = harness()

    await expect(flow.value.purgeNextExpired()).resolves.toBe(true)
    expect(flow.storage.delete).toHaveBeenCalledWith(
      `private/organization-exports/${REQUEST_ID}.zip`,
    )
    expect(flow.repo.completeDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ deletionEvidenceRef: 's3:deleted:request-1' }),
    )
  })
})

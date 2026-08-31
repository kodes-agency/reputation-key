// LIF-01-T2 — post-upload / pre-completion crash recovery.
//
// The blocker this proves closed: a process killed between `putEncrypted`
// resolving and `completeGeneration` committing leaves encrypted bytes in the
// object store that PostgreSQL knows nothing about. With durable pre-egress
// evidence, the next claim resumes from the persisted digests, asks the store
// whether that exact archive is present, and converges without ever building
// a second bundle. A later live snapshot is NOT proof of what was exported.

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  OrganizationExportRepository,
  OrganizationExportStatus,
  OrganizationExportStorage,
} from '../ports/organization-export.port'
import type { OrganizationExportBundle } from '../organization-export-contract'
import {
  ORGANIZATION_EXPORT_FORMAT_VERSION,
  ORGANIZATION_EXPORT_OBJECT_TTL_MS,
} from '../organization-export-contract'
import { createOrganizationExportService } from './organization-export'

const NOW = new Date('2026-08-28T12:00:00.000Z')
const REQUEST_ID = '18deca2e-91a7-46e4-b92b-73163568ed84'
const OBJECT_KEY = `private/organization-exports/${REQUEST_ID}.zip`
const ARCHIVE = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])
const ARCHIVE_SHA = createHash('sha256').update(ARCHIVE).digest('hex')
const COVERAGE_SHA = 'b'.repeat(64)
const MANIFEST_SHA = 'c'.repeat(64)

/** The archive a LATER live snapshot would produce — never acceptable proof. */
const LATER_ARCHIVE = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9])

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
    coverageSha256: null,
    manifestSha256: null,
    archiveSha256: null,
    objectKey: null,
    encryptionEvidenceRef: null,
    retrievalOperationId: null,
    retrievalTokenDigest: null,
    retrievalExpiresAt: null,
    retrievedAt: null,
    deletedAt: null,
    lastErrorCode: null,
    preEgressRecordedAt: null,
    egressRecoveryAttempts: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** The row a crash between putEncrypted and completeGeneration leaves behind. */
function egressPending(revision: number): OrganizationExportStatus {
  return status('egress_pending', revision, {
    generationLeaseExpiresAt: new Date(NOW.getTime() + 900_000),
    coverageSha256: COVERAGE_SHA,
    manifestSha256: MANIFEST_SHA,
    archiveSha256: ARCHIVE_SHA,
    objectKey: OBJECT_KEY,
    preEgressRecordedAt: new Date(NOW.getTime() - 60_000),
    egressRecoveryAttempts: 1,
  })
}

const laterBundle: OrganizationExportBundle = {
  version: ORGANIZATION_EXPORT_FORMAT_VERSION,
  asOf: NOW,
  coverageSha256: 'd'.repeat(64),
  manifestSha256: 'e'.repeat(64),
  entries: [
    {
      path: 'manifest.json',
      mediaType: 'application/json',
      classification: 'tenant_visible',
      bytes: Buffer.from('{"later":true}'),
    },
  ],
  manifest: {
    version: ORGANIZATION_EXPORT_FORMAT_VERSION,
    asOf: NOW.toISOString(),
    entries: [],
  },
}

function harness(
  options: Readonly<{
    claimed: OrganizationExportStatus
    verify: Awaited<ReturnType<OrganizationExportStorage['verifyStored']>>
  }>,
) {
  let persisted = options.claimed
  const repo = {
    request: vi.fn(),
    claimNextGeneration: vi.fn(async () => persisted),
    recordPreEgressEvidence: vi.fn(async () => {
      throw new Error('recovery must not re-record pre-egress evidence')
    }),
    completeGeneration: vi.fn(async (input) => {
      persisted = status('ready', input.expectedRevision + 1, {
        coverageSha256: input.coverageSha256,
        manifestSha256: input.manifestSha256,
        archiveSha256: input.archiveSha256,
        objectKey: input.objectKey,
        encryptionEvidenceRef: input.encryptionEvidenceRef,
        preEgressRecordedAt: options.claimed.preEgressRecordedAt,
      })
      return persisted
    }),
    failGeneration: vi.fn(async () => {}),
    issueRetrieval: vi.fn(),
    consumeRetrieval: vi.fn(),
    claimNextExpiredDeletion: vi.fn(),
    completeDeletion: vi.fn(),
  } as unknown as OrganizationExportRepository & {
    claimNextGeneration: ReturnType<typeof vi.fn>
    completeGeneration: ReturnType<typeof vi.fn>
    failGeneration: ReturnType<typeof vi.fn>
    recordPreEgressEvidence: ReturnType<typeof vi.fn>
  }
  const storage = {
    putEncrypted: vi.fn(async () => ({
      outcome: 'stored' as const,
      encryptionEvidenceRef: 's3:aes256:unexpected',
    })),
    verifyStored: vi.fn(async () => options.verify),
    readEncrypted: vi.fn(async () => ARCHIVE),
    delete: vi.fn(async () => ({ deletionEvidenceRef: 's3:deleted:request-1' })),
  }
  const buildBundle = vi.fn(async () => laterBundle)
  const writeZip = vi.fn(async () => LATER_ARCHIVE)
  return {
    repo,
    storage,
    buildBundle,
    writeZip,
    service: createOrganizationExportService({
      repository: repo,
      contributors: [],
      archiveWriter: { writeZip },
      storage: storage as unknown as OrganizationExportStorage,
      authority: { isCurrentAccountAdmin: vi.fn(async () => true) },
      deriveRetrievalSecret: () =>
        Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      clock: () => NOW,
      buildBundle,
    }),
  }
}

describe('Organization Export generation recovery', () => {
  it('resumes from persisted pre-egress digests and completes with the original evidence', async () => {
    const flow = harness({
      claimed: egressPending(5),
      verify: { outcome: 'present_exact', encryptionEvidenceRef: 's3:aes256:verified' },
    })

    const generated = await flow.service.generateNext()

    expect(flow.storage.verifyStored).toHaveBeenCalledWith({
      objectKey: OBJECT_KEY,
      archiveSha256: ARCHIVE_SHA,
    })
    expect(flow.storage.putEncrypted).not.toHaveBeenCalled()
    expect(flow.repo.completeGeneration).toHaveBeenCalledWith({
      id: REQUEST_ID,
      expectedRevision: 5,
      coverageSha256: COVERAGE_SHA,
      manifestSha256: MANIFEST_SHA,
      archiveSha256: ARCHIVE_SHA,
      objectKey: OBJECT_KEY,
      encryptionEvidenceRef: 's3:aes256:verified',
      now: NOW,
    })
    expect(generated?.request).toMatchObject({
      state: 'ready',
      coverageSha256: COVERAGE_SHA,
      manifestSha256: MANIFEST_SHA,
      archiveSha256: ARCHIVE_SHA,
    })
    expect(generated?.recovered).toBe(true)
    expect(generated?.bundle).toBeNull()
  })

  it('never rebuilds a bundle on the recovery path', async () => {
    const flow = harness({
      claimed: egressPending(5),
      verify: { outcome: 'present_exact', encryptionEvidenceRef: 's3:aes256:verified' },
    })

    await flow.service.generateNext()

    // A rebuild here would hand the tenant a LATER live snapshot while
    // claiming it is the archive the original request produced.
    expect(flow.buildBundle).toHaveBeenCalledTimes(0)
    expect(flow.writeZip).toHaveBeenCalledTimes(0)
    expect(flow.repo.recordPreEgressEvidence).toHaveBeenCalledTimes(0)
  })

  it('fails closed when the stored object is absent, keeping the recorded digests', async () => {
    const flow = harness({ claimed: egressPending(5), verify: { outcome: 'absent' } })

    await expect(flow.service.generateNext()).rejects.toThrow(/absent/u)
    expect(flow.repo.failGeneration).toHaveBeenCalledWith({
      id: REQUEST_ID,
      expectedRevision: 5,
      errorCode: 'egress_evidence_mismatch',
      now: NOW,
    })
    expect(flow.repo.completeGeneration).not.toHaveBeenCalled()
    expect(flow.buildBundle).not.toHaveBeenCalled()
    // failGeneration carries no digest arguments at all, so the persisted
    // pre-egress evidence cannot be overwritten by the failure path.
    const failure = flow.repo.failGeneration.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(failure).sort()).toEqual([
      'errorCode',
      'expectedRevision',
      'id',
      'now',
    ])
  })

  it('fails closed on a checksum mismatch rather than republishing other bytes', async () => {
    const flow = harness({ claimed: egressPending(7), verify: { outcome: 'mismatch' } })

    await expect(flow.service.generateNext()).rejects.toThrow(/mismatch/u)
    expect(flow.repo.failGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'egress_evidence_mismatch' }),
    )
    expect(flow.repo.completeGeneration).not.toHaveBeenCalled()
    expect(flow.storage.putEncrypted).not.toHaveBeenCalled()
    expect(flow.buildBundle).not.toHaveBeenCalled()
  })

  it('refuses to resume an egress_pending row whose evidence is incomplete', async () => {
    const flow = harness({
      claimed: status('egress_pending', 5, {
        generationLeaseExpiresAt: new Date(NOW.getTime() + 900_000),
        coverageSha256: COVERAGE_SHA,
        manifestSha256: MANIFEST_SHA,
        archiveSha256: null,
        objectKey: OBJECT_KEY,
        preEgressRecordedAt: NOW,
      }),
      verify: { outcome: 'present_exact', encryptionEvidenceRef: 's3:aes256:verified' },
    })

    await expect(flow.service.generateNext()).rejects.toThrow(
      /pre-egress evidence is incomplete/u,
    )
    expect(flow.storage.verifyStored).not.toHaveBeenCalled()
    expect(flow.buildBundle).not.toHaveBeenCalled()
  })

  it('still builds normally when the claim is a fresh generating request', async () => {
    const flow = harness({
      claimed: status('generating', 2, {
        generationLeaseExpiresAt: new Date(NOW.getTime() + 900_000),
      }),
      verify: { outcome: 'present_exact', encryptionEvidenceRef: 's3:aes256:verified' },
    })
    flow.repo.recordPreEgressEvidence = vi.fn(async () => egressPending(3))

    await flow.service.generateNext()

    expect(flow.buildBundle).toHaveBeenCalledTimes(1)
    expect(flow.storage.verifyStored).not.toHaveBeenCalled()
    expect(flow.repo.recordPreEgressEvidence).toHaveBeenCalledTimes(1)
  })
})

import { createHash } from 'node:crypto'
import {
  buildOrganizationExportBundle,
  ORGANIZATION_EXPORT_LINK_TTL_MS,
  ORGANIZATION_EXPORT_OBJECT_TTL_MS,
} from '../organization-export-contract'
import type {
  GeneratedOrganizationExport,
  OrganizationExportServiceDeps,
  OrganizationExportStatus,
} from '../ports/organization-export.port'
import { validateLifecycleEvidenceRef } from '../../domain/organization-lifecycle'

const GENERATION_LEASE_MS = 15 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256 = /^[a-f0-9]{64}$/u

export type CreateOrganizationExportServiceInput = Readonly<{
  organizationId: string
  actorUserId: string
}>

export type CreateOrganizationExportServiceDeps = OrganizationExportServiceDeps

function tokenDigest(token: string): string {
  return createHash('sha256')
    .update('repkey:organization-export-retrieval:v1\0', 'utf8')
    .update(token, 'utf8')
    .digest('hex')
}

function archiveDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertZip(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new Error('Organization Export writer did not produce a ZIP archive')
  }
}

function assertRequestId(value: string): string {
  if (!UUID.test(value)) throw new Error('Organization Export request id must be a UUID')
  return value
}

export const createOrganizationExportService = (
  deps: CreateOrganizationExportServiceDeps,
) => {
  const requireAccountAdmin = async (organizationId: string, actorUserId: string) => {
    if (
      !(await deps.authority.isCurrentAccountAdmin({
        organizationId,
        actorUserId,
      }))
    ) {
      throw new Error('A current AccountAdmin is required for Organization Export')
    }
  }

  const request = async (
    input: CreateOrganizationExportServiceInput & Readonly<{ requestId: string }>,
  ): Promise<OrganizationExportStatus> => {
    await requireAccountAdmin(input.organizationId, input.actorUserId)
    const now = deps.clock()
    return deps.repository.request({
      id: assertRequestId(input.requestId),
      organizationId: input.organizationId,
      requestedBy: input.actorUserId,
      asOf: now,
      objectExpiresAt: new Date(now.getTime() + ORGANIZATION_EXPORT_OBJECT_TTL_MS),
    })
  }

  /** One bounded background claim; storage is private and encryption-required. */
  const generateNext = async (): Promise<GeneratedOrganizationExport | null> => {
    const now = deps.clock()
    const request = await deps.repository.claimNextGeneration({
      now,
      leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
    })
    if (!request) return null

    let storageStarted = false
    try {
      const bundle = await (deps.buildBundle ?? buildOrganizationExportBundle)({
        organizationId: request.organizationId,
        requestId: request.id,
        asOf: request.asOf,
        contributors: deps.contributors,
      })
      const archive = await deps.archiveWriter.writeZip(bundle.entries)
      assertZip(archive)
      const archiveSha256 = archiveDigest(archive)
      const objectKey = `private/organization-exports/${request.id}.zip`
      storageStarted = true
      const stored = await deps.storage.putEncrypted({
        objectKey,
        bytes: archive,
        archiveSha256,
        contentType: 'application/zip',
        deleteAfter: request.objectExpiresAt,
      })
      const completed = await deps.repository.completeGeneration({
        id: request.id,
        expectedRevision: request.revision,
        coverageSha256: bundle.coverageSha256,
        manifestSha256: bundle.manifestSha256,
        archiveSha256,
        objectKey,
        encryptionEvidenceRef: validateLifecycleEvidenceRef(stored.encryptionEvidenceRef),
        now: deps.clock(),
      })
      return { request: completed, bundle }
    } catch (error) {
      const errorCode =
        error instanceof Error && /ZIP archive/u.test(error.message)
          ? 'invalid_archive'
          : 'generation_failed'
      // Before storage egress the request may end as a safe content-free
      // failure. After egress starts it remains leased/generating so recovery
      // replays the exact deterministic key+checksum; it must not strand an
      // untracked object behind a terminal database state.
      if (!storageStarted) {
        await deps.repository
          .failGeneration({
            id: request.id,
            expectedRevision: request.revision,
            errorCode,
            now: deps.clock(),
          })
          .catch(() => {})
      }
      throw error
    }
  }

  const issueRetrieval = async (
    input: CreateOrganizationExportServiceInput &
      Readonly<{ requestId: string; operationId: string }>,
  ): Promise<{ token: string; expiresAt: Date }> => {
    await requireAccountAdmin(input.organizationId, input.actorUserId)
    const requestId = assertRequestId(input.requestId)
    const operationId = assertRequestId(input.operationId)
    const secret = deps.deriveRetrievalSecret({ requestId, operationId })
    if (secret.byteLength < 32) {
      throw new Error('Organization Export retrieval secret must be at least 256 bits')
    }
    const token = Buffer.from(secret).toString('base64url')
    const now = deps.clock()
    const expiresAt = new Date(now.getTime() + ORGANIZATION_EXPORT_LINK_TTL_MS)
    const issued = await deps.repository.issueRetrieval({
      id: assertRequestId(input.requestId),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      operationId,
      tokenDigest: tokenDigest(token),
      expiresAt,
      now,
    })
    if (!issued.retrievalExpiresAt) {
      throw new Error('Organization Export retrieval expiry was not persisted')
    }
    return { token, expiresAt: issued.retrievalExpiresAt }
  }

  const retrieve = async (
    input: CreateOrganizationExportServiceInput &
      Readonly<{ requestId: string; token: string }>,
  ): Promise<Uint8Array> => {
    await requireAccountAdmin(input.organizationId, input.actorUserId)
    const consumed = await deps.repository.consumeRetrieval({
      id: assertRequestId(input.requestId),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      tokenDigest: tokenDigest(input.token),
      now: deps.clock(),
    })
    if (!consumed.objectKey || !consumed.archiveSha256) {
      throw new Error('Organization Export object evidence is incomplete')
    }
    const archive = await deps.storage.readEncrypted(consumed.objectKey)
    if (
      !SHA256.test(consumed.archiveSha256) ||
      archiveDigest(archive) !== consumed.archiveSha256
    ) {
      throw new Error('Organization Export archive checksum mismatch')
    }
    return archive
  }

  /** Bounded, idempotent storage deletion; never treats expiry as proof. */
  const purgeNextExpired = async (): Promise<boolean> => {
    const now = deps.clock()
    const request = await deps.repository.claimNextExpiredDeletion({ now })
    if (!request) return false
    if (!request.objectKey)
      throw new Error('Expired Organization Export has no object key')
    const deleted = await deps.storage.delete(request.objectKey)
    await deps.repository.completeDeletion({
      id: request.id,
      expectedRevision: request.revision,
      deletionEvidenceRef: validateLifecycleEvidenceRef(deleted.deletionEvidenceRef),
      now: deps.clock(),
    })
    return true
  }

  return Object.freeze({
    request,
    generateNext,
    issueRetrieval,
    retrieve,
    purgeNextExpired,
  })
}

export type CreateOrganizationExportService = ReturnType<
  typeof createOrganizationExportService
>

import type { OrganizationExportBundle } from '../organization-export-contract'
import type {
  OrganizationExportContributor,
  OrganizationExportEntry,
} from './organization-export-contributor.port'

export type OrganizationExportState =
  | 'requested'
  | 'generating'
  /**
   * Durable pre-egress evidence is committed: the coverage/manifest/archive
   * digests and the deterministic object key are persisted, but the upload is
   * not yet confirmed. This is the only state from which `ready` is reachable,
   * so a published archive can never have digests that were unknown before
   * egress.
   */
  | 'egress_pending'
  | 'ready'
  | 'retrieval_issued'
  | 'retrieved'
  | 'delete_pending'
  | 'deleted'
  | 'failed'

export type OrganizationExportStatus = Readonly<{
  id: string
  organizationId: string
  requestedBy: string
  state: OrganizationExportState
  revision: number
  asOf: Date
  objectExpiresAt: Date
  generationLeaseExpiresAt: Date | null
  coverageSha256: string | null
  manifestSha256: string | null
  archiveSha256: string | null
  objectKey: string | null
  encryptionEvidenceRef: string | null
  retrievalOperationId: string | null
  retrievalTokenDigest: string | null
  retrievalExpiresAt: Date | null
  retrievedAt: Date | null
  deletedAt: Date | null
  lastErrorCode: string | null
  preEgressRecordedAt: Date | null
  egressRecoveryAttempts: number
  createdAt: Date
  updatedAt: Date
}>

export type OrganizationExportRepository = Readonly<{
  /** Idempotently binds the caller-provided request id to this exact request. */
  request(input: {
    id: string
    organizationId: string
    requestedBy: string
    asOf: Date
    objectExpiresAt: Date
  }): Promise<OrganizationExportStatus>
  /**
   * LIF-01: the current export status for an Organization.
   *
   * `organization_exports_one_open_per_org_idx` already guarantees at most one
   * OPEN request per Organization, so "current" is unambiguous; when none is
   * open the most recently created terminal row is returned so a tenant can
   * still see that their last export failed or expired. Authorization is the
   * caller's obligation — this is a read.
   */
  findCurrentForOrganization(
    organizationId: string,
  ): Promise<OrganizationExportStatus | null>
  /**
   * Claims a `requested` export, or re-claims a `generating` / `egress_pending`
   * export whose lease expired. An `egress_pending` claim renews the lease in
   * place — it never returns to `generating`, which would license a rebuild.
   */
  claimNextGeneration(input: {
    now: Date
    leaseExpiresAt: Date
  }): Promise<OrganizationExportStatus | null>
  /**
   * Commits the digests and object key BEFORE the archive leaves the process.
   *
   * Compare-and-set on `expectedRevision`. An exact replay is idempotent; the
   * same revision carrying a different digest or key is rejected, because that
   * would mean a second archive was built for one historical request.
   */
  recordPreEgressEvidence(input: {
    id: string
    expectedRevision: number
    coverageSha256: string
    manifestSha256: string
    archiveSha256: string
    objectKey: string
    now: Date
  }): Promise<OrganizationExportStatus>
  /**
   * Publishes an export that already carries durable pre-egress evidence. The
   * supplied digests must equal the persisted ones — they are checked, never
   * written over.
   */
  completeGeneration(input: {
    id: string
    expectedRevision: number
    coverageSha256: string
    manifestSha256: string
    archiveSha256: string
    objectKey: string
    encryptionEvidenceRef: string
    now: Date
  }): Promise<OrganizationExportStatus>
  failGeneration(input: {
    id: string
    expectedRevision: number
    errorCode: string
    now: Date
  }): Promise<void>
  /** Co-commits the digest-only, bounded retrieval authority. */
  issueRetrieval(input: {
    id: string
    organizationId: string
    actorUserId: string
    operationId: string
    tokenDigest: string
    expiresAt: Date
    now: Date
  }): Promise<OrganizationExportStatus>
  /** Atomically consumes an unexpired token and co-commits access audit. */
  consumeRetrieval(input: {
    id: string
    organizationId: string
    actorUserId: string
    tokenDigest: string
    now: Date
  }): Promise<OrganizationExportStatus>
  claimNextExpiredDeletion(input: { now: Date }): Promise<OrganizationExportStatus | null>
  completeDeletion(input: {
    id: string
    expectedRevision: number
    deletionEvidenceRef: string
    now: Date
  }): Promise<void>
}>

export type OrganizationExportArchiveWriter = Readonly<{
  /** Writes a versioned ZIP without changing entry bytes or paths. */
  writeZip(entries: readonly OrganizationExportEntry[]): Promise<Uint8Array>
}>

export type OrganizationExportStorage = Readonly<{
  putEncrypted(input: {
    objectKey: string
    bytes: Uint8Array
    archiveSha256: string
    contentType: 'application/zip'
    deleteAfter: Date
  }): Promise<{
    outcome: 'stored' | 'already_present_exact'
    encryptionEvidenceRef: string
  }>
  /**
   * Answers, without transferring the object, whether the exact archive named
   * by the persisted pre-egress evidence is stored under that key.
   *
   * This is what makes a post-upload/pre-completion crash recoverable: it
   * distinguishes "uploaded but not completed" (`present_exact`) from "never
   * uploaded" (`absent`) and from "some other bytes are there" (`mismatch`),
   * so recovery never has to rebuild a later live snapshot to find out.
   */
  verifyStored(input: {
    objectKey: string
    archiveSha256: string
  }): Promise<
    | Readonly<{ outcome: 'present_exact'; encryptionEvidenceRef: string }>
    | Readonly<{ outcome: 'absent' }>
    | Readonly<{ outcome: 'mismatch' }>
  >
  readEncrypted(objectKey: string): Promise<Uint8Array>
  delete(objectKey: string): Promise<{ deletionEvidenceRef: string }>
}>

export type OrganizationExportAuthority = Readonly<{
  isCurrentAccountAdmin(input: {
    organizationId: string
    actorUserId: string
  }): Promise<boolean>
}>

export type OrganizationExportServiceDeps = Readonly<{
  repository: OrganizationExportRepository
  contributors: readonly OrganizationExportContributor[]
  archiveWriter: OrganizationExportArchiveWriter
  storage: OrganizationExportStorage
  authority: OrganizationExportAuthority
  /** Server-keyed deterministic secret; enables exact retry after ambiguity. */
  deriveRetrievalSecret: (input: { requestId: string; operationId: string }) => Uint8Array
  clock: () => Date
  buildBundle?: typeof import('../organization-export-contract').buildOrganizationExportBundle
}>

export type GeneratedOrganizationExport = Readonly<{
  request: OrganizationExportStatus
  /**
   * `null` on the recovery path. A resumed generation completes from the
   * persisted pre-egress digests and the verified stored object; it must NOT
   * rebuild a bundle, because a later live snapshot is not historical proof
   * of what was exported.
   */
  bundle: OrganizationExportBundle | null
  recovered: boolean
}>

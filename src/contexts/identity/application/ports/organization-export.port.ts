import type {
  OrganizationExportBundle,
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '../organization-export-contract'

export type OrganizationExportState =
  | 'requested'
  | 'generating'
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
  claimNextGeneration(input: {
    now: Date
    leaseExpiresAt: Date
  }): Promise<OrganizationExportStatus | null>
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
  bundle: OrganizationExportBundle
}>

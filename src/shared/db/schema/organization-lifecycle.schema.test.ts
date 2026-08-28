import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  identityOrganizationLifecycleReceipts,
  organizationExportRetrievalIssuances,
  organizationExports,
  organizationLifecycleAuthority,
  organizationLifecycleCommandReceipts,
} from './organization-lifecycle.schema'

describe('Organization lifecycle schema', () => {
  it('keeps lifecycle authority outside Better Auth with explicit terminal semantics', () => {
    expect(Object.keys(organizationLifecycleAuthority)).toEqual(
      expect.arrayContaining([
        'organizationId',
        'state',
        'revision',
        'closureLineageId',
        'closureRequestedAt',
        'recoverableUntil',
        'irreversibleAt',
        'closedAt',
        'reactivationRequired',
        'lastActorId',
        'lastReasonCode',
        'lastSupportEvidenceRef',
      ]),
    )

    const config = getTableConfig(organizationLifecycleAuthority)
    expect(config.checks.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining([
        'organization_lifecycle_state_valid',
        'organization_lifecycle_revision_nonnegative',
        'organization_lifecycle_state_shape',
        'organization_lifecycle_evidence_ref_valid',
      ]),
    )
  })

  it('keeps export content outside PostgreSQL and stores only control-plane evidence', () => {
    expect(Object.keys(organizationExports)).toEqual(
      expect.arrayContaining([
        'organizationId',
        'state',
        'formatVersion',
        'coverageSha256',
        'manifestSha256',
        'archiveSha256',
        'objectKey',
        'encryptionEvidenceRef',
        'retrievalTokenDigest',
        'retrievalExpiresAt',
        'deletedAt',
      ]),
    )
    expect(Object.keys(organizationExports)).not.toEqual(
      expect.arrayContaining(['token', 'archive', 'content', 'email', 'credential']),
    )
    expect(
      getTableConfig(organizationExports).indexes.map((index) => index.config.name),
    ).toEqual(
      expect.arrayContaining([
        'organization_exports_one_open_per_org_idx',
        'organization_exports_generation_idx',
        'organization_exports_expiry_idx',
      ]),
    )
  })

  it('retains content-free command receipts for retry-safe transitions', () => {
    expect(Object.keys(organizationLifecycleCommandReceipts)).toEqual(
      expect.arrayContaining([
        'operationId',
        'organizationId',
        'operation',
        'resultState',
        'resultRevision',
        'closureLineageId',
      ]),
    )
    expect(Object.keys(organizationLifecycleCommandReceipts)).not.toEqual(
      expect.arrayContaining(['reason', 'description', 'note', 'content', 'email']),
    )
  })

  it('binds Identity context work to one content-free receipt per phase revision', () => {
    expect(Object.keys(identityOrganizationLifecycleReceipts)).toEqual(
      expect.arrayContaining([
        'organizationId',
        'closureLineageId',
        'lifecycleRevision',
        'phase',
        'requestFingerprint',
        'outcome',
        'evidenceRef',
        'recoverableUntil',
        'occurredAt',
      ]),
    )
    expect(Object.keys(identityOrganizationLifecycleReceipts)).not.toEqual(
      expect.arrayContaining(['payload', 'content', 'email', 'note', 'reason']),
    )
    const config = getTableConfig(identityOrganizationLifecycleReceipts)
    expect(config.primaryKeys.map((candidate) => candidate.getName())).toEqual([
      'identity_organization_lifecycle_receipts_pk',
    ])
  })

  it('retains each digest-only retrieval authority so an expired token cannot return', () => {
    expect(Object.keys(organizationExportRetrievalIssuances)).toEqual(
      expect.arrayContaining([
        'exportId',
        'organizationId',
        'exportRevision',
        'operationId',
        'tokenDigest',
        'issuedAt',
        'expiresAt',
      ]),
    )
    expect(Object.keys(organizationExportRetrievalIssuances)).not.toEqual(
      expect.arrayContaining(['token', 'secret', 'content', 'email']),
    )
    const config = getTableConfig(organizationExportRetrievalIssuances)
    expect(config.indexes.map((candidate) => candidate.config.name)).toEqual(
      expect.arrayContaining([
        'organization_export_retrieval_issuances_operation_idx',
        'organization_export_retrieval_issuances_digest_idx',
        'organization_export_retrieval_issuances_org_time_idx',
      ]),
    )
  })
})

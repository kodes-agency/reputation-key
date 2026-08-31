import type { SQL } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  identityOrganizationLifecycleReceipts,
  organizationExportRetrievalIssuances,
  organizationExports,
  organizationLifecycleAuthority,
  organizationLifecycleCommandReceipts,
} from './organization-lifecycle.schema'

/**
 * Renders a Drizzle SQL fragment back to readable text for assertions:
 * literal chunks verbatim, column references as `"table"."column"`.
 */
function sqlText(fragment: SQL): string {
  return fragment.queryChunks
    .map((chunk) => {
      if (typeof chunk !== 'object' || chunk === null) return String(chunk)
      if ('value' in chunk) return String((chunk as { value: unknown }).value)
      if ('name' in chunk && 'table' in chunk) {
        const column = chunk as { name: string; table: PgTable }
        return `"${getTableConfig(column.table).name}"."${column.name}"`
      }
      return String(chunk)
    })
    .join('')
}

function checkExpression(table: PgTable, name: string): string {
  const found = getTableConfig(table).checks.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing check constraint ${name}`)
  return sqlText(found.value)
}

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

  it('makes egress_pending carry pre-egress evidence while generating still carries none', () => {
    const shape = checkExpression(organizationExports, 'organization_export_state_shape')
    const normalized = shape.replace(/\s+/gu, ' ')

    // egress_pending: digests + key are durable, the upload is not confirmed.
    expect(normalized).toContain(
      '"organization_exports"."state" = \'egress_pending\' ' +
        'AND "organization_exports"."generation_lease_expires_at" IS NOT NULL ' +
        'AND "organization_exports"."coverage_sha256" IS NOT NULL ' +
        'AND "organization_exports"."manifest_sha256" IS NOT NULL ' +
        'AND "organization_exports"."archive_sha256" IS NOT NULL ' +
        'AND "organization_exports"."object_key" IS NOT NULL ' +
        'AND "organization_exports"."encryption_evidence_ref" IS NULL ' +
        'AND "organization_exports"."pre_egress_recorded_at" IS NOT NULL',
    )
    // generating: nothing has been produced yet, so nothing may be recorded.
    expect(normalized).toContain(
      '"organization_exports"."state" = \'generating\' ' +
        'AND "organization_exports"."generation_lease_expires_at" IS NOT NULL ' +
        'AND "organization_exports"."coverage_sha256" IS NULL ' +
        'AND "organization_exports"."manifest_sha256" IS NULL ' +
        'AND "organization_exports"."archive_sha256" IS NULL ' +
        'AND "organization_exports"."object_key" IS NULL ' +
        'AND "organization_exports"."encryption_evidence_ref" IS NULL ' +
        'AND "organization_exports"."pre_egress_recorded_at" IS NULL',
    )
    expect(
      checkExpression(organizationExports, 'organization_export_state_valid'),
    ).toContain("'egress_pending'")
    // A mid-egress export is still an OPEN export.
    const openIndex = getTableConfig(organizationExports).indexes.find(
      (candidate) =>
        candidate.config.name === 'organization_exports_one_open_per_org_idx',
    )
    expect(sqlText(openIndex!.config.where!)).toContain("'egress_pending'")
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

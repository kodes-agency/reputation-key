import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'drizzle/0159_organization_lifecycle_authority.sql'
const migration = readFileSync(migrationPath, 'utf8')

describe('Organization lifecycle authority migration', () => {
  it('installs the explicit state machine, monotonic revision guard, and retry receipts', () => {
    expect(migration).toContain('CREATE TABLE "organization_lifecycle_authority"')
    expect(migration).toContain(
      "'active', 'closure_requested', 'closing', 'purge_pending', 'purging', 'closed'",
    )
    expect(migration).toContain('"revision" integer DEFAULT 0 NOT NULL')
    expect(migration).toContain('CREATE TABLE "organization_lifecycle_command_receipts"')
    expect(migration).toContain('"recoverable_until" timestamp with time zone')
    expect(migration).toContain('"reactivation_required" boolean DEFAULT false')
    expect(migration).toContain(
      'CREATE FUNCTION "guard_organization_lifecycle_revision_v1"',
    )
    expect(migration).toContain('NEW."revision" IS DISTINCT FROM OLD."revision" + 1')
    expect(migration).toContain(
      `(OLD."state" = 'active' AND NEW."state" = 'closure_requested')`,
    )
    expect(migration).toContain(
      `(OLD."state" = 'closure_requested' AND NEW."state" IN ('active', 'closing'))`,
    )
    expect(migration).toContain(
      `(OLD."state" = 'closing' AND NEW."state" IN ('active', 'purge_pending'))`,
    )
    expect(migration).toContain(
      `(OLD."state" = 'purge_pending' AND NEW."state" IN ('active', 'purging'))`,
    )
    expect(migration).toContain(`(OLD."state" = 'purging' AND NEW."state" = 'closed')`)
    expect(migration).toContain(
      `OLD."state" = 'purge_pending' AND NEW."state" = 'active' AND NEW."last_reason_code" = 'purge_cancelled_before_irreversible'`,
    )
    expect(migration).toContain(
      `OLD."state" = 'closing' AND NEW."state" = 'purge_pending' AND NEW."last_reason_code" IN ('recovery_window_elapsed', 'recovery_window_waived')`,
    )
    expect(migration).toContain(
      `OLD."state" = 'active' AND OLD."reactivation_required" = true`,
    )
    expect(migration).toContain(
      `NEW."closure_lineage_id" IS DISTINCT FROM OLD."closure_lineage_id"`,
    )
    expect(migration).toContain(`NEW."last_transition_at" < OLD."last_transition_at"`)
    expect(migration).toContain('CREATE TRIGGER "organization_lifecycle_revision_guard"')
  })

  it('prevents generic policy administration from clearing a lifecycle fence', () => {
    expect(migration).toContain(
      'CREATE FUNCTION "guard_organization_lifecycle_policy_fence_v1"',
    )
    expect(migration).toContain('CREATE TRIGGER "organization_lifecycle_policy_fence"')
    expect(migration).toContain(
      'lifecycle."state" <> \'active\' OR lifecycle."reactivation_required" = true',
    )
  })

  it('places the irreversible timestamp at Purging rather than Purge Pending', () => {
    expect(migration).toContain(
      `"state" IN ('closure_requested', 'closing', 'purge_pending')`,
    )
    expect(migration).toContain(`"state" = 'purging'`)
    expect(migration).toContain(
      `"organization_lifecycle_authority"."requested_by" IS NOT NULL`,
    )
    expect(migration).toContain(
      `"organization_lifecycle_authority"."request_support_evidence_ref" IS NOT NULL`,
    )
  })

  it('installs the private Organization Export lifecycle without archive contents or raw tokens', () => {
    expect(migration).toContain('CREATE TABLE "organization_exports"')
    expect(migration).toContain('"format_version" varchar(64)')
    expect(migration).toContain('"archive_sha256" varchar(64)')
    expect(migration).toContain('"retrieval_token_digest" varchar(64)')
    expect(migration).toContain("interval '24 hours'")
    expect(migration).toContain("interval '7 days'")
    expect(migration).not.toContain('"retrieval_token"')
    expect(migration).not.toContain('"archive_bytes"')
    expect(migration).toContain('CREATE FUNCTION "guard_organization_export_revision_v1"')
    expect(migration).toContain('CREATE TRIGGER "organization_export_revision_guard"')
    expect(migration).toContain(
      `WHERE "organization_exports"."state" IN ('requested', 'generating', 'ready', 'retrieval_issued')`,
    )
  })

  it('rejects archive or retrieval evidence before its owning export state', () => {
    expect(migration).toContain(
      `"state" = 'requested' AND "organization_exports"."generation_lease_expires_at" IS NULL AND "organization_exports"."coverage_sha256" IS NULL AND "organization_exports"."manifest_sha256" IS NULL AND "organization_exports"."archive_sha256" IS NULL AND "organization_exports"."object_key" IS NULL AND "organization_exports"."encryption_evidence_ref" IS NULL AND "organization_exports"."last_error_code" IS NULL`,
    )
    expect(migration).toContain(
      `"state" = 'generating' AND "organization_exports"."generation_lease_expires_at" IS NOT NULL AND "organization_exports"."coverage_sha256" IS NULL AND "organization_exports"."manifest_sha256" IS NULL AND "organization_exports"."archive_sha256" IS NULL AND "organization_exports"."object_key" IS NULL AND "organization_exports"."encryption_evidence_ref" IS NULL AND "organization_exports"."last_error_code" IS NULL`,
    )
    expect(migration).toContain(
      `"state" = 'failed' AND "organization_exports"."generation_lease_expires_at" IS NULL AND "organization_exports"."coverage_sha256" IS NULL AND "organization_exports"."manifest_sha256" IS NULL AND "organization_exports"."archive_sha256" IS NULL AND "organization_exports"."object_key" IS NULL AND "organization_exports"."encryption_evidence_ref" IS NULL AND "organization_exports"."last_error_code" IS NOT NULL`,
    )
    expect(migration).toContain(
      `"state" NOT IN ('retrieval_issued', 'retrieved') AND "organization_exports"."retrieval_operation_id" IS NULL AND "organization_exports"."retrieval_token_digest" IS NULL AND "organization_exports"."retrieval_issued_at" IS NULL AND "organization_exports"."retrieval_expires_at" IS NULL AND "organization_exports"."retrieved_at" IS NULL`,
    )
  })

  it('backfills active authority without inferring closure or deleting tenant data', () => {
    expect(migration).toContain('FROM "organization"')
    expect(migration).toContain("'provisioned', 'migration:0159'")
    expect(migration).toContain(
      'CREATE FUNCTION "provision_organization_lifecycle_authority_v1"',
    )
    expect(migration).toContain(
      'CREATE TRIGGER "organization_lifecycle_authority_provision"',
    )
    expect(migration).toContain('AFTER INSERT ON "organization"')
    expect(migration).not.toMatch(/DELETE\s+FROM/iu)
    expect(migration).not.toMatch(/DROP\s+TABLE/iu)
  })

  it('is the journaled successor to the AI and Inbox migrations', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>
    }
    const lifecycleIndex = journal.entries.findIndex(
      (entry) => entry.tag === '0159_organization_lifecycle_authority',
    )
    expect(lifecycleIndex).toBeGreaterThanOrEqual(2)
    expect(journal.entries.slice(lifecycleIndex - 2, lifecycleIndex + 1)).toEqual([
      expect.objectContaining({
        idx: 157,
        tag: '0157_ai_review_analysis_assisted_approval',
      }),
      expect.objectContaining({ idx: 158, tag: '0158_inbox_response_targets' }),
      expect.objectContaining({ idx: 159, tag: '0159_organization_lifecycle_authority' }),
    ])
  })
})

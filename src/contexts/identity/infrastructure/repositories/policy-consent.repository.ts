// BQC-2.2 — policy consent repository (real PostgreSQL).
//
// Generic governed consent state for enabled features now and AI opt-in
// later (phase BQC-2 §2.2; §9 forbids building the AI flows — this is only
// the governed record). One active consent per (org, subject, purpose) via
// partial unique index; revocation is a state transition, not a delete.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { BUMP_POLICY_VERSION_SQL } from './policy-version-sql'

export type ConsentSubjectType = 'organization' | 'property' | 'user'
export type ConsentState = 'granted' | 'revoked'

export type PolicyConsentRecord = Readonly<{
  id: string
  organizationId: string
  subjectType: ConsentSubjectType
  subjectId: string
  purpose: string
  state: ConsentState
  recordedBy: string | null
  recordedAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}>

export type RecordPolicyConsentInput = Readonly<{
  organizationId: string
  subjectType: string
  subjectId: string
  purpose: string
  recordedBy?: string
  expiresAt?: Date
}>

function mapConsent(r: Record<string, unknown>): PolicyConsentRecord {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    subjectType: r.subject_type as ConsentSubjectType,
    subjectId: r.subject_id as string,
    purpose: r.purpose as string,
    state: r.state as ConsentState,
    recordedBy: (r.recorded_by as string | null) ?? null,
    recordedAt: toDate(r.recorded_at)!,
    expiresAt: toDate(r.expires_at),
    revokedAt: toDate(r.revoked_at),
  }
}

/** pg returns timestamptz as Date or string depending on driver path — normalize. */
function toDate(v: unknown): Date | null {
  if (v == null) return null
  return v instanceof Date ? v : new Date(v as string)
}

export async function recordPolicyConsent(
  db: Database,
  input: RecordPolicyConsentInput,
): Promise<PolicyConsentRecord> {
  const rows = await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    ins AS (
      INSERT INTO policy_consent
        (organization_id, subject_type, subject_id, purpose, recorded_by, expires_at)
      VALUES (
        ${input.organizationId},
        ${input.subjectType},
        ${input.subjectId},
        ${input.purpose},
        ${input.recordedBy ?? null},
        ${input.expiresAt ?? null}
      )
      RETURNING *
    )
    SELECT * FROM ins
  `)
  return mapConsent(rows.rows[0] as Record<string, unknown>)
}

export async function revokePolicyConsent(
  db: Database,
  input: Readonly<{
    organizationId: string
    subjectType: string
    subjectId: string
    purpose: string
  }>,
): Promise<boolean> {
  const rows = await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    upd AS (
      UPDATE policy_consent
      SET state = 'revoked', revoked_at = now()
      WHERE organization_id = ${input.organizationId}
        AND subject_type = ${input.subjectType}
        AND subject_id = ${input.subjectId}
        AND purpose = ${input.purpose}
        AND state = 'granted'
      RETURNING id
    )
    SELECT id FROM upd
  `)
  return rows.rows.length > 0
}

export async function getActiveConsent(
  db: Database,
  input: Readonly<{
    organizationId: string
    subjectType: string
    subjectId: string
    purpose: string
    at: Date
  }>,
): Promise<PolicyConsentRecord | null> {
  const rows = await db.execute(sql`
    SELECT * FROM policy_consent
    WHERE organization_id = ${input.organizationId}
      AND subject_type = ${input.subjectType}
      AND subject_id = ${input.subjectId}
      AND purpose = ${input.purpose}
      AND state = 'granted'
      AND (expires_at IS NULL OR expires_at > ${input.at})
    LIMIT 1
  `)
  const row = rows.rows[0] as Record<string, unknown> | undefined
  return row ? mapConsent(row) : null
}

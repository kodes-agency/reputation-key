// LIF-01-T20 — privacy access / correction / withdrawal / erasure requests.
//
// Program bullet 9. Today only the 24-hour self-service Guest path exists
// (GST-01), and the `privacy_request.received` / `privacy_request.fulfilled`
// audit actions were declared but never written. This is the record that makes
// them real.
//
// Three properties are structural rather than procedural:
//
//   1. TENANT AND PROPERTY SCOPED. Both ids are NOT NULL. A privacy request
//      that is not bound to exactly one Property cannot be answered without
//      reading across tenants, so the schema refuses to hold one.
//   2. NO SUBJECT CONTENT. The subject is identified by the SHA-256 of a
//      VERIFIED identifier, never by the email address, phone number or
//      session pseudonym itself. A request record about a person's data must
//      not become another copy of that person's data.
//   3. EXPIRY BOUND. An access package reference carries a mandatory expiry.
//      A privacy export that never expires is a permanent secondary copy.

import { sql } from 'drizzle-orm'
import {
  char,
  check,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * received -> verified -> in_progress -> fulfilled | refused
 *
 * No edge skips `verified`. Acting on an unverified request is how one person
 * reads or erases another person's data.
 */
export const PRIVACY_REQUEST_STATES = [
  'received',
  'verified',
  'in_progress',
  'fulfilled',
  'refused',
] as const

export type PrivacyRequestState = (typeof PRIVACY_REQUEST_STATES)[number]

export const PRIVACY_REQUEST_KINDS = [
  'access',
  'correction',
  'withdrawal',
  'erasure',
] as const

export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number]

/** Guest contact/feedback, or Participant (Staff) data. */
export const PRIVACY_SUBJECT_TYPES = ['guest', 'participant'] as const

export type PrivacySubjectType = (typeof PRIVACY_SUBJECT_TYPES)[number]

/** Content classification carried by an access package. */
export const PRIVACY_CONTENT_CLASSIFICATIONS = [
  'content_free',
  'personal',
  'sensitive',
] as const

export type PrivacyContentClassification =
  (typeof PRIVACY_CONTENT_CLASSIFICATIONS)[number]

const list = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ')

export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    /** Property scope is mandatory: an unscoped request cannot be answered. */
    propertyId: uuid('property_id').notNull(),
    subjectType: varchar('subject_type', { length: 24 }).notNull(),
    /** SHA-256 of the VERIFIED subject identifier. Never the identifier. */
    subjectRef: char('subject_ref', { length: 64 }).notNull(),
    requestKind: varchar('request_kind', { length: 24 }).notNull(),
    state: varchar('state', { length: 24 }).notNull(),

    /** How the subject's identity was verified. Opaque, content-free. */
    verificationRef: varchar('verification_ref', { length: 200 }),
    /** Explicit machine-readable refusal reason; never a free-text excuse. */
    refusalReasonCode: varchar('refusal_reason_code', { length: 64 }),
    /**
     * Correction/withdrawal name exactly one field of the subject's own data.
     * A field NAME is a schema identifier, not subject content.
     */
    targetField: varchar('target_field', { length: 64 }),

    contentClassification: varchar('content_classification', { length: 24 }).notNull(),
    /** Access package artifact reference; expiry-bound by the CHECK below. */
    packageRef: varchar('package_ref', { length: 200 }),
    packageExpiresAt: timestamptz('package_expires_at'),

    evidenceRef: varchar('evidence_ref', { length: 200 }).notNull(),
    correlationId: varchar('correlation_id', { length: 255 }).notNull(),
    receivedAt: timestamptz('received_at').notNull(),
    verifiedAt: timestamptz('verified_at'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('privacy_requests_scope_idx').on(t.organizationId, t.propertyId, t.state),
    index('privacy_requests_subject_idx').on(t.subjectRef, t.receivedAt),
    check(
      'privacy_requests_state_valid',
      sql.raw(`"privacy_requests"."state" IN (${list(PRIVACY_REQUEST_STATES)})`),
    ),
    check(
      'privacy_requests_kind_valid',
      sql.raw(`"privacy_requests"."request_kind" IN (${list(PRIVACY_REQUEST_KINDS)})`),
    ),
    check(
      'privacy_requests_subject_type_valid',
      sql.raw(`"privacy_requests"."subject_type" IN (${list(PRIVACY_SUBJECT_TYPES)})`),
    ),
    check(
      'privacy_requests_classification_valid',
      sql.raw(
        `"privacy_requests"."content_classification" IN (${list(PRIVACY_CONTENT_CLASSIFICATIONS)})`,
      ),
    ),
    check('privacy_requests_subject_ref_valid', sql`${t.subjectRef} ~ '^[a-f0-9]{64}$'`),
    // Content-free by construction — every reference is an opaque token and
    // every reason is a code.
    check(
      'privacy_requests_refs_valid',
      sql`${t.evidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND (${t.verificationRef} IS NULL OR ${t.verificationRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND (${t.packageRef} IS NULL OR ${t.packageRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND (${t.refusalReasonCode} IS NULL OR ${t.refusalReasonCode} ~ '^[a-z][a-z0-9_]{0,63}$')
        AND (${t.targetField} IS NULL OR ${t.targetField} ~ '^[a-z][a-z0-9_]{0,63}$')`,
    ),
    // No edge skips identity verification: every state past `received` requires
    // both the verification instant and its reference.
    check(
      'privacy_requests_verification_required',
      sql`${t.state} = 'received'
        OR (${t.verifiedAt} IS NOT NULL AND ${t.verificationRef} IS NOT NULL)`,
    ),
    check(
      'privacy_requests_refusal_reason_required',
      sql`(${t.state} = 'refused') = (${t.refusalReasonCode} IS NOT NULL)`,
    ),
    check(
      'privacy_requests_completion_valid',
      sql`(${t.state} IN ('fulfilled', 'refused')) = (${t.completedAt} IS NOT NULL)`,
    ),
    // An access package is only ever produced for an access request, and it
    // always expires. A privacy export with no expiry is a permanent copy.
    check(
      'privacy_requests_package_valid',
      sql`${t.packageRef} IS NULL
        OR (${t.requestKind} = 'access' AND ${t.packageExpiresAt} IS NOT NULL
          AND ${t.packageExpiresAt} > ${t.receivedAt})`,
    ),
    check(
      'privacy_requests_target_field_valid',
      sql`${t.targetField} IS NULL OR ${t.requestKind} IN ('correction', 'withdrawal')`,
    ),
  ],
)

export type PrivacyRequestRow = typeof privacyRequests.$inferSelect

// Executable log-field policy for the architecture gate
// (architecture/observability-schema.test.ts), which scans every logger
// call-site and fails on a banned key.
//
// Cardinality rule: tenant identifiers (organization, property, user, review,
// reply, job, event, connection, inbox, portal, session, …) are NEVER log
// fields — the only approved correlation fields are requestId (per-trace) and
// correlationId (domain events, ADR 0030 identifier-only by design).

import {
  SENSITIVE_OBSERVABILITY_FIELD_NAMES,
  isSensitiveObservabilityField,
} from '#/shared/observability/sensitive-field-policy'

/**
 * The ONLY identifier-shaped fields approved for log/trace/metric emission:
 * per-trace requestId and ADR 0030 event correlationId. Everything else that
 * names a tenant entity is banned from log objects (BANNED_LOG_KEYS below).
 */
export const APPROVED_CORRELATION_FIELDS = ['requestId', 'correlationId'] as const

/**
 * Keys that must never appear in a logger call-site object: tenant/entity
 * identifiers, raw payloads, protected content, and credential material.
 * jobName/queue/reason/duration/count/age/attempt fields are content-free
 * and stay approved (not listed). Calibrated against the BQC-7.3 call-site
 * sweep — a key lands here because a real call-site passed an identifier or
 * payload under it.
 */
const TENANT_IDENTIFIER_LOG_KEYS = [
  // Tenant/entity identifiers (and their in-code aliases)
  'organizationId',
  'orgId',
  'userId',
  'uid',
  'propertyId',
  'reviewId',
  'replyId',
  'jobId',
  'quarantineJobId',
  'eventId',
  'connectionId',
  'googleConnectionId',
  'inboxItemId',
  'noteId',
  'feedbackId',
  'portalId',
  'invitationId',
  'goalId',
  'notificationId',
  'notificationEmailId',
  'moveId',
  'resourceId',
  'id',
  // Generic payload containers are prohibited at log call-sites, but are not
  // sensitive field names by themselves (Sentry breadcrumbs legitimately use
  // `data` as a container whose children still require deep scrubbing).
  'jobData',
  'data',
  'input',
  'gbpAccountId',
] as const

export const BANNED_LOG_KEYS = [
  ...TENANT_IDENTIFIER_LOG_KEYS,
  ...SENSITIVE_OBSERVABILITY_FIELD_NAMES,
] as const

export type BannedLogKey = (typeof BANNED_LOG_KEYS)[number]

const BANNED_SET: ReadonlySet<string> = new Set(BANNED_LOG_KEYS)

export function isBannedLogKey(key: string): boolean {
  return BANNED_SET.has(key) || isSensitiveObservabilityField(key)
}

// POST-BETA-4 PB4.4: Activity vs audit separation.
//
// Per ADR 0045: three distinct models:
// - Domain event: source context fact (durable, immutable)
// - Activity item: user-facing feed (authorized users, shorter retention)
// - Security audit: restricted (operators/compliance, tamper-evident)
//
// Never copy review text, guest text, tokens, cookies, or secrets into
// activity or audit payloads.

export type ActivityCategory =
  | 'membership_change'
  | 'goal_lifecycle'
  | 'badge_award'
  | 'portal_publication'
  | 'reply_status'
  | 'integration_health'

export type AuditCategory =
  | 'authentication'
  | 'authorization_decision'
  | 'grant_change'
  | 'sensitive_data_access'
  | 'capability_activation'
  | 'external_publish'
  | 'privacy_request'
  | 'destructive_lifecycle'

export interface ActivityItem {
  readonly id: string
  readonly organizationId: string
  readonly userId: string
  readonly category: ActivityCategory
  readonly resourceType: string
  readonly resourceId: string
  readonly resourceLabel: string
  readonly action: string
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>
  readonly occurredAt: Date
  readonly isTombstoned: boolean
  readonly tombstonedAt: Date | null
}

export interface AuditRecord {
  readonly id: string
  readonly organizationId: string
  readonly actorUserId: string | null
  readonly category: AuditCategory
  readonly resourceType: string
  readonly resourceId: string
  readonly action: string
  readonly result: 'success' | 'failure' | 'denied'
  readonly reason: string | null
  readonly occurredAt: Date
  readonly sequenceNumber: number
  readonly hash: string
  readonly previousHash: string | null
}

// Activity payload fields that must NEVER appear in stored data
const FORBIDDEN_PAYLOAD_FIELDS = new Set([
  'reviewText',
  'review_text',
  'guestText',
  'guest_text',
  'emailBody',
  'email_body',
  'token',
  'cookie',
  'presignedUrl',
  'presigned_url',
  'rawIp',
  'raw_ip',
  'ipAddress',
  'ip_address',
  'password',
  'apiKey',
  'api_key',
])

/**
 * Sanitize an activity metadata payload to ensure no forbidden fields.
 * Per ADR 0045: never copy sensitive data into activity payloads.
 */
export function sanitizeActivityMetadata(
  metadata: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean | null>> {
  const result: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_PAYLOAD_FIELDS.has(key)) continue
    if (typeof value === 'string') result[key] = value
    else if (typeof value === 'number') result[key] = value
    else if (typeof value === 'boolean') result[key] = value
    else if (value === null) result[key] = null
    else result[key] = '[redacted]'
  }
  return result
}

/**
 * Create an activity item.
 */
export function createActivityItem(params: {
  id: string
  organizationId: string
  userId: string
  category: ActivityCategory
  resourceType: string
  resourceId: string
  resourceLabel: string
  action: string
  metadata: Readonly<Record<string, unknown>>
}): ActivityItem {
  return {
    id: params.id,
    organizationId: params.organizationId,
    userId: params.userId,
    category: params.category,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    resourceLabel: params.resourceLabel,
    action: params.action,
    metadata: sanitizeActivityMetadata(params.metadata),
    occurredAt: new Date(),
    isTombstoned: false,
    tombstonedAt: null,
  }
}

/**
 * Tombstone an activity item (privacy/redaction).
 * Per ADR 0045: presentation may be redacted/tombstoned.
 */
export function tombstoneActivity(item: ActivityItem): ActivityItem {
  return {
    ...item,
    isTombstoned: true,
    tombstonedAt: new Date(),
    metadata: {},
    resourceLabel: '[redacted]',
  }
}

/**
 * Compute the hash for an audit record (tamper-evident chain).
 * Uses a simple hash of the record fields + previous hash.
 */
export function computeAuditHash(record: Omit<AuditRecord, 'hash'>): string {
  // Simple deterministic hash — real implementation would use SHA-256
  const str = [
    record.id,
    record.organizationId,
    record.actorUserId ?? 'null',
    record.category,
    record.resourceType,
    record.resourceId,
    record.action,
    record.result,
    record.reason ?? 'null',
    record.occurredAt.toISOString(),
    record.sequenceNumber.toString(),
    record.previousHash ?? 'null',
  ].join('|')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

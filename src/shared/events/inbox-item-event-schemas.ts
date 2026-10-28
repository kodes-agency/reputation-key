// Inbox item event schemas, registered by ./schema-registrations.ts.
//
// The facts about one Inbox item that carry who acted and nothing else:
// escalated, escalation resolved, and the manager priority change (ADR 0071).
// Identifiers and closed values only (ADR 0030). Never `.strict()`: an unknown
// key is a producer ahead of this deploy, not a bad payload.

import { z } from 'zod/v4'
import { registerEventSchema } from './schema-registry'

/**
 * Who acted, where, and when — the tail the corrected Inbox facts share, in
 * the order they store it. Written once so they cannot be corrected apart from
 * each other; it stays a shape rather than a schema so each event still
 * declares its own identifiers first.
 */
export const inboxActorShape = {
  userId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
} as const

/** One Inbox item, and nothing about it beyond the identifiers. */
const inboxItemEventShape = {
  inboxItemId: z.string(),
  organizationId: z.string(),
  ...inboxActorShape,
} as const

/** The manager priority levels (`inbox_priority_level`); null is "none". */
const inboxPriorityLevelSchema = z.enum(['urgent', 'high', 'medium', 'low']).nullable()

/**
 * Audit-only: no consumer reads it, so nobody is notified and Recent Activity
 * records nothing. Only a signed-in manager's web command produces it, so the
 * actor and the source are required here, not optional as on the older facts.
 */
const inboxItemPriorityChangedSchema = z.object({
  ...inboxItemEventShape,
  userId: z.string().trim().min(1).max(255),
  source: z.literal('web'),
  priority: inboxPriorityLevelSchema,
  previousPriority: inboxPriorityLevelSchema,
})

/** Register the three item facts; called once from registerAllEventSchemas. */
export function registerInboxItemEventSchemas(version: number): void {
  registerEventSchema({
    type: 'inbox.inbox_item.escalated',
    version,
    schema: z.object(inboxItemEventShape),
  })
  registerEventSchema({
    type: 'inbox.inbox_item.escalation_resolved',
    version,
    schema: z.object(inboxItemEventShape),
  })
  registerEventSchema({
    type: 'inbox.inbox_item.priority_changed',
    version,
    schema: inboxItemPriorityChangedSchema,
  })
}

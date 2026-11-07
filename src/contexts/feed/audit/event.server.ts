import { z } from 'zod/v4'

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$/u)
const code = z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/u)

const auditEvent = z
  .strictObject({
    organizationId: identifier,
    propertyId: identifier.nullable(),
    actorType: z.enum(['user', 'system', 'operator', 'service', 'public']),
    actorId: identifier.nullable(),
    action: code.max(80),
    outcome: z.enum(['succeeded', 'denied', 'failed']),
    resourceType: code.max(40),
    resourceId: identifier.nullable(),
    sourceKind: z.enum([
      'domain_fact',
      'policy_decision',
      'interactive_command',
      'worker_command',
      'operator_command',
      'history_access',
      'history_lifecycle',
    ]),
    sourceId: identifier,
    sourceEventType: code.nullable(),
    sourceEventVersion: z.number().int().positive().nullable(),
    sourceContext: code.nullable(),
    sourceAggregateId: identifier.nullable(),
    occurredAt: z.date(),
  })
  .superRefine((event, ctx) => {
    const eventFields = [
      event.sourceEventType,
      event.sourceEventVersion,
      event.sourceContext,
      event.sourceAggregateId,
    ]
    if (
      event.sourceKind === 'domain_fact'
        ? eventFields.some((value) => value === null)
        : eventFields.some((value) => value !== null)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid audit source identity' })
    }
    // A retained record may already have had an attributable actor redacted.
    if (
      (event.actorType === 'system' || event.actorType === 'public') &&
      event.actorId !== null
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid audit actor attribution' })
    }
  })

export type AuditEvent = z.infer<typeof auditEvent>

/** Reject unknown fields at the owning write boundary; never strip content. */
export const parseAuditEvent = (input: unknown): AuditEvent => auditEvent.parse(input)

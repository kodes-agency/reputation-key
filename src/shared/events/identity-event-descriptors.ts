import { z } from 'zod/v4'
import type { EventDescriptor } from './descriptor'
import { databaseUuidSchema } from './reply-publication-cancelled-schema'

// ── Identity event schemas ──────────────────────────────────────────

const memberInvitedV2Schema = z.object({
  invitationId: z.string(),
  organizationId: z.string(),
  role: z.string(),
  // Recognize and reject the retired key instead of letting Zod's normal
  // unknown-key stripping make a directly injected v2 envelope look valid.
  email: z.never().optional(),
})

// Invitation facts are emitted only in their content-minimal v2 shape.
// identity.invitation.accepted lives in ./identity-access-event-schemas.ts.

const invitationCanceledSchema = z.object({
  invitationId: z.string(),
  organizationId: z.string(),
})

const memberRemovedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  // Additive at version 1: leaving records this same fact with the member as
  // its own actor, and Feed must not tell a member who left that an
  // administrator removed them. Rows recorded before it was kept lack it.
  removedBy: z.string().optional(),
})

// BQC-3.5: memberRoleChangedSchema gains `memberUserId` IN PLACE at version 1.
// Justification: the identity use-case wiring never passed outboxRepo, so
// these events only ever emitted on the bus — zero historical outbox rows
// exist for any identity type. The activity consumer reads
// event.memberUserId as the audit resourceId (the TARGET); the schema
// previously kept only userId (the ACTOR) and silently stripped the target.
const memberRoleChangedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  memberUserId: z.string(),
  previousRole: z.string(),
  newRole: z.string(),
})

// BQC-3.5: registered so the registration path records the audit fact
// (orphan event — no consumers; the fact is the trail). Same zero-row
// justification as above: never wired, never recorded.
const organizationCreatedSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  slug: z.string(),
  ownerId: z.string(),
})

const merchantAiChangedSchema = z
  .object({
    _tag: z.literal('identity.merchant_ai.changed').optional(),
    eventId: z.string().optional(),
    correlationId: z.string().nullable().optional(),
    organizationId: z.string(),
    propertyId: z.uuid(),
    authorizationLineageId: z.uuid(),
    state: z.enum(['disabled', 'enabled', 'revoked']),
    reviewAnalysisEpoch: z.number().int().safe().positive(),
    replyDraftingEpoch: z.number().int().safe().positive(),
    propertyTrendsEpoch: z.number().int().safe().positive(),
    // 0-based source epoch (drizzle/0060); the capability epochs above are 1-based.
    authorizedSourceEpoch: z.number().int().safe().nonnegative(),
    analysisStartSequence: z.number().int().safe().nonnegative(),
    stateVersion: z.number().int().safe().positive(),
    occurredAt: z.string(),
  })
  .strict()
  .transform((event) => ({
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    authorizationLineageId: event.authorizationLineageId,
    state: event.state,
    reviewAnalysisEpoch: event.reviewAnalysisEpoch,
    replyDraftingEpoch: event.replyDraftingEpoch,
    propertyTrendsEpoch: event.propertyTrendsEpoch,
    authorizedSourceEpoch: event.authorizedSourceEpoch,
    analysisStartSequence: event.analysisStartSequence,
    stateVersion: event.stateVersion,
    occurredAt: event.occurredAt,
  }))

// ADR 0059: identifiers and a closed outcome only. Not `.strict()`: the outbox
// validates the whole event (envelope included) and PERSISTS the parsed
// result, so this schema is the allowlist — anything else, report text or a
// triage classification included, is stripped before the row is written.
const betaFeedbackOutcomeReachedSchema = z.object({
  organizationId: z.string().trim().min(1).max(255),
  userId: z.string().trim().min(1).max(255),
  reference: databaseUuidSchema,
  outcome: z.enum(['accepted', 'declined', 'resolved']),
})

export const identityEventDescriptors = [
  {
    type: 'identity.member.invited',
    aggregate: { type: 'invitation', id: 'invitationId' },
    version: 2,
    schema: memberInvitedV2Schema,
  },
  {
    type: 'identity.invitation.canceled',
    aggregate: { type: 'invitation', id: 'invitationId' },
    version: 1,
    schema: invitationCanceledSchema,
  },
  {
    type: 'identity.member.removed',
    aggregate: { type: 'user', id: 'userId' },
    version: 1,
    schema: memberRemovedSchema,
  },
  {
    type: 'identity.member.role_changed',
    aggregate: { type: 'user', id: 'userId' },
    version: 1,
    schema: memberRoleChangedSchema,
  },
  {
    type: 'identity.organization.created',
    aggregate: { type: 'event', id: 'eventId' },
    version: 1,
    schema: organizationCreatedSchema,
  },
  {
    type: 'identity.merchant_ai.changed',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: merchantAiChangedSchema,
  },
  {
    type: 'identity.beta_feedback.outcome_reached',
    aggregate: { type: 'user', id: 'userId' },
    version: 1,
    schema: betaFeedbackOutcomeReachedSchema,
  },
] as const satisfies readonly EventDescriptor[]

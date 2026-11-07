import { z } from 'zod/v4'
import type { EventDescriptor } from './descriptor'
import { databaseUuidSchema } from './reply-publication-cancelled-schema'

// ── Integration event schemas ───────────────────────────────────────

// v2 remains registered for already-written rows. Current producers emit v3,
// whose actor field follows the canonical event vocabulary.
const googleAccountConnectedV2Schema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  connectedBy: z.string(),
})

const googleAccountConnectedV3Schema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
})

// `userId` is the admin who disconnected — identifier only, and optional
// because the recovery reconciler and pre-2026-09-24 rows name no actor.
const googleAccountDisconnectedSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  userId: z.string().nullable().optional(),
})

// `provider_revoked` is additive: rows written with the two departure causes
// (including by the fence_google_connector_departure_v1 trigger) stay valid.
const googleAccountReauthorizationRequiredSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  cause: z.enum(['member_removed', 'account_admin_role_lost', 'provider_revoked']),
  occurredAt: z.iso.datetime(),
})

const connectionVisibilityChangedSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  visibility: z.string(),
})

const googleReviewPushAcceptedSchema = z.object({
  organizationId: z.string().trim().min(1).max(255),
  propertyId: databaseUuidSchema,
  connectionId: databaseUuidSchema,
  sourceEpoch: z.number().int().safe().nonnegative(),
  referenceRef: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,31}\.[A-Za-z0-9_-]{43}$/u)
    .nullable(),
  notificationKind: z.enum(['NEW_REVIEW', 'UPDATED_REVIEW', 'REVIEW_CHANGED']),
  occurredAt: z.iso.datetime(),
})

const integrationPropertyImportRetentionReleasedSchema = z
  .object({
    _tag: z.literal('integration.property_import.retention_released').optional(),
    eventId: z.string().optional(),
    correlationId: z.string().nullable().optional(),
    occurredAt: z.string().optional(),
    organizationId: z.string(),
    // Optional for v1 compatibility with already-enqueued release facts.
    // Every new producer supplies it so the durable envelope has a stable
    // import aggregate rather than falling back to the event ID.
    importJobId: z.uuid().optional(),
    idempotencyKeys: z.array(z.uuid()).min(1).max(100),
  })
  .strict()
  .transform(({ organizationId, importJobId, idempotencyKeys }) => ({
    organizationId,
    ...(importJobId ? { importJobId } : {}),
    idempotencyKeys,
  }))
const integrationPropertyImportRequestedSchema = z
  .object({
    _tag: z.literal('integration.property_import.requested').optional(),
    eventId: z.string().optional(),
    correlationId: z.string().nullable().optional(),
    occurredAt: z.string().optional(),
    organizationId: z.string(),
    importJobId: z.uuid(),
  })
  .strict()
  .transform(({ organizationId, importJobId }) => ({
    organizationId,
    importJobId,
  }))

export const integrationEventDescriptors = [
  {
    type: 'integration.property_import.requested',
    aggregate: { type: 'import_job', id: 'importJobId' },
    version: 1,
    schema: integrationPropertyImportRequestedSchema,
  },
  {
    type: 'integration.property_import.retention_released',
    aggregate: { type: 'import_job', id: 'importJobId' },
    version: 1,
    schema: integrationPropertyImportRetentionReleasedSchema,
  },
  {
    type: 'integration.google_account.connected',
    aggregate: { type: 'connection', id: 'connectionId' },
    version: 2,
    schema: googleAccountConnectedV2Schema,
  },
  {
    type: 'integration.google_account.connected',
    aggregate: { type: 'connection', id: 'connectionId' },
    version: 3,
    schema: googleAccountConnectedV3Schema,
  },
  {
    type: 'integration.google_account.disconnected',
    aggregate: { type: 'connection', id: 'connectionId' },
    version: 1,
    schema: googleAccountDisconnectedSchema,
  },
  {
    type: 'integration.google_account.reauthorization_required',
    aggregate: { type: 'connection', id: 'connectionId' },
    version: 1,
    schema: googleAccountReauthorizationRequiredSchema,
  },
  {
    type: 'integration.google_connection.visibility_changed',
    aggregate: { type: 'connection', id: 'connectionId' },
    version: 1,
    schema: connectionVisibilityChangedSchema,
  },
  {
    type: 'integration.google_review_push.accepted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: googleReviewPushAcceptedSchema,
  },
] as const satisfies readonly EventDescriptor[]

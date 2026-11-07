import { z } from 'zod/v4'
import type { EventDescriptor } from './descriptor'
import { propertyGoogleBindingChangedSchema } from './property-google-binding-event-schema'

// ── Property event schemas ──────────────────────────────────────────

const propertyCreatedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
})

// BQC-3.5: registered so the orphan audit facts record with their state
// (never registered before → zero historical rows; additive at v1).
const propertyUpdatedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  occurredAt: z.iso.datetime().optional(),
})

const propertyDeletedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  occurredAt: z.iso.datetime().optional(),
})

const propertyLifecycleSchema = z.object({
  propertyId: z.uuid(),
  organizationId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  previousState: z.enum([
    'active',
    'suspended',
    'archived',
    'disconnecting',
    'purge_pending',
    'purging',
    'purged',
  ]),
  sourceEpoch: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
})

const propertyArchivedSchema = propertyLifecycleSchema
  .extend({
    previousState: z.enum(['active', 'suspended']),
    recoveryDeadline: z.iso.datetime(),
  })
  .refine(
    ({ occurredAt, recoveryDeadline }) =>
      Date.parse(recoveryDeadline) > Date.parse(occurredAt),
    { message: 'Property recovery deadline must follow archive time' },
  )

const propertyRestoredSchema = propertyLifecycleSchema.extend({
  previousState: z.literal('archived'),
  googleBindingReadiness: z.enum(['ready', 'reconnect_required']),
})

const propertyResponsibilityNeededSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  // Whose action opened the gap. Optional: facts recorded before the actor
  // was excluded from the recipients do not say.
  actorUserId: z.string().nullable().optional(),
  occurredAt: z.iso.datetime(),
})

const propertyResponsibleManagersUpdatedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  assignmentCount: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
})

export const propertyEventDescriptors = [
  {
    type: 'property.created',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: propertyCreatedSchema,
  },
  {
    type: 'property.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: propertyUpdatedSchema,
  },
  {
    type: 'property.deleted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: propertyDeletedSchema,
  },
  {
    type: 'property.archived',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: propertyArchivedSchema,
  },
  {
    type: 'property.restored',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: propertyRestoredSchema,
  },
  {
    type: 'property.google_binding.changed',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: propertyGoogleBindingChangedSchema,
  },
  {
    type: 'property.responsible_managers.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: propertyResponsibleManagersUpdatedSchema,
  },
  {
    type: 'property.responsibility_became_needed',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: propertyResponsibilityNeededSchema,
  },
] as const satisfies readonly EventDescriptor[]

// Property command store — atomic property state mutation + outbox record
// (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the properties state write and the
// outbox_events fact in ONE PostgreSQL transaction, then emits on the
// in-process bus after commit (expand-phase dual path until the durable
// switch). All three property.created producers (user create, GBP import,
// and — via propertyApi.importProperty — the integration import job) route
// through this store so the fact records atomically with the property row.

import type { OrganizationId } from '#/shared/domain/ids'
import type { Property, PropertyId } from '../../domain/types'
import type {
  PropertyCreated,
  PropertyDeleted,
  PropertyUpdated,
} from '../../domain/events'

/**
 * Property insert + property.created fact in one transaction. Throws
 * `forbidden` on a tenant mismatch (the repository's last-line-of-defense
 * guard, preserved). Returns the inserted row.
 */
export type CreatePropertyCommand = Readonly<{
  organizationId: OrganizationId
  property: Property
  event: PropertyCreated
}>

/**
 * Property update + property.updated fact in one transaction (orphan audit
 * fact — no consumers today). The use case holds the not_found contract via
 * its pre-read; the update itself is an idempotent patch like the repo's.
 */
export type UpdatePropertyCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  patch: Readonly<Partial<Property>>
  event: PropertyUpdated
}>

/**
 * Property hard delete + property.deleted fact in one transaction (orphan
 * audit fact). The bounded source-content purge stays OUTSIDE this command
 * (retention machinery) — the remaining purge↔delete non-atomicity is a
 * noted gap, unchanged from before BQC-3.5.
 */
export type DeletePropertyCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  event: PropertyDeleted
}>

export type PropertyCommandStore = Readonly<{
  createProperty(command: CreatePropertyCommand): Promise<Property>
  updateProperty(command: UpdatePropertyCommand): Promise<void>
  deleteProperty(command: DeletePropertyCommand): Promise<void>
}>

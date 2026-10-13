// Property command store — atomic property state mutation + outbox record
// (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the properties state write and the
// outbox_events fact in ONE PostgreSQL transaction, then emits on the
// in-process bus after commit (expand-phase dual path until the durable
// switch). property.created has two producers, each committing the fact
// atomically with the property row: a manual create through this store, and a
// Google import through PropertyGoogleBindingStore.createBoundProperty.

import type { OrganizationId } from '#/shared/domain/ids'
import type { Property, PropertyId } from '../../domain/types'
import type {
  PropertyCreated,
  PropertyDeleted,
  PropertyGoogleBindingChanged,
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
 * Property update + property.updated fact in one transaction. The use case
 * holds the not_found contract via its pre-read.
 *
 * `patch` carries only the columns this request changes. The use case reads the
 * Property without a lock, and the two expected versions fence the Google
 * binding (`sourceEpoch`) and the name and timezone (`profileVersion`) only: a
 * column the patch repeats from that read would overwrite another save of it
 * that committed in between, and neither version would notice.
 *
 * `event` is built from the row as committed, so the fact and the answer name
 * the Property this save left behind, including what an overlapping save wrote.
 */
export type UpdatePropertyCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  expectedSourceEpoch: number
  expectedProfileVersion: number
  patch: Readonly<Partial<Property>>
  event: (committed: Property) => PropertyUpdated
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
  expectedSourceEpoch: number
  expectedProfileVersion: number
  event: PropertyDeleted
  bindingEvent?: PropertyGoogleBindingChanged
}>

export type PropertyCommandStore = Readonly<{
  createProperty(command: CreatePropertyCommand): Promise<Property>
  /** Answers with the Property as committed. */
  updateProperty(command: UpdatePropertyCommand): Promise<Property>
  deleteProperty(command: DeletePropertyCommand): Promise<void>
}>

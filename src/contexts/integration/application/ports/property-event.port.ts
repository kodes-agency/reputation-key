// Integration context — property creation event port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Used by the import-property use case to emit property.created events
// without importing directly from the property context's domain.

import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'

export type PropertyCreatedEvent = Readonly<{
  _tag: 'property.created'
  propertyId: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  gbpPlaceId: string
  gbpLocationName: string
  googleConnectionId: GoogleConnectionId
  occurredAt: Date
}>

export type PropertyEventPort = Readonly<{
  emitPropertyCreated: (event: PropertyCreatedEvent) => Promise<void>
}>

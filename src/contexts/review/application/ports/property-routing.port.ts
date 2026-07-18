// Review context — property routing lookup port
// Per architecture: "Ports are TypeScript types defining capability contracts."
//
// BQC-4.1 / ADR 0048: sync must fail closed when the property's processing
// region is not an approved cell. The region is a content-free routing fact
// owned by the property context; composition wires this port to the property
// public API (ADR-0001 — no direct property table reads).

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type PropertyRoutingPort = Readonly<{
  /**
   * The property's persisted processing region ('us' | 'europe' | 'global' |
   * 'unresolved'). Null when the property is missing/deleted — callers treat
   * null as not processable.
   */
  getProcessingRegion: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
}>

// Review context — Property source-epoch lookup port
// Per architecture: "Ports are TypeScript types defining capability contracts."
//
// Provider work is bound to the Property's current source epoch. Composition
// wires this content-free lookup to the Property public API (ADR-0001).

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type ReviewPropertySourceEpoch = Readonly<{
  sourceEpoch: number
}>

export type PropertySourceEpochPort = Readonly<{
  /** Read the binding generation from one Property snapshot. */
  getSourceEpoch: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReviewPropertySourceEpoch | null>
}>

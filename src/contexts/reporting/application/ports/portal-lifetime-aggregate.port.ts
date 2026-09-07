import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PortalLifetimeValues } from '../../domain/portal-lifetime-aggregate'

export type PortalLifetimeAggregate = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  /** Immutable governed sources represented by the combined projection. */
  definitionVersionIds: Readonly<{
    qualifiedScans: string
    privateRatings: string
    privateFeedback: string
    destinationSelections: string
  }>
  values: PortalLifetimeValues
  sealedThroughLocalDate: string | null
  projectionRevision: number
  lastRebuiltAt: Date | null
  lastSealedAt: Date | null
}>

export type PortalLifetimeScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
}>

export type PortalLifetimeReconciliation = Readonly<{
  before: PortalLifetimeAggregate | null
  after: PortalLifetimeAggregate
  matched: boolean
}>

export type PortalLifetimeInspection = Readonly<{
  current: PortalLifetimeAggregate
  expectedValues: PortalLifetimeValues
  matched: boolean
}>

export type PortalLifetimeAggregatePort = Readonly<{
  get(scope: PortalLifetimeScope): Promise<PortalLifetimeAggregate | null>
  /** Computes canonical retained-fact parity under the projection lock; never writes. */
  inspect(scope: PortalLifetimeScope): Promise<PortalLifetimeInspection>
  /** Rebuilds totals as sealed anonymous baseline + retained effective facts. */
  rebuild(scope: PortalLifetimeScope): Promise<PortalLifetimeReconciliation>
  /**
   * Advances the Property-local purge checkpoint, then rebuilds totals. This
   * must commit before the matching source-fact purge is allowed to run.
   */
  sealThrough(
    scope: PortalLifetimeScope,
    throughLocalDate: string,
  ): Promise<PortalLifetimeReconciliation>
}>

import type { PropertyResponsibleManager } from '../../domain/property-responsible-manager'
import type { PropertyResponsibilityNeeded } from '../../domain/events'

export type PropertyResponsibleManagerRepository = Readonly<{
  listActive: (
    organizationId: string,
    propertyId: string,
  ) => Promise<readonly PropertyResponsibleManager[]>
  listActiveForUser: (
    organizationId: string,
    userId: string,
  ) => Promise<readonly PropertyResponsibleManager[]>
  replace: (
    input: Readonly<{
      organizationId: string
      propertyId: string
      managerUserIds: readonly string[]
      expectedRevision: number
      actorId: string
      at: Date
      responsibilityNeededEvent: PropertyResponsibilityNeeded
    }>,
  ) => Promise<
    Readonly<{
      assignments: readonly PropertyResponsibleManager[]
      revision: number
      becameResponsibilityNeeded: boolean
    }>
  >
  /** End only the departing user's intervals; preserve all other managers. */
  releaseForUser: (
    input: Readonly<{
      organizationId: string
      userId: string
      /** Omit to release every Property assignment; pass ids for reconciliation. */
      propertyIds?: readonly string[]
      at: Date
      endReason: string
    }>,
  ) => Promise<
    Readonly<{
      released: number
    }>
  >
}>

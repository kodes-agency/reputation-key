import type { PortalResponsibleManager } from '../../domain/portal-responsible-manager'

export type PortalResponsibleManagerRepository = Readonly<{
  listActive: (
    organizationId: string,
    portalId: string,
  ) => Promise<readonly PortalResponsibleManager[]>
  listActiveForUser: (
    organizationId: string,
    userId: string,
  ) => Promise<readonly PortalResponsibleManager[]>
  replace: (
    input: Readonly<{
      organizationId: string
      propertyId: string
      portalId: string
      managerUserIds: readonly string[]
      expectedRevision: number
      actorId: string
      at: Date
    }>,
  ) => Promise<
    Readonly<{
      assignments: readonly PortalResponsibleManager[]
      revision: number
      becameResponsibilityNeeded: boolean
    }>
  >
  /** End only the departing user's intervals; preserve all other managers. */
  releaseForUser: (
    input: Readonly<{
      organizationId: string
      userId: string
      /** Omit to release every Portal assignment; pass ids for reconciliation. */
      portalIds?: readonly string[]
      at: Date
      endReason: string
    }>,
  ) => Promise<Readonly<{ released: number }>>
}>

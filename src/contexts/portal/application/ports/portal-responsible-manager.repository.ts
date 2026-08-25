import type { PortalResponsibleManager } from '../../domain/portal-responsible-manager'
import type { PortalResponsibilityNeeded } from '../../domain/events'

export type PortalResponsibleManagerRepository = Readonly<{
  listActive: (
    organizationId: string,
    portalId: string,
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
      responsibilityNeededEvent: PortalResponsibilityNeeded
    }>,
  ) => Promise<
    Readonly<{
      assignments: readonly PortalResponsibleManager[]
      revision: number
      becameResponsibilityNeeded: boolean
    }>
  >
}>

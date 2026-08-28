import type {
  OrganizationId,
  PortalApprovedDestinationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type {
  PortalApprovedDestination,
  ValidatedPortalDestination,
} from '../../domain/approved-destination'

export type PortalApprovedDestinationRepository = Readonly<{
  request: (
    input: Readonly<{
      id: PortalApprovedDestinationId
      organizationId: OrganizationId
      propertyId: PropertyId
      destination: ValidatedPortalDestination
      requestedBy: UserId
      approveCustom: boolean
      at: Date
    }>,
  ) => Promise<PortalApprovedDestination>
  findById: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    id: PortalApprovedDestinationId,
  ) => Promise<PortalApprovedDestination | null>
  list: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<readonly PortalApprovedDestination[]>
  /**
   * Exact current redirect authority for a published snapshot. Only approved
   * destinations with a recent successful network validation are returned.
   */
  listApprovedUris: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    uris: readonly string[],
    validatedAfter: Date,
  ) => Promise<readonly string[]>
  listDueForNetworkRevalidation: (
    before: Date,
    limit: number,
  ) => Promise<readonly PortalApprovedDestination[]>
  recordNetworkValidation: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      id: PortalApprovedDestinationId
      expectedLastValidatedAt: Date
      result:
        | Readonly<{ outcome: 'safe'; validatedAt: Date }>
        | Readonly<{
            outcome: 'unsafe'
            reason:
              | 'dns_non_public'
              | 'dns_address_changed'
              | 'redirect_target_invalid'
              | 'redirect_host_changed'
              | 'redirect_limit_exceeded'
            observedAt: Date
          }>
    }>,
  ) => Promise<PortalApprovedDestination | null>
  approve: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      id: PortalApprovedDestinationId
      approvedBy: UserId
      at: Date
    }>,
  ) => Promise<PortalApprovedDestination | null>
  disable: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      id: PortalApprovedDestinationId
      reason: string
      at: Date
    }>,
  ) => Promise<PortalApprovedDestination | null>
}>

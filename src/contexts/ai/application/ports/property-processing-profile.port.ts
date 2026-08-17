import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AiPropertyProfileResult } from '../../domain/types'

export type PropertyProcessingProfilePort = Readonly<{
  readForAi(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      expected?: Readonly<{
        sourceEpoch: number
        propertyProfileVersion: number
        routingPolicyVersion: number
      }>
    }>,
  ): Promise<AiPropertyProfileResult>

  refreshForAi(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
    }>,
  ): Promise<AiPropertyProfileResult>
}>

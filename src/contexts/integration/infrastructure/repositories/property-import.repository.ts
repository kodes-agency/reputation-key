// Integration context — property repository adapter for import use case
// Implements the PropertyImportRepo port defined in the application layer.
// Delegates all property data access through PropertyPublicApi,
// keeping the integration context free of direct Property schema imports.
// Per ADR-0001: cross-context data goes through PublicApi, not direct DB.

import type { PropertyImportRepo } from '../../application/ports/property-import-repo.port'
import { duplicateKeyError } from '../../application/ports/property-import-repo.port'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import { isPropertyImportConflict } from '#/contexts/property/application/public-api'
import {
  organizationId as toOrgId,
  googleConnectionId as toConnId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createPropertyImportRepository = (
  propertyApi: PropertyPublicApi,
): PropertyImportRepo => ({
  insertProperty: async (input) => {
    return trace('propertyImport.insertProperty', async () => {
      try {
        const result = await propertyApi.importProperty({
          orgId: toOrgId(input.organizationId),
          name: input.name,
          slug: input.slug,
          gbpPlaceId: input.gbpPlaceId,
          googleConnectionId: toConnId(input.googleConnectionId),
          countryCode: input.countryCode ?? null,
        })
        return {
          id: result.id,
          organizationId: result.organizationId,
          name: result.name,
          slug: result.slug,
          gbpPlaceId: result.gbpPlaceId,
          createdAt: result.createdAt,
        }
      } catch (err) {
        if (isPropertyImportConflict(err)) {
          throw duplicateKeyError(err.message)
        }
        throw err
      }
    })
  },

  findExistingGbpPlaceIds: async (organizationId, gbpPlaceIds) => {
    return trace('propertyImport.findExistingGbpPlaceIds', async () => {
      return propertyApi.findExistingGbpPlaceIds(toOrgId(organizationId), gbpPlaceIds)
    })
  },

  existsByGbpPlaceId: async (organizationId, gbpPlaceId) => {
    return trace('propertyImport.existsByGbpPlaceId', async () => {
      return propertyApi.existsByGbpPlaceId(toOrgId(organizationId), gbpPlaceId)
    })
  },

  countByGoogleConnectionId: async (organizationId, connectionId) => {
    return trace('propertyImport.countByGoogleConnectionId', async () => {
      const ids = await propertyApi.findIdsByGoogleConnection(
        toConnId(connectionId),
        toOrgId(organizationId),
      )
      return ids.length
    })
  },
})

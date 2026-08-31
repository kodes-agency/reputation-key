import type { Database } from '#/shared/db'
import {
  createPropertyCapabilityProvisioning,
  type PropertyCapabilityProvisioning,
} from '#/contexts/identity/application/use-cases/policy-admin'
import {
  getPropertyOrganizationId,
  listOrganizationCapabilities,
  listPropertyCapabilities,
  listProvisionablePropertyIds,
  provisionPropertyCapabilitiesFromOrganization,
} from '#/contexts/identity/infrastructure/repositories/policy-state.repository'

/**
 * Bind Identity's property capability policy to one injected database and
 * refresh callback. Operator tooling imports the same root-owned constructor.
 */
export function bindPropertyCapabilityProvisioning(
  db: Database,
  refreshPolicy: () => Promise<void>,
): PropertyCapabilityProvisioning {
  return createPropertyCapabilityProvisioning({
    listOrganizationCapabilities: (orgId) => listOrganizationCapabilities(db, orgId),
    listPropertyCapabilities: (propId) => listPropertyCapabilities(db, propId),
    getPropertyOrganizationId: (propId) => getPropertyOrganizationId(db, propId),
    listProvisionablePropertyIds: (orgId) => listProvisionablePropertyIds(db, orgId),
    provisionPropertyCapabilities: (input) =>
      provisionPropertyCapabilitiesFromOrganization(db, input),
    refreshPolicy,
  })
}

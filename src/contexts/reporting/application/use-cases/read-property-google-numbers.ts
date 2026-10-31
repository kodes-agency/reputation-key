import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  requireDashboardPropertyAccess,
  type DashboardPropertyAccess,
} from '../dashboard-property-access'
import type { ReadGoogleNumbers } from '../google-numbers-read'

export type ReadPropertyGoogleNumbersInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>
export type ReadPropertyGoogleNumbersDeps = Readonly<{
  propertyAccess: DashboardPropertyAccess
  readGoogleNumbers: ReadGoogleNumbers
  clock: () => Date
}>
/** A dashboard headline, independent of goal permission, goal setup and fleet scans. */
export function createReadPropertyGoogleNumbers(deps: ReadPropertyGoogleNumbersDeps) {
  return async (input: ReadPropertyGoogleNumbersInput, actor: AuthContext) => {
    await requireDashboardPropertyAccess(deps.propertyAccess, actor, {
      organizationId: input.organizationId,
      propertyIds: [input.propertyId],
    })
    return deps.readGoogleNumbers(input.organizationId, input.propertyId, deps.clock())
  }
}
export type ReadPropertyGoogleNumbers = ReturnType<typeof createReadPropertyGoogleNumbers>

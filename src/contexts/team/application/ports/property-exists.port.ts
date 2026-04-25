// Team context — port for checking property existence
// The team context needs to verify that a property exists in the org
// before creating a team under it. Rather than importing the property
// context's repository (which would violate context boundaries), we
// define a local port and wire it in composition.ts.

import type { OrganizationId } from '#/shared/domain/ids'
import type { PropertyId } from '#/shared/domain/ids'

export type PropertyExistsPort = Readonly<{
  exists: (orgId: OrganizationId, propertyId: PropertyId) => Promise<boolean>
}>

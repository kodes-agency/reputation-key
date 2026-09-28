// Feed notification surface — whether a Property is still inside the
// workspace. Property eligibility answers who may act on a Property, and
// ignores its lifecycle; an archived Property still has eligible managers, but
// nobody can approve or publish anything there.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type ActivePropertyLookup = (
  organizationId: OrganizationId,
  propertyId: PropertyId,
) => Promise<boolean>

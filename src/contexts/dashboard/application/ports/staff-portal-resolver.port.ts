// Dashboard context — staff portal resolver port
// Resolves the portals a staff user is assigned to.
// The dashboard context does NOT import staff context directly —
// this port is implemented by the composition root.

import type { PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

export type StaffPortalResolver = (
  input: { userId: UserId; propertyId: PropertyId },
  ctx: AuthContext,
) => Promise<ReadonlyArray<PortalId>>

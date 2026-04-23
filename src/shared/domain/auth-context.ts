// AuthContext — the caller's identity passed to every use case.
// Per architecture: "tenantMiddleware resolves org from session and attaches to AuthContext."
// Use cases receive this as their second parameter: (input, ctx) => Promise<T>
//
// Lives in shared/domain/ because it's a domain concept — "who is making this call" —
// not an auth-framework concern. The middleware that produces it lives in shared/auth/,
// but the type itself is imported by application-layer code that mustn't depend on auth.

import type { OrganizationId, UserId } from './ids'
import type { Role } from './roles'

/** Auth context attached to every authenticated request. */
export type AuthContext = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  role: Role
}>

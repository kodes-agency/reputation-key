// Identity context — domain types
// Entity types for the identity context. Role types and mapping functions
// are canonical in shared/domain/roles.ts and re-exported here for
// consumers that import from the identity domain.

import type { OrganizationId, UserId } from '#/shared/domain/ids'

// Re-export role types and mappings from the canonical source.
// Per architecture: shared/domain/ is the single source of truth for cross-cutting types.
export type { Role, BetterAuthRole } from '#/shared/domain/roles'
export { toDomainRole, toBetterAuthRole } from '#/shared/domain/roles'

/** Membership within an organization */
export type Membership = Readonly<{
  id: string
  organizationId: OrganizationId
  userId: UserId
  role: import('#/shared/domain/roles').Role
  createdAt: Date
}>

/** Organization entity */
export type Organization = Readonly<{
  id: OrganizationId
  name: string
  slug: string
  logo: string | null
  createdAt: Date
}>

/** Invitation entity */
export type Invitation = Readonly<{
  id: string
  organizationId: OrganizationId
  email: string
  role: import('#/shared/domain/roles').Role
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
  expiresAt: Date
  inviterId: UserId
  createdAt: Date
}>

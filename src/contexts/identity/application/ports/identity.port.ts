// Identity context — port for identity operations delegated to better-auth.
// Per architecture: "Ports are TypeScript types defining capability contracts.
// The implementation lives in infrastructure/. The use case depends only on the type."

import type { Role } from '#/shared/domain/roles'
import type { Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import type { OrganizationId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

/** Organization member shape returned by the port. */
export type MemberRecord = Readonly<{
  id: string
  userId: string
  email: string
  name: string
  /** Built-in domain Role, or null when the member has a custom-only / multi role. */
  role: Role | null
  /** Raw better-auth role string (may be multi-role or custom) — for display + owner detection. */
  rawRole: string
  image: string | null
  createdAt: Date
}>

/** Invitation record shape returned by the port. */
export type InvitationRecord = Readonly<{
  id: string
  email: string
  role: Role | null
  /** Raw better-auth role string — for display + owner detection. */
  rawRole: string
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
  expiresAt: Date
  createdAt: Date
  organizationId?: OrganizationId
  organizationName?: string
  propertyIds: ReadonlyArray<string>
}>

/** Organization record shape returned by the port. */
export type OrganizationRecord = Readonly<{
  id: string
  name: string
  slug: string
  logo: string | null
  createdAt: Date
  contactEmail: string | null
  billingCompanyName: string | null
  billingAddress: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
  responseSlaHours: number
}>

/** Port for identity operations — wraps better-auth API calls. */
export type IdentityPort = Readonly<{
  /** Sign up a new user. Returns user ID. */
  signUp: (name: string, email: string, password: string) => Promise<string>

  /** List members of the active organization. */
  listMembers: (ctx: AuthContext) => Promise<ReadonlyArray<MemberRecord>>

  /** Get a single member by ID within the active organization. */
  getMember: (ctx: AuthContext, memberId: string) => Promise<MemberRecord | null>

  /** List pending invitations for the active organization. */
  listInvitations: (ctx: AuthContext) => Promise<ReadonlyArray<InvitationRecord>>

  /** List invitations for the current user across all organizations. */
  listUserInvitations: (headers: Headers) => Promise<ReadonlyArray<InvitationRecord>>

  /** List organizations the current user belongs to. */
  listUserOrganizations: (headers: Headers) => Promise<ReadonlyArray<OrganizationRecord>>

  /** Get the active organization details for the current session. */
  getActiveOrg: (headers: Headers) => Promise<OrganizationRecord | null>

  /** Set the active organization for the current session. */
  setActiveOrganization: (headers: Headers, organizationId: string) => Promise<void>

  /**
   * Resolve the session user (id + email) for invitation acceptance.
   * Returns null when there is no active session.
   */
  getSessionUser: (
    headers: Headers,
  ) => Promise<Readonly<{ id: string; email: string }> | null>

  /**
   * Post-acceptance hook — auto-create staff assignments for the invited
   * properties (replaces BA's afterAcceptInvitation hook, which the app-owned
   * accept path bypasses). Failure-isolated inside the adapter.
   */
  runOnAcceptInvitation: (ctx: {
    userId: string
    organizationId: string
    propertyIds: ReadonlyArray<string>
  }) => Promise<void>

  /**
   * Create a custom role definition (organizationRole + organization_role_policy) in one
   * atomic transaction. App-owned write path — the raw BA create-role endpoint is blocked.
   * Throws `already_exists` on a duplicate (case-insensitive) role name in the org.
   */
  createCustomRole: (
    ctx: AuthContext,
    input: Readonly<{
      role: string
      permissions: ReadonlyArray<Permission>
      dataScope: DataScope
    }>,
  ) => Promise<void>
  /** Update a custom role's permissions + data scope (atomic). App-owned write path. */
  updateCustomRole: (
    ctx: AuthContext,
    role: string,
    input: Readonly<{
      permissions: ReadonlyArray<Permission>
      dataScope: DataScope
    }>,
  ) => Promise<void>
  /**
   * Delete a custom role definition (organizationRole + organization_role_policy, atomic).
   * Members still holding the role become permissionless via the resolver's fail-closed
   * path (missing role definition → no permissions). App-owned write path.
   */
  deleteCustomRole: (ctx: AuthContext, role: string) => Promise<void>
  /** Delete a user by ID. Used as compensating transaction when org setup fails. */
  deleteUser: (userId: string) => Promise<void>
}>

/** Storage port for avatar uploads — local abstraction to avoid cross-context imports. */
export type IdentityStoragePort = Readonly<{
  createPresignedUploadUrl: (
    key: string,
    contentType: string,
    maxSizeBytes: number,
  ) => Promise<{ uploadUrl: string; key: string }>
}>

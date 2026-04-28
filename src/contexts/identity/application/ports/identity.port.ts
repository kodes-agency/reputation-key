// Identity context — port for identity operations delegated to better-auth.
// Per architecture: "Ports are TypeScript types defining capability contracts.
// The implementation lives in infrastructure/. The use case depends only on the type."

import type { Role } from '#/shared/domain/roles'
import type { OrganizationId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

/** Organization member shape returned by the port. */
export type MemberRecord = Readonly<{
  id: string
  userId: string
  email: string
  name: string
  role: Role
  image: string | null
  createdAt: Date
}>

/** Invitation record shape returned by the port. */
export type InvitationRecord = Readonly<{
  id: string
  email: string
  role: Role
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
  expiresAt: Date
  createdAt: Date
  organizationId?: OrganizationId
  organizationName?: string
}>

/** Organization record shape returned by the port. */
export type OrganizationRecord = Readonly<{
  id: string
  name: string
  slug: string
  logo: string | null
  createdAt: Date
}>

/** Port for identity operations — wraps better-auth API calls. */
export type IdentityPort = Readonly<{
  /** Sign up a new user. Returns user ID. */
  signUp: (name: string, email: string, password: string) => Promise<string>

  /** List members of the active organization. */
  listMembers: (ctx: AuthContext) => Promise<ReadonlyArray<MemberRecord>>

  /** Get a single member by ID within the active organization. */
  getMember: (ctx: AuthContext, memberId: string) => Promise<MemberRecord | null>

  /** Create an invitation to join the organization. Returns the invitation ID. */
  createInvitation: (
    ctx: AuthContext,
    email: string,
    role: string,
    propertyIds?: ReadonlyArray<string>,
  ) => Promise<string>

  /** Accept an invitation (may not require active org). */
  acceptInvitation: (invitationId: string, headers: Headers) => Promise<void>

  /** Reject an invitation. */
  rejectInvitation: (invitationId: string, headers: Headers) => Promise<void>

  /** List pending invitations for the active organization. */
  listInvitations: (ctx: AuthContext) => Promise<ReadonlyArray<InvitationRecord>>

  /** List invitations for the current user across all organizations. */
  listUserInvitations: (headers: Headers) => Promise<ReadonlyArray<InvitationRecord>>

  /** Update a member's role. */
  updateMemberRole: (ctx: AuthContext, memberId: string, role: string) => Promise<void>

  /** Remove a member from the organization. */
  removeMember: (ctx: AuthContext, memberId: string) => Promise<void>

  /** List organizations the current user belongs to. */
  listUserOrganizations: (headers: Headers) => Promise<ReadonlyArray<OrganizationRecord>>

  /** Set the active organization for the current session. */
  setActiveOrganization: (headers: Headers, organizationId: string) => Promise<void>
}>

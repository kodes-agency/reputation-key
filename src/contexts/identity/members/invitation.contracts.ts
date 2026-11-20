// Identity context — DTOs for invitation flow
// Zod schemas for input/output shapes that cross network boundaries.
// Per architecture: "Zod at HTTP boundaries (server function inputs)"

import { z } from 'zod/v4'
import { INVITATION_ID_MAX_LENGTH } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'

export const inviteMemberInputSchema = z.object({
  email: z.email('A valid email address is required'),
  role: z.enum(['AccountAdmin', 'PropertyManager'] as const),
  propertyIds: z.array(z.string().min(1, 'This field is required')).default([]),
})
export type InviteMemberInput = z.infer<typeof inviteMemberInputSchema>

export const acceptInvitationInputSchema = z.object({
  invitationId: z.string().min(1, 'Invitation ID is required'),
})
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>

export const updateMemberRoleInputSchema = z.object({
  memberId: z.string().min(1, 'Member ID is required'),
  role: z.enum(['AccountAdmin', 'PropertyManager'] as const),
})
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInputSchema>

export const removeMemberInputSchema = z.object({
  memberId: z.string().min(1, 'Member ID is required'),
})
export type RemoveMemberInput = z.infer<typeof removeMemberInputSchema>

export const registerUserInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.email('A valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  organizationName: z
    .string()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100, 'Organization name must be at most 100 characters'),
})
export type RegisterUserInput = z.infer<typeof registerUserInputSchema>

/** Member registration — creates user only, no organization. */
export const registerMemberInputSchema = z.object({
  invitationId: z.string().min(1, 'Invitation ID is required'),
  name: z.string().min(1, 'Name is required').max(100),
  email: z.email('A valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
export type RegisterMemberInput = z.infer<typeof registerMemberInputSchema>

export const setActiveOrgInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
})
export type SetActiveOrgInput = z.infer<typeof setActiveOrgInputSchema>

/**
 * The anonymous invitation-link preview. The id is a bearer secret; e2e ids
 * are not UUIDs, so only the length is bounded.
 */
export const invitationPreviewInputSchema = z.object({
  invitationId: z
    .string()
    .min(1, 'Invitation ID is required')
    .max(INVITATION_ID_MAX_LENGTH),
})
export type InvitationPreviewInput = z.infer<typeof invitationPreviewInputSchema>

/** Ask for a fresh email-verification link (anonymous, rate-limited). */
export const resendVerificationEmailInputSchema = z.object({
  email: z.email('A valid email address is required'),
})
export type ResendVerificationEmailInput = z.infer<
  typeof resendVerificationEmailInputSchema
>

export const signInInputSchema = z.object({
  email: z.email('A valid email address is required'),
  password: z.string().min(1, 'Password is required'),
})
export type SignInInput = z.infer<typeof signInInputSchema>

/** Role as returned in API responses */
const roleSchema = z.enum(['AccountAdmin', 'PropertyManager', 'Member'] as const)
export type RoleResponse = z.infer<typeof roleSchema>

const _memberResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: roleSchema,
  email: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  createdAt: z.date(),
})
export type MemberResponse = z.infer<typeof _memberResponseSchema>

const _invitationResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: roleSchema,
  status: z.enum(['pending', 'accepted', 'rejected', 'canceled', 'expired'] as const),
  expiresAt: z.date(),
  createdAt: z.date(),
})
export type InvitationResponse = z.infer<typeof _invitationResponseSchema>

/**
 * One open invitation on an Organization's Members page. Browser-safe: the
 * Members UI and the operator console read this shape.
 */
export type OrganizationInvitation = Readonly<{
  id: string
  email: string
  /** null = a non-beta raw role; the UI falls back to rawRole. */
  role: Role | null
  rawRole: string
  /** Stored 'pending' past its expiry, or stored 'expired', reads 'expired'. */
  status: 'pending' | 'expired'
  createdAt: Date
  expiresAt: Date
  /** user.name via invitation.inviterId; null when that user is gone. */
  inviterName: string | null
  /** [] for an AccountAdmin; deleted Properties are dropped. */
  properties: ReadonlyArray<Readonly<{ id: string; name: string }>>
}>

/** listInvitations: the Organization's open invitations, newest first. */
export type ListInvitationsOutput = Readonly<{
  invitations: ReadonlyArray<OrganizationInvitation>
}>

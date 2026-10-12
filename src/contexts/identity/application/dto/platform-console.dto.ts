// Identity context — DTOs for the platform operator console (ADR 0065).
// Browser-safe: the console route and its forms import these shapes.

import { z } from 'zod/v4'
import type { UserId } from '#/shared/domain/ids'
import type { OrganizationLifecycleState } from '../../domain/organization-lifecycle'

/** The slug rule Identity's validateSlug enforces, for inline form feedback. */
const ORGANIZATION_SLUG_INPUT_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email must be at most 254 characters')
  .pipe(z.email('A valid email address is required'))

const organizationIdSchema = z
  .string()
  .trim()
  .min(1, 'Organization ID is required')
  .max(64, 'Organization ID is too long')

export const provisionOrganizationInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100, 'Organization name must be at most 100 characters'),
  /** Omitted → derived from the name with deriveOrganizationSlug. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Slug must be at least 2 characters')
    .max(63, 'Slug must be at most 63 characters')
    .regex(
      ORGANIZATION_SLUG_INPUT_PATTERN,
      'Slug may use lowercase letters, numbers and inner hyphens',
    )
    .optional(),
  adminEmail: emailSchema,
})
export type ProvisionOrganizationInput = z.infer<typeof provisionOrganizationInputSchema>

export const inviteOrganizationAdminInputSchema = z.object({
  organizationId: organizationIdSchema,
  email: emailSchema,
})
export type InviteOrganizationAdminInput = z.infer<
  typeof inviteOrganizationAdminInputSchema
>

export const organizationInvitationInputSchema = z.object({
  organizationId: organizationIdSchema,
  invitationId: z
    .string()
    .trim()
    .min(1, 'Invitation ID is required')
    .max(128, 'Invitation ID is too long'),
})
export type OrganizationInvitationInput = z.infer<
  typeof organizationInvitationInputSchema
>

/** Who is acting: the operator's user id (the invitations' inviter) and name. */
export type PlatformOperatorActor = Readonly<{ userId: UserId; name: string }>

/** An open AccountAdmin invitation of an Organization with no AccountAdmin. */
export type PlatformAdminInvitationView = Readonly<{
  id: string
  email: string
  /** ISO timestamp. */
  expiresAt: string
  /** Past its expiry, or marked expired; Resend renews it. */
  expired: boolean
}>

export type PlatformOrganizationView = Readonly<{
  id: string
  name: string
  slug: string
  /** ISO timestamp. */
  createdAt: string
  lifecycleState: OrganizationLifecycleState
  memberCount: number
  accountAdminCount: number
  /** Invitations of any role still pending and not past their expiry. */
  pendingInvitationCount: number
  /** False while BETA_ALLOWLIST_ORGS does not cover this Organization. */
  controlledBetaEnabled: boolean
  /**
   * Open (pending or expired) AccountAdmin invitations, newest first. Empty
   * once the Organization has an AccountAdmin: the console stops acting on
   * it, so it stops showing invitees' addresses too.
   */
  pendingAdminInvitations: ReadonlyArray<PlatformAdminInvitationView>
}>

/** The Organization and its first AccountAdmin invitation, committed together. */
export type ProvisionOrganizationResult = Readonly<{
  organizationId: string
  slug: string
  invitationId: string
  /** False when the email failed after the commit; Resend sends it again. */
  emailSent: boolean
}>

export type InviteOrganizationAdminResult = Readonly<{
  invitationId: string
  emailSent: boolean
}>

export type ResendOrganizationAdminInvitationResult = Readonly<{
  /** ISO timestamp of the renewed expiry. */
  expiresAt: string
  emailSent: boolean
}>

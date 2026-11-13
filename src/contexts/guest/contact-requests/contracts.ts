import { z } from 'zod/v4'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

export const CONTACT_REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type ContactRequestScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
}>

export type ContactRequestPurpose = 'manager_follow_up'
export type ContactRequestAccessPurpose = 'respond_to_contact_request'

export type ContactRequestContact = Readonly<{
  email: string
  name?: string
}>

export type MaskedContactRequest = Readonly<{
  id: string
  scope: ContactRequestScope
  responseId: string
  purpose: ContactRequestPurpose
  maskedContact: '••••••••'
  submittedAt: Date
  expiresAt: Date
}>

export type ContactRequestGuestAuthority = Readonly<{
  /** Complete Cookie header carrying the signed `rk_guest_session` value. */
  signedSession: string
  csrfNonce: string
}>

export type ContactRequestManagerAuthorityBasis =
  'account_admin' | 'portal_creator' | 'responsible_manager'

export type ContactRequestManagerAuthorization = Readonly<{
  actorId: string
  basis: ContactRequestManagerAuthorityBasis
  checkedAt: Date
}>

export type ContactRequestPolicyAction = Extract<
  Permission,
  'inbox.read' | 'feedback.read' | 'feedback.contact_read'
>

export type ContactRequestPolicyPurpose =
  'view_contact_request' | 'respond_to_contact_request'

/**
 * A strict subset of the central ExecutionPolicy request, so role, capability,
 * suspension and Property-grant rules stay in one place.
 */
export const contactRequestPolicyInput = (
  ctx: AuthContext,
  scope: ContactRequestScope,
  action: ContactRequestPolicyAction,
  reason: ContactRequestPolicyPurpose,
  now: Date,
) => ({
  principal: { kind: 'user' as const, ctx },
  action,
  capability: 'portal.guest_contact' as const,
  organizationId: scope.organizationId,
  propertyId: scope.propertyId,
  executionKind: 'interactive' as const,
  reason,
  now,
})

export const contactRequestPurposeSchema = z.enum(['manager_follow_up'] as const)

export const contactRequestEmailSchema = z.string().trim().max(254).pipe(z.email())
export const contactRequestNameSchema = z.string().trim().min(1).max(100)

export const contactRequestContactSchema = z.strictObject({
  email: contactRequestEmailSchema,
  name: contactRequestNameSchema.optional(),
})

/**
 * Consent deliberately defaults to false; the lifecycle still requires the
 * caller to send an explicit true value.
 */
export const submitContactRequestInputSchema = z
  .object({
    organizationId: z.string().min(1).max(255),
    propertyId: z.uuid(),
    portalId: z.uuid(),
    responseId: z.uuid(),
    email: contactRequestEmailSchema,
    name: contactRequestNameSchema.optional(),
    consent: z.boolean().default(false),
    purpose: contactRequestPurposeSchema.optional(),
  })
  .strict()

export type SubmitContactRequestDto = z.infer<typeof submitContactRequestInputSchema>

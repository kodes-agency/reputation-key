import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import type { ContactRequestScope } from '../../domain/contact-request'

export type ContactRequestPolicyAction = Extract<
  Permission,
  'inbox.read' | 'feedback.read' | 'feedback.contact_read'
>

export type ContactRequestPolicyPurpose =
  'view_contact_request' | 'respond_to_contact_request'

/**
 * Guest-owned authorization seam. Its request is intentionally a strict subset
 * of the central ExecutionPolicy contract so composition can delegate without
 * rebuilding role, capability, suspension, or Property-grant rules here.
 */
export type ContactRequestExecutionPolicyPort = Readonly<{
  decide(input: {
    principal: Readonly<{ kind: 'user'; ctx: AuthContext }>
    action: ContactRequestPolicyAction
    capability: 'portal.guest_contact'
    organizationId: string
    propertyId: string
    executionKind: 'interactive'
    reason: ContactRequestPolicyPurpose
    now: Date
  }): Promise<Readonly<{ allowed: boolean; reason: string }>>
}>

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

import type { SystemAction } from '#/shared/governance/entry-point-catalogue'
import type { Capability } from '#/shared/auth/beta-capabilities'
import { decidePublicExecution } from '#/shared/auth/execution-policy'

/** The catalogue action of acceptance; the recovery job is governed under it too. */
const ACCEPT_INVITATION_ACTION: SystemAction = 'system:identity.accept_invitation'

/**
 * Whether the execution policy admits acceptance for an Organization under
 * one capability. A joiner has no tenant context yet, so the policy decides for
 * the invitation's Organization (ADR 0032): the kill switch, an Organization
 * suspension and isolated restore mode refuse.
 */
export const isAcceptanceAdmitted = async (
  capability: Capability,
  organizationId: string,
  now: Date,
): Promise<boolean> =>
  (
    await decidePublicExecution({
      action: ACCEPT_INVITATION_ACTION,
      capability,
      organizationId,
      now,
    })
  ).allowed

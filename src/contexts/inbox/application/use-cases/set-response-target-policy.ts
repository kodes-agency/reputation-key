import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import type { ResponseTargetKind } from '../../domain/response-target'
import { inboxError } from '../../domain/errors'
import type { ResponseTargetPolicyStore } from '../ports/response-target-policy.store'

type OrganizationPolicyInput = Readonly<{
  scope: 'organization'
  targetKind: ResponseTargetKind
  durationMinutes: number
  expectedPolicyVersion: number | null
}>

type PropertyOverrideInput = Readonly<{
  scope: 'property'
  propertyId: PropertyId
  /** Null disables the override and restores Organization/default resolution. */
  durationMinutes: number | null
  expectedPolicyVersion: number | null
  targetKind?: 'private_feedback_handling'
}>

export type SetResponseTargetPolicyInput = OrganizationPolicyInput | PropertyOverrideInput
export type SetResponseTargetPolicyDeps = Readonly<{
  store: ResponseTargetPolicyStore
  clock: () => Date
}>

export const setResponseTargetPolicy = (deps: SetResponseTargetPolicyDeps) => {
  return async (input: SetResponseTargetPolicyInput, ctx: AuthContext) => {
    if (
      !canForContext(ctx, 'organization.update') ||
      scopeForPermission(ctx, 'organization.update') !== 'organization'
    ) {
      throw inboxError(
        'forbidden',
        'Organization administrator permission is required for Response Targets',
      )
    }
    const shared = {
      organizationId: ctx.organizationId,
      expectedPolicyVersion: input.expectedPolicyVersion,
      actorUserId: ctx.userId,
      at: deps.clock(),
    }
    if (input.scope === 'property') {
      if (
        'targetKind' in input &&
        input.targetKind !== undefined &&
        input.targetKind !== 'private_feedback_handling'
      ) {
        throw inboxError(
          'invalid_input',
          'Google Review Response Targets do not support a Property override',
        )
      }
      return deps.store.setPrivateFeedbackPropertyOverride({
        ...shared,
        propertyId: input.propertyId,
        durationMinutes: input.durationMinutes,
      })
    }
    return deps.store.setOrganizationPolicy({
      ...shared,
      targetKind: input.targetKind,
      durationMinutes: input.durationMinutes,
    })
  }
}

export type SetResponseTargetPolicy = ReturnType<typeof setResponseTargetPolicy>

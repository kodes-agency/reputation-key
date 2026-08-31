import {
  organizationClosureDeadline,
  validateLifecycleEvidenceRef,
  type OrganizationClosureCancelReasonCode,
  type OrganizationClosureRequestReasonCode,
  type OrganizationLifecycleStatus,
} from '../../domain/organization-lifecycle'
import { identityError } from '../../domain/errors'
import type { OrganizationLifecycleCommandStore } from '../ports/organization-lifecycle-command-store.port'

export type OrganizationLifecycleDeps = Readonly<{
  store: OrganizationLifecycleCommandStore
  clock: () => Date
  /** Refreshes this process from the policy generation committed by requestClosure. */
  refreshPolicy: () => Promise<void>
  /**
   * Whether this deployment can actually reactivate a cancelled closure.
   *
   * Requesting a closure commits an Organization-wide suspension, and
   * cancelling deliberately LEAVES that suspension in place with the
   * reactivation fence set — nothing resumes silently. Reactivation is the only
   * command that lifts it. If reactivation is not composed, a single request
   * therefore suspends the tenant with no in-product way back.
   *
   * So the request is refused unless the undo path exists. Read as a thunk
   * because the reactivation binding is constructed after this facade.
   */
  reactivationConfigured: () => boolean
}>

export type RequestOrganizationClosureInput = Readonly<{
  operationId: string
  organizationId: string
  actorUserId: string
  reasonCode: OrganizationClosureRequestReasonCode
  supportEvidenceRef: string
}>

export type GetOrganizationLifecycleStatusInput = Readonly<{
  organizationId: string
  actorUserId: string
}>

export type CancelOrganizationClosureInput = Readonly<{
  operationId: string
  organizationId: string
  actorUserId: string
  reasonCode: OrganizationClosureCancelReasonCode
  supportEvidenceRef: string
}>

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validateOperationId(value: string): string {
  if (!OPERATION_ID_PATTERN.test(value)) throw new Error('operationId must be a UUID')
  return value
}

export function createOrganizationLifecycle(deps: OrganizationLifecycleDeps) {
  return {
    /**
     * Whether a closure can be requested at all in this deployment.
     *
     * Exposed so the UI can say so instead of arming a destructive control for
     * a command that can only refuse. `requestClosure` enforces the same rule;
     * this is the read side of it.
     */
    closureRequestAvailable(): boolean {
      return deps.reactivationConfigured()
    },

    async requestClosure(
      input: RequestOrganizationClosureInput,
    ): Promise<OrganizationLifecycleStatus> {
      if (!deps.reactivationConfigured()) {
        throw identityError(
          'forbidden',
          'Organization closure is unavailable: this deployment cannot reactivate a cancelled closure, and requesting one would suspend the Organization with no way back.',
        )
      }
      const now = deps.clock()
      const result = await deps.store.requestClosure({
        ...input,
        operationId: validateOperationId(input.operationId),
        supportEvidenceRef: validateLifecycleEvidenceRef(input.supportEvidenceRef),
        now,
        recoverableUntil: organizationClosureDeadline(now),
      })
      // The state + suspension + generation are already durable. Do not report
      // the request as ready to the caller until this process observes them.
      await deps.refreshPolicy()
      return result
    },

    getStatus(input: GetOrganizationLifecycleStatusInput) {
      return deps.store.getStatus(input)
    },

    async cancelClosure(
      input: CancelOrganizationClosureInput,
    ): Promise<OrganizationLifecycleStatus> {
      return deps.store.cancelClosure({
        ...input,
        operationId: validateOperationId(input.operationId),
        supportEvidenceRef: validateLifecycleEvidenceRef(input.supportEvidenceRef),
        now: deps.clock(),
      })
    },
  } as const
}

export type OrganizationLifecycle = ReturnType<typeof createOrganizationLifecycle>

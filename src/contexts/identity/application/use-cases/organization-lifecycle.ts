import {
  organizationClosureDeadline,
  validateLifecycleEvidenceRef,
  type OrganizationClosureCancelReasonCode,
  type OrganizationClosureRequestReasonCode,
  type OrganizationLifecycleStatus,
} from '../../domain/organization-lifecycle'
import type { OrganizationLifecycleCommandStore } from '../ports/organization-lifecycle-command-store.port'

export type OrganizationLifecycleDeps = Readonly<{
  store: OrganizationLifecycleCommandStore
  clock: () => Date
  /** Refreshes this process from the policy generation committed by requestClosure. */
  refreshPolicy: () => Promise<void>
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
    async requestClosure(
      input: RequestOrganizationClosureInput,
    ): Promise<OrganizationLifecycleStatus> {
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

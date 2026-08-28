import type {
  OrganizationClosureCancelReasonCode,
  OrganizationClosureRequestReasonCode,
  OrganizationLifecycleState,
  OrganizationLifecycleStatus,
} from '../../domain/organization-lifecycle'

export type RequestOrganizationClosureCommand = Readonly<{
  operationId: string
  organizationId: string
  actorUserId: string
  reasonCode: OrganizationClosureRequestReasonCode
  supportEvidenceRef: string
  now: Date
  recoverableUntil: Date
}>

export type CancelOrganizationClosureCommand = Readonly<{
  operationId: string
  organizationId: string
  actorUserId: string
  reasonCode: OrganizationClosureCancelReasonCode
  supportEvidenceRef: string
  now: Date
}>

/**
 * LIF-01-T18. Reactivation is compare-and-set on the revision the caller
 * evaluated readiness against: a concurrent closure request, cancel or
 * operator transition between the readiness pass and this command must lose,
 * because its readiness evidence describes a different Organization state.
 */
export type ReactivateOrganizationCommand = Readonly<{
  operationId: string
  organizationId: string
  actorUserId: string
  expectedRevision: number
  closureLineageId: string
  /** Digest of the readiness + acknowledgement evidence. Content-free. */
  supportEvidenceRef: string
  now: Date
}>

export type TransitionOrganizationLifecycleCommand = Readonly<{
  organizationId: string
  closureLineageId: string
  expectedRevision: number
  from: OrganizationLifecycleState
  to: OrganizationLifecycleState
  actorUserId: string
  reasonCode:
    | 'closing_prepared'
    | 'recovery_window_elapsed'
    | 'recovery_window_waived'
    | 'purge_cancelled_before_irreversible'
    | 'irreversible_purge_authorized'
    | 'context_purge_complete'
  supportEvidenceRef: string
  now: Date
}>

export type ListOrganizationLifecycleCandidatesInput = Readonly<{
  states: readonly OrganizationLifecycleState[]
  now: Date
  limit: number
}>

export type OrganizationLifecycleCommandStore = Readonly<{
  requestClosure(
    command: RequestOrganizationClosureCommand,
  ): Promise<OrganizationLifecycleStatus>
  getStatus(input: {
    organizationId: string
    actorUserId: string
  }): Promise<OrganizationLifecycleStatus>
  cancelClosure(
    command: CancelOrganizationClosureCommand,
  ): Promise<OrganizationLifecycleStatus>
  /**
   * Clears `reactivation_required` and lifts the Organization suspension in
   * one transaction. Readiness is the caller's obligation; this method only
   * enforces the authority, the state precondition and the compare-and-set.
   */
  reactivate(command: ReactivateOrganizationCommand): Promise<OrganizationLifecycleStatus>
  /** Internal worker/operator read. Authorization belongs to its caller. */
  getAuthority(organizationId: string): Promise<OrganizationLifecycleStatus>
  listCandidates(
    input: ListOrganizationLifecycleCandidatesInput,
  ): Promise<readonly OrganizationLifecycleStatus[]>
  transition(
    command: TransitionOrganizationLifecycleCommand,
  ): Promise<OrganizationLifecycleStatus>
}>

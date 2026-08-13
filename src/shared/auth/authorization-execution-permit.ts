import type { GoogleContentCapability } from './google-content-contract'

export type AuthorizationExecutionPermitState =
  | 'admitted'
  | 'started'
  | 'completed'
  | 'fenced'

export type AuthorizationCommitVectorMode = 'full' | 'core_credential_projection'

export type AuthorizationExecutionPermit = Readonly<{
  id: string
  capability: GoogleContentCapability
  organizationId: string
  propertyId: string | null
  connectionId: string | null
  initiatorUserId: string | null
  operationKey: string
  routeKey: string
  routeCatalogVersion: string
  quotaPolicyId: string
  policyVersion: number
  emergencyKillVersion: number
  approvalBindingId: string
  permitGeneration: number
  startVectorMode: AuthorizationCommitVectorMode
  commitVectorMode: AuthorizationCommitVectorMode
  state: AuthorizationExecutionPermitState
  admittedAt: Date
  startDeadlineAt: Date
  startedAt: Date | null
  operationDeadlineAt: Date | null
  completedAt: Date | null
  fencedAt: Date | null
}>

export type AdmitAuthorizationExecutionPermitInput = Omit<
  AuthorizationExecutionPermit,
  | 'state'
  | 'admittedAt'
  | 'startDeadlineAt'
  | 'startedAt'
  | 'operationDeadlineAt'
  | 'completedAt'
  | 'fencedAt'
>

export const AUTHORIZATION_PERMIT_START_DEADLINE_MS = 1_000
export const AUTHORIZATION_PERMIT_OPERATION_DEADLINE_MS = 30_000

export function createAdmittedExecutionPermit(
  input: AdmitAuthorizationExecutionPermitInput,
  now: Date,
): AuthorizationExecutionPermit {
  const admittedAt = new Date(now.getTime())
  return {
    ...input,
    state: 'admitted',
    admittedAt,
    startDeadlineAt: new Date(
      admittedAt.getTime() + AUTHORIZATION_PERMIT_START_DEADLINE_MS,
    ),
    startedAt: null,
    operationDeadlineAt: null,
    completedAt: null,
    fencedAt: null,
  }
}

export type ExecutionPermitFenceReason =
  | 'state_not_admitted'
  | 'start_deadline_elapsed'
  | 'policy_version_changed'
  | 'emergency_kill_changed'
  | 'approval_binding_changed'

export type StartExecutionPermitResult =
  | Readonly<{ kind: 'started'; permit: AuthorizationExecutionPermit }>
  | Readonly<{
      kind: 'fenced'
      reason: ExecutionPermitFenceReason
      permit: AuthorizationExecutionPermit
    }>

function fencedStartResult(
  permit: AuthorizationExecutionPermit,
  now: Date,
  reason: ExecutionPermitFenceReason,
): StartExecutionPermitResult {
  if (permit.state !== 'admitted') {
    return { kind: 'fenced', reason, permit }
  }
  return {
    kind: 'fenced',
    reason,
    permit: {
      ...permit,
      state: 'fenced',
      fencedAt: new Date(now.getTime()),
    },
  }
}

export function startExecutionPermit(
  permit: AuthorizationExecutionPermit,
  input: Readonly<{
    now: Date
    policyVersion: number
    emergencyKillVersion: number
    approvalBindingId: string
  }>,
): StartExecutionPermitResult {
  if (permit.state !== 'admitted') {
    return fencedStartResult(permit, input.now, 'state_not_admitted')
  }
  if (input.now.getTime() >= permit.startDeadlineAt.getTime()) {
    return fencedStartResult(permit, input.now, 'start_deadline_elapsed')
  }
  if (input.policyVersion !== permit.policyVersion) {
    return fencedStartResult(permit, input.now, 'policy_version_changed')
  }
  if (input.emergencyKillVersion !== permit.emergencyKillVersion) {
    return fencedStartResult(permit, input.now, 'emergency_kill_changed')
  }
  if (input.approvalBindingId !== permit.approvalBindingId) {
    return fencedStartResult(permit, input.now, 'approval_binding_changed')
  }

  const startedAt = new Date(input.now.getTime())
  return {
    kind: 'started',
    permit: {
      ...permit,
      state: 'started',
      startedAt,
      operationDeadlineAt: new Date(
        startedAt.getTime() + AUTHORIZATION_PERMIT_OPERATION_DEADLINE_MS,
      ),
    },
  }
}

export function completeExecutionPermit(
  permit: AuthorizationExecutionPermit,
  now: Date,
): AuthorizationExecutionPermit | null {
  if (
    permit.state !== 'started' ||
    !permit.operationDeadlineAt ||
    now.getTime() >= permit.operationDeadlineAt.getTime()
  ) {
    return null
  }
  return {
    ...permit,
    state: 'completed',
    completedAt: new Date(now.getTime()),
  }
}

export function fenceExecutionPermit(
  permit: AuthorizationExecutionPermit,
  now: Date,
): AuthorizationExecutionPermit | null {
  if (permit.state !== 'admitted' && permit.state !== 'started') return null
  return {
    ...permit,
    state: 'fenced',
    fencedAt: new Date(now.getTime()),
  }
}

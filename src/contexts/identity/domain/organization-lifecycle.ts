export const ORGANIZATION_LIFECYCLE_STATES = [
  'active',
  'closure_requested',
  'closing',
  'purge_pending',
  'purging',
  'closed',
] as const

export type OrganizationLifecycleState = (typeof ORGANIZATION_LIFECYCLE_STATES)[number]

export const ORGANIZATION_CLOSURE_REQUEST_REASON_CODES = [
  'account_admin_request',
  'contract_ended',
  'duplicate_workspace',
  'privacy_request',
  'test_workspace',
] as const

export type OrganizationClosureRequestReasonCode =
  (typeof ORGANIZATION_CLOSURE_REQUEST_REASON_CODES)[number]

export const ORGANIZATION_CLOSURE_CANCEL_REASON_CODES = [
  'closure_cancelled',
  'request_created_in_error',
  'retention_needed',
] as const

export type OrganizationClosureCancelReasonCode =
  (typeof ORGANIZATION_CLOSURE_CANCEL_REASON_CODES)[number]

export const DEFAULT_ORGANIZATION_CLOSURE_RECOVERY_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Every bounded context must give the lifecycle coordinator an explicit,
 * content-free answer. Dark/empty contexts still return a `no_data` receipt;
 * silently omitting one would make a partial purge look complete.
 */
export const ORGANIZATION_LIFECYCLE_CONTEXTS = [
  'activity',
  'ai',
  'badge',
  'dashboard',
  'goal',
  'guest',
  'identity',
  'inbox',
  'integration',
  'leaderboard',
  'metric',
  'notification',
  'portal',
  'property',
  'review',
  'staff',
  'team',
] as const

export type OrganizationLifecycleContext =
  (typeof ORGANIZATION_LIFECYCLE_CONTEXTS)[number]

export const ORGANIZATION_LIFECYCLE_RECEIPT_PHASES = [
  'closing',
  'purge_readiness',
  'purge',
] as const

export type OrganizationLifecycleReceiptPhase =
  (typeof ORGANIZATION_LIFECYCLE_RECEIPT_PHASES)[number]

export type OrganizationLifecycleReceipt = Readonly<{
  context: OrganizationLifecycleContext
  phase: OrganizationLifecycleReceiptPhase
  outcome: 'complete' | 'no_data'
  evidenceRef: string
}>

export function organizationClosureDeadline(requestedAt: Date): Date {
  if (Number.isNaN(requestedAt.getTime())) throw new Error('requestedAt must be valid')
  return new Date(requestedAt.getTime() + DEFAULT_ORGANIZATION_CLOSURE_RECOVERY_MS)
}

export function canCancelOrganizationClosure(
  input: Readonly<{
    state: OrganizationLifecycleState
    recoverableUntil: Date | null
    now: Date
  }>,
): boolean {
  return (
    (input.state === 'closure_requested' || input.state === 'closing') &&
    input.recoverableUntil !== null &&
    input.now.getTime() < input.recoverableUntil.getTime()
  )
}

const ORGANIZATION_LIFECYCLE_TRANSITIONS: Readonly<
  Record<OrganizationLifecycleState, readonly OrganizationLifecycleState[]>
> = {
  active: ['closure_requested'],
  closure_requested: ['active', 'closing'],
  closing: ['active', 'purge_pending'],
  purge_pending: ['active', 'purging'],
  purging: ['closed'],
  closed: [],
}

export function canTransitionOrganizationLifecycle(
  from: OrganizationLifecycleState,
  to: OrganizationLifecycleState,
): boolean {
  return ORGANIZATION_LIFECYCLE_TRANSITIONS[from].includes(to)
}

export function assertOrganizationLifecycleTransition(
  from: OrganizationLifecycleState,
  to: OrganizationLifecycleState,
): void {
  if (!canTransitionOrganizationLifecycle(from, to)) {
    throw new Error(`Invalid Organization lifecycle transition: ${from} -> ${to}`)
  }
}

const ORGANIZATION_LIFECYCLE_TRANSITION_REASONS: Readonly<
  Record<string, readonly string[]>
> = {
  'active:closure_requested': ORGANIZATION_CLOSURE_REQUEST_REASON_CODES,
  'closure_requested:active': ORGANIZATION_CLOSURE_CANCEL_REASON_CODES,
  'closure_requested:closing': ['closing_prepared'],
  'closing:active': ORGANIZATION_CLOSURE_CANCEL_REASON_CODES,
  'closing:purge_pending': ['recovery_window_elapsed', 'recovery_window_waived'],
  'purge_pending:active': ['purge_cancelled_before_irreversible'],
  'purge_pending:purging': ['irreversible_purge_authorized'],
  'purging:closed': ['context_purge_complete'],
}

/**
 * Binds a machine reason to the exact state edge. This prevents an internal
 * caller from borrowing a valid reason from another lifecycle operation.
 */
export function assertOrganizationLifecycleTransitionReason(
  from: OrganizationLifecycleState,
  to: OrganizationLifecycleState,
  reasonCode: string,
): void {
  assertOrganizationLifecycleTransition(from, to)
  const allowed = ORGANIZATION_LIFECYCLE_TRANSITION_REASONS[`${from}:${to}`] ?? []
  if (!allowed.includes(reasonCode)) {
    throw new Error(
      `Organization lifecycle transition reason does not match ${from} -> ${to}`,
    )
  }
}

const CONTENT_FREE_EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]*$/

export function validateLifecycleEvidenceRef(value: string): string {
  if (value.length > 200) {
    throw new Error('supportEvidenceRef must be at most 200 characters')
  }
  if (!CONTENT_FREE_EVIDENCE_REF.test(value)) {
    throw new Error('supportEvidenceRef must be a content-free identifier')
  }
  return value
}

export function validateCompleteLifecycleReceipts(
  phase: OrganizationLifecycleReceiptPhase,
  receipts: readonly OrganizationLifecycleReceipt[],
): readonly OrganizationLifecycleReceipt[] {
  const byContext = new Map<OrganizationLifecycleContext, OrganizationLifecycleReceipt>()
  for (const receipt of receipts) {
    if (receipt.phase !== phase) {
      throw new Error(
        `Organization lifecycle receipt phase mismatch for ${receipt.context}`,
      )
    }
    validateLifecycleEvidenceRef(receipt.evidenceRef)
    if (byContext.has(receipt.context)) {
      throw new Error(`Duplicate Organization lifecycle receipt for ${receipt.context}`)
    }
    byContext.set(receipt.context, receipt)
  }

  const missing = ORGANIZATION_LIFECYCLE_CONTEXTS.filter(
    (context) => !byContext.has(context),
  )
  if (missing.length > 0) {
    throw new Error(`Missing Organization lifecycle receipts: ${missing.join(',')}`)
  }
  if (byContext.size !== ORGANIZATION_LIFECYCLE_CONTEXTS.length) {
    throw new Error('Organization lifecycle receipt set contains an unknown context')
  }

  return ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) => byContext.get(context)!)
}

export type OrganizationLifecycleStatus = Readonly<{
  organizationId: string
  state: OrganizationLifecycleState
  revision: number
  closureLineageId: string | null
  closureRequestedAt: Date | null
  recoverableUntil: Date | null
  irreversibleAt: Date | null
  closedAt: Date | null
  reactivationRequired: boolean
  lastTransitionAt: Date
  lastActorId: string
  lastReasonCode: string
  lastSupportEvidenceRef: string
}>

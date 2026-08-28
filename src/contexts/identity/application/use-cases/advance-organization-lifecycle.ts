import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { sha256Hex } from '#/shared/domain/sha256'
import type {
  OrganizationLifecycleCommandStore,
  TransitionOrganizationLifecycleCommand,
} from '../ports/organization-lifecycle-command-store.port'
import {
  contributionInputFromStatus,
  type OrganizationLifecycleContributor,
  type OrganizationLifecyclePhaseResult,
  type OrganizationLifecycleSupportAuthorization,
} from '../ports/organization-lifecycle-contributor.port'
import {
  ORGANIZATION_LIFECYCLE_CONTEXTS,
  assertOrganizationLifecycleTransition,
  validateCompleteLifecycleReceipts,
  validateLifecycleEvidenceRef,
  type OrganizationLifecycleReceipt,
  type OrganizationLifecycleReceiptPhase,
  type OrganizationLifecycleStatus,
} from '../../domain/organization-lifecycle'

const DEFAULT_BATCH_SIZE = 10
const MAX_BATCH_SIZE = 50

export type CreateOrganizationLifecycleCoordinatorDeps = Readonly<{
  store: OrganizationLifecycleCommandStore
  contributors: readonly OrganizationLifecycleContributor[]
  supportAuthorization: OrganizationLifecycleSupportAuthorization
  clock: () => Date
}>

export type AdvanceOrganizationLifecycleResult = Readonly<{
  examined: number
  transitioned: number
  failed: number
  closingPrepared: number
  purgePending: number
  closed: number
}>

export type CreateOrganizationLifecycleCoordinatorInput = Readonly<{
  limit?: number
}>

export type WaiveOrganizationRecoveryInput = Readonly<{
  organizationId: string
  closureLineageId: string
  expectedRevision: number
  operatorUserId: string
  supportEvidenceRef: string
  authorizationEvidenceRef: string
  typedConfirmation: string
}>

export type BeginIrreversibleOrganizationPurgeInput = Readonly<{
  organizationId: string
  closureLineageId: string
  expectedRevision: number
  operatorUserId: string
  supportEvidenceRef: string
  authorizationEvidenceRef: string
  typedConfirmation: string
}>

export type CancelPendingOrganizationPurgeInput = Readonly<{
  organizationId: string
  closureLineageId: string
  expectedRevision: number
  operatorUserId: string
  supportEvidenceRef: string
  authorizationEvidenceRef: string
  typedConfirmation: string
}>

function phaseEvidenceRef(
  phase: OrganizationLifecycleReceiptPhase,
  receipts: readonly OrganizationLifecycleReceipt[],
): string {
  return `lifecycle:${phase}:${sha256Hex(canonicalizeRfc8785(receipts))}`
}

function supportDecisionEvidenceRef(
  action: 'waive_recovery' | 'cancel_pending_purge' | 'begin_irreversible_purge',
  input: Readonly<{
    organizationId: string
    closureLineageId: string
    expectedRevision: number
    operatorUserId: string
    supportEvidenceRef: string
    authorizationEvidenceRef: string
  }>,
  phaseEvidence?: string,
): string {
  const evidence = {
    action,
    organizationId: input.organizationId,
    closureLineageId: input.closureLineageId,
    expectedRevision: input.expectedRevision,
    operatorUserId: input.operatorUserId,
    supportEvidenceRef: validateLifecycleEvidenceRef(input.supportEvidenceRef),
    authorizationEvidenceRef: validateLifecycleEvidenceRef(
      input.authorizationEvidenceRef,
    ),
    ...(phaseEvidence ? { phaseEvidence } : {}),
  }
  return `lifecycle:${action}:${sha256Hex(canonicalizeRfc8785(evidence))}`
}

function assertExactContributorSet(
  contributors: readonly OrganizationLifecycleContributor[],
): void {
  const ids = contributors.map((contributor) => contributor.context)
  if (new Set(ids).size !== ids.length) {
    throw new Error('Organization lifecycle contributors must be unique')
  }
  const missing = ORGANIZATION_LIFECYCLE_CONTEXTS.filter(
    (context) => !ids.includes(context),
  )
  if (missing.length > 0 || ids.length !== ORGANIZATION_LIFECYCLE_CONTEXTS.length) {
    throw new Error(
      `Organization lifecycle contributors are incomplete: ${missing.join(',')}`,
    )
  }
}

export const createOrganizationLifecycleCoordinator = (
  deps: CreateOrganizationLifecycleCoordinatorDeps,
) => {
  assertExactContributorSet(deps.contributors)
  const contributors: ReadonlyMap<
    (typeof ORGANIZATION_LIFECYCLE_CONTEXTS)[number],
    OrganizationLifecycleContributor
  > = new Map(deps.contributors.map((contributor) => [contributor.context, contributor]))

  const runPhase = async (
    phase: OrganizationLifecycleReceiptPhase,
    status: OrganizationLifecycleStatus,
    occurredAt: Date,
  ): Promise<OrganizationLifecyclePhaseResult> => {
    const input = contributionInputFromStatus(status, occurredAt)
    const receipts = await Promise.all(
      ORGANIZATION_LIFECYCLE_CONTEXTS.map(async (context) => {
        const contributor = contributors.get(context)!
        const result =
          phase === 'closing'
            ? await contributor.prepareClosing(input)
            : phase === 'purge_readiness'
              ? await contributor.verifyPurgeReadiness(input)
              : await contributor.purge(input)
        return { context, phase, ...result } as const
      }),
    )
    const complete = validateCompleteLifecycleReceipts(phase, receipts)
    return { phase, receipts: complete, evidenceRef: phaseEvidenceRef(phase, complete) }
  }

  const transition = async (
    status: OrganizationLifecycleStatus,
    input: Omit<
      TransitionOrganizationLifecycleCommand,
      'organizationId' | 'closureLineageId' | 'expectedRevision' | 'from'
    >,
  ): Promise<OrganizationLifecycleStatus> => {
    if (!status.closureLineageId) throw new Error('Closure lineage is required')
    assertOrganizationLifecycleTransition(status.state, input.to)
    return deps.store.transition({
      ...input,
      organizationId: status.organizationId,
      closureLineageId: status.closureLineageId,
      expectedRevision: status.revision,
      from: status.state,
    })
  }

  /**
   * Bounded, retry-safe worker pass. A contributor failure leaves the current
   * lifecycle state unchanged; successful contributors must replay their own
   * durable receipt on the next pass.
   */
  const runScheduledPass = async (
    input: CreateOrganizationLifecycleCoordinatorInput = {},
  ): Promise<AdvanceOrganizationLifecycleResult> => {
    const now = deps.clock()
    const limit = Math.max(1, Math.min(MAX_BATCH_SIZE, input.limit ?? DEFAULT_BATCH_SIZE))
    const candidates = await deps.store.listCandidates({
      states: ['closure_requested', 'closing', 'purging'],
      now,
      limit,
    })
    const counts = {
      examined: candidates.length,
      transitioned: 0,
      failed: 0,
      closingPrepared: 0,
      purgePending: 0,
      closed: 0,
    }

    for (const candidate of candidates) {
      try {
        if (candidate.state === 'closure_requested') {
          const phase = await runPhase('closing', candidate, now)
          await transition(candidate, {
            to: 'closing',
            actorUserId: 'system:lifecycle',
            reasonCode: 'closing_prepared',
            supportEvidenceRef: phase.evidenceRef,
            now,
          })
          counts.closingPrepared += 1
        } else if (
          candidate.state === 'closing' &&
          candidate.recoverableUntil !== null &&
          now.getTime() >= candidate.recoverableUntil.getTime()
        ) {
          const phase = await runPhase('purge_readiness', candidate, now)
          await transition(candidate, {
            to: 'purge_pending',
            actorUserId: 'system:lifecycle',
            reasonCode: 'recovery_window_elapsed',
            supportEvidenceRef: phase.evidenceRef,
            now,
          })
          counts.purgePending += 1
        } else if (candidate.state === 'purging') {
          const phase = await runPhase('purge', candidate, now)
          await transition(candidate, {
            to: 'closed',
            actorUserId: 'system:lifecycle',
            reasonCode: 'context_purge_complete',
            supportEvidenceRef: phase.evidenceRef,
            now,
          })
          counts.closed += 1
        } else {
          continue
        }
        counts.transitioned += 1
      } catch {
        counts.failed += 1
      }
    }
    return counts
  }

  const waiveRecoveryWindow = async (
    input: WaiveOrganizationRecoveryInput,
  ): Promise<OrganizationLifecycleStatus> => {
    const now = deps.clock()
    const current = await deps.store.getAuthority(input.organizationId)
    assertExactStatus(current, input)
    if (current.state !== 'closing') {
      throw new Error('Only a closing Organization can waive its recovery window')
    }
    if (input.typedConfirmation !== `WAIVE RECOVERY ${input.organizationId}`) {
      throw new Error('Recovery waiver confirmation does not match')
    }
    await authorizeSupport('waive_recovery', input, now)
    const phase = await runPhase('purge_readiness', current, now)
    return transition(current, {
      to: 'purge_pending',
      actorUserId: input.operatorUserId,
      reasonCode: 'recovery_window_waived',
      supportEvidenceRef: supportDecisionEvidenceRef(
        'waive_recovery',
        input,
        phase.evidenceRef,
      ),
      now,
    })
  }

  const beginIrreversiblePurge = async (
    input: BeginIrreversibleOrganizationPurgeInput,
  ): Promise<OrganizationLifecycleStatus> => {
    const now = deps.clock()
    const current = await deps.store.getAuthority(input.organizationId)
    assertExactStatus(current, input)
    if (current.state !== 'purge_pending') {
      throw new Error('Organization is not ready to cross the irreversible boundary')
    }
    if (input.typedConfirmation !== `BEGIN IRREVERSIBLE PURGE ${input.organizationId}`) {
      throw new Error('Irreversible purge confirmation does not match')
    }
    await authorizeSupport('begin_irreversible_purge', input, now)
    return transition(current, {
      to: 'purging',
      actorUserId: input.operatorUserId,
      reasonCode: 'irreversible_purge_authorized',
      supportEvidenceRef: supportDecisionEvidenceRef('begin_irreversible_purge', input),
      now,
    })
  }

  const cancelPendingPurge = async (
    input: CancelPendingOrganizationPurgeInput,
  ): Promise<OrganizationLifecycleStatus> => {
    const now = deps.clock()
    const current = await deps.store.getAuthority(input.organizationId)
    assertExactStatus(current, input)
    if (current.state !== 'purge_pending' || current.irreversibleAt !== null) {
      throw new Error('Organization is not recoverable from Purge Pending')
    }
    if (input.typedConfirmation !== `CANCEL PENDING PURGE ${input.organizationId}`) {
      throw new Error('Pending purge cancellation confirmation does not match')
    }
    await authorizeSupport('cancel_pending_purge', input, now)
    return transition(current, {
      to: 'active',
      actorUserId: input.operatorUserId,
      reasonCode: 'purge_cancelled_before_irreversible',
      supportEvidenceRef: supportDecisionEvidenceRef('cancel_pending_purge', input),
      now,
    })
  }

  const assertExactStatus = (
    current: OrganizationLifecycleStatus,
    input: Readonly<{ closureLineageId: string; expectedRevision: number }>,
  ): void => {
    if (
      current.closureLineageId !== input.closureLineageId ||
      current.revision !== input.expectedRevision
    ) {
      throw new Error('Organization lifecycle authority changed')
    }
  }

  const authorizeSupport = async (
    action: 'waive_recovery' | 'cancel_pending_purge' | 'begin_irreversible_purge',
    input: Readonly<{
      organizationId: string
      closureLineageId: string
      expectedRevision: number
      operatorUserId: string
      supportEvidenceRef: string
      authorizationEvidenceRef: string
    }>,
    occurredAt: Date,
  ): Promise<void> => {
    const supportEvidenceRef = validateLifecycleEvidenceRef(input.supportEvidenceRef)
    const authorizationEvidenceRef = validateLifecycleEvidenceRef(
      input.authorizationEvidenceRef,
    )
    if (
      !(await deps.supportAuthorization.authorize({
        action,
        ...input,
        supportEvidenceRef,
        authorizationEvidenceRef,
        occurredAt,
      }))
    ) {
      throw new Error('Organization lifecycle support authorization denied')
    }
  }

  return Object.freeze({
    runScheduledPass,
    waiveRecoveryWindow,
    beginIrreversiblePurge,
    cancelPendingPurge,
  })
}

export type CreateOrganizationLifecycleCoordinator = ReturnType<
  typeof createOrganizationLifecycleCoordinator
>

// LIF-01-T18 — explicit Organization reactivation.
//
// Program bullet 4: "Cancel requires health checks, fresh Google
// authorization, and deliberate Portal/feature reactivation — nothing resumes
// silently." `cancelClosure` deliberately returns the Organization to `active`
// while LEAVING `reactivation_required = true` and the suspension in place.
// This command is the only thing that clears them, and it is the whole reason
// a cancelled closure does not resume anything by itself.
//
// What this command does NOT do is the point of the design:
//   * it never republishes a Portal — Wave 6's Portal contributor deactivated
//     the activation and kept the immutable snapshot, so republishing is a
//     separate human action that re-points a NEW activation at that same
//     snapshot; here it is only asserted as already done;
//   * it never re-enables an AI capability;
//   * it never restores a Google credential — a stored credential from before
//     the closure is not evidence of current authorization.
// Each of the three is supplied as an acknowledgement carrying its own actor
// and content-free reason, and a `system:` actor is refused: a machine cannot
// be the author of a deliberate human decision.

import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { sha256Hex } from '#/shared/domain/sha256'
import {
  ORGANIZATION_REACTIVATION_CHECKS,
  canReactivateOrganization,
  missingReactivationAcknowledgements,
  unsatisfiedReactivationChecks,
  type OrganizationLifecycleStatus,
  type OrganizationReactivationAcknowledgement,
  type OrganizationReactivationCheck,
} from '../../domain/organization-lifecycle'
import { identityError } from '../../domain/errors'
import type { OrganizationLifecycleCommandStore } from '../ports/organization-lifecycle-command-store.port'
import type { OrganizationReactivationReadinessPort } from '../ports/organization-reactivation-readiness.port'

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type ReactivateOrganizationDeps = Readonly<{
  store: Pick<OrganizationLifecycleCommandStore, 'getStatus' | 'reactivate'>
  readiness: OrganizationReactivationReadinessPort
  clock: () => Date
  /** Observes the lifted suspension before the caller is told it is lifted. */
  refreshPolicy: () => Promise<void>
}>

export type ReactivateOrganizationInput = Readonly<{
  operationId: string
  organizationId: string
  actorUserId: string
  acknowledgements: readonly OrganizationReactivationAcknowledgement[]
}>

export type ReactivateOrganizationResult = Readonly<{
  status: OrganizationLifecycleStatus
  checks: readonly OrganizationReactivationCheck[]
  evidenceRef: string
}>

/**
 * Refusal carries the machine ids of what is missing and nothing else. A
 * checklist UI can render it, and it names no tenant content.
 */
export class OrganizationReactivationBlocked extends Error {
  readonly unsatisfiedChecks: readonly string[]
  readonly missingAcknowledgements: readonly string[]

  constructor(
    unsatisfiedChecks: readonly string[],
    missingAcknowledgements: readonly string[],
  ) {
    super(
      'Organization reactivation is blocked: ' +
        `checks=${unsatisfiedChecks.join('|') || 'none'};` +
        `actions=${missingAcknowledgements.join('|') || 'none'}`,
    )
    this.name = 'OrganizationReactivationBlocked'
    this.unsatisfiedChecks = unsatisfiedChecks
    this.missingAcknowledgements = missingAcknowledgements
  }
}

function reactivationEvidenceRef(
  input: Readonly<{
    organizationId: string
    closureLineageId: string
    expectedRevision: number
    actorUserId: string
    checks: readonly OrganizationReactivationCheck[]
    acknowledgements: readonly OrganizationReactivationAcknowledgement[]
  }>,
): string {
  // Canonical JSON so the same decision always digests to the same reference,
  // and so the reference proves WHICH readiness answers authorized the lift.
  return `lifecycle:reactivation:${sha256Hex(canonicalizeRfc8785(input))}`
}

export const reactivateOrganization =
  (deps: ReactivateOrganizationDeps) =>
  async (input: ReactivateOrganizationInput): Promise<ReactivateOrganizationResult> => {
    if (!OPERATION_ID_PATTERN.test(input.operationId)) {
      throw identityError('validation_error', 'operationId must be a UUID')
    }
    // The store authorizes from the current AccountAdmin membership while it
    // remains locked for the duration of the read.
    const current = await deps.store.getStatus({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
    })
    if (!canReactivateOrganization(current)) {
      throw identityError(
        'forbidden',
        'Only an active Organization awaiting explicit reactivation can be reactivated',
      )
    }
    if (!current.closureLineageId) {
      throw identityError(
        'organization_conflict',
        'Organization reactivation requires the closure lineage it reverses',
      )
    }

    const checks = await deps.readiness.evaluate({
      organizationId: input.organizationId,
      closureLineageId: current.closureLineageId,
      now: deps.clock(),
    })
    const unsatisfied = unsatisfiedReactivationChecks(checks)
    const missing = missingReactivationAcknowledgements(input.acknowledgements)
    if (unsatisfied.length > 0 || missing.length > 0) {
      throw new OrganizationReactivationBlocked(unsatisfied, missing)
    }

    // Ordered by the closed check list so the digest cannot depend on the
    // order a probe implementation happened to resolve in.
    const orderedChecks = ORGANIZATION_REACTIVATION_CHECKS.map((id) =>
      checks.find((check) => check.id === id)!,
    )
    const evidenceRef = reactivationEvidenceRef({
      organizationId: input.organizationId,
      closureLineageId: current.closureLineageId,
      expectedRevision: current.revision,
      actorUserId: input.actorUserId,
      checks: orderedChecks,
      acknowledgements: [...input.acknowledgements].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
    })

    const status = await deps.store.reactivate({
      operationId: input.operationId,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      expectedRevision: current.revision,
      closureLineageId: current.closureLineageId,
      supportEvidenceRef: evidenceRef,
      now: deps.clock(),
    })
    // The suspension is already lifted durably. Do not report the Organization
    // as usable until this process observes the new policy generation.
    await deps.refreshPolicy()
    return { status, checks: orderedChecks, evidenceRef }
  }

export type ReactivateOrganization = ReturnType<typeof reactivateOrganization>

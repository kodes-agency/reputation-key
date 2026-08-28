// LIF-01-T21 — repair for a partially applied offboarding.
//
// Removal and leave fence the provider-side authorities (Google connector,
// running imports) BEFORE the Identity transaction, because those live in
// another context and cannot join it. That ordering is deliberate: a fenced
// connector with a surviving membership is a REPAIRABLE state, while a deleted
// membership with a live provider grant is not.
//
// A crash between the two therefore leaves exactly one observable shape:
//   * every `property_access_grant` for the user is revoked with the
//     offboarding reason, and
//   * the membership row is still present.
//
// This command detects that shape and converges by COMPLETING the offboarding.
// It never re-grants: the fence was a deliberate, authorized act, and
// resurrecting access to undo a crash would hand back authority that an
// operator already decided to remove. If an operator wants the member to keep
// working, they re-invite — a decision with its own audit trail.
//
// Idempotent by construction: after convergence there is no membership, so the
// next run classifies the same user as `already_offboarded` and does nothing.

import { userId as toUserId, type OrganizationId } from '#/shared/domain/ids'
import { identityMemberRemoved } from '../../domain/events'
import { identityError } from '../../domain/errors'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import {
  classifyPartialOffboarding,
  type PartialOffboardingFinding,
  type PartialOffboardingObservation,
} from '../../domain/partialOffboarding'

export {
  PARTIAL_OFFBOARDING_FINDINGS,
  PARTIAL_OFFBOARDING_GRANT_REASON,
  classifyPartialOffboarding,
} from '../../domain/partialOffboarding'
export type {
  PartialOffboardingFinding,
  PartialOffboardingObservation,
} from '../../domain/partialOffboarding'

export type PartialOffboardingReport = Readonly<{
  finding: PartialOffboardingFinding
  observation: PartialOffboardingObservation
  repaired: boolean
}>

export type PartialOffboardingLookup = Readonly<{
  observe(input: {
    organizationId: string
    userId: string
  }): Promise<PartialOffboardingObservation>
  /** Bounded scan for users whose grants are revoked but membership remains. */
  listCandidates(input: {
    limit: number
  }): Promise<readonly Readonly<{ organizationId: string; userId: string }>[]>
}>

export type RepairPartialOffboardingDeps = Readonly<{
  lookup: PartialOffboardingLookup
  commandStore: IdentityCommandStore
  clock: () => Date
  /** Named operator identity recorded on the completion fact. */
  operatorUserId: string
}>

export type RepairPartialOffboardingInput = Readonly<{
  organizationId: string
  userId: string
  /** Report-only by default; convergence is an explicit second decision. */
  apply?: boolean
}>

export type RepairPartialOffboarding = ReturnType<typeof repairPartialOffboarding>

export const repairPartialOffboarding = (deps: RepairPartialOffboardingDeps) => {
  const inspect = async (
    input: RepairPartialOffboardingInput,
  ): Promise<PartialOffboardingReport> => {
    const observation = await deps.lookup.observe(input)
    const finding = classifyPartialOffboarding(observation)
    if (finding !== 'partial_offboarding' || input.apply !== true) {
      return { finding, observation, repaired: false }
    }
    if (!observation.memberId) {
      throw identityError(
        'organization_conflict',
        'Partial offboarding repair lost its member authority',
      )
    }
    // Completes the offboarding through the SAME atomic command every removal
    // uses, so the repaired state is byte-identical to a clean removal:
    // sessions revoked, binding released, grants revoked, membership deleted
    // and the removal fact recorded in one transaction.
    await deps.commandStore.removeMember({
      organizationId: input.organizationId as OrganizationId,
      memberId: observation.memberId,
      event: identityMemberRemoved({
        organizationId: input.organizationId as OrganizationId,
        userId: toUserId(input.userId),
        removedBy: toUserId(deps.operatorUserId),
        occurredAt: deps.clock(),
      }),
    })
    return { finding, observation, repaired: true }
  }

  return Object.freeze({
    inspect,
    /** Bounded sweep; every candidate is reported whether or not it repairs. */
    async sweep(
      input: Readonly<{ limit?: number; apply?: boolean }> = {},
    ): Promise<readonly PartialOffboardingReport[]> {
      const limit = Math.max(1, Math.min(100, input.limit ?? 25))
      const candidates = await deps.lookup.listCandidates({ limit })
      const reports: PartialOffboardingReport[] = []
      for (const candidate of candidates) {
        reports.push(await inspect({ ...candidate, apply: input.apply }))
      }
      return reports
    },
  })
}

// LIF-01-T18 — the readiness questions reactivation must answer before the
// post-closure fence may be cleared.
//
// The port answers; it never repairs. Nothing behind this interface may
// republish a Portal, re-enable an AI capability or restore a Google
// credential — those are separate, human-performed actions whose completion
// this port merely OBSERVES. A probe that cannot answer must fail, and a
// failed probe is an unsatisfied check, never an implicit pass.

import {
  ORGANIZATION_REACTIVATION_CHECKS,
  type OrganizationReactivationCheck,
  type OrganizationReactivationCheckId,
} from '../../domain/organization-lifecycle'

export type { OrganizationReactivationCheck, OrganizationReactivationCheckId }

export type OrganizationReactivationReadinessInput = Readonly<{
  organizationId: string
  /** The closure this reactivation reverses; probes scope to its lineage. */
  closureLineageId: string
  now: Date
}>

/**
 * One content-free probe per check.
 *
 * Each is a function rather than a repository because the facts live in three
 * different contexts. Composition binds each probe to the context that owns
 * the fact, which keeps Identity infrastructure free of foreign schema imports
 * and keeps the boundary rule in `src/contexts/CONTEXT.md` intact.
 *
 * `detailCode` is a machine code (`no_eligible_manager`, `probe_unavailable`),
 * never prose and never tenant content.
 */
export type OrganizationReactivationProbe = (
  input: OrganizationReactivationReadinessInput,
) => Promise<Readonly<{ satisfied: boolean; detailCode: string }>>

export type OrganizationReactivationProbes = Readonly<
  Record<OrganizationReactivationCheckId, OrganizationReactivationProbe>
>

export type OrganizationReactivationReadinessPort = Readonly<{
  evaluate(
    input: OrganizationReactivationReadinessInput,
  ): Promise<readonly OrganizationReactivationCheck[]>
}>

/**
 * Builds the readiness port from one probe per check.
 *
 * A probe that throws is an UNSATISFIED check, not a crash: a reactivation
 * that cannot prove readiness must be refused, and an unavailable probe is
 * exactly that. The `probe_unavailable` detail code distinguishes it from a
 * probe that answered "no".
 */
export const createOrganizationReactivationReadiness = (
  probes: OrganizationReactivationProbes,
): OrganizationReactivationReadinessPort =>
  Object.freeze({
    evaluate: async (input) =>
      Promise.all(
        ORGANIZATION_REACTIVATION_CHECKS.map(async (id) => {
          try {
            const answer = await probes[id](input)
            return { id, satisfied: answer.satisfied, detailCode: answer.detailCode }
          } catch {
            return { id, satisfied: false, detailCode: 'probe_unavailable' } as const
          }
        }),
      ),
  })

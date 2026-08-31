import { and, eq, sql } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import {
  identityOrganizationLifecycleReceipts,
  organizationLifecycleAuthority,
} from '#/shared/db/schema/organization-lifecycle.schema'
import { sha256Hex } from '#/shared/domain/sha256'
import type { Tx } from '#/shared/outbox/commit'
import type {
  OrganizationLifecycleContributionInput,
  OrganizationLifecycleContributor,
} from '../application/ports/organization-lifecycle-contributor.port'
import {
  validateLifecycleEvidenceRef,
  type OrganizationLifecycleReceipt,
  type OrganizationLifecycleReceiptPhase,
} from '../domain/organization-lifecycle'

type IdentityLifecycleResult = Omit<OrganizationLifecycleReceipt, 'context' | 'phase'>

const AUTHORITY_STATE_BY_PHASE = Object.freeze({
  closing: 'closure_requested',
  purge_readiness: 'closing',
  purge: 'purging',
} as const)

export type IdentityOrganizationLifecyclePhaseWork = (
  tx: Tx,
  input: OrganizationLifecycleContributionInput,
) => Promise<IdentityLifecycleResult>

export type IdentityOrganizationLifecycleContributorDeps = Readonly<{
  db: Database
  prepareClosing: IdentityOrganizationLifecyclePhaseWork
  verifyPurgeReadiness: IdentityOrganizationLifecyclePhaseWork
  purge: IdentityOrganizationLifecyclePhaseWork
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function requestFingerprint(
  phase: OrganizationLifecycleReceiptPhase,
  input: OrganizationLifecycleContributionInput,
): string {
  return sha256Hex(
    canonicalizeRfc8785({
      context: 'identity',
      phase,
      organizationId: input.organizationId,
      closureLineageId: input.closureLineageId,
      lifecycleRevision: input.lifecycleRevision,
      recoverableUntil: input.recoverableUntil.toISOString(),
    }),
  )
}

function validateInput(input: OrganizationLifecycleContributionInput): void {
  if (!UUID.test(input.closureLineageId)) {
    throw new Error('Identity lifecycle closure lineage must be a UUID')
  }
  if (!Number.isSafeInteger(input.lifecycleRevision) || input.lifecycleRevision < 1) {
    throw new Error('Identity lifecycle revision must be a positive safe integer')
  }
  if (
    Number.isNaN(input.recoverableUntil.getTime()) ||
    Number.isNaN(input.occurredAt.getTime())
  ) {
    throw new Error('Identity lifecycle contribution timestamps must be valid')
  }
}

function validateResult(result: IdentityLifecycleResult): IdentityLifecycleResult {
  if (result.outcome !== 'complete' && result.outcome !== 'no_data') {
    throw new Error('Identity lifecycle contribution outcome is invalid')
  }
  return {
    outcome: result.outcome,
    evidenceRef: validateLifecycleEvidenceRef(result.evidenceRef),
  }
}

/**
 * Wraps reviewed Identity lifecycle mutations in a transaction-bound receipt.
 *
 * No default destructive work is supplied here. Callers must provide all
 * three phase implementations, and composition must still provide every
 * other context plus independent support authorization before the coordinator
 * can run. The advisory transaction lock prevents two first attempts from
 * executing the same mutation before either can persist its receipt.
 */
export const createIdentityOrganizationLifecycleContributor = (
  deps: IdentityOrganizationLifecycleContributorDeps,
): OrganizationLifecycleContributor => {
  const run = (
    phase: OrganizationLifecycleReceiptPhase,
    work: IdentityOrganizationLifecyclePhaseWork,
    input: OrganizationLifecycleContributionInput,
  ): Promise<IdentityLifecycleResult> => {
    validateInput(input)
    const fingerprint = requestFingerprint(phase, input)
    const lockKey = [
      'repkey',
      'identity-organization-lifecycle',
      input.closureLineageId,
      input.lifecycleRevision,
      phase,
    ].join(':')

    return deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
      const existing = await tx
        .select()
        .from(identityOrganizationLifecycleReceipts)
        .where(
          and(
            eq(
              identityOrganizationLifecycleReceipts.closureLineageId,
              input.closureLineageId,
            ),
            eq(
              identityOrganizationLifecycleReceipts.lifecycleRevision,
              input.lifecycleRevision,
            ),
            eq(identityOrganizationLifecycleReceipts.phase, phase),
          ),
        )
        .limit(1)

      if (existing[0]) {
        if (existing[0].requestFingerprint !== fingerprint) {
          throw new Error('Identity lifecycle contribution authority changed')
        }
        return validateResult({
          outcome: existing[0].outcome as IdentityLifecycleResult['outcome'],
          evidenceRef: existing[0].evidenceRef,
        })
      }

      const authorities = await tx
        .select({
          state: organizationLifecycleAuthority.state,
          revision: organizationLifecycleAuthority.revision,
          closureLineageId: organizationLifecycleAuthority.closureLineageId,
          recoverableUntil: organizationLifecycleAuthority.recoverableUntil,
          lastTransitionAt: organizationLifecycleAuthority.lastTransitionAt,
        })
        .from(organizationLifecycleAuthority)
        .where(eq(organizationLifecycleAuthority.organizationId, input.organizationId))
        .limit(1)
        .for('update')
      const authority = authorities[0]
      if (
        !authority ||
        authority.state !== AUTHORITY_STATE_BY_PHASE[phase] ||
        authority.revision !== input.lifecycleRevision ||
        authority.closureLineageId !== input.closureLineageId ||
        authority.recoverableUntil?.getTime() !== input.recoverableUntil.getTime() ||
        input.occurredAt.getTime() < authority.lastTransitionAt.getTime()
      ) {
        throw new Error('Identity lifecycle contribution authority changed')
      }

      const result = validateResult(await work(tx, input))
      await tx.insert(identityOrganizationLifecycleReceipts).values({
        organizationId: input.organizationId,
        closureLineageId: input.closureLineageId,
        lifecycleRevision: input.lifecycleRevision,
        phase,
        requestFingerprint: fingerprint,
        outcome: result.outcome,
        evidenceRef: result.evidenceRef,
        recoverableUntil: input.recoverableUntil,
        occurredAt: input.occurredAt,
        createdAt: input.occurredAt,
      })
      return result
    })
  }

  return Object.freeze({
    context: 'identity' as const,
    prepareClosing: (input) => run('closing', deps.prepareClosing, input),
    verifyPurgeReadiness: (input) =>
      run('purge_readiness', deps.verifyPurgeReadiness, input),
    purge: (input) => run('purge', deps.purge, input),
  })
}

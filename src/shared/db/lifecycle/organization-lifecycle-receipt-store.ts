// Shared, transaction-bound Organization lifecycle receipt store (LIF-01).
//
// `identity-organization-lifecycle-contributor.ts` established the semantics a
// lifecycle contributor must honour: re-read the live authority under a row
// lock, refuse when the phase's required state / revision / lineage /
// recovery deadline no longer matches, serialize concurrent first attempts on
// an advisory transaction lock, and co-commit the phase mutation with one
// content-free receipt. Sixteen more copies of that reasoning would be
// unreviewable, so it lives here exactly once and is parameterized by context.
//
// Three properties this file exists to preserve:
//   1. Idempotence — replaying the same (context, lineage, revision, phase)
//      returns the recorded outcome WITHOUT re-running the phase work.
//   2. Authority binding — a receipt can only be written while the live
//      authority still says this phase is the work to do.
//   3. Affirmative absence — `no_data` is a real answer that is persisted.
//      An omitted contributor would make a partial purge look complete.

import { and, eq, sql } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import {
  contextOrganizationLifecycleReceipts,
  type ContextLifecycleReceiptContext,
  type ContextLifecycleReceiptOutcome,
  type ContextLifecycleReceiptPhase,
} from '#/shared/db/schema/context-organization-lifecycle-receipts.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import { sha256Hex } from '#/shared/domain/sha256'
import type { Tx } from '#/shared/outbox/commit'

/**
 * Structurally identical to Identity's
 * `OrganizationLifecycleContributionInput`. It is redeclared because
 * `shared/**` may not import a context's application layer; an adapter in a
 * context's `infrastructure/adapters/**` binds the two by structural typing.
 */
export type OrganizationLifecycleContributionRequest = Readonly<{
  organizationId: string
  closureLineageId: string
  lifecycleRevision: number
  recoverableUntil: Date
  occurredAt: Date
}>

export type OrganizationLifecyclePhaseOutcome = Readonly<{
  outcome: ContextLifecycleReceiptOutcome
  evidenceRef: string
}>

/**
 * The reviewed, context-local mutation for one phase.
 *
 * It receives the SAME transaction that will carry the receipt, so a thrown
 * phase leaves neither a receipt nor a mutated business row.
 */
export type OrganizationLifecyclePhaseWork = (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
) => Promise<OrganizationLifecyclePhaseOutcome>

export type OrganizationLifecycleReceiptStore = Readonly<{
  context: ContextLifecycleReceiptContext
  run(
    phase: ContextLifecycleReceiptPhase,
    work: OrganizationLifecyclePhaseWork,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome>
}>

export type OrganizationLifecycleReceiptStoreDeps = Readonly<{
  db: Database
  context: ContextLifecycleReceiptContext
}>

/** Each phase is only legal while the authority sits in exactly this state. */
const AUTHORITY_STATE_BY_PHASE = Object.freeze({
  closing: 'closure_requested',
  purge_readiness: 'closing',
  purge: 'purging',
} as const)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const CONTENT_FREE_EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u

export const LIFECYCLE_AUTHORITY_CHANGED = 'lifecycle contribution authority changed'

/**
 * The fingerprint pins the receipt to the exact request that produced it.
 * A replay whose lineage, revision or recovery deadline differs is a DIFFERENT
 * request wearing the same key, and must not inherit the recorded outcome.
 */
export function lifecycleRequestFingerprint(
  context: ContextLifecycleReceiptContext,
  phase: ContextLifecycleReceiptPhase,
  request: OrganizationLifecycleContributionRequest,
): string {
  return sha256Hex(
    canonicalizeRfc8785({
      context,
      phase,
      organizationId: request.organizationId,
      closureLineageId: request.closureLineageId,
      lifecycleRevision: request.lifecycleRevision,
      recoverableUntil: request.recoverableUntil.toISOString(),
    }),
  )
}

export function validateContentFreeEvidenceRef(value: string): string {
  if (value.length > 200) {
    throw new Error('Lifecycle evidence reference must be at most 200 characters')
  }
  if (!CONTENT_FREE_EVIDENCE_REF.test(value)) {
    throw new Error('Lifecycle evidence reference must be a content-free identifier')
  }
  return value
}

function validateRequest(request: OrganizationLifecycleContributionRequest): void {
  if (!UUID.test(request.closureLineageId)) {
    throw new Error('Lifecycle closure lineage must be a UUID')
  }
  if (!Number.isSafeInteger(request.lifecycleRevision) || request.lifecycleRevision < 1) {
    throw new Error('Lifecycle revision must be a positive safe integer')
  }
  if (
    Number.isNaN(request.recoverableUntil.getTime()) ||
    Number.isNaN(request.occurredAt.getTime())
  ) {
    throw new Error('Lifecycle contribution timestamps must be valid')
  }
}

function validateOutcome(
  result: OrganizationLifecyclePhaseOutcome,
): OrganizationLifecyclePhaseOutcome {
  if (result.outcome !== 'complete' && result.outcome !== 'no_data') {
    throw new Error('Lifecycle contribution outcome is invalid')
  }
  return {
    outcome: result.outcome,
    evidenceRef: validateContentFreeEvidenceRef(result.evidenceRef),
  }
}

/**
 * Build the shared receipt store for one context.
 *
 * No destructive default work is supplied: each context passes its own
 * reviewed phase implementations, and composition must still supply every
 * context plus independent support authorization before a purge can run.
 */
export const createOrganizationLifecycleReceiptStore = (
  deps: OrganizationLifecycleReceiptStoreDeps,
): OrganizationLifecycleReceiptStore => {
  // `async` so an invalid request REJECTS instead of throwing synchronously:
  // every caller of a contributor treats a phase as a promise.
  const run = async (
    phase: ContextLifecycleReceiptPhase,
    work: OrganizationLifecyclePhaseWork,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    validateRequest(request)
    const fingerprint = lifecycleRequestFingerprint(deps.context, phase, request)
    // Two first attempts for the same key would otherwise both pass the
    // existence check and both run the mutation before either could insert
    // its receipt. The lock is transaction-scoped, so it is released by the
    // same commit that makes the receipt visible.
    const lockKey = [
      'repkey',
      'context-organization-lifecycle',
      deps.context,
      request.closureLineageId,
      request.lifecycleRevision,
      phase,
    ].join(':')

    return deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
      const existing = await tx
        .select()
        .from(contextOrganizationLifecycleReceipts)
        .where(
          and(
            eq(contextOrganizationLifecycleReceipts.context, deps.context),
            eq(
              contextOrganizationLifecycleReceipts.closureLineageId,
              request.closureLineageId,
            ),
            eq(
              contextOrganizationLifecycleReceipts.lifecycleRevision,
              request.lifecycleRevision,
            ),
            eq(contextOrganizationLifecycleReceipts.phase, phase),
          ),
        )
        .limit(1)

      if (existing[0]) {
        if (existing[0].requestFingerprint !== fingerprint) {
          throw new Error(LIFECYCLE_AUTHORITY_CHANGED)
        }
        return validateOutcome({
          outcome: existing[0].outcome as ContextLifecycleReceiptOutcome,
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
        .where(eq(organizationLifecycleAuthority.organizationId, request.organizationId))
        .limit(1)
        .for('update')
      const authority = authorities[0]
      if (
        !authority ||
        authority.state !== AUTHORITY_STATE_BY_PHASE[phase] ||
        authority.revision !== request.lifecycleRevision ||
        authority.closureLineageId !== request.closureLineageId ||
        authority.recoverableUntil?.getTime() !== request.recoverableUntil.getTime() ||
        request.occurredAt.getTime() < authority.lastTransitionAt.getTime()
      ) {
        throw new Error(LIFECYCLE_AUTHORITY_CHANGED)
      }

      const result = validateOutcome(await work(tx, request))
      await tx.insert(contextOrganizationLifecycleReceipts).values({
        context: deps.context,
        organizationId: request.organizationId,
        closureLineageId: request.closureLineageId,
        lifecycleRevision: request.lifecycleRevision,
        phase,
        requestFingerprint: fingerprint,
        outcome: result.outcome,
        evidenceRef: result.evidenceRef,
        recoverableUntil: request.recoverableUntil,
        occurredAt: request.occurredAt,
        createdAt: request.occurredAt,
      })
      return result
    })
  }

  return Object.freeze({ context: deps.context, run })
}

export type OrganizationLifecyclePhaseWorkSet = Readonly<{
  prepareClosing: OrganizationLifecyclePhaseWork
  verifyPurgeReadiness: OrganizationLifecyclePhaseWork
  purge: OrganizationLifecyclePhaseWork
}>

/**
 * The scaffold Wave 5's sixteen contributors are built on.
 *
 * The returned object is structurally an Identity
 * `OrganizationLifecycleContributor`, so a context adapter can hand it
 * straight to the coordinator without importing Identity's domain layer.
 * Every context therefore gets the same authority, lock and fingerprint
 * semantics for free, and a reviewer only has to read its three phase bodies.
 */
export const createOrganizationLifecycleContributorScaffold = (
  deps: OrganizationLifecycleReceiptStoreDeps & OrganizationLifecyclePhaseWorkSet,
) => {
  const store = createOrganizationLifecycleReceiptStore({
    db: deps.db,
    context: deps.context,
  })
  return Object.freeze({
    context: deps.context,
    prepareClosing: (request: OrganizationLifecycleContributionRequest) =>
      store.run('closing', deps.prepareClosing, request),
    verifyPurgeReadiness: (request: OrganizationLifecycleContributionRequest) =>
      store.run('purge_readiness', deps.verifyPurgeReadiness, request),
    purge: (request: OrganizationLifecycleContributionRequest) =>
      store.run('purge', deps.purge, request),
  })
}

// REL-01 rollback / forward-fix — the report-first recovery orchestrator core.
//
// `recovery-rehearsal-evidence.ts` describes what a completed rehearsal looks
// like. Nothing produced it, and — more dangerous — nothing stood between an
// operator and a destructive step. This module is that missing control, and it
// enforces three rules.
//
// 1. MANDATORY HUMAN PAUSE, KEYED TO THE PLAN DIGEST.
//    The phases are plan → authorize → contain → execute → read-back → emit.
//    `execute` is reachable only with an authorization whose `planSha256` is
//    the digest of the plan that was emitted and read. An operator who edits
//    the plan after reading it invalidates their own authorization, so the
//    thing that was approved and the thing that runs are the same bytes.
//
// 2. REVERSE DDL IS STRUCTURALLY IMPOSSIBLE TO EMIT.
//    A plan naming DROP TABLE / DROP COLUMN / ALTER ... DROP / TRUNCATE /
//    "reverse DDL" is rejected at build time, before it can be authorized. The
//    assembled evidence hardcodes `reverseDdlExecuted: false`; there is no
//    input that can set it true. A rehearsal that actually reversed DDL
//    therefore cannot be described by this module at all — which is the point.
//
// 3. THE ORCHESTRATOR OBSERVES; IT DOES NOT RESTORE.
//    Objectives are COMPUTED from the operator's measured timestamps
//    (RPO = latestCommittedAt − restorePointAt, RTO = readinessRecoveredAt −
//    restoreStartedAt), never accepted as claims, and exceeding either target
//    forces `outcome: 'failed'`. Every digest the evidence names must arrive
//    with the file that hashes to it, because Gate F rejects an unretained
//    dependency.

import { z } from 'zod/v4'
import {
  parseRecoveryRehearsalEvidence,
  recoveryRehearsalDependencyDigests,
  RECOVERY_REHEARSAL_EVIDENCE_VERSION,
  RECOVERY_RPO_TARGET_MS,
  RECOVERY_RTO_TARGET_MS,
  type RecoveryRehearsalEvidence,
} from './recovery-rehearsal-evidence'
import {
  canonicalReleaseEvidence,
  releaseEvidenceSha256,
  type ReleaseCandidateBinding,
} from './candidate-bound-evidence'

const RECOVERY_REHEARSAL_PLAN_VERSION = 'repkey-recovery-rehearsal-plan-1' as const

export const RECOVERY_REHEARSAL_PHASES = [
  'plan',
  'authorize',
  'contain',
  'execute',
  'read-back',
  'emit',
] as const

export type RecoveryRehearsalPhase = (typeof RECOVERY_REHEARSAL_PHASES)[number]

export type RecoveryPath = RecoveryRehearsalEvidence['recoveryPath']

/**
 * Statements a recovery plan may never contain. Matched against every string in
 * the plan, including operator-supplied steps. The patterns are deliberately
 * specific to schema-destructive DDL: "stop customer traffic" must not trip,
 * "drop column" must.
 */
const FORBIDDEN_RECOVERY_STATEMENT_PATTERNS: ReadonlyArray<
  Readonly<{ name: string; pattern: RegExp }>
> = [
  {
    name: 'drop object',
    pattern:
      /\bdrop\s+(table|column|schema|database|index|constraint|type|view|sequence)\b/iu,
  },
  { name: 'alter ... drop', pattern: /\balter\s+table\b[\s\S]{0,200}?\bdrop\b/iu },
  { name: 'truncate', pattern: /\btruncate\b/iu },
  { name: 'reverse DDL', pattern: /\breverse\s+ddl\b/iu },
  { name: 'down migration', pattern: /\bdown\s+migration\b/iu },
]

export type RecoveryRehearsalStep = Readonly<{
  id: string
  phase: RecoveryRehearsalPhase
  description: string
  /**
   * What this step is permitted to change. `none` is a read or a decision;
   * `operator_manual` is performed by a human with an audited command;
   * `platform_receipt_required` cannot complete without a platform-issued
   * receipt, which this orchestrator can only consume, never produce.
   */
  mutation: 'none' | 'operator_manual' | 'platform_receipt_required'
}>

export type RecoveryRehearsalPlan = Readonly<{
  version: typeof RECOVERY_REHEARSAL_PLAN_VERSION
  recoveryPath: RecoveryPath
  candidate: ReleaseCandidateBinding
  createdAt: string
  operator: Readonly<{
    identity: string
    changeRecord: string
    independentReviewer: string
    reviewedAt: string
  }>
  reverseDdlPermitted: false
  steps: readonly RecoveryRehearsalStep[]
}>

const COMPATIBLE_STEPS: readonly RecoveryRehearsalStep[] = [
  {
    id: 'compatibility-decision',
    phase: 'plan',
    description:
      'Prove the current schema and configuration remain backward compatible with the prior signed manifest images, and retain that decision.',
    mutation: 'none',
  },
  {
    id: 'plan-authorization',
    phase: 'authorize',
    description:
      'A human reads this plan and authorizes it by its exact digest. No later phase runs without that authorization.',
    mutation: 'none',
  },
  {
    id: 'containment',
    phase: 'contain',
    description:
      'Stop customer traffic, application mutations, workers, and external effects, and retain the containment evidence.',
    mutation: 'operator_manual',
  },
  {
    id: 'prior-manifest-promotion',
    phase: 'execute',
    description:
      'Re-promote the previously signed and verified prior manifest through the staged audited promotion command with a recorded rollback reason.',
    mutation: 'operator_manual',
  },
  {
    id: 'exact-digest-readback',
    phase: 'read-back',
    description:
      'Read back the exact image digests, release identity, and health controls from every service, plus post-rollback critical journeys.',
    mutation: 'none',
  },
  {
    id: 'assemble-evidence',
    phase: 'emit',
    description:
      'Assemble candidate-bound recovery rehearsal evidence from the retained read-backs.',
    mutation: 'none',
  },
]

const RESTORE_STEPS: readonly RecoveryRehearsalStep[] = [
  {
    id: 'incompatibility-decision',
    phase: 'plan',
    description:
      'Record that image rollback is forbidden for this candidate and retain the reviewed isolated restore plan and its approval.',
    mutation: 'none',
  },
  {
    id: 'plan-authorization',
    phase: 'authorize',
    description:
      'A human reads this plan and authorizes it by its exact digest. No later phase runs without that authorization.',
    mutation: 'none',
  },
  {
    id: 'containment',
    phase: 'contain',
    description:
      'Stop customer traffic, application mutations, workers, and external effects, and retain the containment evidence.',
    mutation: 'operator_manual',
  },
  {
    id: 'isolated-platform-restore',
    phase: 'execute',
    description:
      'The operator performs the platform point-in-time restore into a NEW sibling Postgres service with three fresh Redis services, and supplies the platform-issued receipt. This orchestrator consumes that receipt; it never issues a restore itself.',
    mutation: 'platform_receipt_required',
  },
  {
    id: 'sibling-readback',
    phase: 'read-back',
    description:
      'Verify the recovery fence, migration head, lifecycle state, tenant isolation, critical reads, routing cutover and rollback read-backs on the sibling.',
    mutation: 'none',
  },
  {
    id: 'assemble-evidence',
    phase: 'emit',
    description:
      'Assemble candidate-bound recovery rehearsal evidence with RPO and RTO computed from measured timestamps.',
    mutation: 'none',
  },
]

export type RecoveryRehearsalPlanInput = Readonly<{
  recoveryPath: RecoveryPath
  candidate: ReleaseCandidateBinding
  operator: RecoveryRehearsalPlan['operator']
  createdAt: string
  additionalSteps?: ReadonlyArray<
    Readonly<{ id: string; phase: string; description: string }>
  >
}>

export type RecoveryRehearsalPlanResult =
  | Readonly<{ ok: true; plan: RecoveryRehearsalPlan; digest: string; document: string }>
  | Readonly<{ ok: false; errors: readonly string[] }>

function forbiddenStatementErrors(text: string, label: string): readonly string[] {
  return FORBIDDEN_RECOVERY_STATEMENT_PATTERNS.flatMap(({ name, pattern }) =>
    pattern.test(text)
      ? [
          `${label}: names a destructive statement (${name}). Reverse DDL is never automated; use a forward fix or the isolated restore path.`,
        ]
      : [],
  )
}

export function canonicalRecoveryRehearsalPlan(plan: RecoveryRehearsalPlan): string {
  return canonicalReleaseEvidence(plan)
}

export function buildRecoveryRehearsalPlan(
  input: RecoveryRehearsalPlanInput,
): RecoveryRehearsalPlanResult {
  const errors: string[] = []
  const canonicalSteps =
    input.recoveryPath === 'compatible_image_rollback' ? COMPATIBLE_STEPS : RESTORE_STEPS

  const additional: RecoveryRehearsalStep[] = []
  for (const [index, step] of (input.additionalSteps ?? []).entries()) {
    const phase = RECOVERY_REHEARSAL_PHASES.find((known) => known === step.phase)
    if (!phase) {
      errors.push(
        `additionalSteps.${index}.phase: ${step.phase} is not a rehearsal phase`,
      )
      continue
    }
    errors.push(...forbiddenStatementErrors(step.description, `additionalSteps.${index}`))
    additional.push({
      id: step.id,
      phase,
      description: step.description,
      mutation: 'operator_manual',
    })
  }

  const steps = [...canonicalSteps, ...additional]
  for (const [index, step] of steps.entries()) {
    errors.push(
      ...forbiddenStatementErrors(`${step.id} ${step.description}`, `steps.${index}`),
    )
  }
  const ids = steps.map(({ id }) => id)
  if (new Set(ids).size !== ids.length) errors.push('steps: step ids must be unique')
  if (errors.length > 0) return { ok: false, errors }

  const plan: RecoveryRehearsalPlan = {
    version: RECOVERY_REHEARSAL_PLAN_VERSION,
    recoveryPath: input.recoveryPath,
    candidate: input.candidate,
    createdAt: input.createdAt,
    operator: input.operator,
    reverseDdlPermitted: false,
    steps,
  }
  const document = canonicalRecoveryRehearsalPlan(plan)
  return { ok: true, plan, digest: releaseEvidenceSha256(document), document }
}

export type RecoveryRehearsalAuthorization = Readonly<{
  planSha256: string
  operator: string
  reason: string
  approvedAt: string
}>

export type RecoveryRehearsalTransitionResult =
  | Readonly<{ ok: true; phase: RecoveryRehearsalPhase }>
  | Readonly<{ ok: false; errors: readonly string[] }>

/**
 * The only legal way to move between phases. `execute` is the gate: without an
 * authorization carrying the exact digest of the emitted plan, the machine
 * stops before anything mutates.
 */
export function recoveryRehearsalTransition(
  input: Readonly<{
    from: RecoveryRehearsalPhase
    to: RecoveryRehearsalPhase
    planSha256: string
    authorization?: RecoveryRehearsalAuthorization
  }>,
): RecoveryRehearsalTransitionResult {
  const fromIndex = RECOVERY_REHEARSAL_PHASES.indexOf(input.from)
  const toIndex = RECOVERY_REHEARSAL_PHASES.indexOf(input.to)
  if (fromIndex < 0 || toIndex < 0) {
    return { ok: false, errors: [`unknown rehearsal phase ${input.from} → ${input.to}`] }
  }
  if (toIndex !== fromIndex + 1) {
    return {
      ok: false,
      errors: [
        `recovery rehearsal may not move ${input.from} → ${input.to}; phases advance one at a time`,
      ],
    }
  }
  if (input.to === 'execute') {
    const errors = authorizationErrors(input.authorization, input.planSha256)
    if (errors.length > 0) return { ok: false, errors }
  }
  return { ok: true, phase: input.to }
}

function authorizationErrors(
  authorization: RecoveryRehearsalAuthorization | undefined,
  planSha256: string,
): readonly string[] {
  if (!authorization) {
    return [
      'recovery rehearsal execution requires a human authorization bound to the emitted plan digest',
    ]
  }
  if (authorization.planSha256 !== planSha256) {
    return [
      `authorization covers plan ${authorization.planSha256}, not the emitted plan ${planSha256}; re-read the plan and re-authorize`,
    ]
  }
  if (authorization.operator.trim().length === 0) {
    return ['authorization must name the authorizing operator']
  }
  if (authorization.reason.trim().length === 0) {
    return ['authorization must record a reason']
  }
  return []
}

type ComputedEvidenceKeys =
  'version' | 'evidenceKind' | 'reverseDdlExecuted' | 'attempts' | 'outcome' | 'failures'

export type CompatibleRollbackObservations = Omit<
  Extract<RecoveryRehearsalEvidence, { recoveryPath: 'compatible_image_rollback' }>,
  ComputedEvidenceKeys
>

export type IncompatibleRestoreObservations = Omit<
  Extract<RecoveryRehearsalEvidence, { recoveryPath: 'incompatible_data_restore' }>,
  ComputedEvidenceKeys | 'objectives'
>

export type RecoveryRehearsalDependencyFile = Readonly<{
  sha256: string
  content: string
}>

export type RecoveryRehearsalAssemblyResult =
  | Readonly<{
      ok: true
      evidence: RecoveryRehearsalEvidence
      dependencies: readonly RecoveryRehearsalDependencyFile[]
    }>
  | Readonly<{ ok: false; errors: readonly string[] }>

/**
 * The narrow projection `assembleRecoveryRehearsalEvidence` reads before the
 * full schema runs. Everything else passes through untouched and is validated
 * by `parseRecoveryRehearsalEvidence`, so an operator-supplied read-back file
 * is checked by exactly the contract Gate F will apply — not by a second,
 * looser copy of it living here.
 */
const observationProjectionSchema = z.discriminatedUnion('recoveryPath', [
  z
    .object({
      recoveryPath: z.literal('compatible_image_rollback'),
      verification: z
        .object({
          releaseIdentityConsistent: z.boolean(),
          queueOutboxConsistent: z.boolean(),
          committedDataLossCount: z.number().int().safe().nonnegative(),
          duplicateExternalEffectCount: z.number().int().safe().nonnegative(),
          unsafeExternalEffectCount: z.number().int().safe().nonnegative(),
        })
        .loose(),
    })
    .loose(),
  z
    .object({
      recoveryPath: z.literal('incompatible_data_restore'),
      restore: z
        .object({
          restorePointAt: z.iso.datetime({ offset: false }),
          latestCommittedAt: z.iso.datetime({ offset: false }),
          restoreStartedAt: z.iso.datetime({ offset: false }),
          readinessRecoveredAt: z.iso.datetime({ offset: false }),
        })
        .loose(),
      verification: z
        .object({
          readinessGreen: z.boolean(),
          canaryReadPassed: z.boolean(),
          queueOutboxConsistent: z.boolean(),
          committedSourceIntegrityPassed: z.boolean(),
          committedDataLossCount: z.number().int().safe().nonnegative(),
          duplicateExternalEffectCount: z.number().int().safe().nonnegative(),
          unsafeExternalEffectCount: z.number().int().safe().nonnegative(),
        })
        .loose(),
    })
    .loose(),
])

export function assembleRecoveryRehearsalEvidence(
  input: Readonly<{
    /**
     * The operator's retained read-back document. Typed as `unknown` because it
     * arrives from disk; the projection above plus the full evidence schema are
     * the only things that may decide it is well formed.
     */
    observations: unknown
    authorization: RecoveryRehearsalAuthorization
    planSha256: string
    dependencyFiles: readonly RecoveryRehearsalDependencyFile[]
  }>,
): RecoveryRehearsalAssemblyResult {
  const authorizationIssues = authorizationErrors(input.authorization, input.planSha256)
  if (authorizationIssues.length > 0) return { ok: false, errors: authorizationIssues }

  const projected = observationProjectionSchema.safeParse(input.observations)
  if (!projected.success) {
    return {
      ok: false,
      errors: projected.error.issues.map(
        (issue) => `observations.${issue.path.join('.')}: ${issue.message}`,
      ),
    }
  }

  const failures: string[] = []
  let candidateEvidence: unknown
  if (projected.data.recoveryPath === 'compatible_image_rollback') {
    const observations = projected.data
    if (!observations.verification.releaseIdentityConsistent) {
      failures.push('release identity was not consistent after rollback')
    }
    if (!observations.verification.queueOutboxConsistent) {
      failures.push('queue and outbox were not consistent after rollback')
    }
    if (observations.verification.committedDataLossCount > 0) {
      failures.push(
        `${observations.verification.committedDataLossCount} committed rows were lost`,
      )
    }
    if (observations.verification.duplicateExternalEffectCount > 0) {
      failures.push(
        `${observations.verification.duplicateExternalEffectCount} duplicate external effects`,
      )
    }
    if (observations.verification.unsafeExternalEffectCount > 0) {
      failures.push(
        `${observations.verification.unsafeExternalEffectCount} unsafe external effects`,
      )
    }
    candidateEvidence = {
      ...observations,
      version: RECOVERY_REHEARSAL_EVIDENCE_VERSION,
      evidenceKind: 'recovery-rehearsal',
      reverseDdlExecuted: false,
      attempts: 1,
      outcome: failures.length === 0 ? 'passed' : 'failed',
      failures,
    }
  } else {
    const observations = projected.data
    // Objectives are MEASURED, never claimed: both are differences between two
    // timestamps the operator recorded, so an optimistic RPO cannot be typed in.
    const rpoMs =
      Date.parse(observations.restore.latestCommittedAt) -
      Date.parse(observations.restore.restorePointAt)
    const rtoMs =
      Date.parse(observations.restore.readinessRecoveredAt) -
      Date.parse(observations.restore.restoreStartedAt)
    if (!Number.isFinite(rpoMs) || rpoMs < 0 || !Number.isFinite(rtoMs) || rtoMs < 0) {
      return {
        ok: false,
        errors: ['restore timestamps do not yield a non-negative RPO and RTO'],
      }
    }
    if (rpoMs > RECOVERY_RPO_TARGET_MS) {
      failures.push(`RPO ${rpoMs}ms exceeds the ${RECOVERY_RPO_TARGET_MS}ms target`)
    }
    if (rtoMs > RECOVERY_RTO_TARGET_MS) {
      failures.push(`RTO ${rtoMs}ms exceeds the ${RECOVERY_RTO_TARGET_MS}ms target`)
    }
    if (!observations.verification.readinessGreen)
      failures.push('readiness never recovered')
    if (!observations.verification.canaryReadPassed) failures.push('canary read failed')
    if (!observations.verification.queueOutboxConsistent) {
      failures.push('queue and outbox were not consistent after restore')
    }
    if (!observations.verification.committedSourceIntegrityPassed) {
      failures.push('committed source integrity check failed')
    }
    if (observations.verification.committedDataLossCount > 0) {
      failures.push(
        `${observations.verification.committedDataLossCount} committed rows were lost`,
      )
    }
    if (observations.verification.duplicateExternalEffectCount > 0) {
      failures.push(
        `${observations.verification.duplicateExternalEffectCount} duplicate external effects`,
      )
    }
    if (observations.verification.unsafeExternalEffectCount > 0) {
      failures.push(
        `${observations.verification.unsafeExternalEffectCount} unsafe external effects`,
      )
    }
    candidateEvidence = {
      ...observations,
      objectives: { rpoMs, rtoMs },
      version: RECOVERY_REHEARSAL_EVIDENCE_VERSION,
      evidenceKind: 'recovery-rehearsal',
      reverseDdlExecuted: false,
      attempts: 1,
      outcome: failures.length === 0 ? 'passed' : 'failed',
      failures,
    }
  }

  const parsed = parseRecoveryRehearsalEvidence(
    canonicalReleaseEvidence(candidateEvidence),
  )
  if (!parsed.ok) return { ok: false, errors: parsed.errors }

  const supplied = new Map(
    input.dependencyFiles.map((file) => [file.sha256, file.content] as const),
  )
  const mismatched = input.dependencyFiles.filter(
    (file) => releaseEvidenceSha256(file.content) !== file.sha256,
  )
  if (mismatched.length > 0) {
    return {
      ok: false,
      errors: mismatched.map(
        ({ sha256 }) => `dependency ${sha256} does not hash to its own content`,
      ),
    }
  }
  const digests = [...new Set(recoveryRehearsalDependencyDigests(parsed.evidence))]
  const unretained = digests.filter((digest) => !supplied.has(digest))
  if (unretained.length > 0) {
    return {
      ok: false,
      errors: unretained.map((digest) => `dependency ${digest} has no retained file`),
    }
  }

  return {
    ok: true,
    evidence: parsed.evidence,
    dependencies: digests.map((sha256) => ({
      sha256,
      content: supplied.get(sha256) ?? '',
    })),
  }
}

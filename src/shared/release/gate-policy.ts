// The gate policy registry: every gate, what it asks, and the audience that
// earns it.
//
// WHY A REGISTRY RATHER THAN A BRANCH IN EACH GATE. The obvious shape is for
// each gate that cares to import `CURRENT_RELEASE_POSTURE` and branch on it.
// That works and is smaller, and it loses the two properties that matter.
// First, the gate set stops being visible: "which gates are dormant right now"
// becomes a grep rather than a command, and a policy nobody can read is a
// policy nobody audits. Second, a NEW gate can silently forget that posture
// exists — it just runs everywhere, which is the safe direction but means the
// registry drifts out of date exactly when someone is moving fast.
//
// So the registry is the authority and the gates consult it. `scripts/ci/gate.ts`
// is the bridge for anything invoked from YAML, which cannot import TypeScript.
//
// THE RULE THIS FILE ENFORCES. A gate is `audience-dependent` only if its
// answer genuinely changes when the only user is the owner. Everything else is
// `correctness`, and a correctness gate is armed at every posture — a bug is
// still a bug with an audience of one. `validateGatePolicy` makes that a
// machine-checked invariant rather than a convention, because a convention is
// what gets quietly broken under deadline pressure.
//
// An audience-dependent gate MAY still be armed at the narrowest posture. That
// is a deliberate choice, not an oversight, and `keptArmedByChoice` names the
// ones in that state so the choice stays visible.

import {
  CURRENT_RELEASE_POSTURE,
  isPostureAtLeast,
  type ReleasePosture,
} from './release-posture'

/** Where a gate runs, which decides how it is switched off when dormant. */
export type GateSurface =
  | 'husky'
  | 'ci:check'
  | 'ci:docker'
  | 'ci:e2e'
  | 'ci:other'
  | 'workflow'
  | 'release-evidence'
  | 'legal'
  | 'runtime'

/**
 * Does this gate's answer change with the audience?
 *
 * `correctness` is the default and the safe one. Reach for
 * `audience-dependent` only when you can name the specific thing that stops
 * being true when the only user is the owner.
 */
export type GateClassification = 'audience-dependent' | 'correctness'

export type GateRecord = Readonly<{
  /** Stable identifier, e.g. `ci.check/typecheck` or `gate-f.opening.cohort_readiness`. */
  id: string
  /** What it ACTUALLY asks, in one sentence — not what its name suggests. */
  question: string
  /** `file:line`, so a reader can check the claim. */
  location: string
  surface: GateSurface
  classification: GateClassification
  /**
   * The NARROWEST posture at which this gate arms; it stays armed above that.
   * A correctness gate declares `closed-beta`, which is to say always.
   */
  armedFrom: ReleasePosture
  /** Why the classification holds, grounded in what the gate checks. */
  rationale: string
  /** The shell command `pnpm gate <id>` runs when armed, where one exists. */
  command?: string
}>

export type GatePolicyViolation = Readonly<{
  gateId: string
  reason: string
}>

/**
 * Every gate known to this repository.
 *
 * Seeded here with the gates verified by direct reading while the mechanism was
 * built. The full inventory — every CI step, every `check:*` script, all
 * eighteen Gate F evidence ids, and the legal registry — is issue #373, and
 * lands as additional entries in this array. An absent gate is not an
 * unclassified gate: anything not listed here simply runs unconditionally, so
 * the failure mode of an incomplete registry is "too strict", never "too lax".
 */
export const GATE_POLICY: readonly GateRecord[] = Object.freeze([
  Object.freeze({
    id: 'gate-f.approvals',
    question: 'Has every required approval role signed the release manifest?',
    location: 'src/shared/release/gate-f-evidence.ts:112',
    surface: 'release-evidence',
    classification: 'audience-dependent',
    armedFrom: 'closed-beta',
    rationale:
      'Already posture-scoped, and the precedent for this whole registry: gateFApprovalRolesFor collapses six roles to one (founder) at closed-beta. Armed at every posture because the signature requirement never vanishes — only its size changes, inside the gate itself.',
  }),
  Object.freeze({
    id: 'gate-f.opening.cohort_readiness',
    question: 'Does the first bounded cohort have a named support and incident owner?',
    location: 'src/shared/release/gate-f-evidence.ts:63',
    surface: 'release-evidence',
    classification: 'audience-dependent',
    armedFrom: 'open-beta',
    rationale:
      'A cohort of one, who is also the support owner and the incident owner, makes this question answer itself. It becomes real the moment a second person can reach the product.',
  }),
  Object.freeze({
    id: 'gate-f.candidate.independent_review',
    question: 'Has someone independent of engineering reviewed the candidate?',
    location: 'src/shared/release/gate-f-evidence.ts:47',
    surface: 'release-evidence',
    classification: 'audience-dependent',
    armedFrom: 'open-beta',
    rationale:
      'Structurally unsatisfiable with one developer — INDEPENDENT_OF_ENGINEERING in gate-f-approval-envelope.ts correctly refuses the same person signing twice, so the gate and the situation cannot both be satisfied. Assurance value scales with blast radius, and blast radius is the audience.',
  }),
  Object.freeze({
    id: 'ci.check/typecheck',
    question: 'Does the TypeScript project compile with no type errors?',
    location: '.github/workflows/ci.yml:92',
    surface: 'ci:check',
    classification: 'correctness',
    armedFrom: 'closed-beta',
    rationale: 'A type error is wrong code regardless of who runs it.',
    command: 'pnpm typecheck',
  }),
  Object.freeze({
    id: 'ci.check/check:schema-drift',
    question: 'Does the Drizzle model match the migrated database catalog?',
    location: '.github/workflows/ci.yml:153',
    surface: 'ci:check',
    classification: 'correctness',
    armedFrom: 'closed-beta',
    rationale:
      'Model/catalog drift corrupts data for one user exactly as readily as for a thousand.',
    command: 'pnpm check:schema-drift',
  }),
  Object.freeze({
    id: 'lint-ci/check:runtime-environment-contract',
    question:
      'Has a file that decides what a DEPLOYED service must supply at boot changed?',
    location: 'scripts/ci/check-runtime-environment-contract.ts:45',
    surface: 'ci:check',
    classification: 'correctness',
    armedFrom: 'closed-beta',
    rationale:
      'It exists because commit 739ccbc9 stayed self-consistent, passed every other gate, and crash-looped two production services. A crash-loop on a one-user beta is still a crash-loop, and this is the only signal that catches it.',
    command: 'pnpm check:runtime-environment-contract',
  }),
  Object.freeze({
    id: 'lint-ci/check:legal-registry',
    question:
      'Is every document under docs/legal registered, digest-accurate, and not falsely marked approved?',
    location: 'scripts/review/legal-document-registry.ts:1',
    surface: 'legal',
    classification: 'correctness',
    armedFrom: 'closed-beta',
    rationale:
      'Despite the name this is not the legal gate. It checks that the registry does not LIE — a draft whose digest went stale, or an approval claimed for bytes that changed. Honesty about legal status is audience-independent, and it costs nothing: it exits 0 today.',
    command: 'pnpm check:legal-registry',
  }),
] as readonly GateRecord[])

/** Is this gate armed at `posture`? */
export function isGateArmed(gate: GateRecord, posture: ReleasePosture): boolean {
  return isPostureAtLeast(posture, gate.armedFrom)
}

export function armedGates(
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
  gates: readonly GateRecord[] = GATE_POLICY,
): readonly GateRecord[] {
  return gates.filter((gate) => isGateArmed(gate, posture))
}

export function dormantGates(
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
  gates: readonly GateRecord[] = GATE_POLICY,
): readonly GateRecord[] {
  return gates.filter((gate) => !isGateArmed(gate, posture))
}

/**
 * Audience-dependent gates that are armed anyway at `posture`.
 *
 * Not a violation — a decision. Naming them keeps the decision visible instead
 * of letting it read as an oversight in the classification.
 */
export function keptArmedByChoice(
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
  gates: readonly GateRecord[] = GATE_POLICY,
): readonly GateRecord[] {
  return gates.filter(
    (gate) => gate.classification === 'audience-dependent' && isGateArmed(gate, posture),
  )
}

export function gateById(
  id: string,
  gates: readonly GateRecord[] = GATE_POLICY,
): GateRecord | undefined {
  return gates.find((gate) => gate.id === id)
}

/**
 * Every way the registry can be wrong, reported together.
 *
 * Collecting all violations rather than throwing on the first means one run
 * tells you everything to fix — the difference between one edit and six.
 */
export function validateGatePolicy(
  gates: readonly GateRecord[] = GATE_POLICY,
): readonly GatePolicyViolation[] {
  const violations: GatePolicyViolation[] = []
  const seen = new Set<string>()
  const reportedDuplicates = new Set<string>()

  for (const gate of gates) {
    if (seen.has(gate.id)) {
      if (!reportedDuplicates.has(gate.id)) {
        reportedDuplicates.add(gate.id)
        violations.push({ gateId: gate.id, reason: 'duplicate gate id' })
      }
    }
    seen.add(gate.id)

    if (gate.classification === 'correctness' && gate.armedFrom !== 'closed-beta') {
      violations.push({
        gateId: gate.id,
        reason: 'correctness gate must be armed at every posture',
      })
    }

    if (gate.rationale.trim().length === 0) {
      violations.push({
        gateId: gate.id,
        reason: 'rationale must explain the classification',
      })
    }
  }

  return Object.freeze(violations)
}

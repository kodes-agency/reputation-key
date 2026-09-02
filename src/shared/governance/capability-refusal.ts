// Capability refusal explainer (issue #408) — read-only, content-free.
//
// Three authorities can refuse a capability and, before this module, no surface
// reported across them: `createPolicyDiagnostic` explained the capability,
// permission and scope layers; the Google Content layer emitted a `logger.warn`
// and one boot line; and the Postgres start authority returned a bare `outcome`
// string. Four investigation sessions reasoned about the wrong layer as a
// result.
//
// Four decisions from #408 shape this module, and each is load-bearing:
//
//  1. FIRST REFUSAL, then `not_evaluated`. The chain reports every authority in
//     a fixed order. The first refusal wins; authorities the real path never
//     reached are reported `not_evaluated`, NEVER as a hypothetical pass. An
//     unlabelled hypothetical is exactly the `RELEASE_SHA` failure mode — a
//     field that reads as authoritative and is not.
//
//  2. FACTS, NOT ONLY CODES. Every refusal carries the observed fact: both
//     values on a comparison, and the exact missing thing on an absence.
//     `approval_unavailable` is equally true of a version mismatch, a missing
//     row and an expiry, and those need three different actions.
//
//  3. PURE VALIDATORS ONLY, NO WRITES. This module reuses the real pure
//     validators (`checkBetaCapability`,
//     `validateGoogleContentApprovalCandidate`) and reads rows through injected
//     readers. It deliberately stops before the ExecutionPolicy authorization
//     check, which writes a `policy_decision_audit` row — the caller supplies
//     that verdict instead. A diagnostic must not mutate the record it
//     diagnoses, least of all one an agent calls in a loop over 37 ids.
//
//  4. THE START AUTHORITY IS NEVER CALLED. `start_google_execution_permit_v1`
//     is a SECURITY DEFINER function whose `transition` CTE performs an
//     `UPDATE ... RETURNING`; asking it what it would say starts or fences a
//     permit. Its predicates are NOT duplicated here — the same predicate was
//     found copied four times across three functions (issue #407), and a fifth
//     copy is how that happened. Instead this reports the empirical record from
//     `authorization_execution_permits`. "It refused 1,618 times with
//     correlation_id 'authorization_changed' and never once started" is a fact;
//     "it would refuse" is a prediction.
//
// The fate always rides on the report (issue #406): `capability_blocked`
// collapses four different decisions with four different reactivation rules, so
// the recorded fate and its activation rule are what make "off" mean one thing.

import {
  CAPABILITIES,
  checkBetaCapability,
  isBlockedCapability,
  type Capability,
  type CapabilityDenyReason,
} from '#/shared/auth/beta-capabilities'
import {
  isGoogleContentCapability,
  type GoogleContentCapability,
} from '#/shared/auth/google-content-contract'
import type {
  GoogleContentApprovalRecord,
  GoogleContentRuntimeBinding,
} from '#/shared/auth/google-content-authority'
import type { GoogleContentRuntimeBindings } from '#/shared/auth/google-content-runtime-bindings'
import {
  validateGoogleContentApprovalCandidate,
  type GoogleContentApprovalSignatureVerifier,
} from '#/shared/auth/google-content-approval'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Role } from '#/shared/domain/roles'
import {
  organizationId as brandOrganizationId,
  userId as brandUserId,
} from '#/shared/domain/ids'
import { CAPABILITY_FATE, type CapabilityFateRecord } from './capability-fate'

// ── The authority ladder ─────────────────────────────────────────────

/**
 * Evaluation order. A capability is refused by exactly one of these, and the
 * report names which — the verdict alone was never the missing information.
 */
export const CAPABILITY_AUTHORITIES = [
  'catalogue',
  'fate',
  'global_posture',
  'tenant_allowlist',
  'permission_scope',
  'google_runtime_binding',
  'google_execution_control',
  'google_approval',
  'postgres_start_authority',
] as const

export type CapabilityAuthority = (typeof CAPABILITY_AUTHORITIES)[number]

export type AuthorityOutcome = 'pass' | 'refused' | 'not_applicable' | 'not_evaluated'

/**
 * One observed fact. `expected` is present only for a comparison, and then BOTH
 * sides are rendered — a mismatch that names one value is unactionable.
 */
export type ObservedFact = Readonly<{
  name: string
  expected?: string
  observed: string
}>

export type AuthorityVerdict = Readonly<{
  authority: CapabilityAuthority
  outcome: AuthorityOutcome
  code: string | null
  facts: ReadonlyArray<ObservedFact>
}>

export type PermitOutcomeTally = Readonly<{
  state: 'admitted' | 'started' | 'completed' | 'fenced'
  correlationId: string | null
  count: number
  lastAt: string | null
}>

export type CapabilityRefusalReport = Readonly<{
  capability: string
  allowed: boolean
  /** The authority that produced the refusal. `null` when nothing refused. */
  decidedBy: CapabilityAuthority | null
  code: string | null
  /** Always present: what kind of "off" this is, and what would reactivate it. */
  fate: CapabilityFateRecord | null
  chain: ReadonlyArray<AuthorityVerdict>
  /**
   * Empirical, not predicted. Empty for a capability never attempted, which is
   * itself the answer — nothing has ever asked the start authority.
   */
  permitOutcomes: ReadonlyArray<PermitOutcomeTally>
}>

// ── Injected readers ────────────────────────────────────────────────

export type ExecutionControlRow = Readonly<{
  denied: boolean
  deniedAt: string | null
  emergencyKillVersion: string
}>

/** One `capability_compliance_approvals` row at approval-identity granularity. */
export type ApprovalIdentityRow = Readonly<{
  bindingVersion: number
  binding: GoogleContentRuntimeBinding
}>

export type CapabilityRefusalDeps = Readonly<{
  /**
   * Parsed `GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON`. `undefined` when the
   * variable is absent — the refusal every Google surface hits first.
   */
  googleContentRuntimeBindings: () => GoogleContentRuntimeBindings | undefined
  /** `null` means NO ROW, which refuses for a different reason than denied. */
  loadExecutionControl: (
    capability: GoogleContentCapability,
  ) => Promise<ExecutionControlRow | null>
  /** The row matching every runtime-owned field, i.e. what the real path finds. */
  loadApprovalForRuntime: (
    binding: GoogleContentRuntimeBinding,
  ) => Promise<GoogleContentApprovalRecord | null>
  /**
   * Rows matching capability/phase/profile only. Used to name WHICH field
   * differs when the runtime-matched lookup finds nothing.
   */
  loadApprovalsForIdentity: (
    binding: GoogleContentRuntimeBinding,
  ) => Promise<ReadonlyArray<ApprovalIdentityRow>>
  loadPermitOutcomes: (
    capability: GoogleContentCapability,
  ) => Promise<ReadonlyArray<PermitOutcomeTally>>
  verifyRoleApproval: GoogleContentApprovalSignatureVerifier
  clock: () => Date
}>

export type CapabilityRefusalInput = Readonly<{
  capability: string
  organizationId?: string
  propertyId?: string
  role?: Role
  userId?: string
  /**
   * Supplied by a caller that already ran the ExecutionPolicy permission and
   * scope checks. Absent means those authorities are `not_applicable` — this
   * module never runs them itself, because that check writes an audit row.
   */
  permissionScope?: Readonly<{ allowed: boolean; scopeOutcome: string }>
}>

// ── Reason → authority ──────────────────────────────────────────────

/**
 * Exhaustive by typecheck: a new deny reason cannot exist without being
 * attributed to an authority, so the report can never say "refused, unknown
 * who by".
 */
const REASON_AUTHORITY = {
  unknown_capability: 'catalogue',
  capability_blocked: 'fate',
  capability_disabled: 'global_posture',
  org_not_allowlisted: 'tenant_allowlist',
  property_not_allowlisted: 'tenant_allowlist',
  org_suspended: 'tenant_allowlist',
  property_suspended: 'tenant_allowlist',
  missing_policy: 'tenant_allowlist',
} as const satisfies Readonly<Record<CapabilityDenyReason, CapabilityAuthority>>

// ── Runtime-binding difference ──────────────────────────────────────

const renderCohort = (value: readonly string[] | null): string =>
  value === null ? '<null>' : `[${[...value].join(', ')}]`

/**
 * Exhaustive by typecheck over every runtime-owned field, so a field added to
 * `GoogleContentRuntimeBinding` cannot silently escape the diff and leave an
 * `approval_unavailable` with no named cause.
 */
const BINDING_FIELDS = {
  capability: (b) => b.capability,
  targetPhase: (b) => b.targetPhase,
  environmentProfile: (b) => b.environmentProfile,
  releaseSha: (b) => b.releaseSha,
  evidenceManifestSha256: (b) => b.evidenceManifestSha256,
  evidenceIndexSha256: (b) => b.evidenceIndexSha256,
  deploymentAttestationSha256: (b) => b.deploymentAttestationSha256,
  adr0050Sha256: (b) => b.adr0050Sha256,
  googleContentPolicyVersion: (b) => b.googleContentPolicyVersion,
  googleOAuthContractVersion: (b) => b.googleOAuthContractVersion,
  googleProjectAttestationSha256: (b) => b.googleProjectAttestationSha256,
  googleOAuthClientIdSha256: (b) => b.googleOAuthClientIdSha256,
  googleRedirectUriSha256: (b) => b.googleRedirectUriSha256,
  providerOriginProfileSha256: (b) => b.providerOriginProfileSha256,
  runtimeIsolationProfileVersion: (b) => b.runtimeIsolationProfileVersion ?? '<null>',
  runtimeIsolationProfileSha256: (b) => b.runtimeIsolationProfileSha256 ?? '<null>',
  railwayClosedBetaCohort: (b) => renderCohort(b.railwayClosedBetaCohort),
  railwayClosedBetaCohortSha256: (b) => b.railwayClosedBetaCohortSha256 ?? '<null>',
  railwayClosedBetaResidualRiskSha256: (b) =>
    b.railwayClosedBetaResidualRiskSha256 ?? '<null>',
  performanceCatalogVersion: (b) => b.performanceCatalogVersion,
  routeCatalogueVersion: (b) => b.routeCatalogueVersion,
  capabilityPolicyVersion: (b) => b.capabilityPolicyVersion,
  executionPolicyVersion: (b) => b.executionPolicyVersion,
  migrationHead: (b) => b.migrationHead,
  imageDigests: (b) =>
    Object.entries(b.imageDigests)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([role, digest]) => `${role}=${digest}`)
      .join(' '),
} as const satisfies Readonly<
  Record<
    keyof GoogleContentRuntimeBinding,
    (binding: GoogleContentRuntimeBinding) => string
  >
>

/** Every field where the stored row and the running binding disagree. */
export function runtimeBindingDifferences(
  row: GoogleContentRuntimeBinding,
  running: GoogleContentRuntimeBinding,
): ReadonlyArray<ObservedFact> {
  const differences: ObservedFact[] = []
  for (const [name, render] of Object.entries(BINDING_FIELDS)) {
    const expected = render(running)
    const observed = render(row)
    if (expected !== observed) differences.push({ name, expected, observed })
  }
  return differences
}

// ── Chain assembly ──────────────────────────────────────────────────

const verdict = (
  authority: CapabilityAuthority,
  outcome: AuthorityOutcome,
  code: string | null = null,
  facts: ReadonlyArray<ObservedFact> = [],
): AuthorityVerdict => Object.freeze({ authority, outcome, code, facts })

/**
 * Pad the chain so every authority appears exactly once and in order. Anything
 * the walk did not reach is `not_evaluated` — never an inferred pass.
 */
function completeChain(
  reached: ReadonlyArray<AuthorityVerdict>,
): ReadonlyArray<AuthorityVerdict> {
  const byAuthority: Record<string, AuthorityVerdict> = Object.fromEntries(
    reached.map((entry) => [entry.authority, entry]),
  )
  return CAPABILITY_AUTHORITIES.map(
    (authority) => byAuthority[authority] ?? verdict(authority, 'not_evaluated'),
  )
}

function report(
  capability: string,
  reached: ReadonlyArray<AuthorityVerdict>,
  permitOutcomes: ReadonlyArray<PermitOutcomeTally> = [],
): CapabilityRefusalReport {
  const refusal = reached.find((entry) => entry.outcome === 'refused') ?? null
  return Object.freeze({
    capability,
    allowed: refusal === null,
    decidedBy: refusal?.authority ?? null,
    code: refusal?.code ?? null,
    fate:
      (CAPABILITY_FATE as Readonly<Record<string, CapabilityFateRecord>>)[capability] ??
      null,
    chain: completeChain(reached),
    permitOutcomes,
  })
}

export function createCapabilityRefusalExplainer(deps: CapabilityRefusalDeps) {
  /** Authorities 6-9. Only reached once 1-5 have passed. */
  async function explainGoogleContent(
    capability: GoogleContentCapability,
    organizationId: string | undefined,
    reached: AuthorityVerdict[],
  ): Promise<ReadonlyArray<PermitOutcomeTally>> {
    const permitOutcomes = await deps.loadPermitOutcomes(capability)
    const bindings = deps.googleContentRuntimeBindings()
    const running = bindings?.[capability]

    if (!running) {
      reached.push(
        verdict('google_runtime_binding', 'refused', 'runtime_unavailable', [
          {
            name: 'GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON',
            expected: `a binding for ${capability}`,
            observed:
              bindings === undefined
                ? '<variable absent>'
                : `bindings present for [${Object.keys(bindings).sort().join(', ')}]`,
          },
        ]),
      )
      return permitOutcomes
    }
    reached.push(
      verdict('google_runtime_binding', 'pass', null, [
        { name: 'releaseSha', observed: running.releaseSha },
        { name: 'routeCatalogueVersion', observed: running.routeCatalogueVersion },
        { name: 'migrationHead', observed: running.migrationHead },
      ]),
    )

    // Two distinct refusals, deliberately: nothing in any enablement flow
    // creates this row, so absence is the silent failure mode and must not be
    // reported as somebody's deliberate kill.
    const control = await deps.loadExecutionControl(capability)
    if (control === null) {
      reached.push(
        verdict('google_execution_control', 'refused', 'no_execution_control_row', [
          {
            name: 'capability_execution_control',
            expected: `a row for ${capability}`,
            observed: '<no row>',
          },
          {
            name: 'consequence',
            observed:
              'the start authority INNER JOINs this table, so absence denies with nobody having denied anything',
          },
        ]),
      )
      return permitOutcomes
    }
    if (control.denied) {
      reached.push(
        verdict('google_execution_control', 'refused', 'capability_killed', [
          { name: 'denied', expected: 'false', observed: 'true' },
          { name: 'deniedAt', observed: control.deniedAt ?? '<null>' },
          { name: 'emergencyKillVersion', observed: control.emergencyKillVersion },
        ]),
      )
      return permitOutcomes
    }
    reached.push(
      verdict('google_execution_control', 'pass', null, [
        { name: 'denied', observed: 'false' },
        { name: 'emergencyKillVersion', observed: control.emergencyKillVersion },
      ]),
    )

    const approval = await deps.loadApprovalForRuntime(running)
    if (!approval) {
      // `approval_unavailable` is true of a mismatch, an absence and an expiry.
      // Name which, by diffing the identity-level rows against the running
      // binding — this is the fact whose absence cost a week.
      const candidates = await deps.loadApprovalsForIdentity(running)
      const facts: ObservedFact[] =
        candidates.length === 0
          ? [
              {
                name: 'capability_compliance_approvals',
                expected: `a row for (${running.capability}, ${running.targetPhase}, ${running.environmentProfile})`,
                observed: '<no row at approval identity>',
              },
            ]
          : candidates.flatMap((candidate) =>
              runtimeBindingDifferences(candidate.binding, running).map((difference) => ({
                ...difference,
                name: `bindingVersion ${candidate.bindingVersion}: ${difference.name}`,
              })),
            )
      reached.push(verdict('google_approval', 'refused', 'approval_unavailable', facts))
      return permitOutcomes
    }

    const validation = validateGoogleContentApprovalCandidate(
      approval.candidate,
      deps.clock(),
      deps.verifyRoleApproval,
    )
    if (!validation.ok) {
      reached.push(
        verdict('google_approval', 'refused', validation.code, [
          { name: 'approvalId', observed: approval.id },
          { name: 'approvedAt', observed: approval.candidate.binding.approvedAt },
          { name: 'expiresAt', observed: approval.candidate.binding.expiresAt },
          { name: 'now', observed: deps.clock().toISOString() },
        ]),
      )
      return permitOutcomes
    }
    reached.push(
      verdict('google_approval', 'pass', null, [
        { name: 'approvalId', observed: approval.id },
        { name: 'expiresAt', observed: approval.candidate.binding.expiresAt },
      ]),
    )

    // NEVER called — see decision 4 in the module docblock. What is reported
    // instead are the values its predicates compare, plus the empirical record.
    reached.push(
      verdict('postgres_start_authority', 'not_evaluated', null, [
        {
          name: 'why',
          observed:
            'start_google_execution_permit_v1 mutates (UPDATE ... RETURNING); asking it starts or fences a permit',
        },
        { name: 'route_catalog_version', observed: running.routeCatalogueVersion },
        { name: 'execution_policy_version', observed: running.executionPolicyVersion },
        {
          name: 'google_project_attestation_sha256',
          observed: running.googleProjectAttestationSha256,
        },
        {
          name: 'railway_closed_beta_cohort',
          observed: renderCohort(running.railwayClosedBetaCohort),
          ...(organizationId === undefined
            ? {}
            : { expected: `contains ${organizationId}` }),
        },
      ]),
    )
    return permitOutcomes
  }

  return async function explainCapabilityRefusal(
    input: CapabilityRefusalInput,
  ): Promise<CapabilityRefusalReport> {
    const reached: AuthorityVerdict[] = []

    if (!(CAPABILITIES as readonly string[]).includes(input.capability)) {
      reached.push(
        verdict('catalogue', 'refused', 'unknown_capability', [
          {
            name: 'CAPABILITIES',
            expected: 'a member of the capability catalogue',
            observed: input.capability,
          },
        ]),
      )
      return report(input.capability, reached)
    }
    const capability = input.capability as Capability
    reached.push(verdict('catalogue', 'pass'))

    const fate = CAPABILITY_FATE[capability]
    if (isBlockedCapability(capability)) {
      // The fate, not `capability_blocked`: four decisions with four different
      // reactivation rules used to share one code.
      reached.push(
        verdict('fate', 'refused', fate.fate, [
          { name: 'authority', observed: fate.authority },
          { name: 'activation', observed: fate.activation },
        ]),
      )
      return report(capability, reached)
    }
    reached.push(verdict('fate', 'pass', fate.fate, []))

    // The real decision function, not a re-derivation — same discipline as
    // createPolicyDiagnostic.
    if (input.role === undefined || input.organizationId === undefined) {
      reached.push(verdict('global_posture', 'not_evaluated'))
      reached.push(
        verdict('tenant_allowlist', 'not_evaluated', null, [
          {
            name: 'why',
            observed: 'no member context supplied; tenant authorities need (org, role)',
          },
        ]),
      )
    } else {
      const decision = checkBetaCapability(
        {
          userId: brandUserId(input.userId ?? 'diagnostic'),
          organizationId: brandOrganizationId(input.organizationId),
          role: input.role,
        } satisfies AuthContext,
        capability,
        input.propertyId,
      )
      if (!decision.allowed) {
        const reason = decision.reason as CapabilityDenyReason
        reached.push(
          verdict(REASON_AUTHORITY[reason] ?? 'tenant_allowlist', 'refused', reason, [
            { name: 'organizationId', observed: input.organizationId },
            ...(input.propertyId
              ? [{ name: 'propertyId', observed: input.propertyId }]
              : []),
          ]),
        )
        return report(capability, reached)
      }
      reached.push(verdict('global_posture', 'pass'))
      reached.push(verdict('tenant_allowlist', 'pass'))
    }

    if (input.permissionScope === undefined) {
      reached.push(
        verdict('permission_scope', 'not_applicable', null, [
          {
            name: 'why',
            observed:
              'not evaluated here: the ExecutionPolicy check writes a policy_decision_audit row, so the caller supplies this verdict',
          },
        ]),
      )
    } else if (!input.permissionScope.allowed) {
      reached.push(
        verdict('permission_scope', 'refused', 'permission_denied', [
          { name: 'scopeOutcome', observed: input.permissionScope.scopeOutcome },
        ]),
      )
      return report(capability, reached)
    } else {
      reached.push(
        verdict('permission_scope', 'pass', null, [
          { name: 'scopeOutcome', observed: input.permissionScope.scopeOutcome },
        ]),
      )
    }

    if (!isGoogleContentCapability(capability)) {
      for (const authority of [
        'google_runtime_binding',
        'google_execution_control',
        'google_approval',
        'postgres_start_authority',
      ] as const) {
        reached.push(
          verdict(authority, 'not_applicable', null, [
            { name: 'why', observed: 'not a Google Content capability' },
          ]),
        )
      }
      return report(capability, reached)
    }

    const permitOutcomes = await explainGoogleContent(
      capability,
      input.organizationId,
      reached,
    )
    return report(capability, reached, permitOutcomes)
  }
}

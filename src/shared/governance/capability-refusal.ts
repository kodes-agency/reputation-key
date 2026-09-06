// Capability refusal explainer (issue #408) — read-only, content-free.
//
// The chain reports each live authority in a fixed order. The first refusal
// wins; authorities the real path never reached are `not_evaluated`, never
// hypothetical passes. Every refusal includes the observed fact so operators
// can distinguish an absent control row from a deliberate kill.
//
// This module reuses the real pure capability validator and reads persisted
// state through injected readers. It stops before the ExecutionPolicy
// authorization check, which writes a `policy_decision_audit` row; callers may
// supply that verdict instead.
//
// The Postgres start authority is never called here. Its transition performs
// an UPDATE ... RETURNING, so asking it what it would say would start or fence
// a permit. The diagnostic reports the empirical permit record instead.
//
// The fate always rides on the report (issue #406): `capability_blocked`
// collapses decisions with different reactivation rules, so the recorded fate
// and its activation rule are what make "off" mean one thing.

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
  'google_execution_control',
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

export type CapabilityRefusalDeps = Readonly<{
  /** `null` means NO ROW, which refuses for a different reason than denied. */
  loadExecutionControl: (
    capability: GoogleContentCapability,
  ) => Promise<ExecutionControlRow | null>
  loadPermitOutcomes: (
    capability: GoogleContentCapability,
  ) => Promise<ReadonlyArray<PermitOutcomeTally>>
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
  async function explainGoogleContent(
    capability: GoogleContentCapability,
    reached: AuthorityVerdict[],
  ): Promise<ReadonlyArray<PermitOutcomeTally>> {
    const permitOutcomes = await deps.loadPermitOutcomes(capability)

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
              'the live control loader treats a capability without an explicitly allowed row as killed',
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

    reached.push(
      verdict('postgres_start_authority', 'not_evaluated', null, [
        {
          name: 'why',
          observed:
            'start_google_execution_permit_v3 mutates (UPDATE ... RETURNING); asking it starts or fences a permit',
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
        'google_execution_control',
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

    const permitOutcomes = await explainGoogleContent(capability, reached)
    return report(capability, reached, permitOutcomes)
  }
}

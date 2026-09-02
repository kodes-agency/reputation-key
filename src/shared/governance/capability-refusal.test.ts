import { describe, expect, it } from 'vitest'
import {
  GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION,
  GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_CONTENT_POLICY_VERSION,
  GOOGLE_OAUTH_CONTRACT_VERSION,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
} from '#/shared/auth/google-content-contract'
import type { GoogleContentRuntimeBinding } from '#/shared/auth/google-content-authority'
import {
  CAPABILITY_AUTHORITIES,
  createCapabilityRefusalExplainer,
  runtimeBindingDifferences,
  type AuthorityVerdict,
  type CapabilityRefusalDeps,
  type CapabilityRefusalReport,
  type CapabilityAuthority,
} from './capability-refusal'

const digest = (seed: string): string => seed.repeat(64).slice(0, 64)

const binding = (
  over: Partial<GoogleContentRuntimeBinding> = {},
): GoogleContentRuntimeBinding => ({
  capability: 'property.import_gbp_v2',
  targetPhase: 'railway_closed_beta',
  environmentProfile: 'railway-closed-beta-1',
  releaseSha: 'a'.repeat(40),
  evidenceManifestSha256: digest('1'),
  evidenceIndexSha256: digest('2'),
  deploymentAttestationSha256: digest('3'),
  adr0050Sha256: digest('4'),
  googleContentPolicyVersion: GOOGLE_CONTENT_POLICY_VERSION,
  googleOAuthContractVersion: GOOGLE_OAUTH_CONTRACT_VERSION,
  googleProjectAttestationSha256: digest('5'),
  googleOAuthClientIdSha256: digest('6'),
  googleRedirectUriSha256: digest('7'),
  providerOriginProfileSha256: digest('8'),
  runtimeIsolationProfileVersion: null,
  runtimeIsolationProfileSha256: null,
  railwayClosedBetaCohort: ['org-1'],
  railwayClosedBetaCohortSha256: digest('9'),
  railwayClosedBetaResidualRiskSha256: digest('b'),
  performanceCatalogVersion: GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION,
  routeCatalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  capabilityPolicyVersion: GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION,
  executionPolicyVersion: GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
  migrationHead: '0177_google_permit_release_decoupling',
  imageDigests: {
    web: `sha256:${digest('c')}`,
    worker: `sha256:${digest('d')}`,
    googleExecutionAdmission: `sha256:${digest('e')}`,
    googleEgressGateway: `sha256:${digest('f')}`,
    providerEphemeralRedis: `sha256:${digest('0')}`,
  },
  ...over,
})

const deps = (over: Partial<CapabilityRefusalDeps> = {}): CapabilityRefusalDeps => ({
  googleContentRuntimeBindings: () => ({ 'property.import_gbp_v2': binding() }),
  loadExecutionControl: async () => ({
    denied: false,
    deniedAt: null,
    emergencyKillVersion: '0',
  }),
  loadApprovalForRuntime: async () => null,
  loadApprovalsForIdentity: async () => [],
  loadPermitOutcomes: async () => [],
  verifyRoleApproval: () => true,
  clock: () => new Date('2026-09-02T12:00:00.000Z'),
  ...over,
})

const at = (
  report: CapabilityRefusalReport,
  authority: CapabilityAuthority,
): AuthorityVerdict => report.chain.find((entry) => entry.authority === authority)!

describe('capability refusal explainer', () => {
  it('reports every authority exactly once, in ladder order, whatever happened', async () => {
    const explain = createCapabilityRefusalExplainer(deps())
    for (const capability of ['nope.nope', 'portal.upload', 'goal.use', 'review.use']) {
      const report = await explain({ capability })
      expect(report.chain.map((entry) => entry.authority)).toEqual([
        ...CAPABILITY_AUTHORITIES,
      ])
    }
  })

  it('refuses an id outside the catalogue and evaluates nothing further', async () => {
    const report = await createCapabilityRefusalExplainer(deps())({
      capability: 'portal.uplaod',
    })

    expect(report.allowed).toBe(false)
    expect(report.decidedBy).toBe('catalogue')
    expect(report.code).toBe('unknown_capability')
    expect(at(report, 'catalogue').facts).toContainEqual({
      name: 'CAPABILITIES',
      expected: 'a member of the capability catalogue',
      observed: 'portal.uplaod',
    })
    // Never an inferred pass for anything downstream.
    for (const authority of CAPABILITY_AUTHORITIES.slice(1)) {
      expect(at(report, authority).outcome).toBe('not_evaluated')
    }
  })

  // #406: `capability_blocked` collapsed four decisions with four different
  // reactivation rules. The fate and its activation rule are the answer.
  it.each([
    ['portal.upload', 'safety_blocked', 'SAFE-01'],
    ['portal.guest_contact', 'safety_blocked', 'counsel'],
    ['badge.use', 'legacy_blocked', 'Never reactivate'],
    ['gbp.reply.auto_publish', 'permanently_denied', 'No activation path'],
    ['identity.register', 'beta_disabled', 'code posture change'],
  ])(
    'reports %s as %s rather than capability_blocked',
    async (capability, fate, hint) => {
      const report = await createCapabilityRefusalExplainer(deps())({ capability })

      expect(report.decidedBy).toBe('fate')
      expect(report.code).toBe(fate)
      expect(report.code).not.toBe('capability_blocked')
      const activation = at(report, 'fate').facts.find((f) => f.name === 'activation')
      expect(activation?.observed).toContain(hint)
    },
  )

  it('carries the fate even when nothing refuses', async () => {
    const report = await createCapabilityRefusalExplainer(deps())({
      capability: 'review.use',
    })

    expect(report.fate?.fate).toBe('core')
    expect(report.decidedBy).toBe(null)
    expect(report.allowed).toBe(true)
  })

  it('marks the Google authorities not_applicable for a non-Google capability', async () => {
    const report = await createCapabilityRefusalExplainer(deps())({
      capability: 'goal.use',
    })

    for (const authority of [
      'google_runtime_binding',
      'google_execution_control',
      'google_approval',
      'postgres_start_authority',
    ] as const) {
      expect(at(report, authority).outcome).toBe('not_applicable')
    }
  })

  // Decision 3: this module never runs the ExecutionPolicy check, because that
  // check writes a policy_decision_audit row.
  it('never evaluates permission and scope itself, and says why', async () => {
    const report = await createCapabilityRefusalExplainer(deps())({
      capability: 'review.use',
    })

    const entry = at(report, 'permission_scope')
    expect(entry.outcome).toBe('not_applicable')
    expect(entry.facts[0]?.observed).toContain('policy_decision_audit')
  })

  it('names the absent runtime binding and what is present instead', async () => {
    const report = await createCapabilityRefusalExplainer(
      deps({ googleContentRuntimeBindings: () => ({}) }),
    )({ capability: 'property.import_gbp_v2' })

    expect(report.decidedBy).toBe('google_runtime_binding')
    expect(report.code).toBe('runtime_unavailable')
    expect(at(report, 'google_runtime_binding').facts[0]).toMatchObject({
      name: 'GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON',
      expected: 'a binding for property.import_gbp_v2',
      observed: 'bindings present for []',
    })
  })

  it('distinguishes an absent runtime-bindings variable from an incomplete one', async () => {
    const report = await createCapabilityRefusalExplainer(
      deps({ googleContentRuntimeBindings: () => undefined }),
    )({ capability: 'property.import_gbp_v2' })

    expect(at(report, 'google_runtime_binding').facts[0]?.observed).toBe(
      '<variable absent>',
    )
  })

  // #407 rider: absence is the silent failure mode — nothing in any enablement
  // flow creates this row — so it must not read as somebody's deliberate kill.
  it('separates a missing execution-control row from a deliberate kill', async () => {
    const missing = await createCapabilityRefusalExplainer(
      deps({ loadExecutionControl: async () => null }),
    )({ capability: 'property.import_gbp_v2' })

    expect(missing.decidedBy).toBe('google_execution_control')
    expect(missing.code).toBe('no_execution_control_row')
    expect(at(missing, 'google_execution_control').facts[1]?.observed).toContain(
      'INNER JOIN',
    )

    const killed = await createCapabilityRefusalExplainer(
      deps({
        loadExecutionControl: async () => ({
          denied: true,
          deniedAt: '2026-09-01T09:00:00.000Z',
          emergencyKillVersion: '4',
        }),
      }),
    )({ capability: 'property.import_gbp_v2' })

    expect(killed.code).toBe('capability_killed')
    expect(at(killed, 'google_execution_control').facts).toContainEqual({
      name: 'deniedAt',
      observed: '2026-09-01T09:00:00.000Z',
      expected: undefined,
    })
  })

  // The fact whose absence cost a week: `approval_unavailable` is equally true
  // of a mismatch, an absence and an expiry.
  it('names which binding field drifted, with both values', async () => {
    const running = binding()
    const report = await createCapabilityRefusalExplainer(
      deps({
        googleContentRuntimeBindings: () => ({ 'property.import_gbp_v2': running }),
        loadApprovalForRuntime: async () => null,
        loadApprovalsForIdentity: async () => [
          {
            bindingVersion: 3,
            binding: binding({ releaseSha: 'f'.repeat(40), migrationHead: '0042_old' }),
          },
        ],
      }),
    )({ capability: 'property.import_gbp_v2' })

    expect(report.decidedBy).toBe('google_approval')
    expect(report.code).toBe('approval_unavailable')
    expect(at(report, 'google_approval').facts).toEqual([
      {
        name: 'bindingVersion 3: releaseSha',
        expected: 'a'.repeat(40),
        observed: 'f'.repeat(40),
      },
      {
        name: 'bindingVersion 3: migrationHead',
        expected: '0177_google_permit_release_decoupling',
        observed: '0042_old',
      },
    ])
  })

  it('reports an absent approval row as an absence, not a drift', async () => {
    const report = await createCapabilityRefusalExplainer(
      deps({ loadApprovalsForIdentity: async () => [] }),
    )({ capability: 'property.import_gbp_v2' })

    expect(at(report, 'google_approval').facts[0]).toMatchObject({
      name: 'capability_compliance_approvals',
      observed: '<no row at approval identity>',
    })
  })

  // Decision 4: the start authority mutates, so it is never called. What is
  // reported is the empirical record plus the values its predicates compare.
  it('never evaluates the start authority and reports permit outcomes instead', async () => {
    const report = await createCapabilityRefusalExplainer(
      deps({
        loadApprovalForRuntime: async () => null,
        loadPermitOutcomes: async () => [
          {
            state: 'fenced',
            correlationId: 'authorization_changed',
            count: 1618,
            lastAt: '2026-08-31T10:00:00.000Z',
          },
          { state: 'started', correlationId: null, count: 0, lastAt: null },
        ],
      }),
    )({ capability: 'property.import_gbp_v2' })

    expect(at(report, 'postgres_start_authority').outcome).not.toBe('refused')
    expect(report.permitOutcomes).toEqual([
      {
        state: 'fenced',
        correlationId: 'authorization_changed',
        count: 1618,
        lastAt: '2026-08-31T10:00:00.000Z',
      },
      { state: 'started', correlationId: null, count: 0, lastAt: null },
    ])
  })

  // Decision 4 as an invariant rather than one scenario: whatever happens
  // upstream, the start authority may never be reported as satisfied — it is
  // the one authority this module refuses to ask, because asking mutates.
  it('never reports the start authority as passing, in any scenario', async () => {
    const scenarios: ReadonlyArray<Partial<CapabilityRefusalDeps>> = [
      {},
      { googleContentRuntimeBindings: () => undefined },
      { googleContentRuntimeBindings: () => ({}) },
      { loadExecutionControl: async () => null },
      {
        loadExecutionControl: async () => ({
          denied: true,
          deniedAt: '2026-09-01T09:00:00.000Z',
          emergencyKillVersion: '4',
        }),
      },
      {
        loadApprovalsForIdentity: async () => [
          { bindingVersion: 9, binding: binding({ releaseSha: 'e'.repeat(40) }) },
        ],
      },
    ]

    for (const override of scenarios) {
      for (const capability of ['property.import_gbp_v2', 'goal.use', 'portal.upload']) {
        const report = await createCapabilityRefusalExplainer(deps(override))({
          capability,
          organizationId: 'org-1',
        })
        expect(at(report, 'postgres_start_authority').outcome, capability).not.toBe(
          'pass',
        )
        expect(report.decidedBy).not.toBe('postgres_start_authority')
      }
    }
  })
})

describe('runtimeBindingDifferences', () => {
  it('detects a drift in every runtime-owned field', () => {
    const base = binding()
    const keys = Object.keys(base)
    expect(keys.length).toBeGreaterThanOrEqual(25)

    for (const key of keys) {
      const value = (base as Record<string, unknown>)[key]
      const drifted: Record<string, unknown> = { ...base }
      drifted[key] = Array.isArray(value)
        ? null
        : value !== null && typeof value === 'object'
          ? {}
          : 'DRIFT'

      const differences = runtimeBindingDifferences(
        drifted as unknown as GoogleContentRuntimeBinding,
        base,
      )
      expect(
        differences.map((difference) => difference.name),
        `${key} escaped the diff`,
      ).toContain(key)
    }
  })

  it('reports no difference for an identical binding', () => {
    expect(runtimeBindingDifferences(binding(), binding())).toEqual([])
  })
})

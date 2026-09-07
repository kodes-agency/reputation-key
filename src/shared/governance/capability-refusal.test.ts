import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_AUTHORITIES,
  createCapabilityRefusalExplainer,
  type AuthorityVerdict,
  type CapabilityRefusalDeps,
  type CapabilityRefusalReport,
  type CapabilityAuthority,
} from './capability-refusal'

const deps = (over: Partial<CapabilityRefusalDeps> = {}): CapabilityRefusalDeps => ({
  loadExecutionControl: async () => ({
    denied: false,
    deniedAt: null,
    emergencyKillVersion: '0',
  }),
  loadPermitOutcomes: async () => [],
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
      'google_execution_control',
      'postgres_start_authority',
    ] as const) {
      expect(at(report, authority).outcome).toBe('not_applicable')
    }
  })

  // This diagnostic receives the permission and scope verdict from its caller.
  it('never evaluates permission and scope itself, and says why', async () => {
    const report = await createCapabilityRefusalExplainer(deps())({
      capability: 'review.use',
    })

    const entry = at(report, 'permission_scope')
    expect(entry.outcome).toBe('not_applicable')
    expect(entry.facts[0]?.observed).toContain('caller supplies')
  })

  // Absence and a deliberate kill are distinct operator facts even though both
  // fail closed.
  it('separates a missing execution-control row from a deliberate kill', async () => {
    const missing = await createCapabilityRefusalExplainer(
      deps({ loadExecutionControl: async () => null }),
    )({ capability: 'property.import_gbp_v2' })

    expect(missing.decidedBy).toBe('google_execution_control')
    expect(missing.code).toBe('no_execution_control_row')
    expect(at(missing, 'google_execution_control').facts[1]?.observed).toContain(
      'explicitly allowed row',
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

  // The start authority mutates, so it is never called; the diagnostic reports
  // the empirical permit record instead.
  it('never evaluates the start authority and reports permit outcomes instead', async () => {
    const report = await createCapabilityRefusalExplainer(
      deps({
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

  // Whatever happens upstream, the start authority may never be reported as
  // satisfied: it is the one authority this module refuses to ask because
  // asking mutates.
  it('never reports the start authority as passing, in any scenario', async () => {
    const scenarios: ReadonlyArray<Partial<CapabilityRefusalDeps>> = [
      {},
      { loadExecutionControl: async () => null },
      {
        loadExecutionControl: async () => ({
          denied: true,
          deniedAt: '2026-09-01T09:00:00.000Z',
          emergencyKillVersion: '4',
        }),
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

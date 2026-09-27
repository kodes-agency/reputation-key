// The Organization allowlist's environment-wide form (ADR 0032 amendment,
// 2026-09-27). `BETA_ALLOWLIST_ORGS` names Organization IDs, so every fresh
// database — a new cell, a reset, a local stack — mints an Organization the
// list does not name, and all controlled-beta capabilities go dark at once.
// `*` admits every Organization in the environment instead. It is still an
// explicit operator input, and it must widen nothing but that one question:
// the kill switch, suspension and blocked fates all still win.

import { afterEach, describe, expect, it } from 'vitest'
import {
  checkScopedCapability,
  createEnvCapabilityPolicyStore,
  describeOrgAllowlist,
  initCapabilityPolicyStore,
  isOrgInAllowlist,
  resetCapabilityPolicyStore,
  type Capability,
  type CapabilityPolicyEnv,
} from './beta-capabilities'

const ORG = 'dbdc2335-9cc8-413e-8a89-8c4615a1ed3d'

function decide(env: CapabilityPolicyEnv, capability: Capability, organizationId = ORG) {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
  return checkScopedCapability({ organizationId }, capability)
}

afterEach(() => resetCapabilityPolicyStore())

describe('BETA_ALLOWLIST_ORGS=*', () => {
  it.each<Capability>([
    'property.import_gbp_v2',
    'notification.send_email',
    'goal.use',
    'portal.write',
    'ai.generate_reply',
  ])('admits an Organization no list names to %s', (capability) => {
    expect(decide({ BETA_ALLOWLIST_ORGS: '*' }, capability)).toEqual({
      allowed: true,
      reason: 'allowed',
      capability,
    })
  })

  it('never reopens a blocked capability', () => {
    expect(decide({ BETA_ALLOWLIST_ORGS: '*' }, 'identity.register').reason).toBe(
      'capability_blocked',
    )
    expect(decide({ BETA_ALLOWLIST_ORGS: '*' }, 'gbp.reply.auto_publish').reason).toBe(
      'capability_blocked',
    )
  })

  it('loses to the per-capability kill switch', () => {
    const env = { BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: 'goal.use' }
    expect(decide(env, 'goal.use').reason).toBe('capability_disabled')
    expect(decide(env, 'portal.write').allowed).toBe(true)
  })

  it('loses to the whole-switch kill', () => {
    expect(
      decide({ BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: 'all' }, 'goal.use')
        .reason,
    ).toBe('capability_disabled')
  })

  it('loses to a suspended Organization', () => {
    expect(
      decide({ BETA_ALLOWLIST_ORGS: '*', BETA_SUSPENDED_ORGS: ORG }, 'goal.use').reason,
    ).toBe('org_suspended')
  })

  it('reads the wildcard through surrounding whitespace and beside listed IDs', () => {
    expect(decide({ BETA_ALLOWLIST_ORGS: ' * ' }, 'goal.use').allowed).toBe(true)
    expect(decide({ BETA_ALLOWLIST_ORGS: 'org-1,*' }, 'goal.use').allowed).toBe(true)
  })
})

describe('explicit BETA_ALLOWLIST_ORGS keeps refusing Organizations it does not name', () => {
  // The perf probe and the local e2e stack measure capability darkness on an
  // unlisted Organization; the wildcard must not have leaked into this mode.
  it('refuses an unlisted Organization', () => {
    expect(decide({ BETA_ALLOWLIST_ORGS: 'org-1,org-2' }, 'goal.use').reason).toBe(
      'org_not_allowlisted',
    )
  })

  it('refuses every Organization when the variable is absent', () => {
    expect(decide({}, 'property.import_gbp_v2').reason).toBe('org_not_allowlisted')
  })

  it('does not treat a wildcard inside an ID as the wildcard', () => {
    expect(decide({ BETA_ALLOWLIST_ORGS: 'org-*' }, 'goal.use').reason).toBe(
      'org_not_allowlisted',
    )
  })
})

describe('describeOrgAllowlist', () => {
  // The startup manifest records this. It carries a count, never an ID.
  it.each([
    [{}, { mode: 'none' }],
    [{ BETA_ALLOWLIST_ORGS: '' }, { mode: 'none' }],
    [{ BETA_ALLOWLIST_ORGS: ' , ' }, { mode: 'none' }],
    [{ BETA_ALLOWLIST_ORGS: '*' }, { mode: 'all' }],
    [{ BETA_ALLOWLIST_ORGS: 'org-1,*' }, { mode: 'all' }],
    [{ BETA_ALLOWLIST_ORGS: 'org-1, org-2,org-1' }, { mode: 'listed', count: 2 }],
  ] as const)('%j → %j', (env, expected) => {
    expect(describeOrgAllowlist(env)).toEqual(expected)
  })
})

describe('isOrgInAllowlist', () => {
  it('answers for one Organization in every mode', () => {
    expect(isOrgInAllowlist({ BETA_ALLOWLIST_ORGS: '*' }, ORG)).toBe(true)
    expect(isOrgInAllowlist({ BETA_ALLOWLIST_ORGS: ORG }, ORG)).toBe(true)
    expect(isOrgInAllowlist({ BETA_ALLOWLIST_ORGS: 'org-1' }, ORG)).toBe(false)
    expect(isOrgInAllowlist({}, ORG)).toBe(false)
  })
})

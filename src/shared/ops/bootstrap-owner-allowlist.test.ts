// ops:bootstrap-owner creates the first Organization of an environment, and a
// fresh Organization is exactly the one an ID allowlist does not name yet.
// Until this report, the first thing the new owner met was a refusal for every
// controlled-beta feature, with nothing pointing at the cause.

import { describe, expect, it } from 'vitest'
import { bootstrapAllowlistReport } from './bootstrap-owner-allowlist'

const NEW_ORG = '0b7f3c52-1d4e-4a8b-9c6f-2e5d8a1b3c7f'

describe('bootstrapAllowlistReport — dry run, before the Organization exists', () => {
  it('reports coverage when the environment admits every Organization', () => {
    expect(bootstrapAllowlistReport({ BETA_ALLOWLIST_ORGS: '*' })).toEqual({
      controlledBetaCapabilities: 'enabled',
      orgAllowlist: { mode: 'all' },
    })
  })

  it.each([{}, { BETA_ALLOWLIST_ORGS: 'org-1,org-2' }])(
    'warns that the new Organization will be dark under %j',
    (env) => {
      expect(bootstrapAllowlistReport(env)).toMatchObject({
        controlledBetaCapabilities: 'not_enabled',
        fix: 'set BETA_ALLOWLIST_ORGS=* (or add the new organizationId) on BOTH web and worker, then redeploy',
      })
    },
  )
})

describe('bootstrapAllowlistReport — after apply, with the new Organization', () => {
  it('reports coverage for a wildcard environment', () => {
    expect(
      bootstrapAllowlistReport({ BETA_ALLOWLIST_ORGS: '*' }, NEW_ORG)
        .controlledBetaCapabilities,
    ).toBe('enabled')
  })

  it('reports coverage when the list already names the Organization', () => {
    expect(
      bootstrapAllowlistReport({ BETA_ALLOWLIST_ORGS: `org-1,${NEW_ORG}` }, NEW_ORG),
    ).toEqual({
      controlledBetaCapabilities: 'enabled',
      orgAllowlist: { mode: 'listed', count: 2 },
    })
  })

  it('names the exact ID to add when the list does not cover it', () => {
    expect(bootstrapAllowlistReport({ BETA_ALLOWLIST_ORGS: 'org-1' }, NEW_ORG)).toEqual({
      controlledBetaCapabilities: 'not_enabled',
      orgAllowlist: { mode: 'listed', count: 1 },
      fix: `set BETA_ALLOWLIST_ORGS=* (or add ${NEW_ORG}) on BOTH web and worker, then redeploy`,
    })
  })
})

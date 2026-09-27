// What ops:bootstrap-owner tells the operator about controlled-beta access.
//
// The Organization allowlist names Organization IDs, and bootstrap-owner mints
// a new one — so in any environment whose allowlist is an explicit list, the
// Organization it just created is dark for every controlled-beta capability.
// The dry run says so before anything is created; the apply names the exact
// ID. The fix lives in the environment, not the database: both processes
// evaluate capabilities (web on requests, worker again when a job runs), so
// setting it on web alone lets a feature start and then refuses its job.

import {
  describeOrgAllowlist,
  isOrgInAllowlist,
  type CapabilityPolicyEnv,
  type OrgAllowlistMode,
} from '#/shared/auth/beta-capabilities'

export type BootstrapAllowlistReport =
  | Readonly<{ controlledBetaCapabilities: 'enabled'; orgAllowlist: OrgAllowlistMode }>
  | Readonly<{
      controlledBetaCapabilities: 'not_enabled'
      orgAllowlist: OrgAllowlistMode
      fix: string
    }>

/**
 * `organizationId` is absent on the dry run: the Organization does not exist
 * yet, so only a wildcard can already cover it.
 */
export function bootstrapAllowlistReport(
  env: Pick<CapabilityPolicyEnv, 'BETA_ALLOWLIST_ORGS'>,
  organizationId?: string,
): BootstrapAllowlistReport {
  const orgAllowlist = describeOrgAllowlist(env)
  const covered =
    organizationId === undefined
      ? orgAllowlist.mode === 'all'
      : isOrgInAllowlist(env, organizationId)
  if (covered) return { controlledBetaCapabilities: 'enabled', orgAllowlist }
  return {
    controlledBetaCapabilities: 'not_enabled',
    orgAllowlist,
    fix: `set BETA_ALLOWLIST_ORGS=* (or add ${organizationId ?? 'the new organizationId'}) on BOTH web and worker, then redeploy`,
  }
}

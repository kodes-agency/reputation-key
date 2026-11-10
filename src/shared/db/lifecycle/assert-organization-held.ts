import { parseSuspendedOrgs } from '#/shared/auth/beta-capabilities'
import { getEnv } from '#/shared/config/env'

/** Whether `BETA_SUSPENDED_ORGS` names the Organization. */
export function isOrganizationSuspended(organization: string): boolean {
  return parseSuspendedOrgs(getEnv().BETA_SUSPENDED_ORGS).has(organization)
}

export const ORGANIZATION_NOT_SUSPENDED =
  'Organization is still active; suspend it before a purge'

/** A purge may only run on an Organization that is suspended. */
export function assertOrganizationHeld(organization: string): void {
  if (!isOrganizationSuspended(organization)) throw new Error(ORGANIZATION_NOT_SUSPENDED)
}

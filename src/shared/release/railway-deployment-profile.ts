export const RAILWAY_DEPLOYMENT_PROFILES = ['production', 'rehearsal'] as const

export type RailwayDeploymentProfile = (typeof RAILWAY_DEPLOYMENT_PROFILES)[number]

export const PRODUCTION_RAILWAY_PROJECT_NAME = 'reputation-key-us-beta' as const
export const REHEARSAL_RAILWAY_PROJECT_NAME = 'reputation-key-us-beta-rehearsal' as const
/**
 * Railway's ID override path does not always populate the human-readable
 * project name in the IaC evaluation context. Release tooling therefore passes
 * the already-reviewed policy name explicitly while still pinning the CLI to
 * the opaque project ID.
 */
export const REPKEY_RAILWAY_PROJECT_NAME_ENV = 'REPKEY_RAILWAY_PROJECT_NAME' as const

export function isRailwayDeploymentProfile(
  value: string | undefined,
): value is RailwayDeploymentProfile {
  return RAILWAY_DEPLOYMENT_PROFILES.includes(value as RailwayDeploymentProfile)
}

export function requireRailwayDeploymentProfile(
  value: string | undefined,
): RailwayDeploymentProfile {
  if (!isRailwayDeploymentProfile(value)) {
    throw new Error(
      `Railway deployment profile must be one of ${RAILWAY_DEPLOYMENT_PROFILES.join(', ')} (got ${value ?? '<unset>'})`,
    )
  }
  return value
}

/**
 * Production and rehearsal deliberately cannot share a Railway project. The
 * exact opaque project ID is captured in plan evidence and checked again by
 * the deployer; this name rule prevents an obvious profile mix-up even before
 * that evidence exists.
 */
export function assertRailwayProjectNameForProfile(
  profile: RailwayDeploymentProfile,
  projectName: string,
): void {
  const expectedProjectName =
    profile === 'production'
      ? PRODUCTION_RAILWAY_PROJECT_NAME
      : REHEARSAL_RAILWAY_PROJECT_NAME
  if (projectName !== expectedProjectName) {
    throw new Error(
      `Railway project mismatch for ${profile}: expected ${expectedProjectName}, linked ${projectName}`,
    )
  }
}

import type { ReleasePosture } from './release-posture'

export const RAILWAY_DEPLOYMENT_PROFILES = ['production', 'rehearsal'] as const

export type RailwayDeploymentProfile = (typeof RAILWAY_DEPLOYMENT_PROFILES)[number]

export const PRODUCTION_RAILWAY_PROJECT_NAME = 'reputation-key-us-beta' as const
export const REHEARSAL_RAILWAY_PROJECT_NAME = 'reputation-key-us-beta-rehearsal' as const

/** Where the closed beta actually runs today. */
export const CLOSED_BETA_RAILWAY_PROJECT_NAME = 'reputation-key' as const
export const CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME = 'google-closed-beta' as const

/** The dedicated single-US cell every wider posture must use. */
export const CELL_US_RAILWAY_ENVIRONMENT_NAME = 'cell-us' as const
/**
 * Railway's ID override path does not always populate the human-readable
 * project name in the IaC evaluation context. Release tooling therefore passes
 * the already-reviewed policy name explicitly while still pinning the CLI to
 * the opaque project ID.
 */
export const REPKEY_RAILWAY_PROJECT_NAME_ENV = 'REPKEY_RAILWAY_PROJECT_NAME' as const

function isRailwayDeploymentProfile(
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

export type RailwayDeploymentTarget = Readonly<{
  projectName: string
  environmentName: string
}>

/**
 * The project and environment a deploy-time migration may run in.
 *
 * WHY THIS IS KEYED ON POSTURE. `assertRailwayProjectNameForProfile` above
 * encodes the dedicated cell the release programme is built around, and the
 * migration authority checked against it unconditionally. The closed beta does
 * not run there — it runs in `reputation-key` / `google-closed-beta` — so
 * `web` built from git successfully and then had every deploy refused, with
 * the beta permanently stuck on an older build.
 *
 * The gate was not wrong to refuse: the names genuinely did not match, and
 * `assertRailwayProjectNameForProfile` exists precisely to stop a profile
 * mix-up. Feeding it the names it wanted would have been spoofing a project
 * identity to satisfy a safety check. So the target is keyed on posture
 * instead: the closed beta is authorized where it really is, and the dedicated
 * cell becomes mandatory again the moment `CURRENT_RELEASE_POSTURE` widens,
 * with nobody needing to remember to re-arm it.
 *
 * @returns `null` when the combination has no target at all — a closed beta
 *   has exactly one environment, so there is nowhere for `rehearsal` to run.
 *   Inventing a name no environment answers to would move the failure from
 *   here, where it is legible, to a deploy that simply never succeeds.
 */
export function railwayDeploymentTargetFor(
  posture: ReleasePosture,
  profile: RailwayDeploymentProfile,
): RailwayDeploymentTarget | null {
  if (posture === 'closed-beta') {
    return profile === 'production'
      ? {
          projectName: CLOSED_BETA_RAILWAY_PROJECT_NAME,
          environmentName: CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME,
        }
      : null
  }
  return {
    projectName:
      profile === 'production'
        ? PRODUCTION_RAILWAY_PROJECT_NAME
        : REHEARSAL_RAILWAY_PROJECT_NAME,
    environmentName: CELL_US_RAILWAY_ENVIRONMENT_NAME,
  }
}

/** Refuse anything that is not the exact authorized target for this posture. */
export function assertRailwayDeploymentTarget(
  posture: ReleasePosture,
  profile: RailwayDeploymentProfile,
  actual: RailwayDeploymentTarget,
): void {
  const expected = railwayDeploymentTargetFor(posture, profile)
  if (expected === null) {
    throw new Error(
      `no ${profile} target exists at ${posture}: a closed beta has a single environment`,
    )
  }
  if (actual.projectName !== expected.projectName) {
    throw new Error(
      `Railway project mismatch for ${profile} at ${posture}: expected ${expected.projectName}, linked ${actual.projectName}`,
    )
  }
  if (actual.environmentName !== expected.environmentName) {
    throw new Error(
      `Railway environment mismatch for ${profile} at ${posture}: expected ${expected.environmentName}, linked ${actual.environmentName}`,
    )
  }
}

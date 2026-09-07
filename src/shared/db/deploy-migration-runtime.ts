import {
  assertRailwayDeploymentTarget,
  requireRailwayDeploymentProfile,
  type RailwayDeploymentProfile,
} from '#/shared/release/railway-deployment-profile'
import {
  CURRENT_RELEASE_POSTURE,
  type ReleasePosture,
} from '#/shared/release/release-posture'

type DeployMigrationEnvironment = Readonly<Record<string, string | undefined>>

export type AuthorizedDeployMigrationRuntime =
  | Readonly<{ mode: 'explicit-local' }>
  | Readonly<{
      mode: 'railway'
      deploymentProfile: RailwayDeploymentProfile
      projectId: string
      environmentId: string
      service: 'schema-migrator' | 'web'
    }>

function exactEnvironmentValue(env: DeployMigrationEnvironment, name: string): string {
  const value = env[name]
  if (!value || value !== value.trim() || value.length > 255) {
    throw new Error(`${name} must be an exact non-empty Railway value`)
  }
  return value
}

/**
 * Authorize the production migration binary before it opens DATABASE_URL.
 *
 * Railway runs must prove the platform-provided target and service identity.
 * `DEPLOY_MIGRATE=1` is the one explicit local/CI escape hatch and deliberately
 * bypasses Railway metadata so disposable database verification keeps working.
 */
export function authorizeDeployMigrationRuntime(
  env: DeployMigrationEnvironment,
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
): AuthorizedDeployMigrationRuntime {
  if (env.DEPLOY_MIGRATE === '1') {
    // Railway injects these opaque IDs into every deployment. Never let a
    // stray local escape-hatch variable disable the stronger platform checks
    // in a real Railway process.
    if (env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID) {
      throw new Error('DEPLOY_MIGRATE=1 is a local/CI bypass and is refused on Railway')
    }
    return { mode: 'explicit-local' }
  }
  if (env.NODE_ENV !== 'production') {
    throw new Error(
      'NODE_ENV must be production on Railway, or set DEPLOY_MIGRATE=1 for an explicit local/CI run',
    )
  }

  // Read opaque IDs first: their absence is the clearest indication that a
  // generic production shell is trying to impersonate a Railway deployment.
  const projectId = exactEnvironmentValue(env, 'RAILWAY_PROJECT_ID')
  const environmentId = exactEnvironmentValue(env, 'RAILWAY_ENVIRONMENT_ID')
  const projectName = exactEnvironmentValue(env, 'RAILWAY_PROJECT_NAME')
  const environmentName = exactEnvironmentValue(env, 'RAILWAY_ENVIRONMENT_NAME')
  const service = exactEnvironmentValue(env, 'RAILWAY_SERVICE_NAME')
  const deploymentProfile = requireRailwayDeploymentProfile(
    env.REPKEY_RAILWAY_DEPLOYMENT_PROFILE,
  )

  // Project AND environment are checked together, against the target the
  // DECLARED POSTURE authorizes. Previously both were pinned to the dedicated
  // cell unconditionally, which is correct for a public launch and refused
  // every deploy of the closed beta — it runs in `reputation-key` /
  // `google-closed-beta`, so `web` built fine and then never shipped.
  assertRailwayDeploymentTarget(posture, deploymentProfile, {
    projectName,
    environmentName,
  })
  if (service !== 'schema-migrator' && service !== 'web') {
    throw new Error('RAILWAY_SERVICE_NAME must be schema-migrator or web')
  }

  return {
    mode: 'railway',
    deploymentProfile,
    projectId,
    environmentId,
    service,
  }
}

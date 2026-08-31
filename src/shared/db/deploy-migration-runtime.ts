import {
  assertRailwayProjectNameForProfile,
  requireRailwayDeploymentProfile,
  type RailwayDeploymentProfile,
} from '#/shared/release/railway-deployment-profile'

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

  if (env.PROCESSING_CELL !== 'us') {
    throw new Error('PROCESSING_CELL must be us for beta deploy migrations')
  }
  if (environmentName !== 'cell-us') {
    throw new Error('RAILWAY_ENVIRONMENT_NAME must be cell-us')
  }
  assertRailwayProjectNameForProfile(deploymentProfile, projectName)
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

import { describe, expect, it } from 'vitest'
import {
  PRODUCTION_RAILWAY_PROJECT_NAME,
  REHEARSAL_RAILWAY_PROJECT_NAME,
} from '#/shared/release/railway-deployment-profile'
import { authorizeDeployMigrationRuntime } from './deploy-migration-runtime'

const railwayProduction = {
  NODE_ENV: 'production',
  PROCESSING_CELL: 'us',
  REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'production',
  RAILWAY_PROJECT_NAME: PRODUCTION_RAILWAY_PROJECT_NAME,
  RAILWAY_PROJECT_ID: 'project-opaque-id',
  RAILWAY_ENVIRONMENT_NAME: 'cell-us',
  RAILWAY_ENVIRONMENT_ID: 'environment-opaque-id',
  RAILWAY_SERVICE_NAME: 'schema-migrator',
} as const

describe('deploy migration runtime authority', () => {
  it('keeps an explicit bypass for local and CI runs', () => {
    expect(authorizeDeployMigrationRuntime({ DEPLOY_MIGRATE: '1' })).toEqual({
      mode: 'explicit-local',
    })
  })

  it('never lets the local bypass disable Railway identity checks', () => {
    expect(() =>
      authorizeDeployMigrationRuntime({
        ...railwayProduction,
        DEPLOY_MIGRATE: '1',
      }),
    ).toThrow('local/CI bypass and is refused on Railway')
  })

  it('accepts only the schema migrator or web inside the exact single-US target', () => {
    expect(authorizeDeployMigrationRuntime(railwayProduction)).toEqual({
      mode: 'railway',
      deploymentProfile: 'production',
      projectId: 'project-opaque-id',
      environmentId: 'environment-opaque-id',
      service: 'schema-migrator',
    })
    expect(
      authorizeDeployMigrationRuntime({
        ...railwayProduction,
        RAILWAY_SERVICE_NAME: 'web',
      }),
    ).toMatchObject({ mode: 'railway', service: 'web' })
  })

  it('accepts the separately permissioned rehearsal profile', () => {
    expect(
      authorizeDeployMigrationRuntime({
        ...railwayProduction,
        REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'rehearsal',
        RAILWAY_PROJECT_NAME: REHEARSAL_RAILWAY_PROJECT_NAME,
      }),
    ).toMatchObject({ mode: 'railway', deploymentProfile: 'rehearsal' })
  })

  it.each([
    [{ ...railwayProduction, PROCESSING_CELL: 'global' }, 'PROCESSING_CELL'],
    [
      { ...railwayProduction, RAILWAY_ENVIRONMENT_NAME: 'cell-global' },
      'RAILWAY_ENVIRONMENT_NAME',
    ],
    [{ ...railwayProduction, RAILWAY_SERVICE_NAME: 'worker' }, 'RAILWAY_SERVICE_NAME'],
    [{ ...railwayProduction, RAILWAY_PROJECT_ID: '' }, 'RAILWAY_PROJECT_ID'],
    [
      {
        ...railwayProduction,
        RAILWAY_PROJECT_NAME: REHEARSAL_RAILWAY_PROJECT_NAME,
      },
      'Railway project mismatch for production',
    ],
  ])('refuses a production runtime outside its exact authority', (env, error) => {
    expect(() => authorizeDeployMigrationRuntime(env)).toThrow(error)
  })

  it('refuses NODE_ENV=production as a substitute for Railway identity', () => {
    expect(() => authorizeDeployMigrationRuntime({ NODE_ENV: 'production' })).toThrow(
      'RAILWAY_PROJECT_ID',
    )
  })
})

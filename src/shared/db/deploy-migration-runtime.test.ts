import { describe, expect, it } from 'vitest'
import {
  CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME,
  CLOSED_BETA_RAILWAY_PROJECT_NAME,
  PRODUCTION_RAILWAY_PROJECT_NAME,
  REHEARSAL_RAILWAY_PROJECT_NAME,
} from '#/shared/release/railway-deployment-profile'
import { CURRENT_RELEASE_POSTURE } from '#/shared/release/release-posture'
import { authorizeDeployMigrationRuntime } from './deploy-migration-runtime'

/** The dedicated single-US cell every posture above `closed-beta` must use. */
const dedicatedCell = {
  NODE_ENV: 'production',
  PROCESSING_CELL: 'us',
  REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'production',
  RAILWAY_PROJECT_NAME: PRODUCTION_RAILWAY_PROJECT_NAME,
  RAILWAY_PROJECT_ID: 'project-opaque-id',
  RAILWAY_ENVIRONMENT_NAME: 'cell-us',
  RAILWAY_ENVIRONMENT_ID: 'environment-opaque-id',
  RAILWAY_SERVICE_NAME: 'schema-migrator',
} as const

/** Where the closed beta actually runs — read from the live project. */
const closedBeta = {
  ...dedicatedCell,
  RAILWAY_PROJECT_NAME: CLOSED_BETA_RAILWAY_PROJECT_NAME,
  RAILWAY_ENVIRONMENT_NAME: CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME,
  RAILWAY_SERVICE_NAME: 'web',
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
        ...dedicatedCell,
        DEPLOY_MIGRATE: '1',
      }),
    ).toThrow('local/CI bypass and is refused on Railway')
  })

  it('accepts only the schema migrator or web inside the exact single-US target', () => {
    expect(authorizeDeployMigrationRuntime(dedicatedCell, 'open-beta')).toEqual({
      mode: 'railway',
      deploymentProfile: 'production',
      projectId: 'project-opaque-id',
      environmentId: 'environment-opaque-id',
      service: 'schema-migrator',
    })
    expect(
      authorizeDeployMigrationRuntime(
        { ...dedicatedCell, RAILWAY_SERVICE_NAME: 'web' },
        'open-beta',
      ),
    ).toMatchObject({ mode: 'railway', service: 'web' })
  })

  it('accepts the separately permissioned rehearsal profile', () => {
    expect(
      authorizeDeployMigrationRuntime(
        {
          ...dedicatedCell,
          REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'rehearsal',
          RAILWAY_PROJECT_NAME: REHEARSAL_RAILWAY_PROJECT_NAME,
        },
        'open-beta',
      ),
    ).toMatchObject({ mode: 'railway', deploymentProfile: 'rehearsal' })
  })

  it.each([
    [{ ...dedicatedCell, PROCESSING_CELL: 'global' }, 'PROCESSING_CELL'],
    [
      { ...dedicatedCell, RAILWAY_ENVIRONMENT_NAME: 'cell-global' },
      'Railway environment mismatch',
    ],
    [{ ...dedicatedCell, RAILWAY_SERVICE_NAME: 'worker' }, 'RAILWAY_SERVICE_NAME'],
    [{ ...dedicatedCell, RAILWAY_PROJECT_ID: '' }, 'RAILWAY_PROJECT_ID'],
    [
      { ...dedicatedCell, RAILWAY_PROJECT_NAME: REHEARSAL_RAILWAY_PROJECT_NAME },
      'Railway project mismatch',
    ],
  ])('refuses a production runtime outside its exact authority', (env, error) => {
    expect(() => authorizeDeployMigrationRuntime(env, 'open-beta')).toThrow(error)
  })

  it('refuses NODE_ENV=production as a substitute for Railway identity', () => {
    expect(() => authorizeDeployMigrationRuntime({ NODE_ENV: 'production' })).toThrow(
      'RAILWAY_PROJECT_ID',
    )
  })

  describe('the closed beta, where the product actually runs', () => {
    // The regression this pins: every one of these deploys was refused, so
    // `web` built from git and never shipped, and the beta sat on an older
    // build with no way to advance it.
    it('authorizes web in reputation-key / google-closed-beta', () => {
      expect(authorizeDeployMigrationRuntime(closedBeta, 'closed-beta')).toEqual({
        mode: 'railway',
        deploymentProfile: 'production',
        projectId: 'project-opaque-id',
        environmentId: 'environment-opaque-id',
        service: 'web',
      })
    })

    it('uses the declared posture when the caller does not pass one', () => {
      // Production calls this with one argument. If the default ever stops
      // matching the declared posture, every deploy breaks — so pin it.
      expect(CURRENT_RELEASE_POSTURE).toBe('closed-beta')
      expect(authorizeDeployMigrationRuntime(closedBeta)).toMatchObject({
        mode: 'railway',
        service: 'web',
      })
    })

    it('still refuses the dedicated cell while the beta is closed', () => {
      // Not symmetric with the widening case, and deliberately so: a migration
      // aimed at the production cell from a closed-beta build is a mix-up in
      // the more dangerous direction.
      expect(() => authorizeDeployMigrationRuntime(dedicatedCell, 'closed-beta')).toThrow(
        'Railway project mismatch',
      )
    })

    it('refuses the closed-beta target once the audience widens', () => {
      for (const posture of ['open-beta', 'ga'] as const) {
        expect(() => authorizeDeployMigrationRuntime(closedBeta, posture)).toThrow(
          'Railway project mismatch',
        )
      }
    })

    it('has no rehearsal target at closed-beta', () => {
      expect(() =>
        authorizeDeployMigrationRuntime(
          { ...closedBeta, REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'rehearsal' },
          'closed-beta',
        ),
      ).toThrow('no rehearsal target exists at closed-beta')
    })

    it('still requires the deployment profile to be declared', () => {
      const { REPKEY_RAILWAY_DEPLOYMENT_PROFILE: _omitted, ...withoutProfile } =
        closedBeta
      expect(() =>
        authorizeDeployMigrationRuntime(withoutProfile, 'closed-beta'),
      ).toThrow('Railway deployment profile must be one of')
    })
  })
})

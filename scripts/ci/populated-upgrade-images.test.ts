import { describe, expect, it } from 'vitest'
import { readyProbe } from '../../src/shared/health/probes'
import { initializeReviewProviderSubjectKeyInventoryFromEnvironment } from '../../src/contexts/review/infrastructure/provider-subject-key-initializer'
import { configureReviewProviderSubjectWriterKeys } from '../../src/contexts/review/application/provider-subject-keyring'
import type { Database } from '../../src/shared/db'
import type { Pool } from 'pg'
import { parseEnvironment } from '../../src/shared/config/env'
import { createAiRuntimeProviders } from '../../src/composition/provider-runtime'
import {
  assertUpgradeReadiness,
  upgradeImageEnvironment,
} from './populated-upgrade-images'

const checks = {
  container: true,
  keys: true,
  db: true,
  redis: true,
  migrations: true,
  policy: true,
}
const response = (status: number, values = checks) =>
  JSON.stringify({ status, body: readyProbe(values) })

describe('upgrade image activation', () => {
  it('keeps fixture key placement valid for the migrator and each runtime role', async () => {
    const url = 'postgresql://test:test@localhost:5432/test_upgrade'
    const migrator = upgradeImageEnvironment(url, 'migrator')
    const db = {
      execute: async () => ({ rows: [{ present: 1 }] }),
    } as unknown as Database
    await expect(
      initializeReviewProviderSubjectKeyInventoryFromEnvironment({ db, env: migrator }),
    ).resolves.toMatchObject({ version: 'v1' })
    for (const role of ['web', 'worker'] as const) {
      const env = upgradeImageEnvironment(url, role)
      expect(env.REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS).toBeUndefined()
      expect(env.DEPLOY_MIGRATE).toBeUndefined()
      if (role === 'web') expect(env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS).toBeUndefined()
      else expect(env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS).toBeDefined()
      expect(() =>
        configureReviewProviderSubjectWriterKeys({
          writerEnabled: role === 'worker',
          production: false,
          raw: env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS,
        }),
      ).not.toThrow()
      expect(() =>
        createAiRuntimeProviders({
          env: parseEnvironment(env),
          runtimeEnvironment: env,
          enableJobs: role === 'worker',
          pool: {} as Pool,
          clock: () => new Date('2026-11-06T00:00:00Z'),
        }),
      ).not.toThrow()
      expect(new URL(env.DATABASE_URL!).hostname).toBe('upgrade-postgres')
      expect(env.REDIS_URL).toBe('redis://upgrade-redis:6379')
      expect(env.QUEUE_REDIS_URL).toBe('redis://upgrade-redis:6379')
    }
  })

  it('requires every dependency for a compatible image', () => {
    expect(() => assertUpgradeReadiness(response(200), true)).not.toThrow()
    for (const key of Object.keys(checks)) {
      expect(() =>
        assertUpgradeReadiness(response(200, { ...checks, [key]: false }), true),
      ).toThrow('readiness')
    }
  })

  it('accepts only a migration refusal after a contraction', () => {
    expect(() =>
      assertUpgradeReadiness(response(503, { ...checks, migrations: false }), false),
    ).not.toThrow()
    expect(() => assertUpgradeReadiness(response(200), false)).toThrow('readiness')
    expect(() =>
      assertUpgradeReadiness(
        response(503, { ...checks, migrations: false, db: false }),
        false,
      ),
    ).toThrow('readiness')
    expect(() => assertUpgradeReadiness(response(503), false)).toThrow('readiness')
  })
})

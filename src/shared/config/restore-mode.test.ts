// Tests for the isolated restore mode (BQC-7.8).
//
// The restore drill boots the WEB process + operator commands against a
// restored database with RESTORE_MODE=isolated: every capability evaluation
// denies fail-closed (beta-capabilities seam), the worker refuses to boot,
// and the ops restore commands refuse any non-isolated target.

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  assertRestoreCommandEnvironment,
  assertRestoreModeCompatible,
  isIsolatedRestoreTarget,
  isRestoreIsolated,
  RESTORE_ISOLATED_LOG_LINE,
  restoreSideServicesRefusal,
} from './restore-mode'

describe('isRestoreIsolated (BQC-7.8)', () => {
  it('is true only for the exact accepted value', () => {
    expect(isRestoreIsolated({ RESTORE_MODE: 'isolated' })).toBe(true)
  })

  it('is false when absent or any other value', () => {
    expect(isRestoreIsolated({})).toBe(false)
    expect(isRestoreIsolated({ RESTORE_MODE: undefined })).toBe(false)
    expect(isRestoreIsolated({ RESTORE_MODE: '' })).toBe(false)
    expect(isRestoreIsolated({ RESTORE_MODE: 'ISOLATED' })).toBe(false)
    expect(isRestoreIsolated({ RESTORE_MODE: 'production' })).toBe(false)
  })
})

describe('assertRestoreModeCompatible (BQC-7.8)', () => {
  it('is a no-op for both processes when restore mode is not active', () => {
    expect(() => assertRestoreModeCompatible({}, 'web')).not.toThrow()
    expect(() => assertRestoreModeCompatible({}, 'worker')).not.toThrow()
  })

  it('lets the WEB process boot in restore-isolated mode (the drill shape)', () => {
    expect(() =>
      assertRestoreModeCompatible(
        {
          RESTORE_MODE: 'isolated',
          DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
          RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
        },
        'web',
      ),
    ).not.toThrow()
  })

  it('refuses WORKER boot in restore-isolated mode with the loud line', () => {
    expect(() =>
      assertRestoreModeCompatible(
        {
          RESTORE_MODE: 'isolated',
          DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
          RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
        },
        'worker',
      ),
    ).toThrow(/RESTORE MODE ISOLATED/)
    expect(() =>
      assertRestoreModeCompatible(
        {
          RESTORE_MODE: 'isolated',
          DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
          RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
        },
        'worker',
      ),
    ).toThrow(/worker refuses to boot/)
  })

  it('never throws the refusal outside restore-isolated mode', () => {
    expect(() =>
      assertRestoreModeCompatible(
        {
          RESTORE_MODE: 'isolated',
          DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
          RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
        },
        'web',
      ),
    ).not.toThrow()
    expect(RESTORE_ISOLATED_LOG_LINE).toContain('RESTORE MODE ISOLATED')
  })

  it('refuses web boot against an unattested database target', () => {
    expect(() =>
      assertRestoreModeCompatible(
        {
          RESTORE_MODE: 'isolated',
          DATABASE_URL: 'postgresql://u:p@postgres.railway.internal:5432/railway',
        },
        'web',
      ),
    ).toThrow(/not an attested/)
  })

  it('keeps the web verifier bootable with the Redis and bucket settings it needs', () => {
    // The production web boot demands REDIS_URL and QUEUE_REDIS_URL, so only
    // the restore commands are held to a database-only posture.
    const env = {
      RESTORE_MODE: 'isolated',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
      REDIS_URL: 'redis://cache.railway.internal:6379',
      QUEUE_REDIS_URL: 'redis://queues.railway.internal:6379',
      AWS_S3_BUCKET_NAME: 'beta-bucket',
    }
    expect(() => assertRestoreModeCompatible(env, 'web')).not.toThrow()
  })
})

describe('isIsolatedRestoreTarget (BQC-7.8)', () => {
  it('accepts exact loopback targets only when bound to a PITR sibling name', () => {
    const pitr = {
      RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
    }
    expect(isIsolatedRestoreTarget('postgresql://u:p@localhost:5432/db')).toBe(false)
    expect(isIsolatedRestoreTarget('postgresql://u:p@localhost:5432/db', pitr)).toBe(true)
    expect(isIsolatedRestoreTarget('postgresql://u:p@127.0.0.1:5432/db', pitr)).toBe(true)
    expect(isIsolatedRestoreTarget('postgresql://u:p@[::1]:5432/db', pitr)).toBe(true)
    expect(
      isIsolatedRestoreTarget('postgresql://u:p@localhost:5432/db', {
        RESTORE_DATABASE_SERVICE_NAME: 'Postgres',
      }),
    ).toBe(false)
  })

  it('accepts the exact private hostname of an attested Railway PITR sibling', () => {
    expect(
      isIsolatedRestoreTarget(
        'postgresql://u:p@postgres-restored-20260825-1015.railway.internal:5432/railway',
        {
          RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
          RAILWAY_PROJECT_ID: 'project-id',
          RAILWAY_ENVIRONMENT_ID: 'environment-id',
          RAILWAY_ENVIRONMENT_NAME: 'closed-beta-v2',
        },
      ),
    ).toBe(true)
  })

  it('refuses a PITR sibling in a different Railway environment', () => {
    expect(
      isIsolatedRestoreTarget(
        'postgresql://u:p@postgres-restored-20260825-1015.railway.internal:5432/railway',
        {
          RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
          RAILWAY_PROJECT_ID: 'project-id',
          RAILWAY_ENVIRONMENT_ID: 'environment-id',
          RAILWAY_ENVIRONMENT_NAME: 'cell-europe',
        },
      ),
    ).toBe(false)
  })

  it.each([
    ['closed-beta-v2', true],
    ['cell-us', false],
    ['production', false],
    ['', false],
    [undefined, false],
  ])(
    'binds an in-platform target to the beta environment alone: %s',
    (name, admitted) => {
      expect(
        isIsolatedRestoreTarget(
          'postgresql://u:p@postgres-restored-20260825-1015.railway.internal:5432/railway',
          {
            RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
            RAILWAY_PROJECT_ID: 'project-id',
            RAILWAY_ENVIRONMENT_ID: 'environment-id',
            RAILWAY_ENVIRONMENT_NAME: name,
          },
        ),
      ).toBe(admitted)
    },
  )

  it('refuses source, public, mismatched, and partially attested Railway targets', () => {
    const railway = {
      RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
      RAILWAY_PROJECT_ID: 'project-id',
      RAILWAY_ENVIRONMENT_ID: 'environment-id',
      RAILWAY_ENVIRONMENT_NAME: 'closed-beta-v2',
    }
    expect(
      isIsolatedRestoreTarget(
        'postgresql://u:p@postgres.railway.internal:5432/railway',
        railway,
      ),
    ).toBe(false)
    expect(
      isIsolatedRestoreTarget(
        'postgresql://u:p@roundhouse.proxy.rlwy.net:12345/railway',
        railway,
      ),
    ).toBe(false)
    expect(
      isIsolatedRestoreTarget(
        'postgresql://u:p@postgres-restored-20260825-1016.railway.internal:5432/railway',
        railway,
      ),
    ).toBe(false)
    expect(
      isIsolatedRestoreTarget(
        'postgresql://u:p@postgres-restored-20260825-1015.railway.internal:5432/railway',
        { ...railway, RAILWAY_ENVIRONMENT_NAME: 'cell-europe' },
      ),
    ).toBe(false)
    expect(
      isIsolatedRestoreTarget(
        'postgresql://u:p@postgres-restored-20260825-1015.railway.internal:5432/railway',
        { ...railway, RAILWAY_PROJECT_ID: undefined },
      ),
    ).toBe(false)
    expect(
      isIsolatedRestoreTarget(
        'postgresql://u:p@postgres-restored-copy.railway.internal:5432/railway',
        {
          ...railway,
          RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-copy',
        },
      ),
    ).toBe(false)
  })

  it('refuses remote/shared targets and localhost look-alikes', () => {
    expect(isIsolatedRestoreTarget('postgresql://u:p@db.prod.example.com:5432/db')).toBe(
      false,
    )
    expect(isIsolatedRestoreTarget('postgresql://u:p@localhost.evil.com:5432/db')).toBe(
      false,
    )
    expect(isIsolatedRestoreTarget('postgresql://u:p@localhost1:5432/db')).toBe(false)
  })

  it('refuses malformed URLs (fail closed)', () => {
    expect(isIsolatedRestoreTarget('not-a-url')).toBe(false)
    expect(isIsolatedRestoreTarget('')).toBe(false)
    expect(isIsolatedRestoreTarget('https://localhost/db')).toBe(false)
  })
})

const RESTORE_COMMAND_ENV = {
  RESTORE_MODE: 'isolated',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/restored',
  RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
}

// Planted faults: each setting carries the shape a live environment gives it.
// A restore command started from that environment must refuse before it opens
// anything, whichever of them is present, and never print the value.
const PLANTED_FAULTS = {
  'production Redis': {
    REDIS_URL: 'redis://default:live-secret@redis.railway.internal:6379',
    PROVIDER_EPHEMERAL_REDIS_URL:
      'rediss://default:live-secret@provider-redis.railway.internal:6380',
  },
  'production queue namespace': {
    QUEUE_REDIS_URL: 'redis://default:live-secret@queue-redis.railway.internal:6379',
  },
  'production bucket endpoint': {
    S3_INTERNAL_ENDPOINT: 'https://live-bucket.storageapi.dev',
    S3_PRESIGN_ENDPOINT: 'https://live-bucket-public.storageapi.dev',
    AWS_S3_BUCKET_NAME: 'live-bucket-name',
    AWS_S3_ACCESS_KEY: 'live-access-key-id',
    AWS_S3_SECRET_ACCESS_KEY: 'live-secret-access-key',
  },
} as const

describe('assertRestoreCommandEnvironment', () => {
  it('admits a database-only isolated restore, on a tunnel and inside the beta', () => {
    expect(() => assertRestoreCommandEnvironment(RESTORE_COMMAND_ENV)).not.toThrow()
    expect(() =>
      assertRestoreCommandEnvironment({
        RESTORE_MODE: 'isolated',
        DATABASE_URL:
          'postgresql://u:p@postgres-restored-20260825-1015.railway.internal:5432/railway',
        RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
        RAILWAY_PROJECT_ID: 'project-id',
        RAILWAY_ENVIRONMENT_ID: 'environment-id',
        RAILWAY_ENVIRONMENT_NAME: 'closed-beta-v2',
      }),
    ).not.toThrow()
  })

  it('refuses a process that is not an isolated restore', () => {
    expect(() =>
      assertRestoreCommandEnvironment({
        ...RESTORE_COMMAND_ENV,
        RESTORE_MODE: undefined,
      }),
    ).toThrow(/RESTORE_MODE=isolated is required/)
  })

  it('refuses the live database and a public proxy', () => {
    for (const DATABASE_URL of [
      'postgresql://u:p@postgres.railway.internal:5432/railway',
      'postgresql://u:p@roundhouse.proxy.rlwy.net:12345/railway',
    ]) {
      expect(() =>
        assertRestoreCommandEnvironment({ ...RESTORE_COMMAND_ENV, DATABASE_URL }),
      ).toThrow(/not an attested/)
    }
  })

  describe.each(Object.entries(PLANTED_FAULTS))('%s', (_label, planted) => {
    it.each(Object.entries(planted))(
      'refuses %s and names it, not its value',
      (name, value) => {
        const env: Record<string, string> = { ...RESTORE_COMMAND_ENV, [name]: value }
        const check = () => assertRestoreCommandEnvironment(env)

        expect(check).toThrow(name)
        expect(check).not.toThrow(value)
        expect(restoreSideServicesRefusal(env)).toContain(name)
      },
    )
  })

  it('refuses a local side service as well: the verifier uses none', () => {
    expect(() =>
      assertRestoreCommandEnvironment({
        ...RESTORE_COMMAND_ENV,
        QUEUE_REDIS_URL: 'redis://127.0.0.1:6379',
      }),
    ).toThrow(/QUEUE_REDIS_URL/)
  })

  it('names every setting that is present', () => {
    expect(
      restoreSideServicesRefusal({
        REDIS_URL: 'redis://a',
        QUEUE_REDIS_URL: 'redis://b',
        AWS_S3_BUCKET_NAME: 'c',
      }),
    ).toMatch(/REDIS_URL, QUEUE_REDIS_URL, AWS_S3_BUCKET_NAME/)
    expect(restoreSideServicesRefusal({})).toBeNull()
  })
})

describe('the side-service list stays complete', () => {
  // Inert on their own: the CA for the provider Redis's TLS, the bucket's
  // region, and a flag the schema always resolves to a boolean.
  const INERT = new Set([
    'PROVIDER_EPHEMERAL_REDIS_CA_PEM',
    'AWS_S3_REGION',
    'S3_FORCE_PATH_STYLE',
  ])

  // A Redis or bucket setting added to the environment schema must be refused
  // by the restore commands too, or be named inert above after a look at what
  // it can reach.
  it('refuses every Redis or bucket setting the environment schema defines', () => {
    const schema = readFileSync('src/shared/config/env.ts', 'utf8')
    const keys = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gmu)].map(
      (match) => match[1] ?? '',
    )
    const unrefused = keys.filter((key) => {
      const planted: Record<string, string> = { [key]: 'planted' }
      return (
        /REDIS|BUCKET|S3_/u.test(key) &&
        !INERT.has(key) &&
        restoreSideServicesRefusal(planted) === null
      )
    })

    expect(keys.length).toBeGreaterThan(50)
    expect(unrefused).toEqual([])
  })
})

// Tests for the isolated restore mode (BQC-7.8).
//
// The restore drill boots the WEB process + operator commands against a
// restored database with RESTORE_MODE=isolated: every capability evaluation
// denies fail-closed (beta-capabilities seam), the worker refuses to boot,
// and the ops restore commands refuse any non-isolated target.

import { describe, it, expect } from 'vitest'
import {
  assertRestoreModeCompatible,
  isIsolatedRestoreTarget,
  isRestoreIsolated,
  RESTORE_ISOLATED_LOG_LINE,
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
          RAILWAY_ENVIRONMENT_NAME: 'cell-us',
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

  it('refuses source, public, mismatched, and partially attested Railway targets', () => {
    const railway = {
      RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
      RAILWAY_PROJECT_ID: 'project-id',
      RAILWAY_ENVIRONMENT_ID: 'environment-id',
      RAILWAY_ENVIRONMENT_NAME: 'cell-us',
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

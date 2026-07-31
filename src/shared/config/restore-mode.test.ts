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
      assertRestoreModeCompatible({ RESTORE_MODE: 'isolated' }, 'web'),
    ).not.toThrow()
  })

  it('refuses WORKER boot in restore-isolated mode with the loud line', () => {
    expect(() =>
      assertRestoreModeCompatible({ RESTORE_MODE: 'isolated' }, 'worker'),
    ).toThrow(/RESTORE MODE ISOLATED/)
    expect(() =>
      assertRestoreModeCompatible({ RESTORE_MODE: 'isolated' }, 'worker'),
    ).toThrow(/worker refuses to boot/)
  })

  it('never throws the refusal outside restore-isolated mode', () => {
    expect(() =>
      assertRestoreModeCompatible({ RESTORE_MODE: 'isolated' }, 'web'),
    ).not.toThrow()
    expect(RESTORE_ISOLATED_LOG_LINE).toContain('RESTORE MODE ISOLATED')
  })
})

describe('isIsolatedRestoreTarget (BQC-7.8)', () => {
  it('accepts loopback targets only', () => {
    expect(isIsolatedRestoreTarget('postgresql://u:p@localhost:5432/db')).toBe(true)
    expect(isIsolatedRestoreTarget('postgresql://u:p@127.0.0.1:5432/db')).toBe(true)
    expect(isIsolatedRestoreTarget('postgresql://u:p@[::1]:5432/db')).toBe(true)
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
  })
})

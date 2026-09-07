import { describe, expect, it, vi } from 'vitest'
import type { RecoveryFenceInput } from './recovery-fence'
import { validateRecoveryFenceInput } from './recovery-fence'

const VALID_INPUT: RecoveryFenceInput = {
  runId: '10000000-0000-4000-8000-000000000001',
  generation: 1,
  sourceReleaseSha: 'a'.repeat(40),
  sourceManifestSha256: 'b'.repeat(64),
  restorePointAt: new Date('2026-08-24T12:00:00.000Z'),
  operatorId: 'operator@example.com',
  correlationId: 'restore-correlation-1',
}

describe('recovery fence input', () => {
  it('accepts a complete, content-free recovery evidence binding', () => {
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'))
    expect(() => validateRecoveryFenceInput(VALID_INPUT)).not.toThrow()
    vi.useRealTimers()
  })

  it.each([
    [{ runId: 'not-a-uuid' }, /run ID/],
    [{ generation: 0 }, /generation/],
    [{ sourceReleaseSha: 'A'.repeat(40) }, /release SHA/],
    [{ sourceManifestSha256: 'b'.repeat(63) }, /manifest SHA-256/],
    [{ restorePointAt: new Date('not-an-instant') }, /valid instant/],
    [{ operatorId: ' ' }, /identities are required/],
    [{ correlationId: '' }, /identities are required/],
  ] as const)('rejects invalid evidence metadata %#', (override, expected) => {
    expect(() => validateRecoveryFenceInput({ ...VALID_INPUT, ...override })).toThrow(
      expected,
    )
  })

  it('rejects a restore point materially in the future', () => {
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'))
    expect(() =>
      validateRecoveryFenceInput({
        ...VALID_INPUT,
        restorePointAt: new Date('2026-08-25T00:01:01.000Z'),
      }),
    ).toThrow(/cannot be in the future/)
    vi.useRealTimers()
  })
})

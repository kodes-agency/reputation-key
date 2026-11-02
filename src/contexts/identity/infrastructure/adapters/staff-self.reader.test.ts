import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createStaffSelfReader } from './staff-self.reader'

describe('personal Portal navigation hint', () => {
  it.each([true, false])(
    'returns only the database existence answer %s',
    async (present) => {
      const execute = vi.fn().mockResolvedValue({ rows: [{ present }] })
      const db = { execute } as unknown as Database
      const reader = createStaffSelfReader(db, () => new Date('2026-11-03T12:00:00Z'))
      expect(await reader.hasPersonalPortal('org', 'manager')).toBe(present)
      expect(execute).toHaveBeenCalledTimes(1)
    },
  )
  it('fails closed when no existence row is returned', async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Database
    expect(
      await createStaffSelfReader(db, () => new Date()).hasPersonalPortal(
        'org',
        'manager',
      ),
    ).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { propertyId } from '#/shared/domain/ids'
import { createPropertyLocalDateResolver } from './repositories/property-local-date'

function databaseReturning(rows: readonly unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(async () => rows)
  return {
    db: { select: vi.fn(() => chain) } as unknown as Database,
    chain,
  }
}

describe('createPropertyLocalDateResolver', () => {
  it('resolves the calendar date in the persisted property timezone across UTC day rollover', async () => {
    const { db, chain } = databaseReturning([{ timezone: 'America/Los_Angeles' }])
    const resolveLocalDate = createPropertyLocalDateResolver(db)

    await expect(
      resolveLocalDate(
        propertyId('00000000-0000-4000-8000-000000000001'),
        new Date('2026-03-08T07:30:00.000Z'),
      ),
    ).resolves.toBe('2026-03-07')
    expect(chain.where).toHaveBeenCalledOnce()
    expect(chain.limit).toHaveBeenCalledWith(1)
  })

  it.each([{ rows: [] }, { rows: [{ timezone: null }] }])(
    'fails closed when the property timezone is unavailable',
    async ({ rows }) => {
      const { db } = databaseReturning(rows)
      const resolveLocalDate = createPropertyLocalDateResolver(db)

      await expect(
        resolveLocalDate(
          propertyId('00000000-0000-4000-8000-000000000001'),
          new Date('2026-08-01T12:00:00.000Z'),
        ),
      ).rejects.toThrow(
        'Property timezone unavailable: 00000000-0000-4000-8000-000000000001',
      )
    },
  )
})

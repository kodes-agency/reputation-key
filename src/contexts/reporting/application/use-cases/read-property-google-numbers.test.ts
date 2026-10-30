import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createReadPropertyGoogleNumbers } from './read-property-google-numbers'

const organization = organizationId('google-header-org')
const property = propertyId('a0000000-0000-4000-8000-000000000001')
const actor = buildTestAuthContext({
  organizationId: organization,
  role: 'PropertyManager',
})
const input = { organizationId: organization, propertyId: property }
const now = new Date('2026-10-30T12:00:00Z')

describe('readPropertyGoogleNumbers', () => {
  it('reads without a goal and preserves stale numbers and their real date', async () => {
    const numbers = {
      shows: 4.3,
      reviewCount: 128,
      asOf: '2026-10-20T12:00:00.000Z',
      current: false,
    }
    const readGoogleNumbers = vi.fn(async () => numbers)
    const read = createReadPropertyGoogleNumbers({
      propertyAccess: async () => [property],
      readGoogleNumbers,
      clock: () => now,
    })
    expect(await read(input, actor)).toEqual(numbers)
    expect(readGoogleNumbers).toHaveBeenCalledExactlyOnceWith(organization, property, now)
  })
  it.each(['foreign', 'unassigned'] as const)(
    'refuses %s access before reading numbers',
    async (refusal) => {
      const readGoogleNumbers = vi.fn(async () => null)
      const read = createReadPropertyGoogleNumbers({
        propertyAccess: async () => [],
        readGoogleNumbers,
        clock: () => now,
      })
      const reader =
        refusal === 'foreign'
          ? buildTestAuthContext({
              organizationId: organizationId('other'),
              role: 'AccountAdmin',
            })
          : actor
      await expect(read(input, reader)).rejects.toMatchObject({
        _tag: 'DashboardError',
        code: 'forbidden',
      })
      expect(readGoogleNumbers).not.toHaveBeenCalled()
    },
  )
  it('preserves a missing snapshot as unavailable and propagates a side-read failure', async () => {
    const read = createReadPropertyGoogleNumbers({
      propertyAccess: async () => [property],
      readGoogleNumbers: async () => null,
      clock: () => now,
    })
    expect(await read(input, actor)).toBeNull()
    const failed = createReadPropertyGoogleNumbers({
      propertyAccess: async () => [property],
      readGoogleNumbers: async () => {
        throw new Error('snapshot failed')
      },
      clock: () => now,
    })
    await expect(failed(input, actor)).rejects.toThrow('snapshot failed')
  })
})

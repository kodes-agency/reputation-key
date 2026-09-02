import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { createCapabilityRefusalReaders } from './google-content-authority.repository'

function databaseReturning(rows: ReadonlyArray<unknown>): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  } as unknown as Database
}

describe('createCapabilityRefusalReaders', () => {
  it('preserves the absence of an execution-control row as null', async () => {
    const readers = createCapabilityRefusalReaders(databaseReturning([]))

    await expect(
      readers.loadExecutionControl('property.import_gbp_v2'),
    ).resolves.toBeNull()
  })

  it('maps an execution-control row to the content-free diagnostic shape', async () => {
    const readers = createCapabilityRefusalReaders(
      databaseReturning([
        {
          denied: true,
          deniedAt: new Date('2026-09-02T08:15:30.000Z'),
          emergencyKillVersion: 17,
        },
      ]),
    )

    await expect(readers.loadExecutionControl('property.import_gbp_v2')).resolves.toEqual(
      {
        denied: true,
        deniedAt: '2026-09-02T08:15:30.000Z',
        emergencyKillVersion: '17',
      },
    )
  })
})

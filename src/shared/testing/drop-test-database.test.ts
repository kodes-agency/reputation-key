import { describe, expect, it, vi } from 'vitest'
import { dropTestDatabase } from './drop-test-database'

function maintenance(sessionCounts: readonly number[]) {
  const counts = [...sessionCounts]
  const query = vi.fn(async (text: string) =>
    text.startsWith('SELECT count')
      ? { rows: [{ sessions: counts.shift() ?? 0 }] }
      : { rows: [] },
  )
  return { query } as unknown as Parameters<typeof dropTestDatabase>[0] & {
    query: typeof query
  }
}

describe('dropTestDatabase', () => {
  it('drops without waiting when no session remains', async () => {
    const pool = maintenance([0])

    await dropTestDatabase(pool, 'scratch')

    expect(pool.query.mock.calls.map(([text]) => text)).toEqual([
      expect.stringContaining('SELECT count'),
      'DROP DATABASE IF EXISTS "scratch" WITH (FORCE)',
    ])
  })

  it('waits for exiting sessions before it drops the database', async () => {
    const pool = maintenance([2, 1, 0])

    await dropTestDatabase(pool, 'scratch')

    const statements = pool.query.mock.calls.map(([text]) => text)
    expect(statements.slice(0, 3).every((text) => text.startsWith('SELECT count'))).toBe(
      true,
    )
    expect(statements.at(-1)).toBe('DROP DATABASE IF EXISTS "scratch" WITH (FORCE)')
  })

  it('quotes the database name', async () => {
    const pool = maintenance([0])

    await dropTestDatabase(pool, 'odd"name')

    expect(pool.query).toHaveBeenLastCalledWith(
      'DROP DATABASE IF EXISTS "odd""name" WITH (FORCE)',
    )
  })
})

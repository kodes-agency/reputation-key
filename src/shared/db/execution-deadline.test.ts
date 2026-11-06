import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from './index'
import { withExecutionDeadline } from './execution-deadline.server'

const query = vi.hoisted(() =>
  vi.fn<(query: { text: string }, params: unknown[]) => Promise<{ rows: unknown[] }>>(),
)

vi.mock('./pool', () => ({ getPool: () => ({ query }) }))

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-06T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const statements = () => query.mock.calls.map(([statement]) => statement.text)

describe('job transaction deadlines through the shared database', () => {
  it('bounds statements to the remaining deadline inside the transaction', async () => {
    const controller = new AbortController()
    const deadline = { signal: controller.signal, expiresAt: Date.now() + 100 }

    const result = await withExecutionDeadline(deadline, async () => {
      vi.setSystemTime(Date.now() + 20)
      return getDb().transaction(
        async (tx) => {
          await tx.execute(sql`select 1`)
          return 'done'
        },
        { isolationLevel: 'serializable' },
      )
    })

    expect(result).toBe('done')
    expect(statements()).toEqual([
      'begin isolation level serializable',
      "select set_config('statement_timeout', $1, true)",
      'select 1',
      'commit',
    ])
    expect(query.mock.calls[1]?.[1]).toEqual(['80'])
  })

  it('rolls back an aborted transaction even when its callback returns normally', async () => {
    const controller = new AbortController()
    const failure = new Error('deadline exceeded')

    await expect(
      withExecutionDeadline(
        { signal: controller.signal, expiresAt: Date.now() + 100 },
        () =>
          getDb().transaction(async (tx) => {
            await tx.execute(sql`select 1`)
            controller.abort(failure)
            return 'must not commit'
          }),
      ),
    ).rejects.toBe(failure)

    expect(statements().at(-1)).toBe('rollback')
    expect(statements()).not.toContain('commit')
  })

  it('refuses new transactions after abort without submitting SQL', async () => {
    const controller = new AbortController()
    controller.abort(new Error('deadline exceeded'))
    const work = vi.fn(async () => {})

    await expect(
      withExecutionDeadline(
        { signal: controller.signal, expiresAt: Date.now() + 100 },
        async () => getDb().transaction(work),
      ),
    ).rejects.toThrow('deadline exceeded')
    expect(work).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('keeps concurrent jobs and ordinary transactions in their own scopes', async () => {
    const held = Promise.withResolvers<void>()
    const controller = new AbortController()
    const aborted = withExecutionDeadline(
      { signal: controller.signal, expiresAt: Date.now() + 100 },
      () =>
        getDb().transaction(async () => {
          await held.promise
        }),
    )
    const outcome = aborted.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)

    const second = new AbortController()
    await withExecutionDeadline(
      { signal: second.signal, expiresAt: Date.now() + 500 },
      () => getDb().transaction(async () => 'other job'),
    )
    const bounds = query.mock.calls.filter(([q]) => q.text.includes('set_config'))
    expect(bounds.map(([, params]) => params)).toEqual([['100'], ['500']])

    controller.abort(new Error('first job aborted'))
    held.resolve()
    expect(await outcome).toEqual(new Error('first job aborted'))
    query.mockClear()
    await getDb().transaction(async (tx) => tx.execute(sql`select 2`))
    expect(statements()).toEqual(['begin', 'select 2', 'commit'])
  })
})

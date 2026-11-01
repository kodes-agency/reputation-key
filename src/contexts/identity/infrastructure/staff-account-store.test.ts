import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import type { Database } from '#/shared/db'
import { createStaffAccountStore } from './staff-account-store'
import { createStaffInvitationBudget } from '../build-staff-accounts'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

function setup(unlockFails = false) {
  const release = vi.fn()
  const query = vi.fn(async (statement: string, _values?: readonly string[]) => {
    if (unlockFails && statement.includes('pg_advisory_unlock'))
      throw new Error('Connection lost')
    return { rows: [{ pg_advisory_unlock: true }] }
  })
  const client = { query, release } as unknown as PoolClient
  const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, 'connect'>
  const store = createStaffAccountStore({} as Database, () => new Date(), pool)
  return { store, query, release }
}

describe('staff address reservation cleanup', () => {
  it('uses the invitation address key and releases after a successful operation', async () => {
    const h = setup()
    expect(
      await h.store.withAddressLock('org', 'polly@example.com', async () => 'done'),
    ).toBe('done')
    expect(h.query.mock.calls[0]).toEqual([
      'SELECT pg_advisory_lock(hashtextextended($1, 0))',
      ['beta-invitation-email:polly@example.com'],
    ])
    expect(h.release.mock.calls).toEqual([[]])
  })
  it('unlocks and releases when the operation fails', async () => {
    const h = setup()
    await expect(
      h.store.withAddressLock('org', 'polly@example.com', async () => {
        throw new Error('Step failed')
      }),
    ).rejects.toThrow('Step failed')
    expect(h.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock')
    expect(h.release.mock.calls).toEqual([[]])
  })
  it('destroys a connection whose advisory unlock cannot be confirmed', async () => {
    const h = setup(true)
    await expect(
      h.store.withAddressLock('org', 'polly@example.com', async () => undefined),
    ).rejects.toThrow('Connection lost')
    expect(h.release.mock.calls).toEqual([[true]])
  })
})

describe('staff invitation budget binding', () => {
  it('reads without spending and reports a refused spend as an actionable staff error', async () => {
    const ctx = buildTestAuthContext()
    const check = vi.fn(async () => ({
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      backendStatus: 'available' as const,
    }))
    const remaining = vi.fn(async () => 7)
    const budget = createStaffInvitationBudget({ check, remaining }, 'test-secret')
    expect(await budget.remaining(ctx)).toBe(7)
    expect(check).not.toHaveBeenCalled()
    await expect(budget.spend(ctx)).rejects.toMatchObject({ code: 'rate_limited' })
  })
})

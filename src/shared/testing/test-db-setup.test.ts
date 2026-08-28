import type { PoolClient, QueryResult } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  isConcurrentDatabaseCreationError,
  withTestDatabaseProvisioningLock,
} from './test-db-setup'

function lockClient(events: string[], released = true): Pick<PoolClient, 'query'> {
  return {
    async query(text: string): Promise<QueryResult> {
      if (text.includes('pg_advisory_lock')) events.push('lock')
      if (text.includes('pg_advisory_unlock')) events.push('unlock')
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: text.includes('pg_advisory_unlock') ? [{ released }] : [{}],
      }
    },
  } as Pick<PoolClient, 'query'>
}

describe('test database provisioning serialization', () => {
  it('holds one session-level lock around the complete provisioning operation', async () => {
    const events: string[] = []

    await expect(
      withTestDatabaseProvisioningLock(lockClient(events), async () => {
        events.push('provision')
        return 'complete'
      }),
    ).resolves.toBe('complete')

    expect(events).toEqual(['lock', 'provision', 'unlock'])
  })

  it('releases the lock without replacing a provisioning failure', async () => {
    const events: string[] = []
    const failure = new Error('migration failed')

    await expect(
      withTestDatabaseProvisioningLock(lockClient(events), async () => {
        events.push('provision')
        throw failure
      }),
    ).rejects.toBe(failure)

    expect(events).toEqual(['lock', 'provision', 'unlock'])
  })

  it('fails closed when PostgreSQL reports that the lock was not held', async () => {
    const events: string[] = []

    await expect(
      withTestDatabaseProvisioningLock(lockClient(events, false), async () => {
        events.push('provision')
      }),
    ).rejects.toThrow('Test database provisioning advisory lock was not held')

    expect(events).toEqual(['lock', 'provision', 'unlock'])
  })

  it('recognizes only the PostgreSQL errors produced by a concurrent CREATE DATABASE', () => {
    expect(isConcurrentDatabaseCreationError({ code: '42P04' })).toBe(true)
    expect(
      isConcurrentDatabaseCreationError({
        code: '23505',
        constraint: 'pg_database_datname_index',
      }),
    ).toBe(true)
    expect(
      isConcurrentDatabaseCreationError({
        code: '23505',
        constraint: 'unrelated_unique_key',
      }),
    ).toBe(false)
    expect(isConcurrentDatabaseCreationError(new Error('duplicate database'))).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { BACKUP_ERASURE_LEDGER_CONTEXTS } from '#/shared/db/schema/backup-erasure-ledger.schema'
import { composeRightsExecutors } from './rights-executors'

const deps = { db: {} as Database, runNotification: vi.fn() }

describe('composeRightsExecutors', () => {
  it('composes the five context executors in order', () => {
    expect(composeRightsExecutors(deps, false).map(({ name }) => name)).toEqual([
      'google-integration',
      'review',
      'inbox',
      'reporting',
      'identity-grants',
      'staff',
      'property',
      'notification',
    ])
  })

  it('runs the notification executor alone for a final warning', () => {
    expect(composeRightsExecutors(deps, true).map(({ name }) => name)).toEqual([
      'notification',
    ])
  })

  it('journals every executor under known lifecycle contexts', () => {
    for (const executor of composeRightsExecutors(deps, false)) {
      expect(executor.journalContexts.length).toBeGreaterThan(0)
      for (const context of executor.journalContexts) {
        expect(BACKUP_ERASURE_LEDGER_CONTEXTS).toContain(context)
      }
    }
  })

  it('covers the organization scope with the executors that erase it', () => {
    const covering = composeRightsExecutors(deps, false)
      .filter(({ scopes }) => scopes.includes('organization'))
      .map(({ name }) => name)
    expect(covering).toEqual([
      'google-integration',
      'review',
      'inbox',
      'reporting',
      'staff',
      'notification',
    ])
  })

  it('covers the property scope with the Google, grant and Property executors', () => {
    const covering = composeRightsExecutors(deps, false)
      .filter(({ scopes }) => scopes.includes('property'))
      .map(({ name }) => name)
    expect(covering).toEqual([
      'google-integration',
      'identity-grants',
      'property',
      'notification',
    ])
  })
})

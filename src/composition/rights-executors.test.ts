import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { BACKUP_ERASURE_LEDGER_CONTEXTS } from '#/shared/db/schema/backup-erasure-ledger.schema'
import { composeRightsExecutors, composeRightsReplayers } from './rights-executors'

import { createNotificationRightsReplayers } from '#/contexts/feed/rights/replayer.server'

const NOTIFICATION_REPLAYERS = createNotificationRightsReplayers()
const deps = { db: {} as Database, runNotification: vi.fn() }

describe('composeRightsExecutors', () => {
  it('composes the context executors in order', () => {
    expect(composeRightsExecutors(deps, false).map(({ name }) => name)).toEqual([
      'google-integration',
      'review',
      'inbox',
      'guest',
      'reporting',
      'ai',
      'activity',
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
      'guest',
      'reporting',
      'ai',
      'activity',
      'staff',
      'notification',
    ])
  })

  it('covers the property scope with every Property erasure executor', () => {
    const covering = composeRightsExecutors(deps, false)
      .filter(({ scopes }) => scopes.includes('property'))
      .map(({ name }) => name)
    expect(covering).toEqual([
      'google-integration',
      'review',
      'inbox',
      'guest',
      'reporting',
      'ai',
      'activity',
      'identity-grants',
      'property',
      'notification',
    ])
  })

  it('registers a replayer for every journaled context and erasing scope', () => {
    const registered = composeRightsReplayers({
      ...deps,
      notificationReplayers: NOTIFICATION_REPLAYERS,
    }).map(({ context, subjectClass }) => `${context}:${subjectClass}`)
    const needed = composeRightsExecutors(deps, false).flatMap((executor) =>
      executor.scopes
        .filter((scope) => scope === 'organization' || scope === 'property')
        .flatMap((scope) =>
          executor.journalContexts.map((context) => `${context}:${scope}`),
        ),
    )
    expect(needed.length).toBeGreaterThan(0)
    for (const key of needed) expect(registered).toContain(key)
    expect(new Set(registered).size).toBe(registered.length)
  })
})

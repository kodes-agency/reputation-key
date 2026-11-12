import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { BACKUP_ERASURE_LEDGER_CONTEXTS } from '#/shared/db/schema/backup-erasure-ledger.schema'
import { createNotificationRightsReplayers } from '#/contexts/feed/rights/replayer.server'
import {
  createRightsJournal,
  rightsJournalEntry,
} from '#/shared/ops/rights/rights-journal'
import { RIGHTS_REQUEST_SCOPES } from '#/shared/ops/rights/rights-request-command'
import { composeRightsExecutors, composeRightsReplayers } from './rights-executors'

const NOTIFICATION_REPLAYERS = createNotificationRightsReplayers()
const deps = {
  db: {} as Database,
  journal: createRightsJournal(undefined),
  runNotification: vi.fn(),
  portalObjectStore: { deleteObject: vi.fn() },
}

describe('composeRightsExecutors', () => {
  it('composes every context executor in order', () => {
    expect(composeRightsExecutors(deps, false).map(({ name }) => name)).toEqual([
      'google-integration',
      'review',
      'inbox',
      'guest',
      'reporting',
      'staff',
      'portal',
      'ai',
      'activity',
      'identity-grants',
      'property',
      'notification',
      'staff-participant',
    ])
  })

  it('runs the notification executor alone for a final warning', () => {
    expect(composeRightsExecutors(deps, true).map(({ name }) => name)).toEqual([
      'notification',
    ])
  })

  it('journals every executor under known lifecycle contexts', () => {
    // The participant executor journals each batch with the ids it names.
    for (const executor of composeRightsExecutors(deps, false)) {
      if (executor.name === 'staff-participant') continue
      expect(executor.journalContexts.length).toBeGreaterThan(0)
      for (const context of executor.journalContexts) {
        expect(BACKUP_ERASURE_LEDGER_CONTEXTS).toContain(context)
      }
    }
  })

  it('journals each context once per scope, so every entry has one place in the apply order', () => {
    const executors = composeRightsExecutors(deps, false)
    for (const scope of RIGHTS_REQUEST_SCOPES) {
      const contexts = executors
        .filter(({ scopes }) => scopes.includes(scope))
        .flatMap(({ journalContexts }) => journalContexts)
      expect(new Set(contexts).size, scope).toBe(contexts.length)
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
      'staff',
      'portal',
      'ai',
      'activity',
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
      'portal',
      'ai',
      'activity',
      'identity-grants',
      'property',
      'notification',
    ])
  })

  it('refuses to silently omit Portal when the image store is missing', () => {
    const { portalObjectStore: _store, ...withoutStore } = deps
    expect(() =>
      // @ts-expect-error A caller without Portal's required effect must fail closed.
      composeRightsExecutors(withoutStore, false),
    ).toThrow('Portal image store is required')
  })

  it('registers a replayer for every journaled context and erasing scope', () => {
    const replayers = composeRightsReplayers({
      ...deps,
      notificationReplayers: NOTIFICATION_REPLAYERS,
    })
    const registered = replayers.map(
      ({ context, subjectClass }) => `${context}:${subjectClass}`,
    )
    const needed = composeRightsExecutors(deps, false).flatMap((executor) =>
      executor.scopes
        .filter((scope) => scope === 'organization' || scope === 'property')
        .flatMap((scope) =>
          executor.journalContexts.map((context) => `${context}:${scope}`),
        ),
    )
    expect(needed.length).toBeGreaterThan(0)
    for (const key of needed) expect(registered).toContain(key)
    const keys = replayers.map(
      ({ context, subjectClass, targetKind }) =>
        `${context}:${subjectClass}:${targetKind ?? 'scope'}`,
    )
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('journal keys the rights command can write', () => {
  it('has a registered replayer for every guest response and feedback key', () => {
    const registered = composeRightsReplayers({
      ...deps,
      notificationReplayers: NOTIFICATION_REPLAYERS,
    }).map(
      ({ context, subjectClass, targetKind }) =>
        `${context}:${subjectClass}:${targetKind ?? 'scope'}`,
    )
    const guestResponse = rightsJournalEntry(
      {
        scope: 'guest-response',
        mode: 'apply',
        organizationId: 'org',
        propertyId: 'property',
        responseId: 'response',
        batchSize: 1,
        receivedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      'guest',
    )
    if ('error' in guestResponse) throw new Error(guestResponse.error)
    const written = [
      guestResponse,
      { ...guestResponse, journalTargets: { kind: 'guest_feedback', ids: ['response'] } },
    ] as const
    for (const entry of written) {
      expect(registered).toContain(
        `${entry.context}:${entry.subjectClass}:${entry.journalTargets?.kind}`,
      )
    }
  })
})

describe('participant scope', () => {
  it('is covered by the participant executor alone', () => {
    const covering = composeRightsExecutors(deps, false)
      .filter(({ scopes }) => scopes.includes('participant'))
      .map(({ name }) => name)
    expect(covering).toEqual(['staff-participant'])
  })

  it('registers a replayer so a restore cannot bring a participant back', () => {
    const registered = composeRightsReplayers({
      ...deps,
      notificationReplayers: NOTIFICATION_REPLAYERS,
    }).map(({ context, targetKind }) => `${context}:${targetKind}`)
    expect(registered).toContain('staff:staff_participant')
  })
})

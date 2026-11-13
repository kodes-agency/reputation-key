import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { ERASURE_JOURNAL_CONTEXTS } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { createNotificationRightsReplayers } from '#/contexts/feed/rights/replayer.server'
import {
  createRightsJournal,
  rightsJournalEntry,
} from '#/shared/ops/rights/rights-journal'
import {
  RIGHTS_REQUEST_SCOPES,
  type RightsRequestPlan,
} from '#/shared/ops/rights/rights-request-command'
import { AUDIT_PSEUDONYM_SECRET_MISSING } from '#/contexts/feed/audit/pseudonymise.server'
import {
  composeRightsExecutors,
  composeRightsReplayers,
  rightsReplayRefusal,
} from './rights-executors'

const NOTIFICATION_REPLAYERS = createNotificationRightsReplayers()
const rightsPlanFor = (scope: 'property' | 'organization'): RightsRequestPlan => ({
  scope,
  mode: 'apply',
  organizationId: 'org',
  batchSize: 1,
  receivedAt: new Date('2026-08-01T00:00:00.000Z'),
})
const deps = {
  db: {} as Database,
  journal: createRightsJournal(undefined),
  runNotification: vi.fn(),
  portalObjectStore: { deleteObject: vi.fn() },
  auditPseudonymSecret: 'audit-pseudonym-test-secret',
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
      'identity',
      'property',
      'notification',
      'staff-participant',
      'work-items',
    ])
  })

  it('refuses a Property or Organization erasure at preflight without the audit pseudonym secret', async () => {
    const activity = composeRightsExecutors(
      { ...deps, auditPseudonymSecret: undefined },
      false,
    ).find(({ name }) => name === 'activity')!

    for (const plan of [
      {
        ...rightsPlanFor('property'),
        propertyId: '30000000-0000-4000-8000-000000000002',
      },
      rightsPlanFor('organization'),
    ]) {
      expect(await activity.preflight!(plan)).toEqual({
        ok: false,
        error: AUDIT_PSEUDONYM_SECRET_MISSING,
      })
    }
  })

  it('refuses to replay an Activity entry without the audit pseudonym secret, and nothing else', () => {
    const missing = { auditPseudonymSecret: undefined }

    expect(
      rightsReplayRefusal([{ context: 'guest' }, { context: 'activity' }], missing),
    ).toBe(AUDIT_PSEUDONYM_SECRET_MISSING)
    expect(
      rightsReplayRefusal([{ context: 'guest' }, { context: 'platform' }], missing),
    ).toBeNull()
    expect(
      rightsReplayRefusal([{ context: 'activity' }], {
        auditPseudonymSecret: 'audit-pseudonym-test-secret',
      }),
    ).toBeNull()
  })

  it('runs the notification executor alone for a final warning', () => {
    expect(composeRightsExecutors(deps, true).map(({ name }) => name)).toEqual([
      'notification',
    ])
  })

  it('journals every executor under known journal contexts', () => {
    // The participant executor journals each batch with the ids it names.
    for (const executor of composeRightsExecutors(deps, false)) {
      if (executor.name === 'staff-participant') continue
      expect(executor.journalContexts.length).toBeGreaterThan(0)
      for (const context of executor.journalContexts) {
        expect(ERASURE_JOURNAL_CONTEXTS).toContain(context)
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
      'identity',
      'property',
      'notification',
      'work-items',
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
      'staff',
      'portal',
      'ai',
      'activity',
      'identity',
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
      {
        ...guestResponse,
        journalTargets: { kind: 'guest_contact_request', ids: ['request'] },
      },
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

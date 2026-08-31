// Unit proof for Notification's lifecycle decision layer (LIF-01 T12/T13/T14).
//
// The database-bound properties (authority binding, advisory lock, atomic
// receipt) are proved in the sibling `.integration.test.ts`. What is proved
// here is the part that must hold before any row is touched: every evidence
// reference is content-free and deterministic, `no_data` is produced only for a
// genuinely empty context, and a blocked readiness raises instead of reporting
// success.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateContentFreeEvidenceRef } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import {
  assertNotificationPurgeReady,
  createNotificationOrganizationLifecycleContributor,
  notificationClosingEvidenceRef,
  notificationClosingOutcome,
  notificationPurgeEvidenceRef,
  notificationPurgeOutcome,
  notificationReadinessEvidenceRef,
  notificationReadinessOutcome,
  NOTIFICATION_CLOSING_FENCE_REASON,
} from './notification-organization-lifecycle.adapter'
import type { Database } from '#/shared/db'

/** The exact grammar `context_organization_lifecycle_receipts` enforces. */
const CONTENT_FREE = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const purgeCounts = {
  notifications: 41,
  emails: 12,
  digestBatches: 2,
  digestBatchMembers: 30,
  preferences: 6,
  userSettings: 3,
  quarantined: 1,
}

const emptyPurgeCounts = {
  notifications: 0,
  emails: 0,
  digestBatches: 0,
  digestBatchMembers: 0,
  preferences: 0,
  userSettings: 0,
  quarantined: 0,
}

describe('Notification Organization lifecycle contributor', () => {
  it('binds itself to the notification context', () => {
    const contributor = createNotificationOrganizationLifecycleContributor({} as Database)
    expect(contributor.context).toBe('notification')
    expect(contributor.prepareClosing).toBeTypeOf('function')
    expect(contributor.verifyPurgeReadiness).toBeTypeOf('function')
    expect(contributor.purge).toBeTypeOf('function')
  })

  it('uses one stable, content-free closure fence reason', () => {
    // The reason is what a reactivation would target and what an operator
    // greps for, so it must stay a code — and it must fit the 64-character
    // `terminal_reason` column as well as the 255-character suppression column.
    expect(NOTIFICATION_CLOSING_FENCE_REASON).toBe('organization_closing')
    expect(NOTIFICATION_CLOSING_FENCE_REASON.length).toBeLessThanOrEqual(64)
  })

  it('stays composition input: no server function, route or public API reaches it', () => {
    // Purge must remain unreachable by default. The contributor is a named
    // seam that only an explicitly reviewed composition may bind.
    const reachable = sourceFiles(join(process.cwd(), 'src/contexts/notification'))
      .filter((path) => !path.endsWith('build.ts') && !path.includes('/adapters/'))
      .filter((path) => readFileSync(path, 'utf8').includes('organizationLifecycle'))
      .map((path) => path.replace(`${process.cwd()}/`, ''))
    expect(reachable).toEqual([])

    const routes = sourceFiles(join(process.cwd(), 'src/routes')).filter((path) =>
      readFileSync(path, 'utf8').includes('organizationLifecycleContributor'),
    )
    expect(routes).toEqual([])

    // Returned beside publicApi, never inside it.
    const build = readFileSync(
      join(process.cwd(), 'src/contexts/notification/build.ts'),
      'utf8',
    )
    expect(build).toContain(
      'organizationLifecycleContributor: createNotificationOrganizationLifecycleContributor(',
    )
  })
})

describe('Notification lifecycle evidence references', () => {
  it('keeps every phase reference content-free and inside the receipt column', () => {
    // Deliberately absurd counts: an evidence reference must stay valid at the
    // top of the range, not just for a small fixture.
    const refs = [
      notificationClosingEvidenceRef({
        cancelledEmails: 9_007_199_254,
        closedDigestBatches: 9_007_199_254,
      }),
      notificationReadinessEvidenceRef({
        sendableEmails: 0,
        openDigestBatches: 0,
        retainedRows: 9_007_199_254,
      }),
      notificationPurgeEvidenceRef({
        notifications: 9_007_199_254,
        emails: 9_007_199_254,
        digestBatches: 9_007_199_254,
        digestBatchMembers: 9_007_199_254,
        preferences: 9_007_199_254,
        userSettings: 9_007_199_254,
        quarantined: 9_007_199_254,
      }),
    ]
    for (const ref of refs) {
      expect(ref).toMatch(CONTENT_FREE)
      expect(ref.length).toBeLessThanOrEqual(200)
      // The shared store validates the same reference before it is written, so
      // the value the phase returns must already satisfy it.
      expect(validateContentFreeEvidenceRef(ref)).toBe(ref)
    }
  })

  it('names only its own context, phase and counts', () => {
    expect(
      notificationClosingEvidenceRef({ cancelledEmails: 12, closedDigestBatches: 2 }),
    ).toBe('notification:closing:mail-12:batch-2')
    expect(notificationPurgeEvidenceRef(purgeCounts)).toBe(
      'notification:purge:notif-41:mail-12:batch-2:member-30:pref-6:setting-3:quarantine-1',
    )
  })

  it('is deterministic — the same counts always produce the same reference', () => {
    expect(notificationPurgeEvidenceRef(purgeCounts)).toBe(
      notificationPurgeEvidenceRef({ ...purgeCounts }),
    )
    expect(
      notificationClosingEvidenceRef({ cancelledEmails: 1, closedDigestBatches: 0 }),
    ).toBe(notificationClosingEvidenceRef({ cancelledEmails: 1, closedDigestBatches: 0 }))
  })
})

describe('Notification lifecycle phase outcomes', () => {
  it('reports no_data as affirmative evidence when there was nothing to fence', () => {
    expect(
      notificationClosingOutcome({ cancelledEmails: 0, closedDigestBatches: 0 }),
    ).toEqual({
      outcome: 'no_data',
      evidenceRef: 'notification:closing:mail-0:batch-0',
    })
  })

  it('reports complete when either blocker class was actually fenced', () => {
    expect(
      notificationClosingOutcome({ cancelledEmails: 1, closedDigestBatches: 0 }).outcome,
    ).toBe('complete')
    expect(
      notificationClosingOutcome({ cancelledEmails: 0, closedDigestBatches: 1 }).outcome,
    ).toBe('complete')
  })

  it('classifies readiness by retained rows, never by the blocker counts', () => {
    expect(
      notificationReadinessOutcome({
        sendableEmails: 0,
        openDigestBatches: 0,
        retainedRows: 0,
      }).outcome,
    ).toBe('no_data')
    expect(
      notificationReadinessOutcome({
        sendableEmails: 0,
        openDigestBatches: 0,
        retainedRows: 7,
      }).outcome,
    ).toBe('complete')
  })

  it('reports a purge of an empty context as no_data, and any scrub as complete', () => {
    expect(notificationPurgeOutcome(emptyPurgeCounts).outcome).toBe('no_data')
    for (const key of Object.keys(emptyPurgeCounts) as (keyof typeof purgeCounts)[]) {
      expect(notificationPurgeOutcome({ ...emptyPurgeCounts, [key]: 1 }).outcome).toBe(
        'complete',
      )
    }
  })
})

describe('Notification purge readiness gate', () => {
  it('passes only when nothing can still leave the system', () => {
    expect(() =>
      assertNotificationPurgeReady({
        sendableEmails: 0,
        openDigestBatches: 0,
        retainedRows: 900,
      }),
    ).not.toThrow()
  })

  it('fails closed on a still-sendable queued email', () => {
    expect(() =>
      assertNotificationPurgeReady({
        sendableEmails: 3,
        openDigestBatches: 0,
        retainedRows: 900,
      }),
    ).toThrow(/sendable_email_queue_rows=3/u)
  })

  it('fails closed on an open provider digest batch', () => {
    expect(() =>
      assertNotificationPurgeReady({
        sendableEmails: 0,
        openDigestBatches: 1,
        retainedRows: 900,
      }),
    ).toThrow(/open_digest_batches=1/u)
  })

  it('raises a content-free blocker message', () => {
    try {
      assertNotificationPurgeReady({
        sendableEmails: 2,
        openDigestBatches: 1,
        retainedRows: 5,
      })
      expect.unreachable('blocked readiness must raise')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toBe(
        'Notification purge readiness blocked: sendable_email_queue_rows=2,open_digest_batches=1',
      )
      // No recipient, subject, body, provider id or organization identifier.
      expect(message).toMatch(/^[A-Za-z0-9 :,_=-]+$/u)
    }
  })
})

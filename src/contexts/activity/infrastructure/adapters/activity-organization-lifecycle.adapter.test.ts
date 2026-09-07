// Unit proof for Activity's lifecycle decision layer (LIF-01 T12/T13/T14).
//
// The database-bound properties (authority binding, advisory lock, atomic
// receipt, append-only Operational Action History) are proved in the sibling
// `.integration.test.ts`. What is proved here is the part that must hold before
// any row is touched: every evidence reference is content-free and
// deterministic, `no_data` is produced only for a genuinely empty context, and
// an active legal hold raises instead of reporting success.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateContentFreeEvidenceRef } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import {
  activityClosingEvidenceRef,
  activityClosingOutcome,
  activityPurgeEvidenceRef,
  activityPurgeOutcome,
  activityReadinessEvidenceRef,
  activityReadinessOutcome,
  assertNoActiveOperationalHistoryLegalHold,
  createActivityOrganizationLifecycleContributor,
} from './activity-organization-lifecycle.adapter'
import type { Database } from '#/shared/db'

/** The content-free evidence grammar stored in lifecycle event payloads. */
const CONTENT_FREE = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const counts = { entries: 41, replayFacts: 44, actorLabelRedactions: 2 }
const empty = { entries: 0, replayFacts: 0, actorLabelRedactions: 0 }
const huge = {
  entries: 9_007_199_254,
  replayFacts: 9_007_199_254,
  actorLabelRedactions: 9_007_199_254,
}

describe('Activity Organization lifecycle contributor', () => {
  it('binds itself to the activity context', () => {
    const contributor = createActivityOrganizationLifecycleContributor({} as Database)
    expect(contributor.context).toBe('activity')
    expect(contributor.prepareClosing).toBeTypeOf('function')
    expect(contributor.verifyPurgeReadiness).toBeTypeOf('function')
    expect(contributor.purge).toBeTypeOf('function')
  })

  it('stays composition input: no server function, route or public API reaches it', () => {
    // Purge must remain unreachable by default. The contributor is a named
    // seam that only an explicitly reviewed composition may bind.
    const reachable = sourceFiles(join(process.cwd(), 'src/contexts/activity'))
      .filter((path) => !path.endsWith('build.ts') && !path.includes('/adapters/'))
      .filter((path) => readFileSync(path, 'utf8').includes('organizationLifecycle'))
      .map((path) => path.replace(`${process.cwd()}/`, ''))
    expect(reachable).toEqual([])

    const routes = sourceFiles(join(process.cwd(), 'src/routes')).filter((path) =>
      readFileSync(path, 'utf8').includes('organizationLifecycleContributor'),
    )
    expect(routes).toEqual([])

    // Returned beside publicApi, never inside it.
    expect(
      readFileSync(join(process.cwd(), 'src/contexts/activity/build.ts'), 'utf8'),
    ).toContain(
      'organizationLifecycleContributor: createActivityOrganizationLifecycleContributor(',
    )
  })
})

describe('Activity lifecycle evidence references', () => {
  it('keeps every phase reference content-free and inside the receipt column', () => {
    for (const ref of [
      activityClosingEvidenceRef(huge),
      activityReadinessEvidenceRef(huge),
      activityPurgeEvidenceRef(huge),
    ]) {
      expect(ref).toMatch(CONTENT_FREE)
      expect(ref.length).toBeLessThanOrEqual(200)
      expect(validateContentFreeEvidenceRef(ref)).toBe(ref)
    }
  })

  it('names only its own context, phase and counts', () => {
    expect(activityClosingEvidenceRef(counts)).toBe(
      'activity:closing:frozen:entry-41:replay-44',
    )
    expect(activityReadinessEvidenceRef(counts)).toBe('activity:purge_readiness:row-87')
    expect(activityPurgeEvidenceRef(counts)).toBe(
      'activity:purge:entry-41:replay-44:redaction-2',
    )
  })

  it('is deterministic — the same counts always produce the same reference', () => {
    expect(activityPurgeEvidenceRef(counts)).toBe(activityPurgeEvidenceRef({ ...counts }))
    expect(activityClosingEvidenceRef(empty)).toBe(
      activityClosingEvidenceRef({ ...empty }),
    )
  })
})

describe('Activity lifecycle phase outcomes', () => {
  it('reports no_data as affirmative evidence for an Organization with no activity', () => {
    expect(activityClosingOutcome(empty)).toEqual({
      outcome: 'no_data',
      evidenceRef: 'activity:closing:frozen:entry-0:replay-0',
    })
    expect(activityReadinessOutcome(empty).outcome).toBe('no_data')
    expect(activityPurgeOutcome(empty).outcome).toBe('no_data')
  })

  it('reports complete when any Recent Activity row exists or was scrubbed', () => {
    for (const key of Object.keys(empty) as (keyof typeof empty)[]) {
      const one = { ...empty, [key]: 1 }
      expect(activityClosingOutcome(one).outcome).toBe('complete')
      expect(activityReadinessOutcome(one).outcome).toBe('complete')
      expect(activityPurgeOutcome(one).outcome).toBe('complete')
    }
  })
})

describe('Activity Operational Action History legal-hold gate', () => {
  it('passes when no hold is outstanding', () => {
    expect(() =>
      assertNoActiveOperationalHistoryLegalHold(0, 'purge_readiness'),
    ).not.toThrow()
    expect(() => assertNoActiveOperationalHistoryLegalHold(0, 'purge')).not.toThrow()
  })

  it('fails closed at readiness so a hold stops the irreversible boundary', () => {
    expect(() => assertNoActiveOperationalHistoryLegalHold(1, 'purge_readiness')).toThrow(
      'Activity purge_readiness blocked: active_operational_history_legal_holds=1',
    )
  })

  it('fails closed again inside purge, because a hold can arrive between phases', () => {
    expect(() => assertNoActiveOperationalHistoryLegalHold(2, 'purge')).toThrow(
      'Activity purge blocked: active_operational_history_legal_holds=2',
    )
  })

  it('raises a content-free blocker message', () => {
    try {
      assertNoActiveOperationalHistoryLegalHold(3, 'purge')
      expect.unreachable('an active legal hold must raise')
    } catch (error) {
      // No matter, reason text, actor or organization identifier.
      expect((error as Error).message).toMatch(/^[A-Za-z0-9 :,_=-]+$/u)
    }
  })
})

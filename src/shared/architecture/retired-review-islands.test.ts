import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const RETIRED_REVIEW_ISLANDS = [
  'src/contexts/review/domain/bounded-sync-policy.ts',
  'src/contexts/review/domain/bounded-sync-policy.test.ts',
  'src/contexts/review/domain/constructors.ts',
  'src/contexts/review/domain/constructors.test.ts',
  'src/contexts/review/domain/inbox-correctness.ts',
  'src/contexts/review/domain/inbox-correctness.test.ts',
] as const

function source(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

describe('retired Review islands stay contracted', () => {
  it('keeps the test-only duplicate implementations absent', () => {
    expect(RETIRED_REVIEW_ISLANDS.filter((path) => existsSync(resolve(path)))).toEqual([])
  })

  it('pins the active owners that replaced their unique obligations', () => {
    const snapshot = source(
      'src/contexts/review/application/use-cases/run-review-provider-snapshot.ts',
    )
    const sync = source('src/contexts/review/application/use-cases/sync-reviews.ts')
    const replies = source(
      'src/contexts/review/application/use-cases/reply-operations.ts',
    )
    const inboxCursor = source('src/contexts/inbox/application/inbox-cursor.ts')
    const inboxCommandStore = source(
      'src/contexts/inbox/infrastructure/inbox-command-store.ts',
    )

    expect(snapshot).toContain('REVIEW_PROVIDER_SNAPSHOT_MAX_PAGES')
    expect(snapshot).toContain('provider_rate_limited')
    expect(sync).toContain('defaultReviewLifecycle')
    expect(sync).toContain('computeReviewContentHash')
    expect(replies).toContain("reviewError('invalid_reply'")
    expect(inboxCursor).toContain('decodeInboxCursor')
    expect(inboxCommandStore).toContain("inboxError('revision_conflict'")
  })
})

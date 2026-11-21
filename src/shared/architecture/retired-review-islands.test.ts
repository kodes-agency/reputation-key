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
      'src/contexts/reputation/sync/run-review-provider-snapshot.server.ts',
    )
    const sync = source('src/contexts/reputation/sync/sync-reviews.server.ts')
    const replyOperations = source(
      'src/contexts/reputation/replies/reply-operations.server.ts',
    )
    const replyContentPolicy = source(
      'src/contexts/reputation/replies/reply-content-policy.server.ts',
    )
    const inboxCursor = source('src/contexts/reputation/inbox/inbox-cursor.server.ts')
    const inboxCommandStore = source(
      'src/contexts/reputation/inbox/assignment-commands.server.ts',
    )

    expect(snapshot).toContain('REVIEW_PROVIDER_SNAPSHOT_MAX_PAGES')
    expect(snapshot).toContain('provider_rate_limited')
    expect(sync).toContain('defaultReviewLifecycle')
    expect(sync).toContain('computeReviewContentHash')
    expect(replyOperations).toContain("from './reply-content-policy.server'")
    expect(replyContentPolicy).toContain("reviewError('invalid_reply'")
    expect(inboxCursor).toContain('decodeInboxCursor')
    expect(inboxCommandStore).toContain("inboxError('revision_conflict'")
  })
})

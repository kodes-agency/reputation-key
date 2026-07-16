// BQR-2.3: sync path must use the atomic command store for review events.
// Static-source checks — no dual emitAndRecord for review.created/updated.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

describe('BQR-2.3: atomic review outbox producer', () => {
  it('sync-reviews uses commandStore.upsertAndRecord for review events', () => {
    const src = readFileSync(
      join(ROOT, 'src/contexts/review/application/use-cases/sync-reviews.ts'),
      'utf-8',
    )
    expect(src).toContain('commandStore')
    expect(src).toContain('upsertAndRecord')
    // Reply mirror may still use emitAndRecord; review create/update must not
    // call emitAndRecord with reviewCreated/reviewUpdated.
    const withoutReplySection = src.split('mirrorReply')[0] ?? src
    expect(withoutReplySection).not.toMatch(/emitAndRecord\([^)]*reviewCreated/)
    expect(withoutReplySection).not.toMatch(/emitAndRecord\([^)]*reviewUpdated/)
  })

  it('build wires createAtomicReviewCommandStore into syncReviews', () => {
    const src = readFileSync(join(ROOT, 'src/contexts/review/build.ts'), 'utf-8')
    expect(src).toContain('createAtomicReviewCommandStore')
    expect(src).toContain('commandStore')
  })

  it('atomic store commits outbox inside db.transaction', () => {
    const src = readFileSync(
      join(ROOT, 'src/contexts/review/infrastructure/review-command-store.ts'),
      'utf-8',
    )
    expect(src).toContain('db.transaction')
    expect(src).toContain('outboxEvents')
    expect(src).toContain('toOutboxEvent')
    // Post-commit bus emit is best-effort via emitAfterCommit
    expect(src).toContain('emitAfterCommit')
    const txIdx = src.indexOf('db.transaction')
    // Call site after the transaction closes (not the helper definition)
    const afterCommitCall = src.indexOf('await emitAfterCommit(events, event)')
    expect(txIdx).toBeGreaterThan(-1)
    expect(afterCommitCall).toBeGreaterThan(txIdx)
  })
})

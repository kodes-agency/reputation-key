// BQR-2.3: sync path must use the atomic command store for review events.
// Static-source checks — no dual emitAndRecord for review.created/updated.
// BQC-3.3: emitAndRecord is forbidden across the WHOLE review context — every
// review/reply/expired fact now commits atomically via the command stores.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

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

describe('BQC-3.3: atomic reply/review command family', () => {
  it('no review-context source file uses emitAndRecord (all facts via command stores)', () => {
    const files = walk(join(ROOT, 'src/contexts/review')).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )
    expect(files.length).toBeGreaterThan(10)
    const offenders = files.filter((f) =>
      readFileSync(f, 'utf-8').includes('emitAndRecord'),
    )
    expect(
      offenders,
      `emitAndRecord is forbidden in the review context (BQC-3.3) — use the atomic command stores:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('build wires createAtomicReplyCommandStore into the reply use cases and sync mirror', () => {
    const src = readFileSync(join(ROOT, 'src/contexts/review/build.ts'), 'utf-8')
    expect(src).toContain('createAtomicReplyCommandStore')
    expect(src).toContain('replyCommandStore')
  })

  it('reply command store commits outbox inside db.transaction', () => {
    const src = readFileSync(
      join(ROOT, 'src/contexts/review/infrastructure/reply-command-store.ts'),
      'utf-8',
    )
    expect(src).toContain('db.transaction')
    expect(src).toContain('outboxEvents')
    expect(src).toContain('toOutboxEvent')
    expect(src).toContain('emitAfterCommit')
  })
})

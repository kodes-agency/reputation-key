// BQC-3.4: every inbox fact must commit atomically via the command store.
// Static-source checks — emitAndRecord is forbidden across the WHOLE inbox
// context: the 7 fact-emitting use cases, the durable consumers, and the
// expand-phase bus handlers (bus emit only) all go through the command store
// or plain events.emit.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()

describe('BQC-3.4: atomic inbox outbox producer', () => {
  it('no inbox-context source file uses emitAndRecord (all facts via the command store)', () => {
    const files = walk(join(ROOT, 'src/contexts/inbox')).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )
    expect(files.length).toBeGreaterThan(10)
    const offenders = files.filter((f) =>
      readFileSync(f, 'utf-8').includes('emitAndRecord'),
    )
    expect(
      offenders,
      `emitAndRecord is forbidden in the inbox context (BQC-3.4) — use the atomic command store:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('build wires createAtomicInboxCommandStore into the inbox use cases', () => {
    const src = readFileSync(join(ROOT, 'src/contexts/inbox/build.ts'), 'utf-8')
    expect(src).toContain('createAtomicInboxCommandStore')
    expect(src).toContain('commandStore')
  })

  it('inbox command store commits outbox inside db.transaction', () => {
    const src = readFileSync(
      join(ROOT, 'src/contexts/inbox/infrastructure/inbox-command-store.ts'),
      'utf-8',
    )
    expect(src).toContain('db.transaction')
    // BQC-5.9 E1: the outbox insert (outboxEvents + toOutboxEvent) and the
    // post-commit emit are single-sourced in src/shared/outbox/commit.ts.
    expect(src).toContain('#/shared/outbox/commit')
    expect(src).toContain('insertOutboxRow')
    // Post-commit bus emit is best-effort via emitAfterCommit
    expect(src).toContain('emitAfterCommit')
    const txIdx = src.indexOf('db.transaction')
    // Call site after the transaction closes (not the helper definition)
    const afterCommitCall = src.indexOf('await emitAfterCommit(events, event)')
    expect(txIdx).toBeGreaterThan(-1)
    expect(afterCommitCall).toBeGreaterThan(txIdx)
  })

  it('projection applyOnce co-commits the consumer receipt inside the transaction', () => {
    const src = readFileSync(
      join(ROOT, 'src/contexts/inbox/infrastructure/inbox-command-store.ts'),
      'utf-8',
    )
    expect(src).toContain('eventConsumerReceipts')
    expect(src).toContain('onConflictDoNothing')
    expect(src).toContain('applyReviewCreatedOnce')
    expect(src).toContain('applyReviewExpiredOnce')
    expect(src).toContain('applyReviewUpdatedOnce')
    expect(src).toContain('applyReplyPublishedOnce')
  })
})

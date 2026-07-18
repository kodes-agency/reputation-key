// BQC-3.4: every inbox fact must commit atomically via the command store.
// Static-source checks — emitAndRecord is forbidden across the WHOLE inbox
// context: the 7 fact-emitting use cases, the durable consumers, and the
// expand-phase bus handlers (bus emit only) all go through the command store
// or plain events.emit.

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

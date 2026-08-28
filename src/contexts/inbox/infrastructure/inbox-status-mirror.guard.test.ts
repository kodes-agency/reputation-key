// `inbox_items.status` is a READ-ONLY-RETAINED compatibility mirror.
//
// Every serving read already resolves workflow status from
// `inbox_handling_cycle_heads` (`repositories/inbox.repository.ts` builds
// `effectiveInboxStatus` from the head and joins it into every active read).
// The column itself cannot be dropped yet: physical contraction is blocked
// until one verified release plus a restore proof, and other contexts still
// read the mirror directly.
//
// So the column stays and the WRITERS get cut. What remains is a small,
// explicitly named set of head-fenced writers that update the mirror inside the
// same transaction that moves the Handling Cycle head. This guard is what keeps
// that set small: a new unfenced writer — a repair script, a milestone stamp, a
// well-meaning `updateStatus` call from a use case — fails here rather than
// silently desynchronising the mirror from the workflow authority.
//
// It is a source guard on purpose. A runtime test can only observe the paths it
// happens to exercise; this observes every path that exists.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const INBOX_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_SRC = join(INBOX_ROOT, '..', '..')

/**
 * The complete set of modules permitted to write the mirror, each with the
 * reason it is fenced. Adding a file here is a deliberate architectural
 * decision, not a test fix.
 */
const FENCED_MIRROR_WRITERS: Readonly<Record<string, string>> = {
  'contexts/inbox/infrastructure/inbox-command-store.ts':
    'Receipt-coordinated command store: every mirror write co-commits with the Handling Cycle head, its transition row, and the emitted fact.',
  'contexts/inbox/infrastructure/feedback-handling.store.ts':
    'Private-feedback outcome store: closes the head and mirrors the status in one locked transaction.',
  'contexts/inbox/infrastructure/review-handling-cycle.store.ts':
    'Review Handling Cycle store: the head is the authority and the mirror follows it in the same transaction.',
  'contexts/inbox/infrastructure/repositories/inbox.repository.ts':
    'Creation insert plus the retained status seams the command store composes; every read it serves resolves from the head, and its milestone seam cannot express a status.',
}

function walk(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) return walk(absolute)
    return absolute.endsWith('.ts') && !absolute.endsWith('.test.ts') ? [absolute] : []
  })
}

const productionFiles = walk(INBOX_ROOT)

const relativeToSrc = (absolute: string): string =>
  relative(REPO_SRC, absolute).split(sep).join('/')

/**
 * Any write to the `inbox_items` table. Detection is deliberately at table
 * granularity rather than at `status:` granularity: the repository sets status
 * through a shared `InboxItemSet` helper, so a key-level scan would miss it and
 * would miss the next helper someone introduces for the same reason. "Which
 * modules may write this table at all" is both precise and unfoolable.
 */
function writesInboxItemsTable(source: string): boolean {
  return /\.(?:update|insert)\(inboxItems\)/.test(source)
}

describe('inbox_items.status is a read-only-retained compatibility mirror', () => {
  it('is written only by the named head-fenced modules', () => {
    const writers = productionFiles
      .filter((file) => writesInboxItemsTable(readFileSync(file, 'utf8')))
      .map(relativeToSrc)
      .sort()
    expect(writers).toEqual(Object.keys(FENCED_MIRROR_WRITERS).sort())
  })

  it('requires every permitted writer to also move the Handling Cycle head', () => {
    for (const permitted of Object.keys(FENCED_MIRROR_WRITERS)) {
      const source = readFileSync(join(REPO_SRC, permitted), 'utf8')
      expect(
        source.includes('inboxHandlingCycleHeads'),
        `${permitted} writes inbox_items.status without referencing the Handling Cycle head`,
      ).toBe(true)
    }
  })

  it('keeps the application, server, domain and event-handler layers out of the mirror entirely', () => {
    const layered = productionFiles.filter((file) => {
      const path = relativeToSrc(file)
      return (
        path.startsWith('contexts/inbox/application/') ||
        path.startsWith('contexts/inbox/server/') ||
        path.startsWith('contexts/inbox/domain/') ||
        path.startsWith('contexts/inbox/infrastructure/event-handlers/')
      )
    })
    const offenders = layered
      .filter((file) => writesInboxItemsTable(readFileSync(file, 'utf8')))
      .map(relativeToSrc)
    expect(offenders).toEqual([])
  })

  it('leaves no caller of the unfenced repository status seams inside the context', () => {
    const offenders = productionFiles
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return (
          /\brepo\.updateStatus\(/.test(source) ||
          /\brepo\.bulkUpdateStatus\(/.test(source) ||
          /\bcommandStore\.updateStatus\(/.test(source)
        )
      })
      .map(relativeToSrc)
    expect(offenders).toEqual([])
  })

  it('resolves every serving read from the Handling Cycle head, not from the mirror', () => {
    const repository = readFileSync(
      join(REPO_SRC, 'contexts/inbox/infrastructure/repositories/inbox.repository.ts'),
      'utf8',
    )
    expect(repository).toContain(
      'const effectiveInboxStatus = sql<InboxStatus>`${inboxHandlingCycleHeads.status}`',
    )
    expect(repository).toContain('status: effectiveInboxStatus')
  })

  it('retains the physical column — contraction is blocked until a verified release plus restore proof', () => {
    const schema = readFileSync(
      join(REPO_SRC, 'shared', 'db', 'schema', 'inbox.schema.ts'),
      'utf8',
    )
    expect(schema).toMatch(/status:\s*inboxStatusEnum\(['"]status['"]\)/)
  })
})

// `inbox_items` carries the current Handling Cycle's facts (cycle number, source
// revision, state revision) beside its status, and every serving read resolves
// from them. `inbox_handling_cycle_heads` is still written beside the row, but
// only as a mirror of what the Inbox row says.
//
// So the WRITERS stay few. What remains is a small, explicitly named set of
// writers that move the Inbox row's cycle facts inside the same transaction that
// writes the Handling Cycle transition and the outbox fact. This guard is what
// keeps that set small: a new unfenced writer — a repair script, a milestone
// stamp, a well-meaning `updateStatus` call from a use case — fails here rather
// than silently desynchronising the row from its cycle.
//
// It is a source guard on purpose. A runtime test can only observe the paths it
// happens to exercise; this observes every path that exists.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_SRC = join(process.cwd(), 'src')
const INBOX_ROOT = join(REPO_SRC, 'contexts', 'inbox')

/**
 * The complete set of modules permitted to write the Inbox row, each with the
 * reason it is fenced. Adding a file here is a deliberate architectural
 * decision, not a test fix.
 */
const FENCED_MIRROR_WRITERS: Readonly<Record<string, string>> = {
  'contexts/reputation/inbox/assignment-commands.server.ts':
    'Assignment, release and manual reopen commands: every Inbox row write co-commits with the Handling Cycle facts, its transition row, and the outbox fact.',
  'contexts/reputation/inbox/source-commands.server.ts':
    'Receipt-coordinated source commands (create, withdraw, source transition): every Inbox row write co-commits with the Handling Cycle facts, its transition row, and the outbox fact.',
  'contexts/reputation/inbox/inbox-source-projection.server.ts':
    'Source-driven projection commands and the item row writers they share: item rows converge with the Handling Cycle facts, its transition row and the outbox fact in one transaction.',
  'contexts/reputation/inbox/feedback-handling-store.server.ts':
    'Private-feedback outcome store: closes the cycle and the item row in one locked transaction.',
  'contexts/reputation/inbox/review-reply-close.server.ts':
    "Close on a reply Google shows, shared by the reply-observed consumer and the projection rebuild: closes the Handling Cycle and the item row in one transaction, inside Review's exact-current observation permit.",
  'contexts/reputation/inbox/review-epoch-carry-head.server.ts':
    "Review-attested source-epoch carry: moves only the Inbox row's source revision, under the row lock the caller holds, and writes no status.",
  'contexts/reputation/inbox/review-handling-cycle-store.server.ts':
    "Opening a source's first Handling Cycle: stamps the cycle facts on the Inbox row inserted in the same transaction.",
  'contexts/reputation/inbox/inbox-repository.server.ts':
    'Only reply milestone stamping; the milestone seam cannot express a status or a cycle fact.',
}

function walk(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) return walk(absolute)
    return absolute.endsWith('.ts') && !absolute.endsWith('.test.ts') ? [absolute] : []
  })
}

const REPUTATION_INBOX_ROOT = join(REPO_SRC, 'contexts', 'reputation', 'inbox')
const REPUTATION_DOMAIN_ROOT = join(REPO_SRC, 'contexts', 'reputation', 'domain')
const REPUTATION_RESPONSE_TARGETS_ROOT = join(
  REPO_SRC,
  'contexts',
  'reputation',
  'response-targets',
)

const productionFiles = [
  ...walk(INBOX_ROOT),
  ...walk(REPUTATION_INBOX_ROOT),
  ...walk(REPUTATION_DOMAIN_ROOT),
  ...walk(REPUTATION_RESPONSE_TARGETS_ROOT),
]

const relativeToSrc = (absolute: string): string =>
  relative(REPO_SRC, absolute).split(sep).join('/')

/**
 * Any write to the `inbox_items` table. Detection is deliberately at table
 * granularity rather than at `status:` granularity: a shared set-values helper
 * can hide a status key from a key-level scan. "Which modules may write this
 * table at all" is both precise and unfoolable.
 */
function writesInboxItemsTable(source: string): boolean {
  return /\.(?:update|insert)\(inboxItems\)/.test(source)
}

describe('inbox_items carries the Handling Cycle facts its readers resolve from', () => {
  it('is written only by the named cycle-fenced modules', () => {
    const writers = productionFiles
      .filter((file) => writesInboxItemsTable(readFileSync(file, 'utf8')))
      .map(relativeToSrc)
      .sort()
    expect(writers).toEqual(Object.keys(FENCED_MIRROR_WRITERS).sort())
  })

  it('requires every cycle-moving writer to move the cycle facts through one helper', () => {
    // A writer that moves the status must also move the facts, so the helper's
    // columns are spread into every such update; the milestone stamp is the one
    // writer that touches neither.
    const milestoneOnly = 'contexts/reputation/inbox/inbox-repository.server.ts'
    for (const permitted of Object.keys(FENCED_MIRROR_WRITERS)) {
      if (permitted === milestoneOnly) continue
      const source = readFileSync(join(REPO_SRC, permitted), 'utf8')
      expect(
        source.includes('cycleHeadItemColumns') || source.includes('mirrorCycleHead'),
        `${permitted} writes inbox_items without moving the Handling Cycle facts`,
      ).toBe(true)
    }
  })

  it('lets only the command store write the manager priority (ADR 0071)', () => {
    // Every module allowed to write `inbox_items` could set the three priority
    // columns; only the command store's `setPriority` may, because only it
    // re-authorizes the signed-in manager its fact names. A projection, a
    // rebuild or a close that wrote a level would make an AI or a system change
    // look like a person's choice.
    const priorityWriters = Object.keys(FENCED_MIRROR_WRITERS).filter((permitted) =>
      /managerPriority|manager_priority/.test(
        readFileSync(join(REPO_SRC, permitted), 'utf8'),
      ),
    )
    expect(priorityWriters).toEqual([])

    // The one module that writes the priority is status-commands.server.ts; it
    // reaches `inbox_items` through the shared command runtime, so the table
    // scan above cannot see it. Name it, and fence anything that defines the
    // writer elsewhere.
    const setPriorityDefiners = productionFiles
      .filter((file) => /^\s+setPriority:\s*async\b/m.test(readFileSync(file, 'utf8')))
      .map(relativeToSrc)
    expect(setPriorityDefiners).toEqual([
      'contexts/reputation/inbox/status-commands.server.ts',
    ])

    // The columns a set or a reset writes are spelled once, and only the
    // command store's `setPriority` hands them to its compare-and-swap.
    const columnCallers = productionFiles
      .filter((file) => /\bmanagerPriorityColumns\(/.test(readFileSync(file, 'utf8')))
      .map(relativeToSrc)
      .sort()
    expect(columnCallers).toEqual([
      'contexts/reputation/inbox/inbox-priority-history.server.ts',
      'contexts/reputation/inbox/status-commands.server.ts',
    ])
  })

  // The Inbox use cases now live beside their stores in Reputation's features, so
  // no path marks them; the first test fences every writer there by name. What a
  // path still marks stays out of the mirror entirely: the public API, the server
  // functions and the domain.
  it('keeps the public API, server functions and domain out of the mirror entirely', () => {
    const layered = productionFiles.filter((file) => {
      const path = relativeToSrc(file)
      return (
        path.startsWith('contexts/inbox/application/') ||
        path.startsWith('contexts/inbox/server/') ||
        path.startsWith('contexts/reputation/domain/')
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

  it('reads the head table only where it is mirrored', () => {
    const readers = productionFiles
      .filter((file) => !file.endsWith('.test-fixtures.ts'))
      .filter((file) => /\binboxHandlingCycleHeads\b/.test(readFileSync(file, 'utf8')))
      .map(relativeToSrc)
      .sort()
    expect(readers).toEqual([
      'contexts/reputation/inbox/inbox-cycle-head.server.ts',
      'contexts/reputation/inbox/review-epoch-carry-head.server.ts',
      'contexts/reputation/inbox/review-handling-cycle-store.server.ts',
    ])
  })

  it('retains the physical status column — contraction is blocked until a verified release plus restore proof', () => {
    const schema = readFileSync(
      join(REPO_SRC, 'shared', 'db', 'schema', 'inbox.schema.ts'),
      'utf8',
    )
    expect(schema).toMatch(/status:\s*inboxStatusEnum\(['"]status['"]\)/)
  })
})

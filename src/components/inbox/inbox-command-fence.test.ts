// A bulk assign reads its fence from the LIST rows; a note is issued from the
// DETAIL. The two are separate caches.
//
// Adding an internal note advances the item's command revision on the server.
// The note's result used to reach only the detail, so the list row kept the old
// revision, and the next bulk assign that included the row was refused for it:
// the whole batch, on every retry, until the list happened to be re-read.
//
// The server is the Storybook in-memory container (the real use cases over
// in-memory repositories); the client is the real mutation hooks and a real
// QueryClient. See `inbox-cache-test-harness.ts`.

import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import {
  createInboxContainer,
  makeInboxItem,
} from '../../../.storybook/in-memory/inbox-container'
import { makeInboxFns } from '../../../.storybook/in-memory/inbox-fns'
import type {
  InboxNote,
  InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import { buildBulkReopenCommands } from './inbox-bulk-policy'
import { installInboxCacheHarness, type ListFilters } from './inbox-cache-test-harness'
import type { InboxServerFns } from './types'
import { useAddInboxNote, type AddInboxNoteInput } from './use-add-inbox-note'
import { useInboxBulkCommands } from './use-inbox-bulk-commands'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  // `server-function-error.ts` builds its wire adapter at module load; only its
  // recogniser is used here.
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

const COLLEAGUE = 'user-00000000-0000-0000-0000-000000000002'
/** The queue on screen, and one the manager opened earlier and still has cached. */
const ON_SCREEN: ListFilters = { queue: 'open', sort: 'newest' }
const OPENED_EARLIER: ListFilters = {
  queue: 'open',
  sourceType: 'review',
  sort: 'newest',
}

const pane = installInboxCacheHarness()

/**
 * The Storybook in-memory container as the server: the real Inbox use cases
 * (note, escalate, assign, bulk assign, list, detail) over in-memory
 * repositories, behind the same server-function bundle a route passes down.
 * Three open reviews, each on command revision 1.
 */
function seededInboxServer(): InboxServerFns {
  const container = createInboxContainer()
  container.seed(
    ['item-x', 'item-y', 'item-z'].map((id) =>
      makeInboxItem({ id, sourceType: 'review' }),
    ),
  )
  return makeInboxFns(container)
}

function renderBulkCommands(fns: InboxServerFns, onDone: () => void) {
  return pane.renderHooks(() =>
    useInboxBulkCommands({
      bulkUpdateFn: fns.bulkUpdateInboxStatus,
      bulkAssignFn: fns.bulkAssignInboxItems,
      onDone,
    }),
  )
}

/** The selection, sent with whatever the rows on screen carry at that moment. */
const assignTo = (
  bulk: ReturnType<typeof renderBulkCommands>,
  selectedIds: readonly string[],
) =>
  bulk.assign({
    data: {
      items: buildBulkReopenCommands(selectedIds, pane.rows(ON_SCREEN)),
      assignedToUserId: COLLEAGUE,
    },
  })

describe('a bulk assign after an internal note', () => {
  it('is accepted, because the list row carries the revision the note left', async () => {
    const fns = seededInboxServer()
    let listRequests = 0
    pane.showList(fns, ON_SCREEN, () => {
      listRequests += 1
    })
    pane.openItem(fns, 'item-x')
    await pane.settle()
    const onDone = vi.fn()
    const addNote = pane.renderHooks(() => useAddInboxNote(fns.addInboxNote))
    const bulk = renderBulkCommands(fns, onDone)

    await addNote({
      data: {
        inboxItemId: 'item-x',
        text: 'Called the guest back',
        expectedCommandRevision: pane.detail('item-x')!.item.commandRevision,
      },
    })
    const result = await assignTo(bulk, ['item-x', 'item-y', 'item-z'])

    expect(result.results.map((item) => item.outcome)).toEqual([
      'assigned',
      'assigned',
      'assigned',
    ])
    expect(onDone).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
    // The row was written through, not re-read: the note costs no list request.
    expect(listRequests).toBe(1)
  })

  it('leaves the detail and every cached list row on the same revision', async () => {
    const fns = seededInboxServer()
    pane.showList(fns, ON_SCREEN)
    await pane.cacheList(fns, OPENED_EARLIER)
    pane.openItem(fns, 'item-x')
    await pane.settle()
    const addNote = pane.renderHooks(() => useAddInboxNote(fns.addInboxNote))

    await addNote({
      data: { inboxItemId: 'item-x', text: 'Refund agreed', expectedCommandRevision: 1 },
    })

    const server = await fns.getInboxItemDetail({ data: { inboxItemId: 'item-x' } })
    expect(server.item.commandRevision).toBe(2)
    expect({
      detail: pane.detail('item-x')?.item.commandRevision,
      onScreen: pane.rowRevision(ON_SCREEN, 'item-x'),
      openedEarlier: pane.rowRevision(OPENED_EARLIER, 'item-x'),
      untouchedRow: pane.rowRevision(ON_SCREEN, 'item-y'),
    }).toEqual({ detail: 2, onScreen: 2, openedEarlier: 2, untouchedRow: 1 })
  })

  it('carries the revision of the re-send when the first send met a conflict', async () => {
    // The pane is one behind (a colleague escalated the item): the server
    // answers the first send with the conflict and its current revision, the
    // command is re-sent at that revision and commits, leaving the item one
    // further on. The cache must end there, not at "first send plus one".
    const conflict: InboxRevisionConflictResult = {
      ok: false,
      code: 'revision_conflict',
      currentCommandRevision: 6,
      currentStatus: 'open',
    }
    const sent: number[] = []
    const addInboxNote = async (input: AddInboxNoteInput) => {
      sent.push(input.data.expectedCommandRevision)
      return input.data.expectedCommandRevision === 6
        ? ({ id: 'note-1', text: input.data.text } as unknown as InboxNote)
        : conflict
    }
    const row = {
      ...makeInboxItem({ id: 'item-x', sourceType: 'review' }),
      commandRevision: 5,
    }
    pane.client.setQueryData(inboxKeys.detail('item-x'), { item: row, reply: null })
    pane.client.setQueryData(inboxKeys.list(ON_SCREEN), {
      pages: [{ items: [row], nextCursor: null }],
      pageParams: [undefined],
    })
    const addNote = pane.renderHooks(() => useAddInboxNote(addInboxNote))

    await addNote({
      data: {
        inboxItemId: 'item-x',
        text: 'Left a voicemail',
        expectedCommandRevision: 5,
      },
    })

    expect(sent).toEqual([5, 6])
    expect({
      detail: pane.detail('item-x')?.item.commandRevision,
      row: pane.rowRevision(ON_SCREEN, 'item-x'),
    }).toEqual({ detail: 7, row: 7 })
  })
})

describe('a bulk assign the server refused whole', () => {
  it('re-reads the list, so the same selection goes through on the next try', async () => {
    const fns = seededInboxServer()
    pane.showList(fns, ON_SCREEN)
    await pane.settle()
    // A colleague's command, from another browser: the server moves on and
    // this list is not told.
    await fns.escalateInboxItem({
      data: { inboxItemId: 'item-y', expectedCommandRevision: 1 },
    })
    const onDone = vi.fn()
    const bulk = renderBulkCommands(fns, onDone)

    const refused = await assignTo(bulk, ['item-x', 'item-y'])

    expect(refused.results.map((item) => item.outcome)).toEqual([
      'batch_aborted',
      'revision_conflict',
    ])
    // Nothing changed, so the selection is kept for the retry.
    expect(onDone).not.toHaveBeenCalled()
    // The command settled only once the rows were current: no wait in between.
    expect(pane.rowRevision(ON_SCREEN, 'item-y')).toBe(2)
    expect(toast.error).toHaveBeenCalledWith(
      'No assignments changed. The list was refreshed; check access and try again.',
    )

    const retried = await assignTo(bulk, ['item-x', 'item-y'])

    expect(retried.updated).toBe(2)
    expect(onDone).toHaveBeenCalledOnce()
  })
})

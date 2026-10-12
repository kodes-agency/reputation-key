// A revision written into a cached list leaves the list as stale as it was.
//
// A note, and a corrected handling outcome, bring the item's row forward in
// every cached list and re-read none of them (`advanceListRowFence`). A plain
// cache write does more than change the data: it dates the list "read just now"
// and drops a pending invalidation. A queue that is cached but not on screen is
// re-read only when it is shown again, and only if it is stale, so that write
// let it be shown without the read it was owed: escalate an item, say why in a
// note, open Escalated, and the item was not there.
//
// The server is the Storybook in-memory container (the real use cases); the
// client is the real hooks and a real QueryClient with the app's 30-second
// stale time. See `inbox-cache-test-harness.ts`.

import { describe, expect, it, vi } from 'vitest'
import {
  createInboxContainer,
  makeInboxItem,
} from '../../../.storybook/in-memory/inbox-container'
import { makeInboxFns } from '../../../.storybook/in-memory/inbox-fns'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  APP_STALE_TIME_MS,
  installInboxCacheHarness,
  type ListFilters,
} from './inbox-cache-test-harness'
import type { InboxServerFns } from './types'
import { useAddInboxNote } from './use-add-inbox-note'
import { useInboxDetail } from './use-inbox-detail'

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
const ON_SCREEN: ListFilters = { queue: 'open', sort: 'newest' }
/** Queues the manager opened earlier and still has cached. */
const ESCALATED: ListFilters = { queue: 'escalated', sort: 'newest' }
const CLOSED: ListFilters = { queue: 'closed', sort: 'newest' }
const OPEN_REVIEWS: ListFilters = { queue: 'open', sourceType: 'review', sort: 'newest' }

const pane = installInboxCacheHarness()

/** Three open reviews, each on command revision 1, behind the real use cases. */
function seededInboxServer(): InboxServerFns {
  const container = createInboxContainer()
  container.seed(
    ['item-x', 'item-y', 'item-z'].map((id) =>
      makeInboxItem({ id, sourceType: 'review' }),
    ),
  )
  return makeInboxFns(container)
}

const readAt = (filters: ListFilters) =>
  pane.client.getQueryState(inboxKeys.list(filters))?.dataUpdatedAt

/** Open the item, and hand back its commands as the pane issues them. */
async function openItemX(fns: InboxServerFns) {
  pane.showList(fns, ON_SCREEN)
  pane.openItem(fns, 'item-x')
  await pane.settle()
  const addNote = pane.renderHooks(() => useAddInboxNote(fns.addInboxNote))
  const detail = pane.renderHooks(() =>
    useInboxDetail(pane.detail('item-x')?.item ?? null, true, fns, {
      selectedItemId: 'item-x',
    }),
  )
  const fence = () => ({
    inboxItemId: 'item-x',
    expectedCommandRevision: pane.detail('item-x')!.item.commandRevision,
  })
  return {
    addNote: (text: string) => addNote({ data: { ...fence(), text } }),
    escalate: () => detail.escalate({ data: fence() }),
    assignToColleague: () =>
      detail.assign({ data: { ...fence(), assignedToUserId: COLLEAGUE } }),
  }
}

/** Go back to a queue that is cached, counting the reads that showing it costs. */
async function showAgain(fns: InboxServerFns, filters: ListFilters): Promise<number> {
  let reads = 0
  pane.showList(fns, filters, () => {
    reads += 1
  })
  await pane.settle()
  return reads
}

describe('a note on an item, and the queues that are cached but not on screen', () => {
  it('still re-reads a queue a status command had marked stale', async () => {
    const fns = seededInboxServer()
    // The manager looked at Escalated (nothing there yet), then went back.
    await pane.cacheList(fns, ESCALATED)
    const item = await openItemX(fns)

    await item.escalate()
    await pane.settle()
    await item.addNote('Escalated: the guest asked for the owner')
    await pane.settle()

    expect(await showAgain(fns, ESCALATED)).toBe(1)
    expect(pane.rows(ESCALATED).map((row) => row.id)).toEqual(['item-x'])
  })

  it('still re-reads a stale queue whose row the note wrote', async () => {
    const fns = seededInboxServer()
    // This queue holds the item, so the note writes its row. The write must
    // not stand in for the read the assignment ordered: only the revision was
    // written, and the row would go on showing nobody assigned.
    await pane.cacheList(fns, OPEN_REVIEWS)
    const item = await openItemX(fns)

    await item.assignToColleague()
    await pane.settle()
    await item.addNote('Passed to the night manager')
    await pane.settle()

    expect(pane.rowRevision(OPEN_REVIEWS, 'item-x')).toBe(3)
    expect(await showAgain(fns, OPEN_REVIEWS)).toBe(1)
    expect(pane.rows(OPEN_REVIEWS).find((row) => row.id === 'item-x')?.assignedTo).toBe(
      COLLEAGUE,
    )
  })

  it('keeps the date of every cached list, written or not', async () => {
    const fns = seededInboxServer()
    await pane.cacheList(fns, OPEN_REVIEWS)
    await pane.cacheList(fns, CLOSED)
    const cachedAt = { withTheItem: readAt(OPEN_REVIEWS), withoutIt: readAt(CLOSED) }
    // Both reads are now older than the app keeps a read fresh.
    await vi.advanceTimersByTimeAsync(APP_STALE_TIME_MS + 1_000)
    const item = await openItemX(fns)

    await item.addNote('Called the guest back')
    await pane.settle()

    expect(pane.rowRevision(OPEN_REVIEWS, 'item-x')).toBe(2)
    expect({ withTheItem: readAt(OPEN_REVIEWS), withoutIt: readAt(CLOSED) }).toEqual(
      cachedAt,
    )
    // So each is re-read when the manager goes back to it.
    expect({
      openReviews: await showAgain(fns, OPEN_REVIEWS),
      closed: await showAgain(fns, CLOSED),
    }).toEqual({ openReviews: 1, closed: 1 })
  })
})

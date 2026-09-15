// The D8 wiring between the inbox list and the open detail pane, driven through
// the REAL hooks (`useInboxState` + `useInboxDetail`) over scripted server
// functions and the story's own QueryClient.
//
// The pure rules have unit tests (`selectedItemDeparture`,
// `polledReplyPublicationChanged`, `inboxCachePolicy`). What those cannot see
// is whether the hooks still call them: dropping `departure` from
// `useSelectedItemPresence`, the `useReplyPublicationChangeDetection` call, or
// the mutation-result baseline in `onReplyMutated` would leave every unit test
// green. These plays fail instead.
//
// The harness renders no product UI: three facts as text (the open item, the
// loaded rows, the detail's reply status), the read counters, and buttons
// standing in for the events a manager or the server causes.
import type { Meta, StoryObj } from '@storybook/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type {
  InboxItemDetailResult,
  InboxQueue,
} from '#/contexts/inbox/application/public-api'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { inboxKeys } from '#/shared/queries/query-keys'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import type { InboxSearchParams } from './inbox-search-schema'
import type { InboxNavigate } from './inbox-state-helpers'
import type { InboxServerFns } from './types'
import { useInboxDetail } from './use-inbox-detail'
import { useInboxState } from './use-inbox-state'

type DetailReply = NonNullable<InboxItemDetailResult['reply']>

const ITEM = makeInboxItem({ id: 'item-under-review', sourceType: 'review' })
const OTHER_ITEM = makeInboxItem({ id: 'item-alongside', sourceType: 'review' })

const NO_FILTERS: InboxFilterValues = {
  propertyId: undefined,
  sourceType: undefined,
  ratingMin: undefined,
  ratingMax: undefined,
  attention: undefined,
  aspect: undefined,
  polarity: undefined,
  q: undefined,
  sort: undefined,
}

type EntityReply = Exclude<DetailReply, { kind: 'google_observation' }>

function reply(overrides: Partial<EntityReply>): EntityReply {
  const at = new Date('2026-09-14T09:00:00.000Z')
  return {
    id: 'reply-under-review',
    reviewId: ITEM.sourceId,
    organizationId: ITEM.organizationId,
    text: 'Thank you for staying with us.',
    templateId: null,
    templateVersion: null,
    status: 'pending_approval',
    source: 'internal',
    createdBy: null,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: at,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationCycle: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  } as EntityReply
}

/** What the scripted server answers next, and how often it was asked. */
type Script = {
  listHasItem: boolean
  detailReply: DetailReply | null
  detailRefused: boolean
  listReads: number
  detailReads: number
  countReads: number
}

let script: Script = makeScript(null)

function makeScript(detailReply: DetailReply | null): Script {
  return {
    listHasItem: true,
    detailReply,
    detailRefused: false,
    listReads: 0,
    detailReads: 0,
    countReads: 0,
  }
}

const unused = (async () => {
  throw new Error('not part of this harness')
}) as never

const fns = {
  getInboxItems: (async () => {
    script.listReads += 1
    const items = script.listHasItem ? [ITEM, OTHER_ITEM] : [OTHER_ITEM]
    return {
      items,
      nextCursor: null,
      totalCount: items.length,
      responseCutoff: new Date('2026-09-14T10:00:00.000Z'),
      viewedUpTo: null,
    }
  }) as unknown as InboxServerFns['getInboxItems'],
  getInboxItemDetail: (async () => {
    script.detailReads += 1
    if (script.detailRefused) {
      throw new ServerFunctionError(
        'InboxError',
        'No access to this inbox source',
        'forbidden',
        403,
      )
    }
    return {
      item: ITEM,
      reply: script.detailReply,
      analysis: null,
      feedbackHandling: null,
      responseTarget: null,
    }
  }) as unknown as InboxServerFns['getInboxItemDetail'],
  getInboxNotes: (async () => []) as unknown as InboxServerFns['getInboxNotes'],
  updateInboxStatus: unused,
  escalateInboxItem: unused,
  resolveEscalation: unused,
  assignInboxItem: unused,
  markFeedbackHandled: unused,
  correctFeedbackHandlingOutcome: unused,
}

function PresenceHarness({
  queue,
  commandResult,
}: Readonly<{ queue: InboxQueue; commandResult: DetailReply }>): ReactNode {
  const qc = useQueryClient()
  const [itemId, setItemId] = useState<string | undefined>(ITEM.id)
  const onNavigate = useCallback<InboxNavigate>(
    (options) =>
      setItemId(
        (current) => options.search({ itemId: current } as InboxSearchParams).itemId,
      ),
    [],
  )
  const list = useInboxState(
    'org',
    queue,
    'viewer',
    NO_FILTERS,
    itemId,
    onNavigate,
    fns.getInboxItems,
  )
  const detail = useInboxDetail(null, true, fns, { selectedItemId: itemId })
  // An active counts observer, so a counts invalidation is a real re-read.
  useQuery({
    queryKey: inboxKeys.countsFor(),
    queryFn: async () => {
      script.countReads += 1
      return {}
    },
  })

  return (
    <main>
      <p>Open item: {itemId ?? 'none'}</p>
      <p>Loaded rows: {list.items.length}</p>
      <p>Detail reply: {detail.detail?.reply?.status ?? 'none'}</p>
      <button
        type="button"
        onClick={() =>
          detail.onReplyMutated({
            kind: 'state_changed',
            reply: commandResult,
            reviewId: ITEM.sourceId,
          })
        }
      >
        Apply the command result
      </button>
      <button type="button" onClick={() => detail.refetch()}>
        Poll the detail
      </button>
      <button
        type="button"
        onClick={() => void qc.invalidateQueries({ queryKey: inboxKeys.lists() })}
      >
        Refresh the list
      </button>
    </main>
  )
}

const meta: Meta<typeof PresenceHarness> = {
  title: 'Inbox/Hooks/Open item across queue moves',
  component: PresenceHarness,
}
export default meta
type Story = StoryObj<typeof PresenceHarness>

async function ready(canvasElement: HTMLElement, replyStatus: string) {
  const canvas = within(canvasElement)
  await canvas.findByText('Loaded rows: 2')
  await canvas.findByText(`Detail reply: ${replyStatus}`)
  return canvas
}

/** Settles React effects queued by the last commit before asserting a non-event. */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

/**
 * Approving from the open pane in Awaiting approval: the command result moves
 * the reply to Waiting for Google, the list re-read drops the item, and the
 * pane stays on it (D8) — because the detail's own reply explains the move.
 */
export const ApprovingKeepsThePaneOpen: Story = {
  args: {
    queue: 'approval',
    commandResult: reply({ status: 'approved', publicationState: 'requested' }),
  },
  beforeEach: () => {
    script = makeScript(reply({ status: 'pending_approval' }))
  },
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement, 'pending_approval')

    script.listHasItem = false
    await userEvent.click(
      canvas.getByRole('button', { name: 'Apply the command result' }),
    )

    await canvas.findByText('Loaded rows: 1')
    await nextFrame()
    expect(canvas.getByText(`Open item: ${ITEM.id}`)).toBeVisible()
    expect(canvas.getByText('Detail reply: approved')).toBeVisible()
  },
}

/**
 * The item left Waiting for Google because the viewer lost access, not because
 * of its reply. The detail read that would explain a move is re-read, it is
 * refused, and the pane closes rather than sit on a header over an error.
 */
export const LosingAccessClosesThePane: Story = {
  args: {
    queue: 'waiting',
    commandResult: reply({ status: 'published', publicationState: 'published' }),
  },
  beforeEach: () => {
    script = makeScript(reply({ status: 'published', publicationState: 'published' }))
  },
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement, 'published')

    script.listHasItem = false
    script.detailRefused = true
    await userEvent.click(canvas.getByRole('button', { name: 'Refresh the list' }))

    expect(await canvas.findByText('Open item: none')).toBeVisible()
  },
}

const STILL_CHECKED = reply({
  status: 'publish_failed',
  approvedAt: new Date('2026-09-14T09:05:00.000Z'),
  publicationState: 'ambiguous',
  publicationLastErrorClass: 'ambiguous',
  publicationAttempts: 1,
  reconcileDueAt: new Date('2099-01-01T00:00:00.000Z'),
})
const CHECKS_ENDED = reply({
  ...STILL_CHECKED,
  publicationState: 'terminal',
  reconcileDueAt: null,
  stateRevision: 2,
})

/** A still-checked reply open in the Waiting queue, whose checks are about to end. */
const checksEndingStory = {
  args: { queue: 'waiting', commandResult: CHECKS_ENDED },
  beforeEach: () => {
    script = makeScript(STILL_CHECKED)
  },
} satisfies Partial<Story>

/** Loads the reply, lets the first count read land, then ends its checks on the server. */
async function endChecksAfterTheFirstCount(canvasElement: HTMLElement) {
  const canvas = await ready(canvasElement, 'publish_failed')
  await waitFor(() => expect(script.countReads).toBe(1))
  script.detailReply = CHECKS_ENDED
  return canvas
}

/**
 * A detail poll sees the automatic checks end: Waiting for Google → Needs
 * reply. Nothing else refreshes the queue counts (a still-checked row does not
 * make the list poll now), so the change detection must.
 */
export const APolledReplyMoveRefreshesTheCounts: Story = {
  ...checksEndingStory,
  play: async ({ canvasElement }) => {
    const canvas = await endChecksAfterTheFirstCount(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Poll the detail' }))

    await waitFor(() => expect(script.countReads).toBe(2))
  },
}

/**
 * The same move arriving as a command result is refreshed by the command
 * (`onReplyChanged`), and recorded as the detail's baseline, so the poll that
 * then reads the same reply is not taken for a second transition.
 */
export const ACommandResultIsNotCountedTwice: Story = {
  ...checksEndingStory,
  play: async ({ canvasElement }) => {
    const canvas = await endChecksAfterTheFirstCount(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Apply the command result' }),
    )
    await waitFor(() => expect(script.countReads).toBe(2))

    const detailReadsBefore = script.detailReads
    await userEvent.click(canvas.getByRole('button', { name: 'Poll the detail' }))
    await waitFor(() => expect(script.detailReads).toBe(detailReadsBefore + 1))
    await nextFrame()
    await nextFrame()
    expect(script.countReads).toBe(2)
  },
}

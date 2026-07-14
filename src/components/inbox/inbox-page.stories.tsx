// Page-level story: composes the full InboxPageV2 three-panel layout against the
// in-memory container. The list + folder sidebar render with REAL use-case
// logic (getInboxItems + getInboxFolderCounts compute over seeded data); the
// detail-only fns are wired but only fire on item selection. Demonstrates the
// Phase-1 prop channel end-to-end: a route-shaped fn bundle, no server/RPC.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { useState } from 'react'
import type { getInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { InboxPageV2 } from './inbox-page-v2'
import {
  createInboxContainer,
  makeInboxItem,
  inboxTestIds,
} from '../../../.storybook/in-memory/inbox-container'
import { makeInboxFns } from '../../../.storybook/in-memory/inbox-fns'
import { SidebarProvider, SidebarInset } from '#/components/ui/sidebar'
import type { InboxCtx } from './inbox-types'
import type { InboxPageNav } from './use-inbox-page'
import type { InboxServerFns } from './types'
import type { InboxSearchParams } from './inbox-search-schema'

const container = createInboxContainer()
// 6 items across folders → sidebar counts computed by the real use-case.
container.seed([
  makeInboxItem({ id: '1', sourceType: 'review', status: 'open', rating: 5 }),
  makeInboxItem({ id: '2', sourceType: 'feedback', status: 'open', rating: 2 }),
  makeInboxItem({ id: '3', sourceType: 'review', status: 'open', rating: 1 }),
  makeInboxItem({
    id: '4',
    sourceType: 'review',
    status: 'open',
    isEscalated: true,
    rating: 1,
  }),
  makeInboxItem({
    id: '5',
    sourceType: 'feedback',
    status: 'open',
    isEscalated: true,
    rating: 2,
  }),
  makeInboxItem({ id: '6', sourceType: 'review', status: 'closed', rating: 4 }),
])

// Empty repo → getInboxItems returns [] → the list empty state.
const emptyContainer = createInboxContainer()

const properties = [
  { id: String(inboxTestIds.PROP), name: 'Acme Hotel' },
  { id: 'prop-00000000-0000-0000-0000-000000000002', name: 'Globex HQ' },
]

const orgCtx: InboxCtx = { activeOrganization: { id: String(inboxTestIds.ORG) } }

// getInboxItems never settles → the list stays in its loading (skeleton) state.
// Sidebar folder counts still resolve (real use-case over the seeded repo), so
// this mirrors a realistic partial-load: chrome rendered, list pending.
const loadingFns: InboxServerFns = {
  ...makeInboxFns(container),
  getInboxItems: (() =>
    Promise.withResolvers<never>().promise) as unknown as typeof getInboxItemsFn,
}

/**
 * Story harness: holds the inbox `search` params in local state and feeds
 * row-click navigation back into them, mirroring how TanStack router owns
 * `search.itemId` in the real app. A no-op `onNavigate` (as a plain args story
 * would use) never updates `search.itemId`, so the detail pane could never
 * open — this harness makes interaction stories (row-click → detail open)
 * exercisable.
 */
function InboxPageHarness({
  ctx,
  properties: props,
  inboxFns,
  initialSearch = {},
}: {
  ctx: InboxCtx
  properties?: ReadonlyArray<{ id: string; name: string }>
  inboxFns: InboxServerFns
  initialSearch?: InboxSearchParams
}) {
  const [search, setSearch] = useState<InboxSearchParams>(initialSearch)
  const onNavigate: InboxPageNav = (o) =>
    setSearch((prev) => ({ ...prev, ...o.search(prev) }))
  return (
    <InboxPageV2
      ctx={ctx}
      search={search}
      properties={props}
      onNavigate={onNavigate}
      inboxFns={inboxFns}
    />
  )
}

const meta: Meta<typeof InboxPageV2> = {
  title: 'Pages/Inbox',
  component: InboxPageV2,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="h-[800px] w-full bg-background text-foreground">
        <SidebarProvider>
          <SidebarInset>
            <Story />
          </SidebarInset>
        </SidebarProvider>
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof InboxPageV2>

export const Default: Story = {
  parameters: { a11y: { disable: true } },
  render: () => (
    <InboxPageHarness
      ctx={orgCtx}
      properties={properties}
      inboxFns={makeInboxFns(container)}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // All seeded rows share reviewerName 'Jane Doe' → multiple matches; click the first.
    // The list loads asynchronously via the real use-case → findAllByRole waits.
    const rows = await canvas.findAllByRole('button', {
      name: /Open review from Jane Doe/i,
    })
    await userEvent.click(rows[0])
    // Row click wired selectedItem into the detail pane → the empty
    // placeholder ("No message selected") is replaced by the detail panel.
    await expect(canvas.queryByText('No message selected')).not.toBeInTheDocument()
  },
}

// Open the "escalated" folder — the list refilters via the real use-case.
export const EscalatedFolder: Story = {
  render: () => (
    <InboxPageHarness
      ctx={orgCtx}
      properties={properties}
      inboxFns={makeInboxFns(container)}
      initialSearch={{ folder: 'escalated' }}
    />
  ),
}

// No active organization → the page renders its NoOrg empty state.
export const NoOrg: Story = {
  render: () => (
    <InboxPageHarness
      ctx={{ activeOrganization: null }}
      properties={properties}
      inboxFns={makeInboxFns(container)}
    />
  ),
}

// Empty list → the use-case returns [] → the "No inbox items" empty state.
export const EmptyList: Story = {
  render: () => (
    <InboxPageHarness
      ctx={orgCtx}
      properties={properties}
      inboxFns={makeInboxFns(emptyContainer)}
    />
  ),
}

// getInboxItems never resolves → the list stays in its loading (skeleton) state.
export const Loading: Story = {
  render: () => (
    <InboxPageHarness ctx={orgCtx} properties={properties} inboxFns={loadingFns} />
  ),
}

// Mobile viewport (390×844 → matches the app's `max-width: 767px` breakpoint):
// the three-panel desktop layout collapses to list + drawer sidebar + detail sheet.
export const MobileViewport: Story = {
  render: () => (
    <InboxPageHarness
      ctx={orgCtx}
      properties={properties}
      inboxFns={makeInboxFns(container)}
    />
  ),
  parameters: {
    viewport: { defaultViewport: 'mobileStaff' },
  },
}

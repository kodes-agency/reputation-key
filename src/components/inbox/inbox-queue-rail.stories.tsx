import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type {
  InboxPropertyCounts,
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import { InboxQueueRail } from './inbox-queue-rail'
import { defaultInboxQueue, type InboxQueueViewer } from './inbox-queue-sections'
import { InboxShortcutsDialog } from './inbox-shortcuts-dialog'
import { sortScopeProperties, type InboxScopeProperty } from './inbox-property-scope'
import { InboxPropertySelect } from './inbox-property-select'
import {
  expectHotelOptions,
  hotelCounts,
  hotels,
} from './inbox-property-select-stories-data'
import type { InboxServerFns } from './types'

const counts: InboxQueueCounts = {
  reply: 18,
  approval: 4,
  waiting: 2,
  feedback: 7,
  escalated: 3,
  mine: 5,
  open: 31,
  // The closed folders carry no badge (ADR 0057, amended 2026-10-28).
  replied: null,
  handled: null,
  closed: null,
}

const MANAGER: InboxQueueViewer = {
  canManageReplies: true,
  canReadReviews: true,
  canReadFeedback: true,
}

/** Reply stages are off: the one reply row counts every open Review. */
const WITHOUT_STAGES: InboxQueueViewer = { ...MANAGER, canManageReplies: false }
const WITHOUT_STAGES_COUNTS: InboxQueueCounts = {
  ...counts,
  reply: 24,
  approval: null,
  waiting: null,
}

function RailStory({
  viewer = MANAGER,
  railCounts = counts,
}: {
  viewer?: InboxQueueViewer
  railCounts?: InboxQueueCounts
}) {
  const [queue, setQueue] = useState<InboxQueue>(defaultInboxQueue(viewer))
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  return (
    <div className="h-[560px]">
      <InboxQueueRail
        queue={queue}
        counts={railCounts}
        viewer={viewer}
        onQueueChange={setQueue}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <InboxShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}

const meta: Meta<typeof InboxQueueRail> = {
  title: 'Inbox/Queue Rail',
  component: InboxQueueRail,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof InboxQueueRail>

/** The queue buttons of each titled group, in the order they are drawn. */
function groupsOf(canvasElement: HTMLElement) {
  const nav = within(canvasElement).getByRole('navigation', { name: 'Queues' })
  return [...nav.querySelectorAll<HTMLElement>('[role="group"]')].map((group) => ({
    name: group.getAttribute('aria-labelledby')
      ? document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent
      : null,
    queues: within(group)
      .getAllByRole('button')
      .map((button) => button.textContent?.replace(/\d+$/, '')),
  }))
}

export const Manager: Story = {
  render: () => <RailStory />,
  play: async ({ canvasElement }) => {
    const queues = within(
      within(canvasElement).getByRole('navigation', { name: 'Queues' }),
    )
    // Two titled groups, then the shared views below a separator with no heading.
    expect(groupsOf(canvasElement)).toEqual([
      {
        name: 'Reviews',
        queues: ['Needs reply', 'Awaiting approval', 'Waiting for Google', 'Replied'],
      },
      { name: 'Private feedback', queues: ['To handle', 'Handled'] },
    ])
    const allOpen = queues.getByRole('button', { name: /^All open\s*31$/ })
    expect(allOpen).not.toHaveAttribute('aria-current')
    expect(queues.getByRole('button', { name: /^Needs reply/ })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await userEvent.click(allOpen)

    expect(allOpen).toHaveAttribute('aria-current', 'page')
    expect(queues.getByRole('button', { name: /^Needs reply/ })).not.toHaveAttribute(
      'aria-current',
    )
  },
}

// A closed folder is an archive, not work: no badge, even though it holds items.
export const ClosedFoldersHaveNoBadge: Story = {
  render: () => <RailStory />,
  play: async ({ canvasElement }) => {
    const queues = within(
      within(canvasElement).getByRole('navigation', { name: 'Queues' }),
    )
    expect(queues.getByRole('button', { name: 'Replied' })).toBeVisible()
    expect(queues.getByRole('button', { name: 'Handled' })).toBeVisible()
    expect(queues.queryByRole('button', { name: /^Closed/ })).toBeNull()
  },
}

// Reply publication is off: the Reviews section is one "Open" row and Replied.
export const WithoutReplyStages: Story = {
  render: () => <RailStory viewer={WITHOUT_STAGES} railCounts={WITHOUT_STAGES_COUNTS} />,
  play: async ({ canvasElement }) => {
    expect(groupsOf(canvasElement)).toEqual([
      { name: 'Reviews', queues: ['Open', 'Replied'] },
      { name: 'Private feedback', queues: ['To handle', 'Handled'] },
    ])
    const queues = within(
      within(canvasElement).getByRole('navigation', { name: 'Queues' }),
    )
    expect(queues.getByRole('button', { name: /^Open\s*24$/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(queues.queryByRole('button', { name: /^Awaiting approval/ })).toBeNull()
  },
}

// A section disappears with its permission, and All open with the second kind.
export const ReviewsOnly: Story = {
  render: () => <RailStory viewer={{ ...MANAGER, canReadFeedback: false }} />,
  play: async ({ canvasElement }) => {
    expect(groupsOf(canvasElement).map((group) => group.name)).toEqual(['Reviews'])
    const queues = within(
      within(canvasElement).getByRole('navigation', { name: 'Queues' }),
    )
    expect(queues.queryByRole('button', { name: /^All open/ })).toBeNull()
    expect(queues.getByRole('button', { name: /^Escalated/ })).toBeVisible()
  },
}

export const FeedbackOnly: Story = {
  render: () => <RailStory viewer={{ ...MANAGER, canReadReviews: false }} />,
  play: async ({ canvasElement }) => {
    expect(groupsOf(canvasElement).map((group) => group.name)).toEqual([
      'Private feedback',
    ])
    expect(
      within(canvasElement).getByRole('button', { name: /^To handle/ }),
    ).toHaveAttribute('aria-current', 'page')
  },
}

export const ZeroCounts: Story = {
  args: {
    queue: 'reply',
    counts: { ...counts, reply: 0, approval: 0, waiting: 0, feedback: 0 },
    viewer: MANAGER,
    onQueueChange: () => undefined,
    onOpenShortcuts: () => undefined,
  },
  render: (args) => (
    <div className="h-[560px]">
      <InboxQueueRail {...args} />
    </div>
  ),
}

// ── Properties: the select above the queues ─────────────────────────

const portfolio: ReadonlyArray<InboxScopeProperty> = [
  'Vratsa Balkan Hotel',
  'Albena Shore',
  'Sofia Central',
  'Bansko Ski Chalets',
  'Black Sea Residence',
  'Borovets Pines',
  'Burgas Marina',
  'Dobrich Garden Hotel',
  'Golden Sands Tower',
  'Kavarna Cliffs',
  'Melnik Wine Lodge',
  'Nessebar Old Town Inn',
  'Pamporovo Lodge',
  'Plovdiv Old Quarter',
  'Ruse Riverside',
  'Sandanski Spa',
  'Shumen Plateau Hotel',
  'Sozopol Bay',
  'Stara Zagora Suites',
  'Sunny Beach Resort',
  'Tryavna Crafts House',
  'Varna Sea Garden',
  'Veliko Tarnovo Heights',
  'Vidin Danube Hotel',
].map((name, index) => ({
  id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name,
}))

const portfolioCounts: InboxPropertyCounts = {
  queue: 'reply',
  total: 62,
  byProperty: Object.fromEntries(
    portfolio.map((property, index) => [property.id, index % 3 === 0 ? 0 : index]),
  ),
}

function ScopedRailStory({
  properties,
  countsFn,
  includeAll = true,
  initialPropertyId = null,
  canManageReplies = true,
}: Readonly<{
  properties: ReadonlyArray<InboxScopeProperty>
  /** The per-property counts read, called only once the select opens. */
  countsFn: () => Promise<InboxPropertyCounts>
  includeAll?: boolean
  initialPropertyId?: string | null
  canManageReplies?: boolean
}>) {
  const viewer = canManageReplies ? MANAGER : WITHOUT_STAGES
  const [queue, setQueue] = useState<InboxQueue>(defaultInboxQueue(viewer))
  const [activePropertyId, setActivePropertyId] = useState(initialPropertyId)
  const sorted = sortScopeProperties(properties)
  return (
    <div className="h-[560px]">
      <InboxQueueRail
        queue={queue}
        counts={canManageReplies ? counts : WITHOUT_STAGES_COUNTS}
        viewer={viewer}
        scopeControl={
          <InboxPropertySelect
            scope={{
              properties: sorted,
              activePropertyId,
              includeAll,
              onSelect: setActivePropertyId,
            }}
            scopeLabel={
              sorted.find((property) => property.id === activePropertyId)?.name ??
              'All properties'
            }
            queue={queue}
            hasReplyStages={canManageReplies}
            placement="rail"
            getInboxPropertyCounts={
              countsFn as unknown as InboxServerFns['getInboxPropertyCounts']
            }
          />
        }
        onQueueChange={setQueue}
        onOpenShortcuts={() => undefined}
      />
      <output data-testid="active-scope" className="sr-only">
        {activePropertyId ?? 'all'}
      </output>
    </div>
  )
}

/** Opens the property select and returns its listbox once it is on screen. */
async function openPropertySelect(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('combobox', { name: /^Property:/ }))
  const page = within(canvasElement.ownerDocument.body)
  return { canvas, page, list: within(await page.findByRole('listbox')) }
}

// Where a group manager starts: the whole backlog. The select sits above the
// queues because it decides their counts; its own counts load only once it is
// opened, since nobody sees them before.
const allPropertiesCounts = fn(async () => hotelCounts)
export const AllProperties: Story = {
  render: () => <ScopedRailStory properties={hotels} countsFn={allPropertiesCounts} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: 'Property: All properties' })
    const queues = canvas.getByRole('navigation', { name: 'Queues' })
    expect(
      trigger.compareDocumentPosition(queues) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(allPropertiesCounts).not.toHaveBeenCalled()

    const { page, list } = await openPropertySelect(canvasElement)
    expect(page.getByText('Needs reply by property')).toBeInTheDocument()
    expect(page.queryByPlaceholderText('Search properties')).toBeNull()
    await expectHotelOptions(list)
    expect(list.getByRole('option', { name: /all properties/i })).toHaveAttribute(
      'aria-current',
      'true',
    )

    await userEvent.click(list.getByRole('option', { name: /rila grand hotel/i }))
    expect(canvas.getByTestId('active-scope')).toHaveTextContent(hotels[1].id)
    await waitFor(() => expect(page.queryByRole('listbox')).toBeNull())
    expect(
      canvas.getByRole('combobox', { name: 'Property: Rila Grand Hotel' }),
    ).toBeInTheDocument()
  },
}

// Opened from one hotel's own Reviews: the counts still belong to the queue, so
// All properties is one choice away with its full number.
export const PropertyInView: Story = {
  render: () => (
    <ScopedRailStory
      properties={hotels}
      countsFn={async () => hotelCounts}
      initialPropertyId={hotels[0].id}
    />
  ),
  play: async ({ canvasElement }) => {
    const { canvas, page, list } = await openPropertySelect(canvasElement)
    expect(list.getByRole('option', { name: /hotel elegance/i })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(list.getByRole('option', { name: /all properties/i })).not.toHaveAttribute(
      'aria-current',
    )

    await userEvent.click(list.getByRole('option', { name: /all properties/i }))
    expect(canvas.getByTestId('active-scope')).toHaveTextContent('all')
    await waitFor(() => expect(page.queryByRole('listbox')).toBeNull())
  },
}

// An agency or a group: a list this long is searched, not scanned.
export const ManyProperties: Story = {
  render: () => (
    <ScopedRailStory
      properties={portfolio}
      countsFn={async () => portfolioCounts}
      initialPropertyId={portfolio[0].id}
    />
  ),
  play: async ({ canvasElement }) => {
    const { canvas, page, list } = await openPropertySelect(canvasElement)
    // All properties + all 24, alphabetically, the one in view checked.
    expect(list.getAllByRole('option')).toHaveLength(25)
    expect(list.getByRole('option', { name: /vratsa balkan hotel/i })).toHaveAttribute(
      'aria-current',
      'true',
    )

    await userEvent.type(page.getByPlaceholderText('Search properties'), 'sofia')
    await waitFor(() =>
      expect(list.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Sofia Central2',
      ]),
    )
    await userEvent.click(list.getByRole('option', { name: /sofia central/i }))
    expect(canvas.getByTestId('active-scope')).toHaveTextContent(portfolio[2].id)
    await waitFor(() => expect(page.queryByRole('listbox')).toBeNull())
  },
}

// A member works one property at a time: no organization-wide Inbox, so no All
// properties, and two properties need no search field.
export const MemberProperties: Story = {
  render: () => (
    <ScopedRailStory
      properties={hotels.slice(0, 2)}
      countsFn={async () => ({
        queue: 'open',
        total: 15,
        byProperty: { [hotels[0].id]: 9, [hotels[1].id]: 6 },
      })}
      includeAll={false}
      initialPropertyId={hotels[0].id}
      canManageReplies={false}
    />
  ),
  play: async ({ canvasElement }) => {
    const { page, list } = await openPropertySelect(canvasElement)
    expect(page.queryByPlaceholderText('Search properties')).toBeNull()
    expect(page.getByText('Open by property')).toBeInTheDocument()
    await waitFor(() =>
      expect(list.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Hotel Elegance9',
        'Rila Grand Hotel6',
      ]),
    )
  },
}

// A property with nothing in the queue shows no count, like a queue with no work.
export const EmptyPropertyCounts: Story = {
  render: () => (
    <ScopedRailStory
      properties={hotels}
      countsFn={async () => ({
        queue: 'reply',
        total: 4,
        byProperty: { [hotels[0].id]: 4 },
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const { list } = await openPropertySelect(canvasElement)
    await waitFor(() =>
      expect(list.getByRole('option', { name: /hotel elegance/i })).toHaveTextContent(
        'Hotel Elegance4',
      ),
    )
    expect(list.getByRole('option', { name: /black sea residence/i })).toHaveTextContent(
      /^Black Sea Residence$/,
    )
  },
}

// Keyboard users start on the scope in view and move with the arrows, with or
// without a search field. Three properties have none, which is where focus once
// fell outside the list and the keys went nowhere.
export const ChoosingByKeyboard: Story = {
  render: () => (
    <ScopedRailStory
      properties={hotels}
      countsFn={async () => hotelCounts}
      initialPropertyId={hotels[0].id}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('combobox', { name: 'Property: Hotel Elegance' }).focus()
    await userEvent.keyboard('{Enter}')
    const page = within(canvasElement.ownerDocument.body)
    const list = within(await page.findByRole('listbox'))
    await waitFor(() =>
      expect(list.getByRole('option', { name: /hotel elegance/i })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )

    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(list.getByRole('option', { name: /rila grand hotel/i })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    await userEvent.keyboard('{Enter}')
    expect(canvas.getByTestId('active-scope')).toHaveTextContent(hotels[1].id)
    await waitFor(() => expect(page.queryByRole('listbox')).toBeNull())
  },
}

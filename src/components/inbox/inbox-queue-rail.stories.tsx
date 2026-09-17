import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type {
  InboxPropertyCounts,
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import { InboxQueueRail } from './inbox-queue-rail'
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
  closed: 42,
  open: 31,
}

function RailStory({ canManageReplies = true }: { canManageReplies?: boolean }) {
  const [queue, setQueue] = useState<InboxQueue>(canManageReplies ? 'reply' : 'open')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  return (
    <div className="h-[560px]">
      <InboxQueueRail
        queue={queue}
        counts={
          canManageReplies
            ? counts
            : { ...counts, reply: null, approval: null, waiting: null }
        }
        canManageReplies={canManageReplies}
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

export const Manager: Story = {
  render: () => <RailStory />,
  play: async ({ canvasElement }) => {
    const queues = within(
      within(canvasElement).getByRole('navigation', { name: 'Queues' }),
    )
    const open = queues.getByRole('button', { name: /^Open\s*31$/ })
    expect(open).not.toHaveAttribute('aria-current')

    await userEvent.click(open)

    expect(open).toHaveAttribute('aria-current', 'page')
    expect(queues.getByRole('button', { name: /^Needs reply/ })).not.toHaveAttribute(
      'aria-current',
    )
  },
}
export const Member: Story = { render: () => <RailStory canManageReplies={false} /> }
export const ZeroCounts: Story = {
  args: {
    queue: 'reply',
    counts: { ...counts, reply: 0, approval: 0, waiting: 0, feedback: 0 },
    canManageReplies: true,
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
  const [queue, setQueue] = useState<InboxQueue>(canManageReplies ? 'reply' : 'open')
  const [activePropertyId, setActivePropertyId] = useState(initialPropertyId)
  const sorted = sortScopeProperties(properties)
  return (
    <div className="h-[560px]">
      <InboxQueueRail
        queue={queue}
        counts={
          canManageReplies
            ? counts
            : { ...counts, reply: null, approval: null, waiting: null }
        }
        canManageReplies={canManageReplies}
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

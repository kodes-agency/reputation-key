import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type {
  InboxPropertyCounts,
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import { InboxQueueRail } from './inbox-queue-rail'
import { InboxShortcutsDialog } from './inbox-shortcuts-dialog'
import { sortScopeProperties, type InboxScopeProperty } from './inbox-property-scope'

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

export const Manager: Story = { render: () => <RailStory /> }
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

// ── Properties: the rail's second axis ──────────────────────────────

const hotels: ReadonlyArray<InboxScopeProperty> = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Hotel Elegance' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Rila Grand Hotel' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Black Sea Residence' },
]

/** Needs reply 23 = 12 + 8 + 3, the canvas's own numbers. */
const hotelCounts: InboxPropertyCounts = {
  queue: 'reply',
  total: 23,
  byProperty: { [hotels[0].id]: 12, [hotels[1].id]: 8, [hotels[2].id]: 3 },
}

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
  propertyCounts,
  includeAll = true,
  initialPropertyId = null,
  canManageReplies = true,
}: Readonly<{
  properties: ReadonlyArray<InboxScopeProperty>
  propertyCounts: InboxPropertyCounts
  includeAll?: boolean
  initialPropertyId?: string | null
  canManageReplies?: boolean
}>) {
  const [queue, setQueue] = useState<InboxQueue>(canManageReplies ? 'reply' : 'open')
  const [activePropertyId, setActivePropertyId] = useState(initialPropertyId)
  return (
    <div className="h-[760px]">
      <InboxQueueRail
        queue={queue}
        counts={
          canManageReplies
            ? counts
            : { ...counts, reply: null, approval: null, waiting: null }
        }
        canManageReplies={canManageReplies}
        propertyScope={{
          properties: sortScopeProperties(properties),
          activePropertyId,
          includeAll,
          counts: propertyCounts,
          onSelect: setActivePropertyId,
        }}
        onQueueChange={setQueue}
        onOpenShortcuts={() => undefined}
      />
      <output data-testid="active-scope" className="sr-only">
        {activePropertyId ?? 'all'}
      </output>
    </div>
  )
}

const properties = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('navigation', { name: 'Properties' }))

// Where a group manager starts: the whole backlog, and which hotel it sits in.
export const AllProperties: Story = {
  render: () => <ScopedRailStory properties={hotels} propertyCounts={hotelCounts} />,
  play: async ({ canvasElement }) => {
    const section = properties(canvasElement)
    const rows = section.getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      'All properties23',
      'Black Sea Residence3',
      'Hotel Elegance12',
      'Rila Grand Hotel8',
    ])
    expect(section.getByRole('button', { name: /all properties/i })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await userEvent.click(section.getByRole('button', { name: /rila grand hotel/i }))
    expect(within(canvasElement).getByTestId('active-scope')).toHaveTextContent(
      hotels[1].id,
    )
  },
}

// Opened from one hotel's own Reviews: the property counts still belong to the
// queue, so All properties stays one click away with its full number.
export const PropertyInView: Story = {
  render: () => (
    <ScopedRailStory
      properties={hotels}
      propertyCounts={hotelCounts}
      initialPropertyId={hotels[0].id}
    />
  ),
  play: async ({ canvasElement }) => {
    const section = properties(canvasElement)
    expect(section.getByRole('button', { name: /hotel elegance/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(section.getByRole('button', { name: /all properties/i })).not.toHaveAttribute(
      'aria-current',
    )

    await userEvent.click(section.getByRole('button', { name: /all properties/i }))
    expect(within(canvasElement).getByTestId('active-scope')).toHaveTextContent('all')
  },
}

// An agency or a group: the first seven by name, the rest on request, and the
// property in view always on screen.
export const ManyProperties: Story = {
  render: () => (
    <ScopedRailStory
      properties={portfolio}
      propertyCounts={portfolioCounts}
      initialPropertyId={portfolio[0].id}
    />
  ),
  play: async ({ canvasElement }) => {
    const section = properties(canvasElement)
    // All properties + seven by name + Vratsa (in view) + Show all.
    expect(section.getAllByRole('button')).toHaveLength(10)
    expect(section.getByRole('button', { name: /vratsa balkan hotel/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(section.queryByRole('button', { name: /sofia central/i })).toBeNull()

    const showAll = section.getByRole('button', { name: /show all 24/i })
    expect(showAll).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(showAll)
    expect(section.getByRole('button', { name: /sofia central/i })).toBeInTheDocument()
    expect(section.getByRole('button', { name: /show fewer/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

// A member works one property at a time: no organization-wide Inbox, so no All
// properties row — but moving between their properties is back inside the inbox.
export const MemberProperties: Story = {
  render: () => (
    <ScopedRailStory
      properties={hotels.slice(0, 2)}
      propertyCounts={{
        queue: 'open',
        total: 15,
        byProperty: { [hotels[0].id]: 9, [hotels[1].id]: 6 },
      }}
      includeAll={false}
      initialPropertyId={hotels[0].id}
      canManageReplies={false}
    />
  ),
  play: async ({ canvasElement }) => {
    const section = properties(canvasElement)
    expect(section.queryByRole('button', { name: /all properties/i })).toBeNull()
    expect(section.getAllByRole('button').map((row) => row.textContent)).toEqual([
      'Hotel Elegance9',
      'Rila Grand Hotel6',
    ])
  },
}

// A property with nothing in the queue shows no count, like a queue with no work.
export const EmptyPropertyCounts: Story = {
  render: () => (
    <ScopedRailStory
      properties={hotels}
      propertyCounts={{ queue: 'approval', total: 4, byProperty: { [hotels[0].id]: 4 } }}
    />
  ),
  play: async ({ canvasElement }) => {
    const section = properties(canvasElement)
    expect(
      section.getByRole('button', { name: /black sea residence/i }),
    ).toHaveTextContent(/^Black Sea Residence$/)
  },
}

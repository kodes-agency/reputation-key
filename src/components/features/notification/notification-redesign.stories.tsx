// DESIGN PROTOTYPE — story-only. Three directions for the bell and one for the
// /notifications page, built from the product's own tokens and copy renderer.
// See docs/design/notifications/README.md for the analysis they answer.

import { useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import {
  Bell,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Settings2,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { cn } from '#/lib/utils'
import type { NotificationView } from '#/contexts/feed/application/public-api'
import {
  makeNotification,
  type NotificationFixtureOverrides,
} from './notification.stories.fixtures'
import {
  byUrgency,
  groupByDate,
  needsYou,
  ProtoEntries,
  SectionLabel,
  stackEntries,
} from './notification-redesign.stories.parts'

// ── A realistic multi-property feed ─────────────────────────────────

const MIN = 60_000
const HOUR = 60 * MIN
const ago = (ms: number) => new Date(Date.now() - ms)
const RIVERSIDE = '33333333-3333-4333-8333-333333333333'
const HARBOUR = '66666666-6666-4666-8666-666666666666'
const PINE = '77777777-7777-4777-8777-777777777777'
const riverside = { propertyName: 'Riverside Hotel' }
const harbour = { propertyName: 'Harbour View Suites' }
const pine = { propertyName: 'Harbor & Pine' }
let seq = 0
const n = (o: Omit<NotificationFixtureOverrides, 'id'>) =>
  makeNotification({
    id: `20000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    ...o,
  })

const FEED: ReadonlyArray<NotificationView> = [
  n({
    type: 'review.created',
    propertyId: HARBOUR,
    payload: { ...harbour, platform: 'google' },
    createdAt: ago(7 * MIN),
  }),
  n({
    type: 'inbox.escalated',
    priority: 'urgent',
    propertyId: RIVERSIDE,
    payload: {
      ...riverside,
      platform: 'portal',
      guestRating: 2,
      waitedHours: 26,
      actorRole: 'property_manager',
    },
    createdAt: ago(12 * MIN),
  }),
  n({
    type: 'review.created',
    propertyId: HARBOUR,
    payload: { ...harbour, platform: 'google' },
    createdAt: ago(14 * MIN),
  }),
  n({
    type: 'reply.pending_approval',
    priority: 'urgent',
    propertyId: RIVERSIDE,
    payload: { ...riverside, waitedHours: 5 },
    coalescedCount: 3,
    coalescedLatestAt: ago(20 * MIN),
    createdAt: ago(3 * HOUR),
  }),
  n({
    type: 'review.created',
    propertyId: HARBOUR,
    payload: { ...harbour, platform: 'google' },
    createdAt: ago(21 * MIN),
  }),
  n({
    type: 'feedback.created',
    propertyId: HARBOUR,
    payload: { ...harbour, platform: 'portal', guestRating: 5 },
    createdAt: ago(58 * MIN),
  }),
  n({
    type: 'inbox.response_target_passed',
    priority: 'urgent',
    propertyId: PINE,
    payload: {
      ...pine,
      platform: 'google',
      waitedHours: 30,
      targetDueAt: ago(6 * HOUR).toISOString(),
    },
    createdAt: ago(2 * HOUR),
  }),
  n({
    type: 'integration.reauthorization_required',
    priority: 'urgent',
    propertyId: null,
    resourceType: 'integration',
    payload: { reauthorizationCause: 'provider_revoked' },
    createdAt: ago(3 * HOUR),
  }),
  n({
    type: 'inbox.assigned',
    propertyId: PINE,
    payload: { ...pine, platform: 'google' },
    createdAt: ago(4 * HOUR),
  }),
  n({
    type: 'reply.pending_approval',
    propertyId: HARBOUR,
    payload: { ...harbour },
    resolvedAt: ago(1 * HOUR),
    createdAt: ago(5 * HOUR),
  }),
  n({
    type: 'inbox_note.added',
    status: 'read',
    propertyId: RIVERSIDE,
    payload: { ...riverside, platform: 'google' },
    createdAt: ago(5 * HOUR),
  }),
  n({
    type: 'reply.published',
    status: 'read',
    propertyId: RIVERSIDE,
    payload: { ...riverside },
    resourceType: 'reply',
    createdAt: ago(6 * HOUR),
  }),
  n({
    type: 'reply.published',
    status: 'read',
    propertyId: RIVERSIDE,
    payload: { ...riverside },
    resourceType: 'reply',
    createdAt: ago(7 * HOUR),
  }),
  n({
    type: 'reply.rejected',
    propertyId: PINE,
    payload: {
      ...pine,
      moderationReason: 'Please do not mention the refund amount in public.',
      hasModerationReason: true,
    },
    resourceType: 'reply',
    createdAt: ago(20 * HOUR),
  }),
  n({
    type: 'property.review_import_finished',
    status: 'read',
    propertyId: PINE,
    resourceType: 'property',
    payload: {
      ...pine,
      importOutcome: 'completed',
      importedCount: 240,
      unansweredCount: 12,
    },
    createdAt: ago(30 * HOUR),
  }),
  n({
    type: 'goal.completed',
    status: 'read',
    propertyId: HARBOUR,
    resourceType: 'goal',
    payload: {
      ...harbour,
      goalName: 'Monthly ratings',
      goalMonth: '2026-09',
      goalSubjectKind: 'property',
      goalOutcome: 'met',
    },
    createdAt: ago(50 * HOUR),
  }),
  n({
    type: 'account.organization_role_changed',
    status: 'read',
    propertyId: null,
    resourceType: 'organization',
    payload: {},
    createdAt: ago(4 * 24 * HOUR),
  }),
]

const NEEDS_YOU = [...FEED].filter(needsYou).sort(byUrgency)
const UPDATES = FEED.filter((row) => !needsYou(row))
const UNREAD_COUNT = FEED.filter(
  (row) => row.status === 'unread' && row.resolvedAt === null,
).length

// ── Frames ──────────────────────────────────────────────────────────

function BellTrigger({ count }: Readonly<{ count: number }>) {
  return (
    <div className="flex justify-end pb-2">
      <span className="relative inline-flex size-8 items-center justify-center rounded-md">
        <Bell aria-hidden="true" className="size-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </span>
    </div>
  )
}

function PanelFrame({
  children,
  width = 'w-[min(26rem,calc(100vw-1rem))]',
}: Readonly<{ children: ReactNode; width?: string }>) {
  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className={cn(
        'flex max-h-[34rem] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground',
        width,
      )}
    >
      {children}
    </div>
  )
}

function PanelHeader({ right }: Readonly<{ right?: ReactNode }>) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5">
      <h2 className="text-sm font-semibold">Notifications</h2>
      <div className="flex items-center gap-1">{right}</div>
    </div>
  )
}

function PanelFooter() {
  return (
    <div className="flex shrink-0 items-center justify-between border-t px-2 py-1.5">
      <Button variant="ghost" size="sm" className="text-xs">
        Open notifications
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Notification preferences"
        className="text-muted-foreground"
      >
        <Settings2 aria-hidden="true" />
      </Button>
    </div>
  )
}

function OverflowButton() {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="More"
      className="text-muted-foreground"
    >
      <MoreHorizontal aria-hidden="true" />
    </Button>
  )
}

// ── Direction A: Refined list ───────────────────────────────────────
// Same information architecture as today; every row loses the clutter.

function DirectionA() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const rows =
    filter === 'all'
      ? FEED
      : FEED.filter((row) => row.status === 'unread' && row.resolvedAt === null)
  return (
    <div>
      <BellTrigger count={UNREAD_COUNT} />
      <PanelFrame>
        <PanelHeader
          right={
            <>
              <div
                role="group"
                aria-label="Show"
                className="flex rounded-md bg-muted p-0.5"
              >
                {(['all', 'unread'] as const).map((value) => (
                  <Button
                    key={value}
                    variant="ghost"
                    size="xs"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className="text-xs aria-pressed:bg-background aria-pressed:text-foreground"
                  >
                    {value === 'all' ? 'All' : 'Unread'}
                  </Button>
                ))}
              </div>
              <OverflowButton />
            </>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {groupByDate(rows).map((group) => (
            <section key={group.label}>
              <SectionLabel>{group.label}</SectionLabel>
              <ProtoEntries entries={group.rows.map((row) => ({ kind: 'row', row }))} />
            </section>
          ))}
        </div>
        <PanelFooter />
      </PanelFrame>
    </div>
  )
}

// ── Direction B: Needs you / Updates ────────────────────────────────
// The bell answers "what do I have to do?" before "what happened?".

function DirectionB({ updatesOpen = true }: Readonly<{ updatesOpen?: boolean }>) {
  const [open, setOpen] = useState(updatesOpen)
  const updates = stackEntries(UPDATES)
  return (
    <div>
      <BellTrigger count={NEEDS_YOU.length} />
      <PanelFrame>
        <PanelHeader
          right={
            <Button variant="ghost" size="xs" className="text-xs text-muted-foreground">
              <CheckCheck aria-hidden="true" className="size-3" />
              Mark all read
            </Button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          <section>
            <SectionLabel count={NEEDS_YOU.length}>Needs you</SectionLabel>
            <ProtoEntries entries={stackEntries(NEEDS_YOU)} />
          </section>
          <section className="mt-1 border-t">
            <SectionLabel
              action={
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-xs text-muted-foreground"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                >
                  {open ? (
                    <ChevronDown aria-hidden="true" />
                  ) : (
                    <ChevronRight aria-hidden="true" />
                  )}
                  {open ? 'Hide' : `Show ${updates.length}`}
                </Button>
              }
            >
              Updates
            </SectionLabel>
            {open && <ProtoEntries entries={updates.slice(0, 6)} dense />}
          </section>
        </div>
        <PanelFooter />
      </PanelFrame>
    </div>
  )
}

// ── Direction C: By property ────────────────────────────────────────
// For a manager of many properties: one block per property, rolled up.

function propertyBlocks(rows: ReadonlyArray<NotificationView>) {
  const blocks = new Map<string, { label: string; rows: NotificationView[] }>()
  for (const row of rows) {
    const key = row.propertyId ?? 'org'
    const label = row.payload.propertyName ?? 'Account and connections'
    const block = blocks.get(key) ?? { label, rows: [] }
    block.rows.push(row)
    blocks.set(key, block)
  }
  return [...blocks.entries()]
    .map(([key, block]) => ({
      key,
      ...block,
      waiting: block.rows.filter(needsYou).length,
    }))
    .sort((a, b) => (a.key === 'org' ? -1 : b.key === 'org' ? 1 : b.waiting - a.waiting))
}

function DirectionC() {
  const blocks = propertyBlocks(
    FEED.filter((row) => row.status === 'unread' || needsYou(row)),
  )
  return (
    <div>
      <BellTrigger count={NEEDS_YOU.length} />
      <PanelFrame>
        <PanelHeader right={<OverflowButton />} />
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {blocks.map((block) => (
            <section key={block.key} className="border-b last:border-b-0">
              <SectionLabel
                count={block.waiting > 0 ? block.waiting : undefined}
                action={
                  block.key !== 'org' && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-xs text-muted-foreground"
                    >
                      Open inbox
                    </Button>
                  )
                }
              >
                {block.label}
              </SectionLabel>
              <ProtoEntries
                entries={stackEntries([...block.rows].sort(byUrgency))}
                showProperty={false}
                dense
              />
            </section>
          ))}
        </div>
        <PanelFooter />
      </PanelFrame>
    </div>
  )
}

// ── Page (Direction B, wide) ────────────────────────────────────────

function PageB() {
  const [tab, setTab] = useState<'needs' | 'updates' | 'all'>('needs')
  const rows = tab === 'needs' ? NEEDS_YOU : tab === 'updates' ? UPDATES : FEED
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {NEEDS_YOU.length} things need you across 3 properties.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm">
            <CheckCheck aria-hidden="true" />
            Mark all read
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Preferences">
            <Settings2 aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="More">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </div>
      </header>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className="mt-6 gap-0"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
          <TabsList variant="line">
            <TabsTrigger value="needs" className="text-sm">
              Needs you{' '}
              <span className="ml-1 tabular-nums text-muted-foreground">
                {NEEDS_YOU.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="updates" className="text-sm">
              Updates
            </TabsTrigger>
            <TabsTrigger value="all" className="text-sm">
              All
            </TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" className="text-sm">
            All properties
            <ChevronDown aria-hidden="true" />
          </Button>
        </div>
        {(['needs', 'updates', 'all'] as const).map((value) => (
          <TabsContent key={value} value={value} className="mt-2">
            {value === 'needs' ? (
              <ProtoEntries entries={stackEntries(rows)} />
            ) : (
              groupByDate(rows).map((group) => (
                <section key={group.label}>
                  <SectionLabel>{group.label}</SectionLabel>
                  <ProtoEntries entries={stackEntries(group.rows)} />
                </section>
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>
    </main>
  )
}

function CaughtUp() {
  return (
    <div>
      <BellTrigger count={0} />
      <PanelFrame>
        <PanelHeader />
        <div className="flex flex-col items-center gap-1 px-6 py-8 text-center">
          <CheckCheck aria-hidden="true" className="size-5 text-positive" />
          <p className="text-sm font-medium">Nothing needs you</p>
          <p className="text-xs text-muted-foreground">
            New reviews, approvals and escalations will show here.
          </p>
        </div>
        <div className="border-t px-1 pb-1">
          <SectionLabel>Recent updates</SectionLabel>
          <ProtoEntries entries={stackEntries(UPDATES).slice(0, 3)} dense />
        </div>
        <PanelFooter />
      </PanelFrame>
    </div>
  )
}

const meta = {
  title: 'Design/Notification redesign',
  parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const A_RefinedList: Story = { render: () => <DirectionA /> }
export const B_NeedsYouAndUpdates: Story = { render: () => <DirectionB /> }
export const B_UpdatesCollapsed: Story = {
  render: () => <DirectionB updatesOpen={false} />,
}
export const B_CaughtUp: Story = { render: () => <CaughtUp /> }
export const C_ByProperty: Story = { render: () => <DirectionC /> }
export const B_Page: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <PageB />,
}
export const B_NeedsYouLight: Story = {
  parameters: { theme: 'light' },
  render: () => <DirectionB />,
}
export const B_Phone: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="p-2">
      <DirectionB />
    </div>
  ),
}

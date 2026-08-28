// Page-level story: composes the full InboxPageV2 three-panel layout against the
// in-memory container. The list + folder sidebar render with REAL use-case
// logic (getInboxItems + getInboxFolderCounts compute over seeded data); the
// detail-only fns are wired but only fire on item selection. Demonstrates the
// Phase-1 prop channel end-to-end: a route-shaped fn bundle, no server/RPC.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
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
import type {
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'
import { propertyId, replyId, reviewId, userId } from '#/shared/domain/ids'

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
  recordInboxVisit = true,
}: {
  ctx: InboxCtx
  properties?: ReadonlyArray<{ id: string; name: string }>
  inboxFns: InboxServerFns
  initialSearch?: InboxSearchParams
  recordInboxVisit?: boolean
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
      recordInboxVisit={recordInboxVisit}
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
      <div className="h-dvh min-h-[800px] w-full bg-background text-foreground">
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

const approvedProperties = [
  { id: String(inboxTestIds.PROP), name: 'Hotel Elegance' },
  {
    id: 'prop-00000000-0000-0000-0000-000000000002',
    name: 'Rila Grand Hotel',
  },
  {
    id: 'prop-00000000-0000-0000-0000-000000000003',
    name: 'Black Sea Residence',
  },
]

const APPROVED_ITEM_ID = '10000000-0000-4000-8000-000000000101'
const approvedItem: InboxItem = {
  ...makeInboxItem({
    id: APPROVED_ITEM_ID,
    sourceType: 'review',
    status: 'open',
    rating: 4,
  }),
  reviewerName: 'gezgin tekniker',
  propertyName: 'Hotel Elegance',
  sourceDate: new Date('2026-08-19T07:07:00Z'),
  snippet:
    'Bulgaristanda nadir olarak gorulen Konforlu bir mekan ve konaklamada sabah kahvaltisi dahil',
  contentAvailability: 'text',
  reviewLanguageCode: 'tr-TR',
  attention: 'low',
}

const approvedContainer = createInboxContainer()
approvedContainer.seed([
  {
    ...makeInboxItem({
      id: '10000000-0000-4000-8000-000000000102',
      sourceType: 'review',
      rating: 3,
    }),
    reviewerName: 'Тодор Василев',
    propertyName: 'Rila Grand Hotel',
    propertyId: propertyId(approvedProperties[1]!.id),
    sourceDate: new Date('2026-08-22T09:35:00Z'),
    snippet: null,
    contentAvailability: 'rating_only',
    reviewLanguageCode: 'bg-BG',
  },
  {
    ...makeInboxItem({
      id: '10000000-0000-4000-8000-000000000103',
      sourceType: 'review',
      rating: 5,
    }),
    reviewerName: 'Mumko Dzhunev',
    propertyName: 'Black Sea Residence',
    propertyId: propertyId(approvedProperties[2]!.id),
    sourceDate: new Date('2026-08-21T15:10:00Z'),
    snippet: null,
    contentAvailability: 'rating_only',
    reviewLanguageCode: 'bg-BG',
  },
  {
    ...makeInboxItem({
      id: '10000000-0000-4000-8000-000000000104',
      sourceType: 'review',
      rating: 5,
    }),
    reviewerName: 'Yozen Daud',
    propertyName: 'Hotel Elegance',
    sourceDate: new Date('2026-08-20T12:20:00Z'),
    snippet: 'Прекрасен хотел и качествено обслужване.',
    contentAvailability: 'text',
    reviewLanguageCode: 'bg-BG',
  },
  approvedItem,
])

const approvedDetail: InboxItemDetailResult = {
  item: approvedItem,
  reviewText: 'A comfortable place to stay, and breakfast was included.',
  reviewTranslatedText:
    'A comfortable place to stay, rarely seen in Bulgaria, and includes breakfast.',
  reviewerProfilePhotoUrl: null,
  reviewContentStatus: 'available',
  feedbackComment: null,
  feedbackRatingValue: null,
  propertyDefaultReplyLanguage: 'bg-Cyrl',
  reviewReplyLanguage: 'en-Latn-US',
  reply: {
    id: replyId('10000000-0000-4000-8000-000000000201'),
    reviewId: reviewId(String(approvedItem.sourceId)),
    organizationId: inboxTestIds.ORG,
    text: 'Благодарим Ви за чудесния отзив. Радваме се, че сте останали доволни от престоя и закуската. Ще се радваме да Ви посрещнем отново.',
    replyLanguageTag: 'bg-Cyrl',
    status: 'draft',
    source: 'internal',
    createdBy: userId('10000000-0000-4000-8000-000000000301'),
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: true,
    stateRevision: 1,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationCycle: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: new Date('2026-08-19T07:10:00Z'),
    updatedAt: new Date('2026-08-19T07:10:00Z'),
  },
  analysis: {
    status: 'ready',
    sentiment: 'positive',
    primaryCategory: 'service',
    attention: 'low',
    generatedAtEpochMillis: Date.parse('2026-08-19T07:08:00Z'),
  },
  feedbackHandling: null,
  responseTarget: null,
}

const approvedFns: InboxServerFns = {
  ...makeInboxFns(approvedContainer),
  getInboxItemDetail: (async () =>
    approvedDetail) as unknown as InboxServerFns['getInboxItemDetail'],
  generateReplySuggestion: (async ({
    data,
  }: Parameters<NonNullable<InboxServerFns['generateReplySuggestion']>>[0]) => {
    const useReviewLanguage = data.targetLanguage.kind === 'review_language'
    return {
      status: 'ready' as const,
      profileVersion: 'reply-draft-v2' as const,
      replyText: useReviewLanguage
        ? 'Thank you for your kind review. We are glad you enjoyed the stay and breakfast.'
        : approvedDetail.reply!.text,
      provenanceToken: 'storybook-signed-provenance',
      expiresAtEpochMillis: Date.now() + 60_000,
      baseReplyStateRevision: 1,
      concreteLanguageTag: useReviewLanguage ? 'en-Latn-US' : 'bg-Cyrl',
    }
  }) as unknown as NonNullable<InboxServerFns['generateReplySuggestion']>,
}

/** Approved middle + detail panel direction with multi-property, language, and AI states. */
export const ApprovedPanels: Story = {
  parameters: {
    theme: 'light',
  },
  render: () => (
    <InboxPageHarness
      ctx={orgCtx}
      properties={approvedProperties}
      inboxFns={approvedFns}
      initialSearch={{ itemId: APPROVED_ITEM_ID }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findAllByText('Hotel Elegance')).resolves.not.toHaveLength(0)
    await expect(canvas.findByText('Rila Grand Hotel')).resolves.toBeVisible()
    await expect(
      canvas.findByRole('textbox', { name: 'Public reply' }),
    ).resolves.toHaveValue(approvedDetail.reply!.text)
    const languageSelect = await canvas.findByRole('combobox', {
      name: 'Reply language',
    })
    await expect(languageSelect).toHaveTextContent(/^Bulgarian\s*·\s*Property default$/i)
    await userEvent.click(languageSelect)
    await expect(
      screen.findByRole('option', { name: /review language · english/i }),
    ).resolves.toBeVisible()
    await userEvent.keyboard('{Escape}')
    languageSelect.blur()
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

const visitContainer = createInboxContainer()
visitContainer.seed([
  makeInboxItem({ id: 'visit-1', sourceType: 'review', status: 'open', rating: 5 }),
])

export const SuccessfulLoadStampsVisit: Story = {
  render: () => (
    <InboxPageHarness
      ctx={orgCtx}
      properties={properties}
      inboxFns={makeInboxFns(visitContainer)}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: /Open review from Jane Doe/i })
    await waitFor(async () => {
      await expect(visitContainer.readLastInboxView()).resolves.not.toBeNull()
    })
  },
}

const failedVisitContainer = createInboxContainer()
const failedVisitFns: InboxServerFns = {
  ...makeInboxFns(failedVisitContainer),
  getInboxItems: (async () => {
    throw new Error('Inbox unavailable')
  }) as unknown as typeof getInboxItemsFn,
}

export const FailedLoadPreservesVisitWatermark: Story = {
  render: () => (
    <InboxPageHarness ctx={orgCtx} properties={properties} inboxFns={failedVisitFns} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Failed to load inbox. Try again.')
    await expect(failedVisitContainer.readLastInboxView()).resolves.toBeNull()
  },
}

const propertyVisitContainer = createInboxContainer()
propertyVisitContainer.seed([
  makeInboxItem({ id: 'property-visit-1', sourceType: 'review', status: 'open' }),
])

export const PropertyScopedLoadPreservesOrganizationWatermark: Story = {
  render: () => (
    <InboxPageHarness
      ctx={orgCtx}
      properties={properties}
      inboxFns={makeInboxFns(propertyVisitContainer)}
      initialSearch={{ propertyId: String(inboxTestIds.PROP) }}
      recordInboxVisit={false}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: /Open review from Jane Doe/i })
    await expect(propertyVisitContainer.readLastInboxView()).resolves.toBeNull()
  },
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Open folders' }))
    await expect(
      await screen.findByRole('combobox', { name: 'Filter by property' }),
    ).toBeVisible()
  },
}

// BQC-6.8 content robustness: 300-char reviewer name, emoji-dense snippet,
// and a missing reviewer name (null → Anonymous fallback) — truncation and
// line-clamping must hold with no layout break or horizontal overflow.
const longContentContainer = createInboxContainer()
longContentContainer.seed([
  {
    ...makeInboxItem({ id: 'long-1', sourceType: 'review', status: 'open', rating: 5 }),
    reviewerName:
      'Alexandria Konstantinopolous-Weathersby the Third of Upper Nether Wallop ' +
      'who wrote this review on behalf of her entire extended family reunion ' +
      'and wanted every single word of her very long name to be preserved ' +
      'for posterity in the hotel management dashboard record',
    snippet: 'Lovely stay! 🎉🏨✨ The staff were amazing 👏👏 and breakfast was 🥐☕',
  },
  {
    ...makeInboxItem({ id: 'long-2', sourceType: 'review', status: 'open', rating: 4 }),
    reviewerName: 'Emoji Guest 🧳🌍✈️',
    snippet:
      '🔥🔥🔥 HOT TAKE: great pool 🏊, terrible wifi 📵, incredible views 🌅, ' +
      'noisy corridors 🔇, would still return 💯',
  },
  {
    ...makeInboxItem({ id: 'long-3', sourceType: 'review', status: 'open', rating: 2 }),
    reviewerName: null,
    snippet: '',
  },
])

export const LongContent: Story = {
  render: () => (
    <InboxPageHarness
      ctx={orgCtx}
      properties={properties}
      inboxFns={makeInboxFns(longContentContainer)}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // All three rows render: truncated long name, emoji name, Anonymous fallback.
    // The list loads asynchronously via the real use-case → findAllByRole waits
    // (same pattern as the Default story).
    const rows = await canvas.findAllByRole(
      'button',
      { name: /open review from/i },
      { timeout: 10_000 },
    )
    const names = rows.map((r) => r.getAttribute('aria-label') ?? '')
    expect(names.length, `row aria-labels: ${JSON.stringify(names)}`).toBe(3)
    expect(rows.some((r) => r.getAttribute('aria-label')?.includes('Emoji Guest'))).toBe(
      true,
    )
    expect(rows.some((r) => r.getAttribute('aria-label')?.includes('Anonymous'))).toBe(
      true,
    )
    // Visual truncation is browser-smoke-tested: the Vitest Storybook canvas
    // does not load Tailwind geometry, so scroll and computed-style values are
    // not meaningful here. The following assertion still detects a horizontal
    // overflow when the canvas exposes dimensions.
    if (canvasElement.clientWidth > 0) {
      expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
    }
  },
}

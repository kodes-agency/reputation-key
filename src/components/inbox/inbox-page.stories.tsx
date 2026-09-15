// Page-level story: composes the full InboxPageV2 three-panel layout against the
// in-memory container. The list + folder sidebar render with REAL use-case
// logic (getInboxItems + getInboxQueueCounts compute over seeded data); the
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
  inboxFns,
  initialSearch = {},
  recordInboxVisit = true,
}: {
  ctx: InboxCtx
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
      onNavigate={onNavigate}
      inboxFns={inboxFns}
      recordInboxVisit={recordInboxVisit}
      scopeLabel={initialSearch.propertyId ? 'Hotel Elegance' : 'All properties'}
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
  render: () => <InboxPageHarness ctx={orgCtx} inboxFns={makeInboxFns(container)} />,
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
  // Plan row 7: the stars come from the detail payload, not the item row —
  // the projection NULLs a review row's own copy (`inbox-command-store.ts:936`).
  reviewRating: 4,
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
    templateId: null,
    templateVersion: null,
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
    aspects: [{ aspect: 'service', polarity: 'positive', intensity: 76 }],
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
      inboxFns={approvedFns}
      initialSearch={{ itemId: APPROVED_ITEM_ID }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findAllByText('Hotel Elegance')).resolves.not.toHaveLength(0)
    await expect(
      canvas.findByRole('textbox', { name: 'Public reply' }),
    ).resolves.toHaveValue(approvedDetail.reply!.text)
    // Plan v2.1 row 17: the language is a group inside `Draft with AI ▾`, not
    // a combobox. Opened, because the language moving is the thing to prove.
    const chevron = await canvas.findByRole('button', { name: /^AI tone and language/ })
    await userEvent.click(chevron)
    // findBy resolves the moment the item EXISTS, which is while the menu
    // content is still animating in from opacity 0 — assert visibility with a
    // retry rather than on whichever frame the machine happened to be on.
    const writeIn = await screen.findByRole('group', { name: 'Write in' })
    const bulgarian = within(writeIn).getByRole('menuitem', {
      name: 'Bulgarian · property default',
    })
    await expect(bulgarian).toHaveAttribute('aria-current', 'true')
    const englishItem = within(writeIn).getByRole('menuitem', {
      name: 'English · review language',
    })
    await waitFor(() => expect(englishItem).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    chevron.blur()
  },
}

const scopedFns = makeInboxFns(approvedContainer)

// Properties are the inbox's second axis: under the queues, All properties and
// each property, counted for the queue in view by the real use case. Choosing a
// property narrows the list and the queue counts; the property counts stay.
function PropertyScopeHarness() {
  const [search, setSearch] = useState<InboxSearchParams>({})
  const onNavigate: InboxPageNav = (o) =>
    setSearch((prev) => ({ ...prev, ...o.search(prev) }))
  const activePropertyId = search.propertyId ?? null
  return (
    <InboxPageV2
      ctx={orgCtx}
      search={search}
      onNavigate={onNavigate}
      inboxFns={scopedFns}
      scopeLabel={
        approvedProperties.find((property) => property.id === activePropertyId)?.name ??
        'All properties'
      }
      propertyScope={{
        properties: approvedProperties,
        activePropertyId,
        includeAll: true,
        // The route moves between /inbox and /properties/$id/reviews; the
        // harness keeps the same contract in search state.
        onSelect: (propertyId) =>
          setSearch(({ itemId: _item, propertyId: _scope, ...rest }) =>
            propertyId ? { ...rest, propertyId } : rest,
          ),
      }}
    />
  )
}

export const PropertyScope: Story = {
  render: () => <PropertyScopeHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const section = within(await canvas.findByRole('navigation', { name: 'Properties' }))
    // Needs reply 4 = Black Sea 1 + Hotel Elegance 2 + Rila 1.
    await waitFor(() =>
      expect(section.getAllByRole('button').map((row) => row.textContent)).toEqual([
        'All properties4',
        'Black Sea Residence1',
        'Hotel Elegance2',
        'Rila Grand Hotel1',
      ]),
    )

    await userEvent.click(section.getByRole('button', { name: /hotel elegance/i }))
    await waitFor(() =>
      expect(section.getByRole('button', { name: /hotel elegance/i })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    )
    await waitFor(() =>
      expect(canvas.getAllByRole('button', { name: /^Open review from/i })).toHaveLength(
        2,
      ),
    )
    await expect(
      section.getByRole('button', { name: /all properties/i }),
    ).toHaveTextContent('All properties4')
  },
}

// Open the "escalated" folder — the list refilters via the real use-case.
export const EscalatedFolder: Story = {
  render: () => (
    <InboxPageHarness
      ctx={orgCtx}
      inboxFns={makeInboxFns(container)}
      initialSearch={{ queue: 'escalated' }}
    />
  ),
}

// No active organization → the page renders its NoOrg empty state.
export const NoOrg: Story = {
  render: () => (
    <InboxPageHarness
      ctx={{ activeOrganization: null }}
      inboxFns={makeInboxFns(container)}
    />
  ),
}

// Empty list → the queue-specific empty state.
export const EmptyList: Story = {
  render: () => <InboxPageHarness ctx={orgCtx} inboxFns={makeInboxFns(emptyContainer)} />,
}

const visitContainer = createInboxContainer()
visitContainer.seed([
  makeInboxItem({ id: 'visit-1', sourceType: 'review', status: 'open', rating: 5 }),
])

export const SuccessfulLoadStampsVisit: Story = {
  render: () => <InboxPageHarness ctx={orgCtx} inboxFns={makeInboxFns(visitContainer)} />,
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
  render: () => <InboxPageHarness ctx={orgCtx} inboxFns={failedVisitFns} />,
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
  render: () => <InboxPageHarness ctx={orgCtx} inboxFns={loadingFns} />,
}

// Mobile viewport (390×844): list + queue strip + detail sheet.
//
// This story used to install a `pinMobileBreakpoint` helper, under a comment
// saying `parameters.viewport` "only resizes the preview iframe from the
// Storybook manager" and that the runner "never sees a narrow window". That was
// the widely-copied source of the claim in this folder, and it is no longer
// true: `@storybook/addon-vitest@10.6` awaits `page.viewport(w, h)` before
// every composed story (`dist/vitest-plugin/test-utils.js:51-71, 120`).
// Measured in this runner on 2026-09-12 — `mobileStaff` is a real 390×844
// window and `matchMedia('(max-width: 767px)')` matches in it; a story with no
// viewport parameter is reset to 1200×900, so widths do not leak between
// stories either. `useIsMobile` is therefore the real query answering, and the
// patch is deleted rather than left standing: a stub that always returns true
// would keep this story green even if the layout stopped consulting the hook.
// The full measurement is written up in `inbox-mobile-390.stories.tsx`.
export const MobileViewport: Story = {
  render: () => <InboxPageHarness ctx={orgCtx} inboxFns={makeInboxFns(container)} />,
  parameters: {
    viewport: { defaultViewport: 'mobileStaff' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const queues = await canvas.findByRole('navigation', { name: 'Queues' })
    await expect(within(queues).findByText(/needs reply/i)).resolves.toBeVisible()
    await expect(
      canvas.findByRole('button', { name: 'Select items' }),
    ).resolves.toBeVisible()
  },
}

// The desktop workspace needs 48 px app rail + 224 px queue rail + 320 px list,
// a 6 px separator, and 480 px detail. Until that 1078 px floor, use the
// strip/sheet composition.
export const TabletViewport: Story = {
  render: () => <InboxPageHarness ctx={orgCtx} inboxFns={makeInboxFns(container)} />,
  parameters: {
    viewport: { defaultViewport: 'tablet' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.findByRole('button', { name: 'Select items' }),
    ).resolves.toBeVisible()
    expect(canvasElement.querySelector('[data-inbox-queue-rail]')).toBeNull()
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
    <InboxPageHarness ctx={orgCtx} inboxFns={makeInboxFns(longContentContainer)} />
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

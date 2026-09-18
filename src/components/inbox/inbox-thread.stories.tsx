// Inbox thread — the single conversation inside the detail pane's scroller,
// drawn as ONE rail (plan v2.1 rows 9–13): the guest's review is node zero, and
// every handling event, internal note and the reply hang off the same connector
// below it, in the order they happened. History arrives from its own query, so
// the thread also owns that query's pending, failed and truncated states.
//
// These stories are the gate for the rules a later change would break in
// silence rather than in red: the guest leads even when a backfilled history
// row predates the source date; the rail's children are nodes and nothing else,
// with the query's status lines below it; a `legacy` row names no actor; an
// ABSENT `internalNote` key is not an empty one; an unresolved assignee is
// neither a raw id nor an invention; a row this bundle cannot put into words
// draws no node and does not count towards the fold; a long history folds into
// one toggle that keeps its focus when it opens; truncation says so exactly
// once; the guest's star rating comes from the DETAIL payload and never from the
// item row (plan row 7); and the guest's own words lead unless the review is
// PROVABLY foreign to the property's reply language, with the other text always
// one disclosure away (plan row 8, amended).
//
// The Vitest Storybook project compiles no Tailwind, so every utility class is
// inert here. Nothing below asserts geometry or a class — only content, roles,
// accessible names, `aria-hidden`, the primitive's `data-slot` structure,
// document order and behaviour, which are real in this runner. The rail's
// pixels (the 32 px column, the 2 px connector, the absent tail under the last
// node) were measured in a real browser against `pnpm storybook`. Every rail
// story has a 390 px twin (`…Phone`), which sets the story's own width and the
// `mobileStaff` viewport so `max-md:` applies where Tailwind does compile.
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import { InboxThread, entryKey } from './inbox-thread'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import type { getInboxItemHistoryFn } from '#/contexts/inbox/server/inbox'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNote,
  InboxNoteView,
  InboxReviewAnalysis,
} from '#/contexts/inbox/application/public-api'
import type { ReplyPublicationCheckResult } from '#/contexts/review/application/public-api'
import type {
  InboxHistoryEntry,
  LedgerEntry,
  ReplyEntityView,
  ReplyView,
  ThreadEntry,
} from './inbox-thread-model'
import type { ComponentProps, ReactNode } from 'react'

type HistoryDetail = InboxHistoryEntry['detail']
/** The opaque Better Auth id, spelled through the entry so no brand is faked. */
type HistoryUserId = NonNullable<InboxHistoryEntry['actorUserId']>

// Every id here shares the `user-` prefix on purpose: one assertion
// (`not.toContain('user-')`) then covers every place a raw id could leak —
// an actor, an assignee, a note author.
const ADA_ID = 'user-ada-1111' as HistoryUserId
const GRACE_ID = 'user-grace-2222' as HistoryUserId
const FORMER_MEMBER_ID = 'user-departed-3333' as HistoryUserId
const CURRENT_USER_ID = 'user-current-4444'

const SOURCE_DATE = new Date('2026-03-01T09:00:00Z')

const REVIEW_TEXT = 'Wonderful stay — the front desk went above and beyond!'
// Google returns its machine translation and the guest's original words in one
// field; ingestion splits them, so `reviewText` is always the original.
const BG_ORIGINAL = 'Хотелът беше чист и уютен, а закуската беше много вкусна.'
const EN_TRANSLATION = 'The hotel was clean and cosy, and the breakfast was very tasty.'
const TR_ORIGINAL = 'Harika bir konaklama oldu, tekrar geleceğiz.'
// ENGLISH, like `EN_TRANSLATION`: Google translates into the reader locale at
// fetch time (`google-review-api.adapter.ts:454-457`), never into the
// property's reply language. A Turkish-into-Bulgarian fixture stood here and
// asserted a provider behaviour the ingest path cannot produce.
const TR_INTO_EN = 'It was a great stay, we will come again.'
const FEEDBACK_COMMENT = 'The shower in room 402 ran cold for two mornings.'
const INTERNAL_NOTE = 'Called the guest; they accepted a partial refund.'

/**
 * The language this property's managers reply in, spelled the only way the
 * comparison can use: `parseCanonicalReplyLanguageTag` wants a 7-character
 * `<lang>-<Script>` group (`reply-language-catalogue.ts:81-96`), and
 * `get-inbox-item-detail.ts:178-182` drops a configured value that does not
 * parse, so `propertyDefaultReplyLanguage` is canonical or null and never a
 * raw `bg-BG`.
 */
const BG_DEFAULT = 'bg-Cyrl'

/**
 * The property the reply speaks for. Two words on purpose: the reply's disc
 * draws ONE initial (`H`), and a two-word name is what tells that apart from a
 * person's two (`HE`).
 */
const PROPERTY_NAME = 'Hotel Elegance'

const reviewItem: InboxItem = {
  ...makeInboxItem({ id: 'thread-review', sourceType: 'review' }),
  sourceDate: SOURCE_DATE,
  propertyName: PROPERTY_NAME,
  // What the detail read really returns: `inboxItemFromRow` sets `rating: null`
  // on every row (`inbox.mapper.ts:37`), `findDetailById` never writes it
  // back, and that item is the pane's `item` (`use-inbox-detail.ts:232`), so
  // the pane never sees a number here.
  //
  // The fixture said 4, which is why finding 2 — "the rating never reaches the
  // pane" — could not be seen from these stories: with a number on the item,
  // a pane reading `item.rating` at all draws stars whether or not the detail
  // payload carries the field, and every rating assertion below would pass
  // against a data path that was severed.
  rating: null,
}

const feedbackItem: InboxItem = {
  ...makeInboxItem({ id: 'thread-feedback', sourceType: 'feedback' }),
  sourceDate: SOURCE_DATE,
  // What the detail read really returns, for feedback exactly as for reviews:
  // `inboxItemFromRow` sets `rating: null` on every row (`inbox.mapper.ts:37`)
  // and `findDetailById` never writes it back. A 2 here was the one remaining
  // fixture that could hide a pane reading `item.rating` — the story would draw
  // `2.0` from the row whether or not `feedbackRatingValue` was read at all.
  rating: null,
  // Private feedback carries no submitter name, and the fleet default would be
  // one — clearing it is what the real detail read returns.
  reviewerName: null,
}

const reviewDetail: InboxItemDetailResult = {
  item: reviewItem,
  reviewText: REVIEW_TEXT,
  reviewTranslatedText: null,
  reviewerProfilePhotoUrl: null,
  reviewContentStatus: 'available',
  /**
   * Plan row 7. The rating arrives on the detail payload, carried from the same
   * `ReviewSnippet` as `reviewText` and governed by the same eligibility rule.
   * 5 against the item's `rating: null` above, so a story that sees `5.0` saw a
   * number that could only have come from here.
   */
  reviewRating: 5,
  feedbackComment: null,
  feedbackRatingValue: null,
  reply: null,
  analysis: null,
  /**
   * Both language fields start at "nothing is known", which is a real state —
   * a property with no reply language set, and a review Google served no
   * language code for. Every story that exercises plan row 8 names its own.
   */
  propertyDefaultReplyLanguage: null,
  reviewReplyLanguage: null,
  feedbackHandling: null,
  responseTarget: null,
}

const feedbackDetail: InboxItemDetailResult = {
  ...reviewDetail,
  item: feedbackItem,
  reviewText: null,
  reviewContentStatus: null,
  // Feedback's number is `feedbackRatingValue`; `reviewRating` is a review's
  // and is null here, which is what `findDetailById`'s feedback branch returns.
  // Keeping them apart means a consumer that reads one field for both sources
  // cannot print a review's score on feedback or the reverse.
  reviewRating: null,
  feedbackComment: FEEDBACK_COMMENT,
  feedbackRatingValue: 2,
  feedbackHandling: {
    cycleNumber: 1,
    sourceRevision: 1,
    stateRevision: 1,
    status: 'open',
    closeReason: null,
    currentOutcome: null,
    history: [],
  },
}

// ─── fixtures ────────────────────────────────────────────────────────────────

/**
 * One Handling History row. The defaults are the common case — a cycle-1 row
 * an identified manager wrote — so each fixture below states only what its own
 * rule depends on.
 */
function historyEvent(
  at: string,
  detail: HistoryDetail,
  overrides: Partial<InboxHistoryEntry> = {},
): InboxHistoryEntry {
  return {
    id: `hist-${detail.kind}-${at}`,
    inboxItemId: reviewItem.id,
    kind: detail.kind,
    occurredAt: new Date(at),
    cycleNumber: 1,
    stateRevision: 1,
    actorUserId: ADA_ID,
    actorDisplayName: 'Ada Lovelace',
    legacy: false,
    detail,
    ...overrides,
  }
}

/** A cycle opening the provider caused: no manager acted, so there is no actor. */
const SYSTEM_ACTOR: Partial<InboxHistoryEntry> = {
  actorUserId: null,
  actorDisplayName: null,
}

const openedFromGoogle: HistoryDetail = {
  kind: 'cycle_opened',
  openedReason: 'review_observed',
  manualReopenReason: null,
  manualReopenExplanation: null,
  supersedesCycleNumber: null,
  sourceRevision: 1,
}

function note(
  id: string,
  at: string,
  text: string,
  author: Readonly<{ userId: string; displayName: string | null }>,
): InboxNoteView {
  return {
    id: id as InboxNote['id'],
    inboxItemId: reviewItem.id,
    organizationId: 'org-1' as InboxNote['organizationId'],
    userId: author.userId as InboxNote['userId'],
    displayName: author.displayName,
    text,
    createdAt: new Date(at),
  }
}

function historyFn(
  entries: readonly InboxHistoryEntry[],
  truncated = false,
): typeof getInboxItemHistoryFn {
  return mockServerFn(async ({ data }: Parameters<typeof getInboxItemHistoryFn>[0]) => ({
    inboxItemId: data.inboxItemId,
    entries,
    truncated,
  })) as unknown as typeof getInboxItemHistoryFn
}

const noHistory = historyFn([])

/** A manager's row, written by someone other than the default actor. */
const BY_GRACE: Partial<InboxHistoryEntry> = {
  actorUserId: GRACE_ID,
  actorDisplayName: 'Grace Hopper',
}

function assignment(
  at: string,
  next: Readonly<{ id: HistoryUserId; name: string | null }> | null,
  overrides: Partial<InboxHistoryEntry> = {},
): InboxHistoryEntry {
  return historyEvent(
    at,
    {
      kind: 'assignment',
      reason: next ? 'assign' : 'release',
      previousAssignee: null,
      nextAssignee: next?.id ?? null,
      previousAssigneeDisplayName: null,
      nextAssigneeDisplayName: next?.name ?? null,
      bulkId: null,
    },
    overrides,
  )
}

function escalation(
  at: string,
  state: 'escalated' | 'resolved',
  overrides: Partial<InboxHistoryEntry> = {},
): InboxHistoryEntry {
  return historyEvent(at, { kind: 'escalation', escalation: state }, overrides)
}

/** A close a manager performed — the only close whose line names a person. */
function closedByUser(at: string): InboxHistoryEntry {
  return historyEvent(at, {
    kind: 'cycle_transition',
    transition: 'closed',
    transitionReason: 'confirmed_on_google',
    actorType: 'user',
  })
}

function openedByGoogle(at: string): InboxHistoryEntry {
  return historyEvent(at, openedFromGoogle, { ...SYSTEM_ACTOR, stateRevision: null })
}

// ─── the reply ───────────────────────────────────────────────────────────────

const REPLY_TEXT = 'Thank you for the kind words — we will pass them to the front desk.'
const REJECTION_REASON = 'Please mention the late checkout we offered.'
const REPLY_SUBMITTED_AT = new Date('2026-03-01T15:00:00Z')
const REPLY_APPROVED_AT = new Date('2026-03-01T15:10:00Z')
const REPLY_PUBLISHED_AT = new Date('2026-03-01T15:20:00Z')
const REPLY_REJECTED_AT = new Date('2026-03-01T15:30:00Z')

/**
 * The reply as `getInboxItemDetail` attaches it. The ids carry the `user-`
 * prefix where the payload carries a person, so `expectsNoRawIds` also proves
 * the reply's node prints no `createdBy` / `approvedBy` / `rejectedBy`.
 */
function reply(overrides: Partial<ReplyEntityView> = {}): ReplyEntityView {
  return {
    id: replyId('reply-thread-1'),
    reviewId: reviewId('thread-review'),
    organizationId: organizationId('org-1'),
    text: REPLY_TEXT,
    replyLanguageTag: 'en-Latn',
    templateId: null,
    templateVersion: null,
    status: 'pending_approval',
    source: 'internal',
    createdBy: userId(ADA_ID),
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: REPLY_SUBMITTED_AT,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationCycle: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: REPLY_SUBMITTED_AT,
    updatedAt: REPLY_SUBMITTED_AT,
    ...overrides,
  }
}

const approvedReply = (overrides: Partial<ReplyEntityView> = {}): ReplyEntityView =>
  reply({
    status: 'approved',
    approvedBy: userId(GRACE_ID),
    approvedAt: REPLY_APPROVED_AT,
    ...overrides,
  })

/** One fixture per chip `presentReplyMessage` can print (`reply-state-copy.ts`). */
const REPLIES = {
  awaitingApproval: reply(),
  waitingForGoogle: approvedReply(),
  liveOnGoogle: approvedReply({
    status: 'published',
    publishedAt: REPLY_PUBLISHED_AT,
    publicationState: 'published',
  }),
  needsCheck: approvedReply({
    status: 'publish_failed',
    publicationState: 'ambiguous',
    publicationLastErrorClass: 'ambiguous',
    publicationAttempts: 1,
  }),
  notPublished: approvedReply({
    status: 'publish_failed',
    publicationState: 'terminal',
    publicationLastErrorClass: 'retryable',
    publicationAttempts: 5,
  }),
  rejected: reply({
    status: 'rejected',
    rejectedBy: userId(GRACE_ID),
    rejectionReason: REJECTION_REASON,
    updatedAt: REPLY_REJECTED_AT,
  }),
  draft: reply({ status: 'draft', submittedAt: null }),
} as const satisfies Record<string, ReplyView>

const replyActions = {
  isSaving: false,
  isEditing: false,
  onApprove: fn(async () => undefined),
  onReject: fn(async (_reason?: string) => undefined),
  // A check that finds nothing: the thread's stories pin the rail, and the
  // check's outcomes are gated in `reply-message.stories.tsx`.
  onCheck: fn(async (): Promise<ReplyPublicationCheckResult> => ({
    reply: REPLIES.needsCheck,
    outcome: 'not_on_google',
    checkedAt: REPLY_APPROVED_AT,
    nextAutomaticCheckAt: null,
  })),
  onRetry: fn(async () => undefined),
  onEditPublished: fn(() => {}),
  onEditRejected: fn(() => {}),
} satisfies ComponentProps<typeof InboxThread>['replyActions']

// ─── widths ──────────────────────────────────────────────────────────────────

/** The desktop pane's share of a 1440 px split, and the plan's canvas width. */
const PANE_WIDTH_PX = 720
/** The staff phone the sheet is designed at (plan row 20). */
const PHONE_WIDTH_PX = 390

/**
 * The 390 px twin's parameters, as `inbox-case-toolbar.stories.tsx` spells
 * them. `paneWidth` is read by the meta decorator; `viewport` is what makes
 * `max-md:` apply in `pnpm storybook`. The viewport parameter resizes nothing
 * in the Vitest runner (`inbox-page.stories.tsx:439`), which is why the width is
 * also the story's own.
 */
const PHONE = {
  paneWidth: PHONE_WIDTH_PX,
  viewport: { defaultViewport: 'mobileStaff' },
} as const

/** A story's 390 px twin: the same args and play, at the phone's width. */
function onPhone(story: Story): Story {
  return { ...story, parameters: { ...story.parameters, ...PHONE } }
}

// ─── assertion helpers ───────────────────────────────────────────────────────

type Canvas = ReturnType<typeof within>

/**
 * The fold node's polite status region, found from its toggle: the two share
 * the node's content column (`EarlierEventsNode`).
 */
function foldStatus(toggle: HTMLElement): HTMLElement {
  const region = toggle
    .closest('[data-slot="timeline-content"]')
    ?.querySelector<HTMLElement>('[role="status"]')
  if (!region) throw new Error('expected a status region beside the fold toggle')
  return region
}

/**
 * Reading order, which is the only order the thread promises. Geometry is
 * unavailable in this runner and would be the wrong proof anyway: a screen
 * reader follows the DOM.
 */
function comesBefore(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

/** Text as a reader meets it, with the markup's line breaks collapsed. */
function normalised(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Finds an event's sentence line by what a reader SEES. Plan row 11 builds the
 * sentence from parts — the actor and the object in their own weighted spans,
 * the verb in another — so no single element owns `Ada Lovelace assigned this
 * to Grace Hopper` and a plain `getByText` finds nothing. This matches the
 * paragraph whose whole text starts with the sentence and then the ` · `
 * separator before the time, so `Escalated` cannot match `Escalation resolved`
 * and a sentence can never match the front of a longer one.
 */
function sentence(words: string) {
  return (_content: string, element: Element | null): boolean =>
    element?.tagName === 'P' && normalised(element.textContent).startsWith(`${words} · `)
}

/**
 * The lines of one history node, found by its sentence: `[0]` is the sentence
 * and its time; a manager's free text, when the row carries any, is `[1]`.
 * Counting them is how a story sees "no note" — an absent `internalNote` leaves
 * no text to search for, so only the missing line proves it stayed absent.
 */
function eventLines(canvas: Canvas, words: string): readonly string[] {
  const content = canvas
    .getByText(sentence(words))
    .closest('[data-slot="timeline-content"]')
  return [...(content?.querySelectorAll('p') ?? [])].map((line) =>
    normalised(line.textContent),
  )
}

/** The thread must never print an opaque id, in any row, for any reason. */
function expectsNoRawIds(canvasElement: HTMLElement): void {
  expect(canvasElement.textContent ?? '').not.toContain('user-')
}

/**
 * The rating as a screen reader hears it, which is the only place it fully
 * exists: `StarRating` draws `aria-hidden` glyphs, prints the number, and
 * follows it with a visually hidden `out of 5 stars`, so the sentence is the
 * wrapper's text content and DOM order — there is no role and no accessible
 * name to query. (The deleted `RatingStars` was a `role="img"` carrying an
 * `aria-label`; nothing may assert that shape any more.)
 *
 * `printed` is what a sighted reader sees, so a story states one string and
 * gets both halves checked: `expectRating(canvas, '5.0')` fails if the digits
 * change, if the unit changes, or if the two swap places.
 */
function expectRating(canvas: Canvas, printed: string): void {
  const unit = canvas.getByText('out of 5 stars')
  const rating = unit.closest('[data-slot="star-rating"]')
  expect(rating?.textContent).toBe(`${printed}out of 5 stars`)
}

/** No stars at all — not an empty row of them, not a `0.0`. */
function expectNoRating(canvas: Canvas): void {
  expect(canvas.queryByText('out of 5 stars')).toBeNull()
}

/**
 * The disclosure half of plan row 8, asserted identically wherever there is
 * one. What must survive is the `<details>` mechanism itself: v1 chose it over
 * a Radix `Collapsible` because it leaves the folded text in the DOM while
 * closed, and the half that can be hidden is sometimes the guest's own words,
 * which find-in-page has to reach.
 *
 * Two review findings are pinned here too. The summary's name is re-read AFTER
 * the click: it is a noun phrase precisely so it stays true when the text is
 * open, and an action label (`Show original`) would still say "show" over
 * visible text. And `lang` is asserted on the folded paragraph — `null` means
 * the attribute must be ABSENT, which is the answer for Google's translation,
 * whose language nothing records.
 */
async function expectDisclosureOpens(
  canvas: Canvas,
  label: string,
  text: string,
  lang: string | null,
): Promise<void> {
  const summary = canvas.getByText(label)
  const disclosure = summary.closest('details')
  await expect(disclosure).not.toHaveAttribute('open')
  await expect(canvas.getByText(text)).not.toBeVisible()
  expectLang(canvas.getByText(text), lang)

  await userEvent.click(summary)
  await expect(disclosure).toHaveAttribute('open')
  await expect(canvas.getByText(text)).toBeVisible()
  await expect(disclosure?.querySelector('summary')).toHaveTextContent(label)
}

/**
 * WCAG 3.1.2 on one paragraph: the tag the rule vouched for, or no attribute at
 * all — never an empty `lang=""`, which would declare the text language-less.
 */
function expectLang(paragraph: HTMLElement, lang: string | null): void {
  if (lang === null) {
    expect(paragraph).not.toHaveAttribute('lang')
    return
  }
  expect(paragraph).toHaveAttribute('lang', lang)
}

// ─── the rail ────────────────────────────────────────────────────────────────
//
// Structure is asserted through the primitive's `data-slot` attributes and
// `aria-hidden`, never through a class: the attributes are set by
// `ui/timeline.tsx` itself and exist in this runner, where every class is
// inert.

/** The thread's one rail. There must be exactly one. */
function railOf(canvasElement: HTMLElement): HTMLElement {
  const rails = canvasElement.querySelectorAll<HTMLElement>('[data-slot="timeline"]')
  expect(rails).toHaveLength(1)
  return rails[0]
}

/** The rail's nodes, in reading order. */
function railNodes(canvasElement: HTMLElement): readonly HTMLElement[] {
  return [...railOf(canvasElement).children] as HTMLElement[]
}

/** The node an element sits in. */
function nodeOf(element: Element): HTMLElement {
  const node = element.closest<HTMLElement>('[data-slot="timeline-item"]')
  if (!node) throw new Error('element is not on the rail')
  return node
}

/** What a node's disc shows — initials, or nothing for a glyph or a photo. */
function discText(node: HTMLElement): string {
  return normalised(
    node.querySelector(':scope > [data-slot="timeline-indicator"]')?.textContent,
  )
}

/**
 * The rail as a reader walks it, one string per node: a message by its
 * article's accessible name, the fold by its button's name, an event by its
 * sentence (the line up to the time). One `toEqual` then pins the node count,
 * the order, the fold's placement and every sentence's wording at once.
 */
function railReading(canvasElement: HTMLElement): readonly string[] {
  return railNodes(canvasElement).map((node) => {
    const article = node.querySelector('article')
    if (article) return article.getAttribute('aria-label') ?? ''
    const button = node.querySelector('button')
    if (button) return normalised(button.textContent)
    return normalised(node.querySelector('p')?.textContent).split(' · ')[0]
  })
}

/**
 * The rail's contract with its children (`ui/timeline.tsx`), on a rendered
 * thread:
 *
 * - every child of the rail is a node — no status line inside it, which would
 *   make the last real node not `:last-child` and leave its connector hanging;
 * - every node has exactly one disc and one connector, both hidden from
 *   assistive tech, and nothing focusable in the disc (`aria-hidden-focus` is
 *   off globally, so axe would not say so);
 * - no node is empty — a draft reply or an unsayable row draws no disc.
 */
function expectWellFormedRail(canvasElement: HTMLElement): void {
  for (const node of railNodes(canvasElement)) {
    expect(node).toHaveAttribute('data-slot', 'timeline-item')
    const discs = node.querySelectorAll(':scope > [data-slot="timeline-indicator"]')
    const connectors = node.querySelectorAll(':scope > [data-slot="timeline-connector"]')
    expect(discs).toHaveLength(1)
    expect(connectors).toHaveLength(1)
    expect(discs[0]).toHaveAttribute('aria-hidden', 'true')
    expect(connectors[0]).toHaveAttribute('aria-hidden', 'true')
    expect(discs[0].querySelector('button, a, input, [tabindex]')).toBeNull()
    const content = node.querySelector(':scope > [data-slot="timeline-content"]')
    expect(normalised(content?.textContent)).not.toBe('')
  }
}

/** The history query's own lines sit under the rail, never on it. */
function expectBelowTheRail(canvasElement: HTMLElement, line: HTMLElement): void {
  const rail = railOf(canvasElement)
  expect(rail.contains(line)).toBe(false)
  expect(comesBefore(rail, line)).toBe(true)
}

// ─── meta ────────────────────────────────────────────────────────────────────

const meta: Meta<typeof InboxThread> = {
  title: 'Inbox/Thread',
  component: InboxThread,
  tags: ['autodocs'],
  decorators: [
    // The width is the story's own, as an inline style: an arbitrary Tailwind
    // width would be inert in the Vitest project and, built from a variable,
    // would never be generated by `pnpm storybook` either. A 390 px twin sets
    // `parameters.paneWidth` (see `PHONE`).
    (Story, { parameters }) => (
      <div
        style={{
          width:
            typeof parameters.paneWidth === 'number'
              ? parameters.paneWidth
              : PANE_WIDTH_PX,
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    item: reviewItem,
    detail: reviewDetail,
    notes: [],
    currentUserId: CURRENT_USER_ID,
    getInboxItemHistory: noHistory,
    replyActions,
  },
}
export default meta
type Story = StoryObj<typeof InboxThread>

// ─── the states ──────────────────────────────────────────────────────────────

// A review with nothing recorded against it yet: the guest's message is the
// whole thread — one node, and once the history query settles nothing else is
// on screen at all.
export const ReviewOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('article', { name: 'Guest review' })).toBeVisible()
    await expect(canvas.getByText(REVIEW_TEXT)).toBeVisible()
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Jane Doe' }),
    ).toBeVisible()
    // Finding 2, and the only assertion in this file that can catch its
    // return: the item row carries `rating: null`, so `5.0` is on screen if
    // and only if `detail.reviewRating` reached the header.
    expectRating(canvas, '5.0')
    // One language and no translation: the guest's words stand alone, with
    // nothing to attribute and nothing to fold away.
    await expect(canvasElement.querySelector('details')).toBeNull()
    await expect(canvas.queryByText(/Translated/)).toBeNull()

    // The pending skeleton clears, and leaves no status line behind it. The
    // region itself stays — a live region has to outlive its messages to
    // announce the next one — so what is asserted is that it says nothing.
    await waitFor(() => expect(canvas.getByRole('status')).toBeEmptyDOMElement())
    await expect(railReading(canvasElement)).toEqual(['Guest review'])
    expectWellFormedRail(canvasElement)
    // Node zero's disc is the reviewer's initials (row 10: no photo here).
    await expect(discText(railNodes(canvasElement)[0])).toBe('JD')
    await expect(canvas.queryByText('Not all handling history is shown')).toBeNull()
  },
}
export const ReviewOnlyPhone = onPhone(ReviewOnly)

// Node zero with Google's profile photo: the photo IS the disc, and it is
// decoration — the name is printed beside it, so the image is `alt=""` inside
// an `aria-hidden` indicator and never repeats the name to a screen reader.
// (A data URI, so the image loads without a network in either runner.)
const PHOTO_URL =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="%23c2410c"/></svg>'

export const GuestPhotoIsTheFirstDisc: Story = {
  args: { detail: { ...reviewDetail, reviewerProfilePhotoUrl: PHOTO_URL } },
  play: async ({ canvasElement }) => {
    const [guest] = railNodes(canvasElement)
    const disc = guest.querySelector(':scope > [data-slot="timeline-indicator"]')
    const photo = disc?.querySelector('img')
    await expect(photo).toHaveAttribute('alt', '')
    await expect(disc).toHaveAttribute('aria-hidden', 'true')
    // No initials beside a photo, and the article holds no image of its own.
    await expect(discText(guest)).toBe('')
    await expect(
      within(guest).getByRole('article', { name: 'Guest review' }).querySelector('img'),
    ).toBeNull()
  },
}
export const GuestPhotoIsTheFirstDiscPhone = onPhone(GuestPhotoIsTheFirstDisc)

// The rail the plan draws: the review, the opening, an assignment, an
// escalation, a colleague's note and the reply, on ONE connector. The `opened`
// transition is in the fixture because the server really writes one — every
// opening produces a `cycle_opened` row AND the transition it caused, at the
// same instant — and the rail collapses it, so the opening reads once.
const fullRailHistory: readonly InboxHistoryEntry[] = [
  openedByGoogle('2026-03-01T09:05:00Z'),
  historyEvent(
    '2026-03-01T09:05:00Z',
    {
      kind: 'cycle_transition',
      transition: 'opened',
      transitionReason: 'review_observed',
      actorType: 'system',
    },
    SYSTEM_ACTOR,
  ),
  assignment('2026-03-01T10:00:00Z', { id: GRACE_ID, name: 'Grace Hopper' }),
  escalation('2026-03-01T11:00:00Z', 'escalated'),
]

const colleagueNote = note('note-colleague', '2026-03-01T12:00:00Z', INTERNAL_NOTE, {
  userId: GRACE_ID,
  displayName: 'Grace Hopper',
})

export const FullRail: Story = {
  args: {
    notes: [colleagueNote],
    detail: { ...reviewDetail, reply: REPLIES.awaitingApproval },
    getInboxItemHistory: historyFn(fullRailHistory),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Opened from Google'))

    // Row 10: the review is node zero, not a heading above the stream. Row 11:
    // actor · verb · object. Row 12: the note. Row 9: the reply.
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Opened from Google',
      'Ada Lovelace assigned this to Grace Hopper',
      'Ada Lovelace escalated this',
      'Internal note from Grace Hopper, not visible to the guest',
      `Reply from ${PROPERTY_NAME}`,
    ])
    expectWellFormedRail(canvasElement)

    // Who each disc says, in the words the node prints beside it: the guest's
    // initials, glyphs for the system events, the note author's initials, and
    // the property's ONE initial — a brand, not a teammate's `HE`.
    const discs = railNodes(canvasElement).map(discText)
    await expect(discs).toEqual(['JD', '', '', '', 'GH', 'H'])

    // Each person in a sentence is its own weighted run, and the separator
    // before the time is real text — the line reads as one sentence.
    const assigned = canvas.getByText(
      sentence('Ada Lovelace assigned this to Grace Hopper'),
    )
    await expect(within(assigned).getByText('Ada Lovelace')).toBeVisible()
    await expect(within(assigned).getByText('Grace Hopper')).toBeVisible()
    await expect(assigned.querySelector('time')).not.toBeNull()

    // The reply keeps its box: chip, meta line and actions inside its article.
    const replyArticle = canvas.getByRole('article', {
      name: `Reply from ${PROPERTY_NAME}`,
    })
    await expect(within(replyArticle).getByText('Awaiting approval')).toBeVisible()
    await expect(
      within(replyArticle).getByRole('button', { name: 'Confirm & Publish' }),
    ).toBeVisible()
    await expect(canvas.getAllByText(sentence('Opened from Google'))).toHaveLength(1)
    expectsNoRawIds(canvasElement)
  },
}
export const FullRailPhone = onPhone(FullRail)

// All five history kinds against one item, and the two sentence shapes row 11
// gives them: a system opening leads with its verb; a manager's act leads with
// the manager.
const everyKind: readonly InboxHistoryEntry[] = [
  ...fullRailHistory,
  historyEvent('2026-03-02T08:00:00Z', {
    kind: 'handling_outcome',
    outcome: 'follow_up_completed',
    outcomeRevision: 1,
    deadlineResult: 'on_time',
    completionAt: new Date('2026-03-02T08:00:00Z'),
    supersedesOutcomeId: null,
  }),
  closedByUser('2026-03-02T09:00:00Z'),
]

export const WithEvents: Story = {
  args: { getInboxItemHistory: historyFn(everyKind) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Opened from Google'))
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Opened from Google',
      'Ada Lovelace assigned this to Grace Hopper',
      'Ada Lovelace escalated this',
      'Ada Lovelace handled — Follow-up completed',
      'Ada Lovelace closed this — the reply is confirmed on Google',
    ])
    expectWellFormedRail(canvasElement)
    // The qualifier rides after the sentence, inside the same line.
    await expect(
      eventLines(canvas, 'Ada Lovelace handled — Follow-up completed')[0],
    ).toContain('· on time ·')
    expectsNoRawIds(canvasElement)
  },
}
export const WithEventsPhone = onPhone(WithEvents)

// Notes are a separate query with no event of its own, so the merge happens in
// the thread. What must survive a refactor is that a note lands between the
// events it was written between — on the same rail — and that each note's disc
// says who wrote it without inventing a person.
const interleavedEvents: readonly InboxHistoryEntry[] = [
  assignment('2026-03-01T10:00:00Z', { id: GRACE_ID, name: 'Grace Hopper' }),
  escalation('2026-03-01T12:00:00Z', 'escalated'),
]

const interleavedNotes: readonly InboxNoteView[] = [
  note('note-1', '2026-03-01T11:00:00Z', 'Checking with the front desk.', {
    userId: ADA_ID,
    displayName: 'Ada Lovelace',
  }),
  // An author the directory could not resolve is opaque, never an id fragment.
  note('note-2', '2026-03-01T13:00:00Z', 'Left a voicemail for the guest.', {
    userId: FORMER_MEMBER_ID,
    displayName: null,
  }),
  note('note-3', '2026-03-01T14:00:00Z', INTERNAL_NOTE, {
    userId: CURRENT_USER_ID,
    displayName: 'Grace Hopper',
  }),
]

export const NotesInterleavedBetweenEvents: Story = {
  args: {
    notes: interleavedNotes,
    getInboxItemHistory: historyFn(interleavedEvents),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Ada Lovelace assigned this to Grace Hopper'))

    // 10:00 event · 11:00 note · 12:00 event · 13:00 note · 14:00 note. The
    // caller's own note is "You" even though the directory resolved a name
    // for them — the reader is not a third party to themselves.
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Ada Lovelace assigned this to Grace Hopper',
      'Internal note from Ada Lovelace, not visible to the guest',
      'Ada Lovelace escalated this',
      'Internal note from Unknown user, not visible to the guest',
      'Internal note from You, not visible to the guest',
    ])
    expectWellFormedRail(canvasElement)

    // The viewer vs a colleague, and the author nobody can name. The disc
    // takes initials from the DISPLAY NAME, never from the label: `You` draws
    // the viewer's own `GH`, not `Y`; an unresolved author draws the person
    // glyph, not `UU` — initials nobody has.
    const byName = (name: string): HTMLElement =>
      nodeOf(canvas.getByRole('article', { name }))
    await expect(
      discText(byName('Internal note from Ada Lovelace, not visible to the guest')),
    ).toBe('AL')
    await expect(
      discText(byName('Internal note from You, not visible to the guest')),
    ).toBe('GH')
    await expect(
      discText(byName('Internal note from Unknown user, not visible to the guest')),
    ).toBe('')

    // Row 12: the label says what a note is, in words, on every note — and the
    // box prints no lock and no second privacy line. The promise that the guest
    // cannot see it is SPOKEN instead, in the article's own name — the sentence
    // the outcome row's lock speaks — so a screen reader hears "guest" on every
    // note, where it once heard only `Internal note from You`. And the box is
    // dashed: a shape, not a hue, tells it from the reply's solid box when the
    // amber is lost (grayscale, glare, low vision). Class, not pixels — the
    // Storybook project compiles no Tailwind; the edge was measured in Chromium.
    const mine = canvas.getByRole('article', {
      name: 'Internal note from You, not visible to the guest',
    })
    await expect(within(mine).getByText('Internal note')).toBeVisible()
    await expect(within(mine).queryByText(/not visible to the guest/i)).toBeNull()
    await expect(within(mine).queryByText(/team only/i)).toBeNull()
    await expect(mine).toHaveClass('border-dashed')
    for (const article of canvas.getAllByRole('article', {
      name: /^Internal note from /,
    })) {
      await expect(article).toHaveAccessibleName(/, not visible to the guest$/)
    }

    // IBX-01-T6: a resolved name, an opaque fallback, and no id anywhere.
    await expect(canvas.getByText('Unknown user')).toBeVisible()
    expectsNoRawIds(canvasElement)
  },
}
export const NotesInterleavedBetweenEventsPhone = onPhone(NotesInterleavedBetweenEvents)

// ─── the reply as a node, one story per chip ─────────────────────────────────
//
// `reply-message.stories.tsx` gates the message's own behaviour. What these
// gate is its place ON THE RAIL: the reply is a node of its own, last in time,
// whose disc is the property's initial; and the box — chip, meta line, actions
// — still lives inside the article beside it. The disc's TONE follows the chip
// (`reply-message.tsx`, `INDICATOR_TONE_CLASS`), which only a real browser can
// see; here the chip's words are the proof of which tone was chosen.

const replyStateHistory = historyFn([openedByGoogle('2026-03-01T09:05:00Z')])

function replyNodeStory(
  state: keyof typeof REPLIES,
  chip: string,
  buttons: readonly string[],
): Story {
  return {
    args: {
      detail: { ...reviewDetail, reply: REPLIES[state] },
      getInboxItemHistory: replyStateHistory,
    },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await canvas.findByText(sentence('Opened from Google'))
      await expect(railReading(canvasElement)).toEqual([
        'Guest review',
        'Opened from Google',
        `Reply from ${PROPERTY_NAME}`,
      ])
      expectWellFormedRail(canvasElement)

      const article = canvas.getByRole('article', { name: `Reply from ${PROPERTY_NAME}` })
      const node = nodeOf(article)
      await expect(node).toBe(railNodes(canvasElement).at(-1))
      await expect(discText(node)).toBe('H')
      // The article is the box now: the disc is outside it, the chip, the
      // text and every action inside it.
      await expect(article.querySelector('[data-slot="timeline-indicator"]')).toBeNull()
      await expect(within(article).getByText(chip)).toBeVisible()
      await expect(within(article).getByText(REPLY_TEXT)).toBeVisible()
      await expect(
        within(article)
          .queryAllByRole('button')
          .map((button) => normalised(button.textContent)),
      ).toEqual(buttons)
      expectsNoRawIds(canvasElement)
    },
  }
}

export const ReplyAwaitingApproval = replyNodeStory(
  'awaitingApproval',
  'Awaiting approval',
  ['Confirm & Publish', 'Reject'],
)
export const ReplyAwaitingApprovalPhone = onPhone(ReplyAwaitingApproval)

export const ReplyWaitingForGoogle = replyNodeStory(
  'waitingForGoogle',
  'Waiting for Google',
  [],
)
export const ReplyWaitingForGooglePhone = onPhone(ReplyWaitingForGoogle)

export const ReplyLiveOnGoogle = replyNodeStory('liveOnGoogle', 'Live on Google', [
  'Edit reply',
])
export const ReplyLiveOnGooglePhone = onPhone(ReplyLiveOnGoogle)

export const ReplyNeedsCheck = replyNodeStory('needsCheck', 'Needs a check', [
  'Check Google again',
])
export const ReplyNeedsCheckPhone = onPhone(ReplyNeedsCheck)

export const ReplyNotPublished = replyNodeStory('notPublished', 'Not published', [
  'Try publishing again',
])
export const ReplyNotPublishedPhone = onPhone(ReplyNotPublished)

export const ReplyRejected = replyNodeStory('rejected', 'Rejected', ['Edit & resubmit'])
export const ReplyRejectedPhone = onPhone(ReplyRejected)

// A draft is the composer's, not the thread's: `ReplyMessage` renders nothing
// for it, and so draws no disc either. An empty node here would put a
// connector and a circle under the last event with nothing beside them.
export const ReplyDraftDrawsNoNode: Story = {
  args: {
    detail: { ...reviewDetail, reply: REPLIES.draft },
    getInboxItemHistory: replyStateHistory,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Opened from Google'))
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Opened from Google',
    ])
    expectWellFormedRail(canvasElement)
    await expect(canvas.queryByText(REPLY_TEXT)).toBeNull()
  },
}
export const ReplyDraftDrawsNoNodePhone = onPhone(ReplyDraftDrawsNoNode)

// ─── the fold (plan row 13) ──────────────────────────────────────────────────

// Eight events and a note. Row 13: more than six system events fold all but
// the newest three into one node placed directly after the review — here five
// — and the note never folds. Written at 13:30, between the fifth and sixth
// events, it lands right after the marker: after everything it followed that
// is still on the rail. It also sits exactly where the fold's span may end —
// the span is the unbroken run of events after the review, and a note ends it
// (`foldEarlierEvents`); `NoteAmongTheOldestEventsKeepsTheRailOpen` is the case
// where it ends too soon to fold.
const longHistory: readonly InboxHistoryEntry[] = [
  openedByGoogle('2026-03-01T09:05:00Z'),
  assignment('2026-03-01T10:00:00Z', { id: GRACE_ID, name: 'Grace Hopper' }),
  escalation('2026-03-01T11:00:00Z', 'escalated'),
  escalation('2026-03-01T12:00:00Z', 'resolved'),
  assignment('2026-03-01T13:00:00Z', { id: ADA_ID, name: 'Ada Lovelace' }, BY_GRACE),
  escalation('2026-03-01T14:00:00Z', 'escalated', BY_GRACE),
  assignment('2026-03-01T15:00:00Z', null),
  closedByUser('2026-03-01T16:00:00Z'),
]

const foldNote = note('note-fold', '2026-03-01T13:30:00Z', INTERNAL_NOTE, {
  userId: GRACE_ID,
  displayName: 'Grace Hopper',
})

const FOLDED_READING = [
  'Guest review',
  'Show 5 earlier events',
  'Internal note from Grace Hopper, not visible to the guest',
  'Grace Hopper escalated this',
  'Ada Lovelace unassigned this',
  'Ada Lovelace closed this — the reply is confirmed on Google',
] as const

const EXPANDED_READING = [
  'Guest review',
  'Hide 5 earlier events',
  'Opened from Google',
  'Ada Lovelace assigned this to Grace Hopper',
  'Ada Lovelace escalated this',
  'Ada Lovelace resolved the escalation',
  'Grace Hopper assigned this to Ada Lovelace',
  'Internal note from Grace Hopper, not visible to the guest',
  'Grace Hopper escalated this',
  'Ada Lovelace unassigned this',
  'Ada Lovelace closed this — the reply is confirmed on Google',
] as const

export const FoldedHistory: Story = {
  args: { notes: [foldNote], getInboxItemHistory: historyFn(longHistory) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByRole('button', { name: 'Show 5 earlier events' })
    await expect(railReading(canvasElement)).toEqual(FOLDED_READING)
    expectWellFormedRail(canvasElement)

    // The control is in the node's content, beside a decorative disc — never
    // inside the `aria-hidden` indicator, where it would be focusable and
    // invisible to a screen reader at once.
    await expect(toggle.closest('[data-slot="timeline-content"]')).not.toBeNull()
    // It states its state, and its status region says nothing until the reader
    // acts: a thread that merely rendered folded announces nothing.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(foldStatus(toggle)).toHaveTextContent(/^$/)
    // The hidden rows are gone, not merely hidden: nothing to reach by find.
    await expect(canvas.queryByText(sentence('Opened from Google'))).toBeNull()
    await expect(
      canvas.queryByText(sentence('Ada Lovelace resolved the escalation')),
    ).toBeNull()
  },
}
export const FoldedHistoryPhone = onPhone(FoldedHistory)

// Opening the fold. The marker stays where it is, relabelled, rather than
// vanishing: a button removed by its own click drops keyboard focus to the
// document body, and the reader who asked for the earlier events would be sent
// back to the top of the page, above them.
export const ExpandedHistory: Story = {
  args: FoldedHistory.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByRole('button', { name: 'Show 5 earlier events' })

    await userEvent.click(toggle)
    const opened = await canvas.findByRole('button', { name: 'Hide 5 earlier events' })
    // The same element, still focused: React kept the node (key `fold`) and
    // only its words changed.
    await expect(opened).toBe(toggle)
    await expect(opened).toHaveFocus()
    // VoiceOver does not speak a name change on the element it is on, so the
    // click also reports its state and its result.
    await expect(opened).toHaveAttribute('aria-expanded', 'true')
    await expect(foldStatus(opened)).toHaveTextContent('5 earlier events shown')
    await expect(railReading(canvasElement)).toEqual(EXPANDED_READING)
    expectWellFormedRail(canvasElement)
    // The revealed events are the next nodes after the toggle, oldest first.
    await expect(
      comesBefore(opened, canvas.getByText(sentence('Opened from Google'))),
    ).toBe(true)

    // Closing it again, from the keyboard.
    await userEvent.keyboard('{Enter}')
    const closed = await canvas.findByRole('button', { name: 'Show 5 earlier events' })
    await expect(closed).toHaveFocus()
    await expect(closed).toHaveAttribute('aria-expanded', 'false')
    await expect(foldStatus(closed)).toHaveTextContent('5 earlier events hidden')
    await expect(railReading(canvasElement)).toEqual(FOLDED_READING)
  },
}
export const ExpandedHistoryPhone = onPhone(ExpandedHistory)

// The threshold's edge: exactly six events never fold. A fold here would hide
// three rows behind a node that is itself a row.
export const SixEventsNeverFold: Story = {
  args: { getInboxItemHistory: historyFn(longHistory.slice(0, 6)) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Grace Hopper escalated this'))
    await expect(canvas.queryByRole('button', { name: /earlier events/ })).toBeNull()
    await expect(railNodes(canvasElement)).toHaveLength(7)
    expectWellFormedRail(canvasElement)
  },
}
export const SixEventsNeverFoldPhone = onPhone(SixEventsNeverFold)

// The same eight events with the note written at 10:30, after the second.
// "All but the newest three" would have hidden events from both sides of it —
// the note would have read below `Show 5 earlier events`, over three events
// newer than itself, and opening the fold would have split them around it. The
// fold's span is the unbroken run of events after the review, and a note ends
// it; two events is a span too short to fold (a fold hides at least four), so
// the rail stays open and reads in the record's order, top to bottom.
const earlyNote = note('note-early', '2026-03-01T10:30:00Z', INTERNAL_NOTE, {
  userId: GRACE_ID,
  displayName: 'Grace Hopper',
})

export const NoteAmongTheOldestEventsKeepsTheRailOpen: Story = {
  args: { notes: [earlyNote], getInboxItemHistory: historyFn(longHistory) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Opened from Google'))
    await expect(canvas.queryByRole('button', { name: /earlier events/ })).toBeNull()
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Opened from Google',
      'Ada Lovelace assigned this to Grace Hopper',
      'Internal note from Grace Hopper, not visible to the guest',
      'Ada Lovelace escalated this',
      'Ada Lovelace resolved the escalation',
      'Grace Hopper assigned this to Ada Lovelace',
      'Grace Hopper escalated this',
      'Ada Lovelace unassigned this',
      'Ada Lovelace closed this — the reply is confirmed on Google',
    ])
    expectWellFormedRail(canvasElement)
  },
}
export const NoteAmongTheOldestEventsKeepsTheRailOpenPhone = onPhone(
  NoteAmongTheOldestEventsKeepsTheRailOpen,
)

// ─── when this client does not know what happened ────────────────────────────
//
// `openedReason`, `manualReopenReason` and `outcome` are enforced by a DB CHECK
// constraint and cast straight out of `varchar` by the repository, so the
// unions below are a client-side belief about a server-side column. A migration
// that widens one ships on its own and a manager's cached bundle keeps running
// this file: the row arrives with NO client deploy in between. `as string as …`
// is how a fixture reaches a value that is legal in the column and outside the
// union — the state the running client is actually in, not a hypothetical.
type OpenedReason = Extract<HistoryDetail, { kind: 'cycle_opened' }>['openedReason']
type ManualReopenReason = NonNullable<
  Extract<HistoryDetail, { kind: 'cycle_opened' }>['manualReopenReason']
>
type HandlingOutcome = Extract<HistoryDetail, { kind: 'handling_outcome' }>['outcome']

const FUTURE_OPENED_REASON = 'reopened_by_policy_engine' as string as OpenedReason
const FUTURE_REOPEN_REASON = 'guest_escalated_offsite' as string as ManualReopenReason
const FUTURE_OUTCOME = 'referred_to_legal' as string as HandlingOutcome

const FUTURE_ROW_EXPLANATION = 'The guest phoned the front desk about this.'

/** A sixth history KIND — a shape this bundle has no builder for at all. */
function futureKindEvent(at: string): InboxHistoryEntry {
  return historyEvent(at, {
    kind: 'sla_breached',
    breachedAt: new Date(at),
  } as unknown as HistoryDetail)
}

// Six rows this bundle can say and two it cannot: an outcome from the future,
// and a kind from the future. Eight rows arrived; six draw a node. The fold
// counts what the rail DRAWS, so this thread does not fold — counting the raw
// rows would print `Show 5 earlier events` over four, and keep a "newest
// three" of which only two appear.
export const UnsayableRowsDoNotCountTowardsTheFold: Story = {
  args: {
    getInboxItemHistory: historyFn([
      ...longHistory.slice(0, 3),
      historyEvent('2026-03-01T11:30:00Z', {
        kind: 'handling_outcome',
        outcome: FUTURE_OUTCOME,
        outcomeRevision: 1,
        deadlineResult: 'on_time',
        completionAt: new Date('2026-03-01T11:30:00Z'),
        supersedesOutcomeId: null,
      }),
      futureKindEvent('2026-03-01T11:45:00Z'),
      ...longHistory.slice(3, 6),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Grace Hopper escalated this'))
    await expect(canvas.queryByRole('button', { name: /earlier events/ })).toBeNull()
    await expect(railNodes(canvasElement)).toHaveLength(7)
    expectWellFormedRail(canvasElement)
  },
}

// The pane mounts one thread for its whole life, so the fold's state has to
// belong to the ITEM: a fold opened on one review must not be open over the
// next review's history, which that reader has not seen. Returning to the
// first review finds its fold as the reader left it.
const otherReviewItem: InboxItem = {
  ...reviewItem,
  id: makeInboxItem({ id: 'thread-review-other', sourceType: 'review' }).id,
}

function SelectionHost(props: ComponentProps<typeof InboxThread>): ReactNode {
  const [other, setOther] = useState(false)
  const item = other ? otherReviewItem : props.item
  const detail = props.detail ? { ...props.detail, item } : null
  return (
    <>
      <button type="button" onClick={() => setOther((current) => !current)}>
        Select the other review
      </button>
      <InboxThread {...props} item={item} detail={detail} />
    </>
  )
}

export const FoldBelongsToTheItem: Story = {
  args: FoldedHistory.args,
  render: (args) => <SelectionHost {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Show 5 earlier events' }),
    )
    await expect(
      canvas.getByRole('button', { name: 'Hide 5 earlier events' }),
    ).toBeVisible()

    const select = canvas.getByRole('button', { name: 'Select the other review' })
    await userEvent.click(select)
    const otherToggle = await canvas.findByRole('button', {
      name: 'Show 5 earlier events',
    })
    await expect(otherToggle).toBeVisible()
    // Nobody toggled THIS review's fold, so its status says nothing: selecting
    // a review must not announce "5 earlier events hidden" over a fold the
    // reader never opened.
    await expect(foldStatus(otherToggle)).toHaveTextContent(/^$/)
    await expect(
      canvas.queryByRole('button', { name: 'Hide 5 earlier events' }),
    ).toBeNull()

    await userEvent.click(select)
    await expect(
      await canvas.findByRole('button', { name: 'Hide 5 earlier events' }),
    ).toBeVisible()
  },
}

// ─── the history query's own states ──────────────────────────────────────────

// A source that hit its row limit. `truncated` is a property of the RESULT,
// not of any entry, so there is exactly one line however many entries came
// back — and it sits UNDER the rail, at the foot of the record. Every history
// source reads `ORDER BY … ASC LIMIT 200`, so the rows that never arrived are
// the most RECENT ones: a line above the oldest entry would claim the opposite
// of what happened. The copy names no end at all.
export const TruncatedHistory: Story = {
  args: { getInboxItemHistory: historyFn(everyKind, true) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const lines = await canvas.findAllByText('Not all handling history is shown')
    await expect(lines).toHaveLength(1)

    // Not a node: below the rail, after its last entry, so that entry is
    // still the rail's last child and draws no connector into the line.
    expectBelowTheRail(canvasElement, lines[0])
    expectWellFormedRail(canvasElement)
    await expect(railReading(canvasElement).at(-1)).toBe(
      'Ada Lovelace closed this — the reply is confirmed on Google',
    )

    // End-agnostic: nothing here may say which end was cut. `Earlier history
    // not shown` — the wording this line used to carry — named the wrong one.
    await expect(canvas.queryByText(/earlier/i)).toBeNull()
  },
}
export const TruncatedHistoryPhone = onPhone(TruncatedHistory)

// The history query is still in flight. The guest's message comes from the
// detail query, so node zero is on screen on the first paint — the thread
// never holds the conversation back waiting for its events.
const pendingHistory = (() =>
  Promise.withResolvers<never>().promise) as unknown as typeof getInboxItemHistoryFn

export const HistoryLoading: Story = {
  args: { getInboxItemHistory: pendingHistory },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('article', { name: 'Guest review' })).toBeVisible()
    await expect(canvas.getByText(REVIEW_TEXT)).toBeVisible()
    const status = canvas.getByRole('status')
    await expect(status).toHaveTextContent('Loading handling history…')
    expectBelowTheRail(canvasElement, status)
    await expect(railReading(canvasElement)).toEqual(['Guest review'])
    expectWellFormedRail(canvasElement)
  },
}
export const HistoryLoadingPhone = onPhone(HistoryLoading)

// The history read failed. A history that would not load is not an item that
// failed, so it stays one quiet line under the rail rather than a destructive
// banner over the guest's words — and it takes no disc, because it is not an
// event in the case.
const failingHistory = mockServerFn(async () => {
  throw new Error('Storybook: handling history is unreachable')
}) as unknown as typeof getInboxItemHistoryFn

// The notes read failed, as opposed to returning none. `notes` arrives as
// `data ?? []` either way, so without the flag the rail looks complete while a
// colleague's note is missing from it. The line sits in the rail's one status
// region, beside the history line it mirrors.
export const NotesUnavailable: Story = {
  args: { notesUnavailable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = await canvas.findByText('Internal notes are unavailable right now.')
    await expect(line).toBeVisible()
    await expect(line.closest('[role="status"]')).not.toBeNull()
  },
}

export const HistoryFailed: Story = {
  args: { notes: [colleagueNote], getInboxItemHistory: failingHistory },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = await canvas.findByText('Handling history is unavailable right now.')
    await expect(line).toBeVisible()
    await expect(line.closest('[role="status"]')).not.toBeNull()
    expectBelowTheRail(canvasElement, line)
    // The guest's message and the notes — a different query — survive intact.
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Internal note from Grace Hopper, not visible to the guest',
    ])
    expectWellFormedRail(canvasElement)
    await expect(canvas.getByText(REVIEW_TEXT)).toBeVisible()
  },
}
export const HistoryFailedPhone = onPhone(HistoryFailed)

// ─── plan row 8: which of the guest's two texts is the body ──────────────────
//
// One rule, seen from every side it has. Before it, the pane always printed the
// original and folded the translation away. The rule promotes Google's text to
// the body ONLY when the review is provably in a language other than the one
// the property replies in — both languages known, template groups different.
// Anything less keeps the guest's own words as the body, because "unknown" is
// not "different", and on production data it is always unknown: the only
// review source hard-codes `languageCode: null`
// (`google-review-api.adapter.ts:450`). The first story below is that shape.
//
// `reviewReplyLanguage` is the review's language CANONICALIZED by the use case
// (`get-inbox-item-detail.ts:184-188`), and `item.reviewLanguageCode` is the
// raw code the source served. Only the canonical tag can be compared —
// `parseCanonicalReplyLanguageTag` returns null for a raw `bg-BG` — but the raw
// code is a valid BCP 47 tag and still labels the original's `lang`.

/** A Turkish review in a property whose managers reply in Bulgarian. */
const turkishItem: InboxItem = { ...reviewItem, reviewLanguageCode: 'tr-TR' }

/** The same property's own language — the manager can read the body as it is. */
const bulgarianItem: InboxItem = { ...reviewItem, reviewLanguageCode: 'bg-BG' }

// What every translated Google review looks like today: no language on the
// review at all, a property default set. Review found the first rule turned
// this into translation-first — a Bulgarian guest's Bulgarian sentence folded
// away at a Bulgarian property, under Google's English — on roughly four in
// five texted reviews (`google-review-comment.ts:5`, 76 of 93).
export const OriginalFirstWhenReviewLanguageUnknown: Story = {
  args: {
    detail: {
      ...reviewDetail,
      reviewText: BG_ORIGINAL,
      reviewTranslatedText: EN_TRANSLATION,
      reviewReplyLanguage: null,
      propertyDefaultReplyLanguage: BG_DEFAULT,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    const body = canvas.getByText(BG_ORIGINAL)
    await expect(body).toBeVisible()
    // No language is known for these words, so none is declared for them.
    expectLang(body, null)
    await expectDisclosureOpens(canvas, 'Google translation', EN_TRANSLATION, null)
    // The body is the guest's own words, so there is nothing to attribute —
    // and no header language fact either, since there is no language.
    await expect(canvas.queryByText(/^Translated/)).toBeNull()
    await expect(canvas.queryByText(/Review language/)).toBeNull()
  },
}

export const TranslationFirst: Story = {
  args: {
    item: turkishItem,
    detail: {
      ...reviewDetail,
      item: turkishItem,
      reviewText: TR_ORIGINAL,
      reviewTranslatedText: TR_INTO_EN,
      reviewReplyLanguage: 'tr-Latn-TR',
      propertyDefaultReplyLanguage: BG_DEFAULT,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Both languages known and different: Google's text is the body, and it
    // is MARKED as machine text — the one thing this rearrangement must not
    // omit, since the body is no longer the guest's own words. The line names
    // the SOURCE only; the translation's language is recorded nowhere, so the
    // body declares none.
    const body = canvas.getByText(TR_INTO_EN)
    await expect(body).toBeVisible()
    expectLang(body, null)
    const line = canvas.getByText('Translated from Turkish by Google')
    await expect(line).toBeVisible()
    // The marker is read BEFORE the prose it describes; after it, it would
    // retro-label words the reader has already taken as the guest's own.
    await expect(comesBefore(line, body)).toBe(true)

    // The guest's own words are the half that folds, named for what they are
    // and labelled with their language for a screen reader's voice.
    await expectDisclosureOpens(canvas, 'Original in Turkish', TR_ORIGINAL, 'tr-Latn-TR')
    await expect(canvas.queryByText('Show original')).toBeNull()

    // The header's own language fact is untouched by the rule.
    await expect(canvas.getByText('Review language: Turkish')).toBeVisible()
  },
}

export const OriginalFirstInThePropertyLanguage: Story = {
  args: {
    item: bulgarianItem,
    detail: {
      ...reviewDetail,
      item: bulgarianItem,
      reviewText: BG_ORIGINAL,
      reviewTranslatedText: EN_TRANSLATION,
      reviewReplyLanguage: 'bg-Cyrl-BG',
      propertyDefaultReplyLanguage: BG_DEFAULT,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Today's arrangement, kept: the review is in the language this property
    // replies in, so the guest's words lead and Google's copy folds.
    const body = canvas.getByText(BG_ORIGINAL)
    await expect(body).toBeVisible()
    expectLang(body, 'bg-Cyrl-BG')
    await expectDisclosureOpens(canvas, 'Google translation', EN_TRANSLATION, null)
    // Nothing to attribute — the body is the guest's.
    await expect(canvas.queryByText(/^Translated/)).toBeNull()
    await expect(canvas.getByText('Review language: Bulgarian')).toBeVisible()
  },
}

export const OriginalFirstWithNoPropertyLanguage: Story = {
  args: {
    item: turkishItem,
    detail: {
      ...reviewDetail,
      item: turkishItem,
      reviewText: TR_ORIGINAL,
      reviewTranslatedText: TR_INTO_EN,
      reviewReplyLanguage: 'tr-Latn-TR',
      // The property has never set one. `get-inbox-item-detail.ts:178-182`
      // returns null both when nothing is configured and when what is
      // configured does not canonicalize, so this is the same state either way.
      propertyDefaultReplyLanguage: null,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // The same Turkish review as `TranslationFirst`, in a property that has
    // claimed no language — so there is no reader language for it to be
    // foreign TO, and nothing is proven. Plan row 8 as first written led with
    // the translation here; amended, the guest's words lead.
    const body = canvas.getByText(TR_ORIGINAL)
    await expect(body).toBeVisible()
    expectLang(body, 'tr-Latn-TR')
    await expectDisclosureOpens(canvas, 'Google translation', TR_INTO_EN, null)
    await expect(canvas.queryByText(/^Translated/)).toBeNull()
  },
}

export const ForeignReviewWithNoTranslation: Story = {
  args: {
    item: turkishItem,
    detail: {
      ...reviewDetail,
      item: turkishItem,
      reviewText: TR_ORIGINAL,
      // Google served none. The rule has nothing to promote and must not
      // invent an empty disclosure to hold the absence.
      reviewTranslatedText: null,
      reviewReplyLanguage: 'tr-Latn-TR',
      propertyDefaultReplyLanguage: BG_DEFAULT,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = canvas.getByText(TR_ORIGINAL)
    await expect(body).toBeVisible()
    expectLang(body, 'tr-Latn-TR')
    await expect(canvasElement.querySelector('details')).toBeNull()
    await expect(canvas.queryByText(/Translated/)).toBeNull()
    await expect(canvas.queryByText(/^Original/)).toBeNull()
  },
}

// Google's envelope with no `(Original)` marker: `parseGoogleReviewComment`
// keeps the whole text as the translation and returns no original
// (`google-review-comment.ts:59`). Review found the pane then drew a review
// with a name, stars and a date and not one word — not even an "unavailable"
// sentence, because the content IS available. The translation is the only
// prose we hold, so it is printed, and marked.
export const TranslationOnly: Story = {
  args: {
    detail: {
      ...reviewDetail,
      reviewText: null,
      reviewTranslatedText: EN_TRANSLATION,
      reviewReplyLanguage: null,
      propertyDefaultReplyLanguage: BG_DEFAULT,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = canvas.getByText(EN_TRANSLATION)
    await expect(body).toBeVisible()
    expectLang(body, null)
    const line = canvas.getByText('Translated by Google')
    await expect(comesBefore(line, body)).toBe(true)
    // Nothing to fold: there is no original to put behind a disclosure.
    await expect(canvasElement.querySelector('details')).toBeNull()
    await expect(canvas.queryByText(/Review content unavailable/)).toBeNull()
  },
}

// A review that is a score and nothing else — the guest left stars and no
// words. `available` with no text is NOT a withdrawal, so none of the
// unavailable sentences may appear; the rating is the whole message.
export const RatingOnlyReview: Story = {
  args: {
    detail: {
      ...reviewDetail,
      reviewText: null,
      reviewTranslatedText: null,
      reviewRating: 4,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('article', { name: 'Guest review' })).toBeVisible()
    expectRating(canvas, '4.0')
    await expect(canvas.queryByText(REVIEW_TEXT)).toBeNull()
    await expect(canvas.queryByText(/Review content unavailable/)).toBeNull()
    await expect(canvasElement.querySelector('details')).toBeNull()
  },
}

// A review with no reviewer name. The fleet fixture always carries one, so
// every story above this point exercises the resolved branch only — this item
// is what the missing-name branch actually needs, and both stories below reuse
// it so the two readings of a null name sit side by side.
const anonymousItem: InboxItem = { ...reviewItem, reviewerName: null }

// BQC-1.2: the source cache expired, so the review text is gone for good. The
// honest unavailable line renders — never a stale copy, never the snippet.
//
// The name is null here for a second reason: `inbox.repository.ts` nulls every
// snippet field for `expired` and `not_found` alike, so on an ineligible source
// a null name means the snippet is gone, NOT that the guest posted anonymously.
// The pane may not pick the flattering reading of an ambiguous null.
export const ContentExpired: Story = {
  args: {
    item: anonymousItem,
    detail: {
      ...reviewDetail,
      item: anonymousItem,
      reviewText: null,
      // A translation of content the source has withdrawn. The repository
      // nulls every snippet field for `expired` (`inbox.repository.ts:769-787`)
      // so this pairing cannot arise from a live read — but the TYPE allows it,
      // and a replayed `inbox-cache-policy.ts` entry written while the snippet
      // was still available would carry exactly this shape.
      reviewTranslatedText: EN_TRANSLATION,
      // BQC-1.2: the rating is provider-owned content exactly like the words,
      // so an ineligible source asserts no score either.
      reviewRating: null,
      reviewContentStatus: 'expired',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Review content unavailable (source cache expired)'),
    ).toBeVisible()
    await expect(canvas.queryByText(REVIEW_TEXT)).toBeNull()
    // An ineligible source renders neither the original nor a translation of it.
    await expect(canvas.queryByText(EN_TRANSLATION)).toBeNull()
    await expect(canvasElement.querySelector('details')).toBeNull()
    // …and no stars. `detail.reviewRating` is null here and it is the pane's
    // ONLY rating source for a review — `item.rating` is not read, because the
    // detail item's copy is null for every row (`inbox.mapper.ts:37`) and a
    // fallback to it could only ever print a score beside a withdrawn review.
    expectNoRating(canvas)

    // The missing name is reported as missing, in the register of the line
    // above it — never as an anonymity the source never recorded.
    await expect(canvas.queryByText('Anonymous guest')).toBeNull()
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Reviewer name unavailable' }),
    ).toBeVisible()
  },
}

// The other reading of the same null, and the only one allowed to claim it: an
// AVAILABLE review whose snippet is intact and whose reviewer name is genuinely
// absent was genuinely posted anonymously. Without this story the assertion
// above would pass just as well if `Anonymous guest` were deleted outright.
export const AnonymousGuestOnAvailableReview: Story = {
  args: {
    item: anonymousItem,
    detail: { ...reviewDetail, item: anonymousItem },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Anonymous guest' }),
    ).toBeVisible()
    await expect(canvas.getByText(REVIEW_TEXT)).toBeVisible()
    await expect(canvas.queryByText('Reviewer name unavailable')).toBeNull()
  },
}

// The review was deleted at the source: the same contract, without the
// cache-expired qualifier that would misdescribe it.
export const ContentNotFound: Story = {
  args: {
    detail: {
      ...reviewDetail,
      reviewText: null,
      reviewRating: null,
      reviewContentStatus: 'not_found',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Review content unavailable')).toBeVisible()
    await expect(canvas.queryByText(/source cache expired/i)).toBeNull()
    await expect(canvas.queryByText(REVIEW_TEXT)).toBeNull()
    expectNoRating(canvas)
  },
}

// ─── a feedback item's thread ────────────────────────────────────────────────

// Private feedback. There is no reviewer, no platform and no name we are
// allowed to show, so the author is the role noun and node zero's disc is the
// person glyph — no initials of a name we do not have. The handling outcome is
// an event on the same rail rather than a panel beside it.
export const FeedbackItem: Story = {
  args: {
    item: feedbackItem,
    detail: feedbackDetail,
    notes: [colleagueNote],
    getInboxItemHistory: historyFn([
      historyEvent('2026-03-01T09:05:00Z', {
        kind: 'cycle_opened',
        openedReason: 'feedback_submitted',
        manualReopenReason: null,
        manualReopenExplanation: null,
        supersedesCycleNumber: null,
        sourceRevision: 1,
      }),
      historyEvent('2026-03-02T08:00:00Z', {
        kind: 'handling_outcome',
        outcome: 'handled_with_team',
        outcomeRevision: 1,
        deadlineResult: 'on_time',
        completionAt: new Date('2026-03-02T08:00:00Z'),
        supersedesOutcomeId: null,
      }),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('article', { name: 'Guest feedback' })).toBeVisible()
    await expect(canvas.getByRole('heading', { level: 2, name: 'Guest' })).toBeVisible()
    await expect(canvas.getByText(FEEDBACK_COMMENT)).toBeVisible()
    // Feedback's own number. The item row carries `rating: null`, as the detail
    // read returns it, so `2.0` is on screen if and only if
    // `feedbackRatingValue` reached the header.
    expectRating(canvas, '2.0')

    await canvas.findByText(sentence('Ada Lovelace handled — Handled with the team'))
    // The opening names nobody even though the row carries the default actor:
    // a guest's submission is not a manager's act (`history-event-line.ts`).
    await expect(railReading(canvasElement)).toEqual([
      'Guest feedback',
      'Opened from guest feedback',
      'Internal note from Grace Hopper, not visible to the guest',
      'Ada Lovelace handled — Handled with the team',
    ])
    expectWellFormedRail(canvasElement)
    await expect(discText(railNodes(canvasElement)[0])).toBe('')

    // No review affordances leak onto a feedback item.
    await expect(canvas.queryByRole('article', { name: 'Guest review' })).toBeNull()
    expectsNoRawIds(canvasElement)
  },
}
export const FeedbackItemPhone = onPhone(FeedbackItem)

// ─── the rules ───────────────────────────────────────────────────────────────

// A backfilled cycle opening routinely predates the review it belongs to. The
// guest message is node zero of the rail rather than an entry sorted into it,
// so it leads regardless of what any timestamp says.
export const GuestFirstDespiteBackdatedHistory: Story = {
  args: {
    getInboxItemHistory: historyFn([openedByGoogle('2024-11-02T00:00:00Z')]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Opened from Google'))
    // The event is ~16 months older than the source date and still reads second.
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Opened from Google',
    ])
  },
}

// A pre-cutover row proves an episode existed and nothing more. The server
// redacts its actor, and the line redacts it again — so a fixture that still
// carries a name (a server that forgot, a cache written before the redaction)
// must not be able to print one. Row 11: a redacted row starts at its verb,
// capitalised.
export const LegacyEventHasNoActor: Story = {
  args: {
    getInboxItemHistory: historyFn([
      historyEvent(
        '2026-03-01T09:30:00Z',
        {
          kind: 'cycle_opened',
          openedReason: 'legacy_backfill',
          manualReopenReason: null,
          manualReopenExplanation: null,
          supersedesCycleNumber: null,
          sourceRevision: 1,
        },
        {
          legacy: true,
          actorUserId: GRACE_ID,
          actorDisplayName: 'Grace Hopper',
          stateRevision: null,
        },
      ),
      escalation('2026-03-01T11:00:00Z', 'escalated'),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Earlier handling'))

    // The legacy row names nobody, though its fixture still carries a name...
    await expect(eventLines(canvas, 'Earlier handling')[0]).not.toContain('Grace Hopper')
    // ...and the assertion above is not vacuous: a normal row does lead with
    // its actor, so the difference is the `legacy` flag and nothing else.
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Earlier handling',
      'Ada Lovelace escalated this',
    ])
    expectWellFormedRail(canvasElement)
    expectsNoRawIds(canvasElement)
  },
}
export const LegacyEventHasNoActorPhone = onPhone(LegacyEventHasNoActor)

// The manager-internal note recorded with a private-feedback outcome is ABSENT
// — not null, not empty — whenever the reader may not see it, so an
// unauthorized reader cannot even learn that a note exists. Both rows are in
// one story so the present case proves the absent case is not vacuous.
export const HandlingOutcomeNoteVisibility: Story = {
  args: {
    item: feedbackItem,
    detail: feedbackDetail,
    getInboxItemHistory: historyFn([
      historyEvent('2026-03-02T08:00:00Z', {
        kind: 'handling_outcome',
        outcome: 'follow_up_completed',
        outcomeRevision: 1,
        deadlineResult: 'on_time',
        completionAt: new Date('2026-03-02T08:00:00Z'),
        supersedesOutcomeId: null,
        internalNote: INTERNAL_NOTE,
      }),
      // The key is missing entirely — this is what an unauthorized read returns.
      historyEvent('2026-03-03T08:00:00Z', {
        kind: 'handling_outcome',
        outcome: 'handled_with_team',
        outcomeRevision: 2,
        deadlineResult: 'late',
        completionAt: new Date('2026-03-03T08:00:00Z'),
        supersedesOutcomeId: 'outcome-1',
      }),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const handled = 'Ada Lovelace handled — Follow-up completed'
    await canvas.findByText(sentence(handled))

    // Present: the sentence, then the note under it, marked in words.
    const withNote = eventLines(canvas, handled)
    await expect(withNote).toHaveLength(2)
    await expect(withNote[1]).toBe(INTERNAL_NOTE)
    await expect(
      within(nodeOf(canvas.getByText(INTERNAL_NOTE))).getByRole('img', {
        name: 'Internal note, not visible to the guest',
      }),
    ).toBeInTheDocument()

    // Absent: the sentence alone. No second line, so no placeholder, no
    // "withheld" affordance and no stringified `undefined`.
    await expect(
      eventLines(canvas, 'Ada Lovelace corrected the outcome — Handled with the team'),
    ).toHaveLength(1)
    await expect(canvas.getAllByText(INTERNAL_NOTE)).toHaveLength(1)
  },
}

// An assignee whose display name the directory could not resolve — they left
// the Organization, or never had a name. The opaque id the server DID send is
// never a fallback, and no name may be borrowed from a neighbouring row.
export const AssignmentWithUnresolvedName: Story = {
  args: {
    getInboxItemHistory: historyFn([
      assignment('2026-03-01T10:00:00Z', { id: GRACE_ID, name: 'Grace Hopper' }),
      historyEvent('2026-03-01T11:00:00Z', {
        kind: 'assignment',
        reason: 'reassign',
        previousAssignee: GRACE_ID,
        nextAssignee: FORMER_MEMBER_ID,
        previousAssigneeDisplayName: 'Grace Hopper',
        nextAssigneeDisplayName: null,
        bulkId: null,
      }),
      historyEvent('2026-03-01T12:00:00Z', {
        kind: 'assignment',
        reason: 'release',
        previousAssignee: FORMER_MEMBER_ID,
        nextAssignee: null,
        previousAssigneeDisplayName: null,
        nextAssigneeDisplayName: null,
        bulkId: null,
      }),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const unresolvedSentence = 'Ada Lovelace assigned this to Unknown user'
    const unresolved = await canvas.findByText(sentence(unresolvedSentence))
    await expect(unresolved).toBeVisible()

    // A resolved assignee still reads by name, so the neutral placeholder above
    // is the missing-name branch rather than the whole component giving up.
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Ada Lovelace assigned this to Grace Hopper',
      unresolvedSentence,
      'Ada Lovelace unassigned this',
    ])

    const line = eventLines(canvas, unresolvedSentence)[0]
    // Not the id the server sent...
    await expect(line).not.toContain(FORMER_MEMBER_ID)
    // ...and not the name sitting one row above it either.
    await expect(line).not.toContain('Grace Hopper')
    expectsNoRawIds(canvasElement)
  },
}

// ─── the topic chips under the guest's words ─────────────────────────────────

/**
 * A finished analysis that found nothing worth showing: no aspect was
 * mentioned, and `medium` sits below the "worth a look" line that `urgent` and
 * `high` share. `ready` is the important part — the component has separate
 * copy for `none` and `unavailable`, and neither of those sentences may stand
 * in for a successful analysis with an empty result.
 */
const NO_SIGNAL_ANALYSIS = {
  status: 'ready',
  sentiment: 'neutral',
  aspects: [],
  primaryCategory: 'service',
  attention: 'medium',
  generatedAtEpochMillis: Date.parse('2026-03-01T09:10:00Z'),
} as const satisfies InboxReviewAnalysis

// Nothing at all, not an empty container: a bare `<ul aria-label="Review
// topics">` is announced as "Review topics, list, 0 items" — a promise of
// content to a screen reader — and still takes its share of the guest
// article's gap for a sighted one.
export const AnalysisReadyWithNoSignals: Story = {
  args: { detail: { ...reviewDetail, analysis: NO_SIGNAL_ANALYSIS } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(REVIEW_TEXT)).toBeVisible()

    await expect(canvas.queryByRole('list', { name: 'Review topics' })).toBeNull()
    await expect(canvas.queryByRole('listitem')).toBeNull()
    await expect(canvas.queryByText('Needs attention')).toBeNull()
    // And no status line either — `ready` is not `none`, so neither of the
    // component's two sentences is a fallback for an empty ready analysis.
    await expect(canvas.queryByText(/review signals/i)).toBeNull()
  },
}

// The same empty aspect list one step up the attention scale. `high` is above
// the line, so the row renders for the attention chip alone — which is what
// makes the story above a statement about the attention level rather than a
// component that gave up whenever `aspects` is empty.
export const AnalysisReadyNeedsAttentionOnly: Story = {
  args: {
    detail: {
      ...reviewDetail,
      analysis: { ...NO_SIGNAL_ANALYSIS, attention: 'high' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('list', { name: 'Review topics' })).toBeVisible()
    await expect(canvas.getByText('Needs attention')).toBeVisible()
  },
}

// ─── a value, or a kind, this bundle has never heard of ──────────────────────

// The only honest rendering of a sentence this client cannot write is silence
// — the same rule the node already states for a sixth history kind. A row that
// kept its timestamp and its actor while losing its sentence would put a
// manager's name against an event the reader cannot see, and `Reopened —
// undefined` would put it against a broken one. On the rail, silence means NO
// NODE: an empty item would still draw a disc and a connector.
export const UnknownEnumValuesRenderNothing: Story = {
  args: {
    getInboxItemHistory: historyFn([
      historyEvent('2026-03-01T09:05:00Z', {
        ...openedFromGoogle,
        openedReason: FUTURE_OPENED_REASON,
      }),
      // A reason the client cannot spell, carrying free text the manager wrote:
      // the explanation must not survive the sentence that would frame it.
      historyEvent('2026-03-01T10:00:00Z', {
        kind: 'cycle_opened',
        openedReason: 'manual_reopen',
        manualReopenReason: FUTURE_REOPEN_REASON,
        manualReopenExplanation: FUTURE_ROW_EXPLANATION,
        supersedesCycleNumber: null,
        sourceRevision: 1,
      }),
      historyEvent('2026-03-02T08:00:00Z', {
        kind: 'handling_outcome',
        outcome: FUTURE_OUTCOME,
        outcomeRevision: 1,
        deadlineResult: 'on_time',
        completionAt: new Date('2026-03-02T08:00:00Z'),
        supersedesOutcomeId: null,
      }),
      // The one row this bundle does understand. Without it, "no row rendered"
      // would pass just as well if the whole query had failed to arrive.
      escalation('2026-03-02T09:00:00Z', 'escalated'),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Ada Lovelace escalated this'))

    // Four entries came back and one node rendered: no disc, no orphaned
    // timestamp, and no actor standing next to an empty sentence.
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Ada Lovelace escalated this',
    ])
    expectWellFormedRail(canvasElement)
    await expect([...canvasElement.querySelectorAll('time')]).toHaveLength(2)

    // Not a half-written sentence, and not the manager's free text under one.
    await expect(canvas.queryByText(/undefined/i)).toBeNull()
    await expect(canvas.queryByText(FUTURE_ROW_EXPLANATION)).toBeNull()
    // Nor the raw column value, humanised or otherwise.
    await expect(canvasElement.textContent ?? '').not.toContain('referred_to_legal')
    await expect(canvasElement.textContent ?? '').not.toContain('policy engine')
  },
}

// A sixth history KIND reaching an older client — a server that grew the
// union ships without this bundle. The row is silence and no node, and the
// rows around it are untouched.
export const UnknownEventKindRendersNothing: Story = {
  args: {
    getInboxItemHistory: historyFn([
      openedByGoogle('2026-03-01T09:05:00Z'),
      futureKindEvent('2026-03-01T10:00:00Z'),
      escalation('2026-03-01T11:00:00Z', 'escalated'),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(sentence('Ada Lovelace escalated this'))
    await expect(railReading(canvasElement)).toEqual([
      'Guest review',
      'Opened from Google',
      'Ada Lovelace escalated this',
    ])
    expectWellFormedRail(canvasElement)
    // The guest's `<time>` and one per event that rendered — none for the
    // unknown row.
    await expect([...canvasElement.querySelectorAll('time')]).toHaveLength(3)
    await expect(canvasElement.textContent ?? '').not.toContain('sla')
  },
}
export const UnknownEventKindRendersNothingPhone = onPhone(UnknownEventKindRendersNothing)

// ─── an ENTRY KIND this bundle has never heard of ────────────────────────────

/**
 * `LedgerEntry` is shared through the rebuild's contract and still growing, so
 * both of the thread's last arms have to fail closed on a kind nobody wrote a
 * node for. `ThreadRow`'s already did; the React KEY was still reaching
 * `'guest'` through `default:`, which fails open twice — a new member compiles
 * silently, and then every entry of that kind claims the one constant key
 * `'guest'`. In a list React reconciles BY key that is not a cosmetic warning:
 * duplicate keys drop rows and hand one entry's state to another's.
 *
 * The compiler refuses an out-of-union entry, which is the point of the fix and
 * also why this assertion calls the key builder directly with a cast fixture —
 * `buildThread` and `foldEarlierEvents` can only ever emit the kinds this
 * bundle knows, so no amount of rendering reaches the arm. `as unknown as
 * ThreadEntry` is the same device the enum stories above use: the state a
 * running client is actually in after the server grows a kind, not a
 * hypothetical.
 */
const FUTURE_ENTRY = {
  kind: 'sla_breached',
  at: new Date('2026-03-03T09:00:00Z'),
} as unknown as ThreadEntry

const FOLD_ENTRY: LedgerEntry = {
  kind: 'fold',
  at: new Date('2026-03-01T09:05:00Z'),
  events: [],
}

export const FutureEntryKindDoesNotStealTheGuestKey: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The thread still renders the kinds it does know...
    await expect(canvas.getByRole('article', { name: 'Guest review' })).toBeVisible()

    // ...and a kind it does not gets a key of its own, distinct from the
    // guest's, from the fold's, and from every other entry of the same unknown
    // kind.
    const first = entryKey(FUTURE_ENTRY, 3)
    const second = entryKey(FUTURE_ENTRY, 4)
    const guest = entryKey({ kind: 'guest', at: new Date() }, 0)
    expect(first).not.toBe(guest)
    expect(first).not.toBe(entryKey(FOLD_ENTRY, 1))
    expect(first).not.toBe(second)
    // The fold keeps ONE key in both of its states, which is what lets its
    // toggle keep focus across the click that relabels it.
    expect(entryKey(FOLD_ENTRY, 1)).toBe(entryKey(FOLD_ENTRY, 7))
  },
}

// ─── light theme ─────────────────────────────────────────────────────────────

// BQC-6.8: the light theme runs the same axe pass, on the busiest threads — the
// full rail with a toned reply disc and amber notes, and a folded history.
export const WithEventsLight: Story = {
  parameters: { theme: 'light' },
  args: {
    notes: interleavedNotes,
    detail: { ...reviewDetail, reply: REPLIES.liveOnGoogle },
    getInboxItemHistory: historyFn(everyKind),
  },
}

export const FoldedHistoryLight: Story = {
  ...ExpandedHistory,
  parameters: { theme: 'light' },
}

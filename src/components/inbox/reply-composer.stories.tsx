// Region 4 of the detail pane — `ReplyComposer`, with its REAL slots.
//
// The region owns no form. What it owns is everything around one: the pinned
// container, the Reply / Note segment, row 9's editing band, and the rule that
// there is exactly one primary button inside it. None of that is observable
// against placeholder slots, so the host below stands in for the pane and hands
// the region the same two children the pane does — `ReplyStatusView` (which
// routes the compose box and the published editor) and `InboxNotesThread`.
//
// The host is a faithful stand-in, not a convenience:
//
//   * it holds `mode`, so the segment is controlled the way the pane controls it;
//   * it holds the half-typed NOTE, which is what carries a note across a
//     change of SELECTION (the form is keyed by item);
//   * it holds the SAVED reply and re-seeds the compose box from it, which is
//     what the pane's write-through cache patch does
//     (`useReplyActions` → `onReplyChanged({ kind: 'draft_saved' })` →
//     `detail.reply.text` → `initialText`).
//
// What the host no longer has to compensate for is the mode switch. The segment
// is still a Radix tab set, but BOTH of its panels are force-mounted now and
// the inactive one carries `hidden` (`reply-composer.tsx`), so neither surface
// loses what is in it: a half-typed reply and a half-typed note both survive a
// round trip, and `ReplyDraftSurvivesNoteRoundTrip` /
// `NoteSurvivesReplyRoundTrip` are the two halves of that. The inactive panel
// is out of the accessibility tree, the tab order and every `getByRole` query,
// which is why the checks below read presence through role queries and read
// "gone from the manager's view" as `not.toBeVisible()` rather than as `null`.
//
// Assertions here are content, roles, accessible names and behaviour only: the
// storybook Vitest project compiles no Tailwind, so nothing may be read off
// geometry. "Primary" is therefore read from `data-variant`, which `Button`
// stamps from its variant — the only non-visual record of the design intent
// that row 8 pins ("Only `Submit for approval` is `variant="default"`") — and
// counted over the VISIBLE panel only, for the same reason.
//
// The autosave STATUS is assertable from here, and the stories under "the save
// state" do it: the status is printed in the dock's HEAD now (plan v2.1 row 16,
// `composer-mode-row.tsx`), reported up from `ReplyCompose` through the dock's
// context, so what is pinned here is that the REAL composer reaches the head —
// `Saving…`, `Saved`, `Not saved` — rather than a stand-in surface
// (`composer-dock.stories.tsx` owns the per-status copy map).
//
// ── PR 4, the dock (plan v2.1 rows 14-19) ───────────────────────────────────
//
// The region is one bordered box: head (segment + state), text, foot (assist
// tools, count, one primary). The reply language is NOT in the chrome any
// more: it only ever chose between the property default and the review's
// language (`ReplyLanguageTarget`, `reply-language-options.ts`), and only AI
// drafting and template loading read it — templates are per-language
// (`reply-template-operations.ts:137` filters, `:304` stamps the tag), an AI
// draft is stamped the same way (`ai-suggested-draft-store.ts:360`), and a
// hand-typed draft only records the tag (`reply-operations.ts:325`). So the
// choice lives inside `Draft with AI ▾` (`Write in`) and `Template ▾`
// (`Templates in`), and the result tag at the top of the text names the
// language an assist action used.
//
// The client also reads the language for a hand-typed reply: automatic detection
// stops autosave and Submit. The assist-menu trigger names the current choice,
// while Submit is described by why it is refused when the language is unresolved.
//
// "The state matrix" at the end of this file walks every state the plan names
// — empty, with text, AI draft, library template, local safe template, note
// empty, note with text, read-only reply, the editing band, no property
// default, a disabled auto-detect, the autosave states — at 720 AND 390. The
// 390 twins run in a real 390 px window (`mobileStaff`; see
// `reply-composer-collapsed.stories.tsx` for the probe) with the pane's
// `collapse` wired, so each one starts COLLAPSED on the bar where the pane
// would, opens it the way a manager does, and then asserts the same things.
// Every language assertion OPENS the menu that holds the language: that the
// combobox is gone proves nothing on its own.
import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import { hasPendingComposerWork } from './composer-policy'
import { FeedbackHandlingBody } from './feedback-handling-body'
import { feedbackHandlingAction } from './feedback-handling-presentation'
import { InboxNotesThread } from './inbox-notes-thread'
import { ReplyComposer } from './reply-composer'
import { ReplyStatusView, resolveReplyView } from './reply-status-view'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import type { ComposerMode } from './reply-composer'
import type { ReplyData, ReplyEditTarget } from './reply-status-view'
import type { ReplySuggestionResult, ReplyTone } from './reply-editor-compose'
import type {
  ReplyLanguageTarget,
  ReviewLanguageReadiness,
} from './reply-language-options'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'
import type { FeedbackHandlingState } from '#/contexts/inbox/application/public-api'
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'

type Reply = Exclude<NonNullable<ReplyData>, { kind: 'google_observation' }>

const NOW = new Date('2026-09-01T09:00:00Z')
const REVIEW_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '10000000-0000-4000-8000-000000000101'
const ITEM_ID = 'rev-composer'

const DRAFT_TEXT = 'Thank you for the kind words — we will pass them to the front desk.'
const PUBLISHED_TEXT = 'Thank you for staying with us. We hope to welcome you again.'
const SUGGESTED_TEXT =
  'Thank you for the thoughtful review. We are glad you enjoyed your visit.'
const NOTE_TEXT = 'Chase housekeeping about the late turndown'

/** The sentences row 8 deleted from the resting composer. Neither may return. */
const REMOVED_EXPLANATION = /recommended because/i
const REMOVED_LOCK_LINE = /Nothing is published automatically/i

/** Row 8's explanations, now tooltips rather than a `basis-full` paragraph. */
const AI_EXPLANATION =
  'AI drafting is recommended because this review has enough specific text.'
const TEMPLATE_EXPLANATION = 'A template is recommended because this review has no text.'

/** The line row 14 deleted under the box — neither its clause nor its words return. */
const REMOVED_SAVE_LINE = /publishes only after approval|Draft saved|Saving draft/i
/** The dock head's save state (row 16), in its three words. */
const SAVING_STATE = 'Saving…'
const SAVED_STATE = 'Saved'
const NOT_SAVED_STATE = 'Not saved'
const AUTOSAVE_ERROR = 'Draft could not be saved. Retry before submitting.'
/** Note mode's head slot and the note surface's name (rows 16, 19). */
const NOT_VISIBLE = 'Not visible to the guest'
const NOTE_SURFACE_NAME = 'Internal note, not visible to the guest'

const EDITING_BAND = 'Editing a live reply · republishes to Google'
/** The standing alert row 18 turned into a menu row. It must not come back. */
const LANGUAGE_ALERT = 'Property reply language not set'

// ── Hotel Elegance: a Turkish review at a Bulgarian property ────────────────
//
// The matrix's fixtures. Two languages that are NOT equivalent, so both
// `Write in` rows exist and a regenerate has somewhere else to go — the meta's
// default pair (`en-Latn` / `en-Latn-US`) folds into one option by design
// (`replyLanguageOptions`), which is right for the behaviour stories and
// useless for proving where the language went.

const BULGARIAN = 'bg-Cyrl'
const TURKISH = 'tr-Latn-TR'
const HOTEL_LANGUAGES = {
  propertyDefaultReplyLanguage: BULGARIAN,
  reviewReplyLanguage: TURKISH,
} as const

const BG_AI_TEXT = 'Благодарим Ви за чудесния отзив! Очакваме Ви отново в Hotel Elegance.'
const TR_AI_TEXT =
  'Harika yorumunuz için teşekkür ederiz! Sizi yeniden Hotel Elegance’ta bekleriz.'
const BG_SAFE_TEXT =
  'Благодарим Ви, че споделихте мнението си. Ценим обратната Ви връзка.'
const BG_TEMPLATE = { id: 'tpl-bg-praise', title: 'Thank-you, praise' } as const
const TR_TEMPLATE = { id: 'tpl-tr-praise', title: 'Teşekkür, övgü' } as const
const TEMPLATE_TEXT: Readonly<Record<string, string>> = {
  [BG_TEMPLATE.id]: 'Благодарим Ви за отзива — радваме се, че сте харесали престоя.',
  [TR_TEMPLATE.id]: 'Yorumunuz için teşekkürler — konaklamanızı beğendiğinize sevindik.',
}

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId('22222222-2222-4222-8222-222222222222'),
    reviewId: reviewId(REVIEW_ID),
    organizationId: organizationId('33333333-3333-4333-8333-333333333333'),
    text: DRAFT_TEXT,
    replyLanguageTag: 'en-Latn',
    status: 'draft',
    source: 'internal',
    createdBy: userId('44444444-4444-4444-8444-444444444444'),
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationCycle: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
    templateId: overrides.templateId ?? null,
    templateVersion: overrides.templateVersion ?? null,
  }
}

const publishedReply = makeReply({
  text: PUBLISHED_TEXT,
  status: 'published',
  approvedBy: userId('44444444-4444-4444-8444-444444444444'),
  stateRevision: 4,
  submittedAt: NOW,
  approvedAt: NOW,
  publishedAt: NOW,
  publicationState: 'published',
  publicationAttempts: 1,
  publicationCycle: 1,
})

// ── the slots' callbacks ─────────────────────────────────────────────────────

const onSaveDraft = fn(async (_text: string) => undefined).mockName('onSaveDraft')
const onSubmitReply = fn(async () => undefined).mockName('onSubmitReply')
const onDeleteDraft = fn(async () => undefined).mockName('onDeleteDraft')
const onSaveEdit = fn(async (_text: string) => undefined).mockName('onSaveEdit')
const onEditDone = fn(() => {}).mockName('onEditDone')
const onNoteAdded = fn((_revision: number) => {}).mockName('onNoteAdded')
/** The two dialog openers row 10's primary calls. */
const onMark = fn(() => {}).mockName('onMark')
const onCorrect = fn(() => {}).mockName('onCorrect')

const addInboxNote = mockServerFn(async () => ({
  ok: true,
})) as unknown as typeof addInboxNoteFn

const emptyTemplateLibrary = (): ReplyTemplateListResult => ({
  profile: null,
  groups: [],
  recommendedTemplateId: null,
})
const onListTemplates = fn(async () => emptyTemplateLibrary())
const onLoadTemplate = fn(async (templateId: string) => ({
  text: 'Library template',
  replyLanguageTag: 'en-Latn',
  templateId,
  templateVersion: 1,
}))
const onGenerateSuggestion = fn(async (): Promise<ReplySuggestionResult> => ({
  status: 'ready',
  profileVersion: 'reply-draft-v2',
  replyText: SUGGESTED_TEXT,
  provenanceToken: 'storybook-provenance-token',
  expiresAtEpochMillis: Date.now() + 60_000,
  baseReplyStateRevision: 0,
  concreteLanguageTag: 'en-Latn',
})).mockName('onGenerateSuggestion')

/**
 * The Hotel Elegance generator: answers in the language of the TARGET it was
 * asked for, which is what the governed AI boundary does — so a regenerate in
 * the other target visibly produces the other language, and the composer's own
 * verification (`resolveSuggestedReplyLanguageTag`) accepts it. A template-only
 * request is the local safe template, in the property's language.
 */
const onGenerateByTarget = fn(
  async (
    _tone: ReplyTone,
    target: ReplyLanguageTarget,
    templateOnly?: boolean,
    _idempotencyKey?: string,
  ): Promise<ReplySuggestionResult> => {
    if (templateOnly) {
      return {
        status: 'fallback',
        kind: 'local_safe_template',
        reason: 'template_requested',
        languageSource: 'explicit',
        replyText: BG_SAFE_TEXT,
        concreteLanguageTag: BULGARIAN,
      }
    }
    const inReviewLanguage = target.kind === 'review_language'
    return {
      status: 'ready',
      profileVersion: 'reply-draft-v2',
      replyText: inReviewLanguage ? TR_AI_TEXT : BG_AI_TEXT,
      provenanceToken: 'storybook-provenance-token',
      expiresAtEpochMillis: Date.now() + 60_000,
      baseReplyStateRevision: 0,
      concreteLanguageTag: inReviewLanguage ? TURKISH : BULGARIAN,
    }
  },
).mockName('onGenerateByTarget')

/** One template per language, as `reply-template-operations.ts:137` filters them. */
const onListByTarget = fn(
  async (target: ReplyLanguageTarget): Promise<ReplyTemplateListResult> => {
    const inReviewLanguage = target.kind === 'review_language'
    const template = inReviewLanguage ? TR_TEMPLATE : BG_TEMPLATE
    const languageTag = inReviewLanguage ? TURKISH : BULGARIAN
    return {
      profile: null,
      groups: [
        {
          languageGroup: inReviewLanguage ? 'tr-Latn' : 'bg-Cyrl',
          templates: [
            { ...template, aspect: null, openLabel: null, languageTag, version: 1 },
          ],
        },
      ],
      recommendedTemplateId: template.id,
    }
  },
).mockName('onListByTarget')

/** Loads the template and stamps the target's language, as `:304` does. */
const onLoadByTarget = fn(async (templateId: string, target: ReplyLanguageTarget) => ({
  text: TEMPLATE_TEXT[templateId] ?? 'Template',
  replyLanguageTag: target.kind === 'review_language' ? TURKISH : BULGARIAN,
  templateId,
  templateVersion: 1,
})).mockName('onLoadByTarget')

// ── the pane, as much of it as region 4 can see ──────────────────────────────

type ComposerInPaneProps = Readonly<{
  /** Which surfaces the region offers, in order. Omitted → both. */
  modes?: readonly ComposerMode[]
  /** The mode the pane arrives holding. Session state there, so it is a seed. */
  startMode?: ComposerMode
  reply: Reply | null
  editTarget: ReplyEditTarget
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  reviewLanguageReadiness: ReviewLanguageReadiness
  isSaving?: boolean
  onGenerateSuggestion?:
    | ((
        tone: ReplyTone,
        target: ReplyLanguageTarget,
        templateOnly?: boolean,
        _idempotencyKey?: string,
      ) => Promise<ReplySuggestionResult>)
    | undefined
  /**
   * Hand the composer Hotel Elegance's per-language library
   * (`onListByTarget` / `onLoadByTarget`) instead of an empty one.
   */
  library?: boolean
  /** The pane column's width in px. Omitted → the story canvas's own. */
  width?: number
  /**
   * Wire row 15's `collapse` the way the pane does. Inert on a desktop window
   * (the region asks `useIsMobile()`); in the 390 px window it is what makes
   * the region open on the bar.
   */
  collapsible?: boolean
  /** Set by `onPhone`: the play expects the bar before anything else. */
  phone?: boolean
  /**
   * How many autosave attempts reject before one is allowed to succeed.
   *
   * The pane's `onSaveDraft` is a real server round trip and it can fail; every
   * other story here uses one that always resolves, so the footer's `error`
   * branch — `Draft not saved`, `Retry save`, and the `canSubmit` guard that
   * reads `autosave.status !== 'error'` — needs a story that makes it fail.
   * A COUNT rather than a flag so `Retry save` has something to recover to.
   */
  saveFailures?: number
  /**
   * The handling cycle a feedback item's primary reads, or `undefined` for a
   * review — which is every story above, and which passes NO slot at all.
   *
   * `undefined` rather than `null` on purpose: the region reads a non-null
   * `singleModePrimarySlot` for more than its contents (it is what moves the
   * note form into its own scroller so the primary stays pinned at the foot),
   * so "a review item" and "a feedback item whose reader may not handle it"
   * have to be two different things here, exactly as they are in the pane.
   */
  handling?: FeedbackHandlingState
  /** `inbox.write ∧ feedback.handle`, which the pane derives from the role. */
  canHandle?: boolean
}>

type StoryReplySlotProps = Readonly<{
  view: ReturnType<typeof resolveReplyView>
  editTarget: ReplyEditTarget
  isSaving: boolean
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  reviewLanguageReadiness: ReviewLanguageReadiness
  generate: ComposerInPaneProps['onGenerateSuggestion']
  library: boolean
  saved: Reply | null
  saveDraft: ComponentProps<typeof ReplyStatusView>['onSaveDraft']
}>

function storyReplySlot(props: StoryReplySlotProps): ReactNode {
  const { view, editTarget } = props
  if (view.kind !== 'compose' && editTarget === null) return null

  return (
    <ReplyStatusView
      propertyId={PROPERTY_ID}
      view={view}
      editTarget={editTarget}
      caretRequest={0}
      isSaving={props.isSaving}
      propertyDefaultReplyLanguage={props.propertyDefaultReplyLanguage}
      reviewReplyLanguage={props.reviewReplyLanguage}
      reviewLanguageReadiness={props.reviewLanguageReadiness}
      onSaveDraft={props.saveDraft}
      onSubmitReply={onSubmitReply}
      onDeleteDraft={props.saved ? onDeleteDraft : undefined}
      onSaveEdit={onSaveEdit}
      onEditDone={onEditDone}
      onGenerateSuggestion={props.generate}
      onListTemplates={props.library ? onListByTarget : onListTemplates}
      onLoadTemplate={props.library ? onLoadByTarget : onLoadTemplate}
    />
  )
}

function storyCollapse(
  collapsible: boolean,
  view: ReturnType<typeof resolveReplyView>,
  noteText: string,
  onExpand: (mode: ComposerMode) => void,
): NonNullable<ComponentProps<typeof ReplyComposer>['collapse']> | undefined {
  if (!collapsible) return undefined
  return {
    itemId: ITEM_ID,
    hasPendingWork: hasPendingComposerWork({
      itemId: ITEM_ID,
      replyView: view,
      noteDraft: { itemId: ITEM_ID, text: noteText },
      reopen: 'idle',
    }),
    onExpand,
  }
}

function storyFeedbackPrimary(
  handling: FeedbackHandlingState | undefined,
  canHandle: boolean,
): ReactNode {
  if (!handling) return null
  return (
    <FeedbackHandlingBody
      state={handling}
      canHandle={canHandle}
      onMark={onMark}
      onCorrect={onCorrect}
    />
  )
}

function itemActionTakesAccent(
  modes: readonly ComposerMode[] | undefined,
  handling: FeedbackHandlingState | undefined,
  canHandle: boolean,
): boolean {
  return (
    modes?.length === 1 &&
    modes[0] === 'note' &&
    canHandle &&
    handling !== undefined &&
    feedbackHandlingAction(handling) === 'correct'
  )
}

function useStoryReplyState(reply: Reply | null, saveFailures: number) {
  const attempts = useRef(0)
  const [saved, setSaved] = useState<Reply | null>(reply)
  const saveDraft: ComponentProps<typeof ReplyStatusView>['onSaveDraft'] = async (
    text,
    provenanceToken,
    replyLanguageTag,
  ) => {
    await onSaveDraft(text)
    attempts.current += 1
    if (attempts.current <= saveFailures) throw new Error('Draft could not be saved')
    setSaved((current) =>
      makeReply({
        ...(current ?? {}),
        text,
        status: 'draft',
        replyLanguageTag: replyLanguageTag ?? null,
        aiGenerated: provenanceToken !== undefined,
      }),
    )
  }
  return { saved, saveDraft }
}

function ComposerInPane({
  modes,
  startMode = 'reply',
  reply,
  editTarget,
  propertyDefaultReplyLanguage,
  reviewReplyLanguage,
  reviewLanguageReadiness,
  isSaving = false,
  onGenerateSuggestion: generate,
  library = false,
  width,
  collapsible = false,
  saveFailures = 0,
  handling,
  canHandle = true,
}: ComposerInPaneProps) {
  const [mode, setMode] = useState<ComposerMode>(startMode)
  // Hoisted for exactly the reason the pane hoists it — and that reason is no
  // longer the mode switch. Both panels are force-mounted, so the form is not
  // destroyed by a glance at the reply box; what this still carries is a note
  // across a change of selection, because the form is keyed by item.
  const [noteText, setNoteText] = useState('')
  // The saved reply, standing in for the detail cache. `onSaveDraft` patches it
  // the way `onReplyChanged({ kind: 'draft_saved' })` patches the query cache,
  // so a compose box that does remount seeds from the saved text. It no longer
  // remounts on a mode flip — that is what force-mounting the panels fixed —
  // but it still does on a change of selection, where the pane keys it by item.
  const storyReply = useStoryReplyState(reply, saveFailures)
  const { saved } = storyReply
  const view = resolveReplyView(saved)
  // The pane's pairing, mirrored (`inbox-detail-content.tsx:433`): `correct`
  // — and ONLY `correct` — demotes `Add note` to `outline` and keeps the
  // region's accent to itself.
  //
  // `mark` does not, and the asymmetry is the fix for finding 4 rather than an
  // oversight. `feedbackHandlingAction` reads the CURRENT cycle
  // (`status === 'open'`), while `handling-outcome-authority.ts` refuses an
  // outcome forever and item-wide once any cycle closed as `guest_withdrawn` or
  // `source_ineligible` — and such an item can still acquire a later open
  // cycle. So `Mark as handled` can be refused every time it is taken, after
  // the dialog has collected an outcome and an internal note that are discarded
  // with the refusal. A correction cannot: it supersedes an outcome the server
  // has already accepted for this item, so the action is known to be permitted.
  // Only the second one earns the right to be the only thing in the region
  // worth pressing. If this expression ever drifts back to `!== null`, this
  // file stops mirroring the pane and starts asserting a pairing production no
  // longer produces — which is exactly what it did before this pass.
  //
  // `modes` is part of the condition because the pane's is: a feedback item is
  // always `['note']`, and the region drops the slot for every other shape, so
  // demoting the note submit there would leave the region with no accent at
  // all. Both drop-cases are pinned by the two stories at the end of this
  // block.
  const itemActionTakesTheAccentAlone = itemActionTakesAccent(modes, handling, canHandle)
  const collapse = storyCollapse(collapsible, view, noteText, setMode)

  return (
    <div style={width === undefined ? undefined : { width }} className="flex flex-col">
      <ReplyComposer
        mode={mode}
        onModeChange={setMode}
        modes={modes}
        hideUnavailableModesOnMobile={view.kind === 'mirror' || view.kind === 'published'}
        editTarget={editTarget}
        // The pane's own wiring (`inbox-detail-content.tsx`), including its
        // pending-work rule, read from the same two pieces of host state.
        collapse={collapse}
        replySlot={storyReplySlot({
          view,
          editTarget,
          isSaving,
          propertyDefaultReplyLanguage,
          reviewReplyLanguage,
          reviewLanguageReadiness,
          generate,
          library,
          saved,
          saveDraft: storyReply.saveDraft,
        })}
        noteSlot={
          <InboxNotesThread
            inboxItemId={ITEM_ID}
            expectedCommandRevision={1}
            onNoteAdded={onNoteAdded}
            addInboxNote={addInboxNote}
            draftText={noteText}
            onDraftChange={setNoteText}
            submitVariant={itemActionTakesTheAccentAlone ? 'outline' : 'default'}
          />
        }
        // Row 10's primary, as the pane hands it over: a NODE, so this file
        // still contains no button and no mutation of its own.
        //
        // `FeedbackHandlingBody` rather than `FeedbackHandlingPrimary` is the
        // deliberate cut. The body is the whole of what the region can see — four
        // states, one node — while the wrapper adds the dialog, the permission
        // pair read off `usePermissions`, and the two commands, none of which the
        // REGION has an opinion about. Spies stand in for the two openers, so
        // these stories can assert that a click reaches the command the state
        // chose; that the dialog then opens is proven where the wiring lives, at
        // the pane level in `inbox-feedback-pane.stories.tsx`.
        singleModePrimarySlot={storyFeedbackPrimary(handling, canHandle)}
      />
    </div>
  )
}

// ── shared assertions ───────────────────────────────────────────────────────

/**
 * Row 8's one-primary rule, read from `data-variant` because the project
 * compiles no CSS. Every primary in the region comes from a SLOT — the segment,
 * the language control and the editing band are deliberately not buttons at
 * all — so this counts across the whole region rather than per slot.
 *
 * Scoped to `button` elements on purpose: `TabsList` also carries a
 * `data-variant="default"` (its pill-vs-line shape), and `Button asChild` lets
 * the child's `data-slot` win, so neither the tag alone nor `data-slot` can be
 * the discriminator. `Review update` is one such child — an
 * `AlertDialogTrigger asChild`, which renders as
 * `data-slot="alert-dialog-trigger"` while keeping the button's variant.
 *
 * The rule is about what the manager can SEE, and both panels are mounted now,
 * so the hidden one's primary has to come out of the count — otherwise every
 * state reads as two (`Submit for approval` plus the note form's `Add note`)
 * and the check says nothing. The filter drops a subtree, not a slot: counting
 * inside the live panel instead would stop catching a primary added to the
 * region's own chrome, and `FeedbackSingleModeComposer` renders no
 * `tabs-content` at all.
 *
 * `expectAccents` is the same count, generalised, for the ONE shape row 10
 * leaves with two: an open feedback cycle, where `Mark as handled` may be
 * refused by the server every time it is taken and so does not get to be the
 * region's only accent — `Add note`, which always works, keeps its own beside
 * it. The order is the composer's own (note slot, then
 * `singleModePrimarySlot`), and passing both names claims the region has
 * exactly two accents rather than that one favourite is among them. Every
 * other state still goes through `expectSolePrimary`, because row 8's rule is
 * unchanged everywhere the exception does not apply.
 */
function expectAccents(canvasElement: HTMLElement, names: readonly string[]): void {
  const primaries = Array.from(
    canvasElement.querySelectorAll('button[data-variant="default"]'),
  ).filter((button) => button.closest('[data-slot="tabs-content"][hidden]') === null)
  expect(primaries).toHaveLength(names.length)
  names.forEach((name, index) => expect(primaries[index]).toHaveAccessibleName(name))
}

function expectSolePrimary(canvasElement: HTMLElement, name: string): void {
  const primaries = Array.from(
    canvasElement.querySelectorAll('button[data-variant="default"]'),
  ).filter((button) => button.closest('[data-slot="tabs-content"][hidden]') === null)
  expect(primaries).toHaveLength(1)
  expect(primaries[0]).toHaveAccessibleName(name)
  expect(primaries[0]).toBeVisible()
}

/**
 * The sentences rows 8, 14 and 18 deleted. None may reappear as prose: the
 * recommendation paragraph, the lock line, the save-state line under the box
 * with its folded guarantee, and the standing language alert.
 */
function expectNoRemovedSentences(canvasElement: HTMLElement): void {
  const prose = canvasElement.textContent ?? ''
  expect(prose).not.toMatch(REMOVED_EXPLANATION)
  expect(prose).not.toMatch(REMOVED_LOCK_LINE)
  expect(prose).not.toMatch(REMOVED_SAVE_LINE)
  expect(prose).not.toContain(LANGUAGE_ALERT)
}

/**
 * The drafting pair: both outline, recommended one first, and its reason on the
 * control's own `title` instead of the paragraph row 8 deleted.
 */
function expectDraftingControls(
  canvasElement: HTMLElement,
  recommended: 'ai' | 'template',
  explanation: string,
): void {
  const canvas = within(canvasElement)
  const ai = canvas.getByRole('button', { name: 'Draft with AI' })
  const template = canvas.getByRole('button', { name: 'Template' })
  // "not a colour" — neither drafting control may become the primary.
  expect(ai).toHaveAttribute('data-variant', 'outline')
  expect(template).toHaveAttribute('data-variant', 'outline')

  const [first, second] = recommended === 'ai' ? [ai, template] : [template, ai]
  const documentOrder = canvas.getAllByRole('button')
  expect(documentOrder.indexOf(first)).toBeLessThan(documentOrder.indexOf(second))
  expect(first).toHaveAttribute('title', explanation)
  expect(second).not.toHaveAttribute('title')
  expectNoRemovedSentences(canvasElement)
}

/**
 * Row 16: the reply's save state is ONE polite live region, in the dock's HEAD
 * — inside the `Tabs` root, outside every panel — and nothing under the box
 * prints a status line any more.
 */
function saveStateOf(canvasElement: HTMLElement): HTMLElement {
  const live = canvasElement.querySelectorAll('[aria-live="polite"]')
  expect(live).toHaveLength(1)
  const node = live[0]
  if (!(node instanceof HTMLElement)) throw new Error('No save state slot')
  expect(node.closest('[data-slot="tabs-content"]')).toBeNull()
  return node
}

function expectSaveState(canvasElement: HTMLElement, text: string): void {
  expect(saveStateOf(canvasElement).textContent).toBe(text)
  expectNoRemovedSentences(canvasElement)
}

/** Menus portal to `document.body`, outside the story canvas. */
const page = () => within(document.body)

const AI_TRIGGER = /^AI tone and language:/
const TEMPLATE_TRIGGER = 'Choose a reply template'

async function openMenu(trigger: string | RegExp): Promise<void> {
  await userEvent.click(page().getByRole('button', { name: trigger }))
  const menu = await page().findByRole('menu')
  await waitFor(() => expect(menu).toBeVisible())
}

async function closeMenu(): Promise<void> {
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(page().queryByRole('menu')).toBeNull())
}

/**
 * Row 17, read where the language now lives. Opens `Draft with AI ▾` and
 * checks the `Write in` rows — the selected one carries `aria-current` — then
 * opens `Template ▾` and checks its `Templates in` switch the same way. The
 * rows' names are the whole choice (`Bulgarian · property default`), so this
 * is also the label-in-name check for both menus.
 */
async function expectLanguageInBothMenus(
  selected: string,
  others: readonly string[],
): Promise<void> {
  await openMenu(AI_TRIGGER)
  const writeIn = within(page().getByRole('group', { name: 'Write in' }))
  expect(writeIn.getByRole('menuitem', { name: selected })).toHaveAttribute(
    'aria-current',
    'true',
  )
  for (const other of others) {
    expect(writeIn.getByRole('menuitem', { name: other })).not.toHaveAttribute(
      'aria-current',
    )
  }
  await closeMenu()
  await openMenu(TEMPLATE_TRIGGER)
  const templatesIn = within(page().getByRole('group', { name: 'Templates in' }))
  expect(templatesIn.getByRole('menuitem', { name: selected })).toHaveAttribute(
    'aria-current',
    'true',
  )
  for (const other of others) {
    expect(templatesIn.getByRole('menuitem', { name: other })).not.toHaveAttribute(
      'aria-current',
    )
  }
  await closeMenu()
}

/** The selected language is not repeated as a standalone foot-row control. */
function expectNoStandaloneLanguageControl(canvasElement: HTMLElement) {
  expect(
    within(canvasElement).queryByRole('button', { name: /^Reply language:/ }),
  ).toBeNull()
}

/**
 * The result tag as printed text (row 18). Matched on the element's whole
 * text because the tag is three spans — the lead word and two quiet parts —
 * and only on the two elements the tag can be: a fact (`p`) or a trigger.
 */
const tagText = (text: string) => (_: string, element: Element | null) =>
  element !== null &&
  ['P', 'BUTTON'].includes(element.tagName) &&
  element.textContent === text

/** Any result tag at all — for the states in which no assist action ran. */
const anyResultTag = (_: string, element: Element | null) =>
  element !== null &&
  ['P', 'BUTTON'].includes(element.tagName) &&
  /^(AI draft|Template) · /.test(element.textContent ?? '')

/**
 * How a 390 twin arrives: the region opens COLLAPSED on the bar (row 15)
 * unless the item carries work the bar would hide, and a tap on the bar opens
 * it onto that surface. `bar` is the bar the pane should show, or `null` for
 * a state that must open expanded. A desktop story skips all of it — the same
 * `collapse` object is inert above the breakpoint.
 */
async function arrive(
  canvasElement: HTMLElement,
  phone: boolean | undefined,
  bar: 'Reply…' | 'Add a note…' | null,
): Promise<void> {
  const canvas = within(canvasElement)
  if (!phone || bar === null) {
    expect(canvas.queryByRole('button', { name: 'Reply…' })).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Add a note…' })).toBeNull()
    return
  }
  const collapsedBar = canvas.getByRole('button', { name: bar })
  expect(collapsedBar).toHaveAttribute('aria-expanded', 'false')
  // Collapsed: no dock head, no live region, no writing surface on screen.
  expect(canvasElement.querySelectorAll('[aria-live="polite"]')).toHaveLength(0)
  expect(canvas.queryByRole('textbox')).toBeNull()
  await userEvent.click(collapsedBar)
  await waitFor(() => expect(canvas.queryByRole('button', { name: bar })).toBeNull())
}

const meta: Meta<typeof ComposerInPane> = {
  title: 'Inbox/ReplyComposer',
  component: ComposerInPane,
  tags: ['autodocs'],
  decorators: [withRole('PropertyManager')],
  args: {
    reply: null,
    editTarget: null,
    propertyDefaultReplyLanguage: 'en-Latn',
    reviewReplyLanguage: 'en-Latn-US',
    reviewLanguageReadiness: 'detectable',
    onGenerateSuggestion,
  },
}
export default meta
type Story = StoryObj<typeof ComposerInPane>

/** The desktop pane's share of a 1440 px split, and the canvas width. */
const PANE_WIDTH_PX = 720
/** The staff phone the sheet is designed at (plan row 20). */
const PHONE_WIDTH_PX = 390

/**
 * A 720 story in the pane's width, with the pane's `collapse` wired — inert
 * on a desktop window, exactly as it is on the desktop panel.
 */
function atPane(story: Story): Story {
  return {
    ...story,
    args: { ...story.args, width: PANE_WIDTH_PX, collapsible: true },
  }
}

/**
 * The same story's 390 twin: a 390 px window (`mobileStaff`, a real
 * `matchMedia` match — see `reply-composer-collapsed.stories.tsx`), the
 * column at the phone's width, and `phone` set so the play arrives through
 * the bar first. Fullscreen, so the canvas's 1 rem padding does not push a
 * 390 px column past a 390 px window.
 */
function onPhone(story: Story): Story {
  return {
    ...story,
    args: { ...story.args, width: PHONE_WIDTH_PX, collapsible: true, phone: true },
    parameters: {
      ...story.parameters,
      layout: 'fullscreen',
      viewport: { defaultViewport: 'mobileStaff' },
    },
  }
}

// ── resting states ──────────────────────────────────────────────────────────

/**
 * Nothing written yet — the region at rest, and where most of rows 8, 14-17 are
 * proved.
 *
 * One box (row 14): the head carries the segment with its SHORT labels and
 * key hints (row 15) and a state slot that says nothing yet — the composer has
 * saved nothing in this visit, and neither `Saved` nor `Not saved` is true of
 * an empty box (row 16). No line under the box, no recommendation paragraph,
 * no language combobox and no language alert: the language is inside the two
 * assist menus (row 17), and this story opens both to find it.
 */
export const EmptyAt720: Story = atPane({
  args: HOTEL_LANGUAGES,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await arrive(canvasElement, args.phone, 'Reply…')

    // The head: a real tablist, reply first and selected, short visible
    // labels inside the pinned accessible names, each with its key.
    const modeRow = canvas.getByRole('tablist')
    expect(
      within(modeRow)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['ReplyR', 'NoteN'])
    expect(canvas.getByRole('tab', { name: 'Public reply' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expectSaveState(canvasElement, '')
    // The head's live region is outside the writing surface; the writing
    // surface's panel is what holds the text and the foot.
    const replyBox = canvas.getByRole('textbox', { name: 'Public reply' })
    expect(replyBox).toHaveValue('')
    const replyPanel = replyBox.closest('[data-slot="tabs-content"]')
    expect(replyPanel).not.toBeNull()
    expect(modeRow.parentElement?.contains(saveStateOf(canvasElement))).toBe(true)
    expect(replyPanel?.contains(modeRow)).toBe(false)

    // Row 17: no combobox anywhere; the language is IN the menus — and, since
    // the PR 4 review, printed before any assist action runs.
    expect(canvas.queryByRole('combobox')).toBeNull()
    expectNoStandaloneLanguageControl(canvasElement)
    await expectLanguageInBothMenus('Bulgarian · property default', [
      'Turkish · review language',
    ])
    // No assist action has run, so there is no result tag.
    expect(canvas.queryByText(anyResultTag)).toBeNull()

    expectNoRemovedSentences(canvasElement)
    expectSolePrimary(canvasElement, 'Submit for approval')
    expectDraftingControls(canvasElement, 'ai', AI_EXPLANATION)
    // No edit is open, so row 9's band is absent and neither mode is locked.
    expect(canvas.queryByText(EDITING_BAND)).toBeNull()
    expect(canvas.getByRole('tab', { name: 'Internal note' })).not.toHaveAttribute(
      'aria-disabled',
    )
    // Nothing to delete yet.
    expect(canvas.queryByRole('button', { name: 'Delete draft' })).toBeNull()
  },
})

export const EmptyAt390: Story = onPhone(EmptyAt720)

/**
 * An existing draft: the text is there, and so is its Delete affordance. A
 * saved draft is work the bar would hide, so the phone opens EXPANDED.
 *
 * Typing into it walks the head's save state for real — through the 700 ms
 * debounce (`Saving…`) to the server (`Saved`) — which is row 16's channel
 * end to end: produced by `useReplyComposer` below the head, printed in it.
 */
export const ReplyWithTextAt720: Story = atPane({
  args: { ...HOTEL_LANGUAGES, reply: makeReply({ replyLanguageTag: BULGARIAN }) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    onSaveDraft.mockClear()
    await arrive(canvasElement, args.phone, null)
    const field = canvas.getByRole('textbox', { name: 'Public reply' })
    expect(field).toHaveValue(DRAFT_TEXT)
    expect(canvas.getByRole('button', { name: 'Delete draft' })).toBeEnabled()
    expect(canvas.getByRole('button', { name: 'Submit for approval' })).toBeEnabled()
    // Delete draft is a ghost, not a second primary.
    expectSolePrimary(canvasElement, 'Submit for approval')
    expectSaveState(canvasElement, '')
    // A hand-typed draft carries no result tag: nothing assisted it.
    expect(canvas.queryByText(anyResultTag)).toBeNull()
    await expectLanguageInBothMenus('Bulgarian · property default', [
      'Turkish · review language',
    ])

    fireEvent.change(field, { target: { value: `${DRAFT_TEXT} Thank you!` } })
    await waitFor(() => expect(saveStateOf(canvasElement).textContent).toBe(SAVING_STATE))
    await waitFor(
      () => expect(saveStateOf(canvasElement).textContent).toBe(SAVED_STATE),
      { timeout: 4_000 },
    )
    expect(onSaveDraft).toHaveBeenCalledWith(`${DRAFT_TEXT} Thank you!`)
    expectNoRemovedSentences(canvasElement)
  },
})

export const ReplyWithTextAt390: Story = onPhone(ReplyWithTextAt720)

/**
 * A draft that came from the model, reloaded. The provenance is the result tag
 * at the top of the text (row 18), not a sentence under the controls:
 * `hasAiDraft` is seeded from the saved reply's `aiGenerated`, and the language
 * is the tag the AI store stamped (`ai-suggested-draft-store.ts:360`), so the
 * tag survives the reload.
 *
 * It is a MENU here, because Hotel Elegance has a second target — the tag's
 * one row regenerates in Turkish. `Friendlier` and `Try again` remain available
 * as one-click rewrites beside the menus.
 */
export const SavedAiDraftAt720: Story = atPane({
  args: {
    ...HOTEL_LANGUAGES,
    reply: makeReply({
      text: BG_AI_TEXT,
      aiGenerated: true,
      replyLanguageTag: BULGARIAN,
    }),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await arrive(canvasElement, args.phone, null)
    expect(canvas.getByRole('textbox', { name: 'Public reply' })).toHaveValue(BG_AI_TEXT)
    const tag = canvas.getByRole('button', { name: 'AI draft · Bulgarian' })
    expect(tag).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.click(tag)
    await waitFor(() => expect(page().getByRole('menu')).toBeVisible())
    expect(
      page()
        .getAllByRole('menuitem')
        .map((row) => row.textContent),
    ).toEqual(['Regenerate in Turkish · review language'])
    await closeMenu()
    expect(canvas.getByRole('button', { name: 'Friendlier' })).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    expectSolePrimary(canvasElement, 'Submit for approval')
    expectNoRemovedSentences(canvasElement)
  },
})

export const SavedAiDraftAt390: Story = onPhone(SavedAiDraftAt720)

/**
 * A generated suggestion waiting to be adopted. Generating only PREVIEWS: the
 * box is untouched and nothing is saved until Use draft is pressed, which is
 * what keeps a model's wording out of a draft nobody agreed to.
 *
 * This is also the one state where the one-primary rule has ever been broken,
 * and the reason it went unnoticed for a PR: the count used to be taken at the
 * END of this play function, after Dismiss had already removed the preview, so
 * the only two-primary state in the region was the one state never counted.
 * `Use draft` was a bare `<Button>` — no `variant`, therefore `default`, the
 * same purple as `Submit for approval` — and the preview asked the manager to
 * choose between two identical-looking primaries, one of which discards what
 * they had. It is `outline` now, and the rule is asserted WHILE the preview is
 * open, which is the assertion that would have caught it.
 */
export const SuggestionAwaitingAdoption: Story = {
  play: async ({ canvas, canvasElement }) => {
    onGenerateSuggestion.mockClear()
    onSaveDraft.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: 'Draft with AI' }))

    const preview = await canvas.findByRole('region', { name: 'Draft suggestion' })
    expect(within(preview).getByText(SUGGESTED_TEXT)).toBeVisible()
    const useDraft = within(preview).getByRole('button', { name: 'Use draft' })
    const dismiss = within(preview).getByRole('button', { name: 'Dismiss' })
    expect(useDraft).toBeEnabled()
    expect(dismiss).toBeEnabled()

    // The count, taken with the preview on screen and its two controls in it.
    // `Submit for approval` is still the region's only primary: adopting a
    // suggestion is a secondary act, and discarding one is quieter still.
    expectSolePrimary(canvasElement, 'Submit for approval')
    expect(useDraft).toHaveAttribute('data-variant', 'outline')
    expect(dismiss).toHaveAttribute('data-variant', 'ghost')

    // Still a preview: the box is empty and no draft was written.
    expect(canvas.getByRole('textbox', { name: 'Public reply' })).toHaveValue('')
    expect(onSaveDraft).not.toHaveBeenCalled()
    expectNoRemovedSentences(canvasElement)

    // Dismissing leaves the composer exactly as it was.
    await userEvent.click(dismiss)
    await waitFor(() =>
      expect(canvas.queryByRole('region', { name: 'Draft suggestion' })).toBeNull(),
    )
    expectSolePrimary(canvasElement, 'Submit for approval')
  },
}

/**
 * Past the 4096-character limit. The counter turns destructive, the field is
 * `aria-invalid`, and the one primary refuses. The cap that keeps the footer
 * reachable is on the textarea rather than the region (the region is `shrink-0`
 * inside an `overflow-hidden` column, so anything it cannot fit is clipped and
 * unreachable) — geometry, and so not assertable in this project.
 */
export const OverLimit: Story = {
  args: { reply: makeReply({ text: 'x'.repeat(5000) }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(`5000/${MAX_REPLY_LENGTH}`)).toHaveClass('text-destructive')
    expect(canvas.getByRole('textbox', { name: 'Public reply' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(canvas.getByRole('button', { name: 'Submit for approval' })).toBeDisabled()
    expectSolePrimary(canvasElement, 'Submit for approval')
  },
}

/**
 * No property default reply language, and no recorded review language — the
 * draft starts on automatic detection.
 *
 * Row 18: the `Property reply language not set` alert no longer stands above
 * the box. It is ONE row in each language menu, beside the language choice it
 * explains — `Set property language` for a manager with `ai.manage`, the same
 * link the alert carried — with the readiness sentence as its description.
 * Neither the alert's title nor its sentence is printed in the composer.
 *
 * And the dead end the PR 4 review measured in this exact story: with no
 * default, a hand-typed reply is never autosaved and never submitted while the
 * language is being detected, and the screen used to print only `Not saved`
 * beside a disabled Submit with no description. Submit is now described by a
 * reason that names both ways out, while language stays inside the assist menus.
 */
export const NoPropertyDefaultAt720: Story = atPane({
  args: { propertyDefaultReplyLanguage: null, reviewReplyLanguage: null },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const reason =
      'We’ll detect this review’s language for this draft. Set a property default so future replies start in your local language.'
    const blocked =
      'This reply has no language yet. Draft with AI to detect the review’s language, or set a property reply language, to save and submit it.'
    await arrive(canvasElement, args.phone, 'Reply…')
    expect(canvas.queryByText(LANGUAGE_ALERT)).toBeNull()
    expect(canvas.queryByText(reason)).toBeNull()
    expectNoStandaloneLanguageControl(canvasElement)
    // Nothing typed: an empty box is refused by its emptiness, not by a reason.
    expect(canvas.queryByText(blocked)).toBeNull()

    await openMenu('AI tone and language: Professional, Detect automatically')
    const writeIn = within(page().getByRole('group', { name: 'Write in' }))
    expect(
      writeIn.getByRole('menuitem', { name: 'Detect automatically' }),
    ).toHaveAttribute('aria-current', 'true')
    const fix = writeIn.getByRole('menuitem', { name: 'Set property language' })
    expect(fix).toHaveAttribute(
      'href',
      expect.stringContaining(`/properties/${PROPERTY_ID}/settings/replies`),
    )
    expect(fix).toHaveAccessibleDescription(reason)
    await closeMenu()

    // The template menu has no switch here — neither detection nor an
    // unrecorded review language can filter the library — but the fix is
    // still one row of it.
    await openMenu(TEMPLATE_TRIGGER)
    expect(page().queryByRole('group', { name: 'Templates in' })).toBeNull()
    expect(
      page().getByRole('menuitem', { name: 'Set property language' }),
    ).toHaveAccessibleDescription(reason)
    await closeMenu()

    // Type a reply by hand: it cannot save or submit, and now it says why.
    fireEvent.change(canvas.getByRole('textbox', { name: 'Public reply' }), {
      target: { value: DRAFT_TEXT },
    })
    await waitFor(() =>
      expect(saveStateOf(canvasElement).textContent).toBe(NOT_SAVED_STATE),
    )
    const submit = canvas.getByRole('button', { name: 'Submit for approval' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAccessibleDescription(blocked)
    expect(canvas.getByText(blocked)).toBeVisible()

    expectSolePrimary(canvasElement, 'Submit for approval')
    expectNoRemovedSentences(canvasElement)
  },
})

export const NoPropertyDefaultAt390: Story = onPhone(NoPropertyDefaultAt720)

/**
 * A review too short to identify its language. `Detect automatically` is still
 * LISTED in `Write in` — so the manager can see why it is not on offer — but
 * refused, with its reason in its own name, and the template path leads. The
 * template menu lists no detection at all: it could never filter templates.
 */
export const AutoDetectDisabledAt720: Story = atPane({
  args: {
    propertyDefaultReplyLanguage: BULGARIAN,
    reviewReplyLanguage: null,
    reviewLanguageReadiness: 'insufficient_language_evidence',
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const refused =
      'Detect automatically — This review is too short to detect its language.'
    await arrive(canvasElement, args.phone, 'Reply…')
    const aiButton = canvas.getByRole('button', { name: 'Draft with AI' })
    expect(aiButton).toBeDisabled()
    expect(aiButton).toHaveAccessibleDescription(
      'AI drafting needs enough review text to verify its language.',
    )

    await openMenu(AI_TRIGGER)
    const writeIn = within(page().getByRole('group', { name: 'Write in' }))
    expect(
      writeIn.getByRole('menuitem', { name: 'Bulgarian · property default' }),
    ).toHaveAttribute('aria-current', 'true')
    expect(writeIn.getByRole('menuitem', { name: refused })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await closeMenu()
    // Only the property default can filter the library here, so the template
    // menu draws no switch — and in particular no refused detection segment.
    await openMenu(TEMPLATE_TRIGGER)
    expect(page().queryByRole('group', { name: 'Templates in' })).toBeNull()
    expect(page().queryByRole('menuitem', { name: refused })).toBeNull()
    await closeMenu()
    expectNoStandaloneLanguageControl(canvasElement)

    const buttons = canvas.getAllByRole('button')
    expect(
      buttons.indexOf(canvas.getByRole('button', { name: 'Template' })),
    ).toBeLessThan(buttons.indexOf(aiButton))
  },
})

export const AutoDetectDisabledAt390: Story = onPhone(AutoDetectDisabledAt720)

/**
 * A language picked on an EMPTY composer saves nothing and says nothing.
 *
 * The PR 4 review measured `Not saved` printed in the head — and announced
 * through its polite live region — after choosing `Turkish · review language`
 * on a box nobody had written in, which is neither true nor the "nothing to
 * say" `composer-mode-row.tsx` promises for an empty box. The pick still takes
 * effect: the ghost control says Turkish.
 */
export const LanguagePickOnAnEmptyBoxAt720: Story = atPane({
  args: HOTEL_LANGUAGES,
  play: async ({ args, canvasElement }) => {
    onSaveDraft.mockClear()
    await arrive(canvasElement, args.phone, 'Reply…')
    expectSaveState(canvasElement, '')

    await openMenu(AI_TRIGGER)
    await userEvent.click(
      within(page().getByRole('group', { name: 'Write in' })).getByRole('menuitem', {
        name: 'Turkish · review language',
      }),
    )
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull())
    expectNoStandaloneLanguageControl(canvasElement)

    // `schedule` emits its status synchronously, so a pick that scheduled
    // anything would already read `Not saved` (or `Saving…`) here.
    expectSaveState(canvasElement, '')
    expect(onSaveDraft).not.toHaveBeenCalled()
  },
})

export const LanguagePickOnAnEmptyBoxAt390: Story = onPhone(LanguagePickOnAnEmptyBoxAt720)

/**
 * `Detect automatically`, picked on a reply already typed in the property's
 * language — the step the PR 4 review showed a manager can take by accident
 * from a menu that looks like a filter.
 *
 * The draft stops saving and Submit is refused, exactly as before PR 4; what
 * changed is that the screen now SAYS so. Submit is described by the one
 * sentence that fixes it. Choosing Bulgarian again through the AI menu
 * resolves the language, saves, and releases Submit.
 */
export const DetectionOnATypedReplyExplainsSubmitAt720: Story = atPane({
  args: { ...HOTEL_LANGUAGES, reviewReplyLanguage: null },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const blocked =
      'This reply has no language yet. Choose a reply language to save and submit it.'
    await arrive(canvasElement, args.phone, 'Reply…')
    fireEvent.change(canvas.getByRole('textbox', { name: 'Public reply' }), {
      target: { value: DRAFT_TEXT },
    })
    await waitFor(
      () => expect(saveStateOf(canvasElement).textContent).toBe(SAVED_STATE),
      { timeout: 4_000 },
    )
    const submit = canvas.getByRole('button', { name: 'Submit for approval' })
    expect(submit).toBeEnabled()

    await openMenu(/^AI tone and language:/)
    await userEvent.click(
      within(page().getByRole('group', { name: 'Write in' })).getByRole('menuitem', {
        name: 'Detect automatically',
      }),
    )
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull())
    expectNoStandaloneLanguageControl(canvasElement)
    await waitFor(() =>
      expect(saveStateOf(canvasElement).textContent).toBe(NOT_SAVED_STATE),
    )
    expect(submit).toBeDisabled()
    expect(submit).toHaveAccessibleDescription(blocked)
    expect(canvas.getByText(blocked)).toBeVisible()

    await openMenu(/^AI tone and language:/)
    await userEvent.click(
      page().getByRole('menuitem', { name: 'Bulgarian · property default' }),
    )
    await waitFor(() => expect(canvas.queryByText(blocked)).toBeNull())
    await waitFor(
      () => expect(saveStateOf(canvasElement).textContent).toBe(SAVED_STATE),
      { timeout: 4_000 },
    )
    expect(submit).toBeEnabled()
    expectSolePrimary(canvasElement, 'Submit for approval')
  },
})

export const DetectionOnATypedReplyExplainsSubmitAt390: Story = onPhone(
  DetectionOnATypedReplyExplainsSubmitAt720,
)

/**
 * Row 9. An edit target puts the live reply's editor in the reply slot, adds
 * the band that says what saving will do, and LOCKS the mode row: hopping to
 * notes mid-edit would strand the edit behind a form that cannot close it.
 *
 * The refusal is `aria-disabled`, never the native attribute — a natively
 * disabled tab leaves the tab order and takes its `aria-describedby` with it,
 * so the one line explaining the refusal would be reachable by no keyboard and
 * no reader.
 */
export const EditingBandAt720: Story = atPane({
  args: { reply: publishedReply, editTarget: 'published' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    // An open edit forces the region open: there is no bar on a phone.
    await arrive(canvasElement, args.phone, null)

    const band = canvas.getByText(EDITING_BAND)
    expect(band).toBeVisible()

    const replyTab = canvas.getByRole('tab', { name: 'Public reply' })
    const noteTab = canvas.getByRole('tab', { name: 'Internal note' })
    expect(replyTab).toHaveAttribute('aria-selected', 'true')
    expect(noteTab).toHaveAttribute('aria-disabled', 'true')
    // The refusal points at the sentence that explains it.
    expect(noteTab).toHaveAttribute('aria-describedby', band.id)
    // ...and the reply segment is not the one being refused.
    expect(replyTab).not.toHaveAttribute('aria-disabled')

    // The slot is the published editor, not the compose box.
    const field = canvas.getByRole('textbox', { name: 'Edit published reply' })
    expect(field).toHaveValue(PUBLISHED_TEXT)
    expect(canvas.queryByRole('textbox', { name: 'Public reply' })).toBeNull()
    expectSolePrimary(canvasElement, 'Review update')

    // Row 9's fact, stated ONCE in the region. The band above is the one line
    // that exists to say it; the editor below used to repeat it as a visible
    // `h2` ("Edit published reply") AND as a `Republishes to Google` badge,
    // under a `border-t` that drew a second rule inside the region's own — the
    // same sentence three times in a box 56 px tall. Badge and border are gone
    // and the heading is `sr-only`, because it is the textarea's LABEL: the
    // band's id is minted inside the region and never reaches the slot, so
    // pointing `aria-labelledby` at the band is not possible from there yet.
    // An unlabelled textarea is the worse trade, so the name survives.
    expect(canvas.getAllByText(/republishes to Google/i)).toHaveLength(1)
    expect(canvas.queryByText('Republishes to Google')).toBeNull()
    const heading = canvas.getByRole('heading', { name: 'Edit published reply' })
    expect(field).toHaveAttribute('aria-labelledby', heading.id)
    expect(canvas.getAllByRole('heading')).toHaveLength(1)

    // The lock holds against a real click: the selection does not move, and
    // the note form — force-mounted like every panel now — stays hidden, so
    // it is out of the tab order and out of every role query.
    await userEvent.click(noteTab)
    await expect(replyTab).toHaveAttribute('aria-selected', 'true')
    await expect(noteTab).toHaveAttribute('aria-selected', 'false')
    await expect(canvas.getByPlaceholderText('Add a note…')).not.toBeVisible()
    await expect(canvas.queryByRole('textbox', { name: 'Add a note' })).toBeNull()
    // The band sits ABOVE the dock, not in its head: no save state is
    // reported by the published editor, so the head slot says nothing.
    expectSaveState(canvasElement, '')
    expect(canvas.queryByRole('button', { name: /^AI tone and language/ })).toBeNull()
  },
})

export const EditingBandAt390: Story = onPhone(EditingBandAt720)

/**
 * Note mode, nothing typed. The assist menus belong to the reply surface, so
 * they go with it — there is nothing to choose a language for — and the note
 * form's own submit is the region's single primary.
 *
 * Row 19: the head says `Not visible to the guest` and prints no save state
 * (no live region at all), and the note panel is NAMED for what it is.
 */
export const NoteModeEmptyAt720: Story = atPane({
  args: { startMode: 'note' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await arrive(canvasElement, args.phone, 'Add a note…')
    expect(canvas.getByRole('tab', { name: 'Internal note' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()
    expect(canvas.getByRole('tabpanel', { name: NOTE_SURFACE_NAME })).toBeVisible()
    expect(canvas.getByText(NOT_VISIBLE)).toBeVisible()
    expect(canvasElement.querySelectorAll('[aria-live="polite"]')).toHaveLength(0)
    // Both queries are role queries, and a role query skips a `hidden`
    // subtree: the reply panel is still MOUNTED beside this one (which is what
    // keeps a draft in it), and these assert that it is nonetheless absent
    // from the accessibility tree, the tab order and every e2e `getByRole`.
    expect(canvas.queryByRole('textbox', { name: 'Public reply' })).toBeNull()
    expect(canvas.queryByRole('button', { name: /^AI tone and language/ })).toBeNull()
    expect(canvas.queryByRole('button', { name: TEMPLATE_TRIGGER })).toBeNull()
    expect(canvas.getByPlaceholderText('Write a reply…')).not.toBeVisible()
    // Nothing typed yet, so the primary is present and refuses.
    expectSolePrimary(canvasElement, 'Add note')
    expect(canvas.getByRole('button', { name: 'Add note' })).toBeDisabled()
    expectNoRemovedSentences(canvasElement)
  },
})

export const NoteModeEmptyAt390: Story = onPhone(NoteModeEmptyAt720)

/**
 * Note mode with words in it. `Add note` wakes up; a look at the reply box and
 * back keeps the words (both panels are force-mounted); the head follows the
 * MODE — the reply surface's state on the reply side, the privacy sentence on
 * the note side.
 */
export const NoteModeWithTextAt720: Story = atPane({
  args: { startMode: 'note' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await arrive(canvasElement, args.phone, 'Add a note…')
    fireEvent.change(canvas.getByPlaceholderText('Add a note…'), {
      target: { value: NOTE_TEXT },
    })
    await expect(canvas.getByRole('button', { name: 'Add note' })).toBeEnabled()
    expectSolePrimary(canvasElement, 'Add note')

    await userEvent.click(canvas.getByRole('tab', { name: 'Public reply' }))
    await waitFor(() => expect(canvas.queryByText(NOT_VISIBLE)).toBeNull())
    expectSaveState(canvasElement, '')
    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    await expect(canvas.getByRole('textbox', { name: 'Add a note' })).toHaveValue(
      NOTE_TEXT,
    )
    expect(canvas.getByText(NOT_VISIBLE)).toBeVisible()
  },
})

export const NoteModeWithTextAt390: Story = onPhone(NoteModeWithTextAt720)

/**
 * A reply that is already out of the manager's hands (published): the pane
 * passes NO reply panel, so the only surface is the note. On a phone, a single
 * real mode is not shown as a conflicting two-choice segment; desktop keeps
 * the established Reply / Note navigation and opens the note explicitly.
 */
export const ReadOnlyReplyAt720: Story = atPane({
  args: { ...HOTEL_LANGUAGES, reply: publishedReply },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await arrive(canvasElement, args.phone, 'Add a note…')
    if (args.phone) {
      expect(canvas.queryByRole('tablist')).toBeNull()
      expect(canvas.queryAllByRole('tab')).toHaveLength(0)
    } else {
      expect(canvas.getAllByRole('tab')).toHaveLength(2)
      await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    }
    expect(canvas.queryByRole('textbox', { name: 'Public reply' })).toBeNull()
    expect(canvas.queryByRole('button', { name: /^AI tone and language/ })).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Submit for approval' })).toBeNull()
    expect(canvas.queryByText(anyResultTag)).toBeNull()

    await expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()
    expectSolePrimary(canvasElement, 'Add note')
  },
})

export const ReadOnlyReplyAt390: Story = onPhone(ReadOnlyReplyAt720)

/**
 * A feedback item (row 10) whose reader has no item action to be offered — the
 * shape the region had before PR 5, and still has for a caller the server sends
 * no handling state to. One mode is not a choice, so the region gets no control
 * to make it with: it drops the segment entirely and is just its rule, its
 * padding and the note form.
 *
 * No slot is passed at all, which is the case this story pins: the region then
 * renders exactly what it rendered before row 10 existed, and the note's own
 * submit is its single primary. The stories below are the other half — a slot
 * that is present, in each of the states it can be in.
 */
export const FeedbackSingleModeComposer: Story = {
  args: { modes: ['note'], startMode: 'reply' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // No segment at all — not a disabled one.
    expect(canvas.queryByRole('tablist')).toBeNull()
    expect(canvas.queryAllByRole('tab')).toHaveLength(0)
    expect(canvas.queryByRole('textbox', { name: 'Public reply' })).toBeNull()

    // `startMode` is `reply`, which this item does not offer: `resolveMode`
    // reconciles it rather than rendering an empty region. The pane keeps
    // `mode` for the whole session, so it routinely arrives pointing at a mode
    // the next selection does not have.
    expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()
    expect(canvas.queryByText(EDITING_BAND)).toBeNull()
    expectSolePrimary(canvasElement, 'Add note')
  },
}

// ── row 10's primary, in the slot the region takes it through ────────────────

const OPEN_CYCLE: FeedbackHandlingState = {
  cycleNumber: 1,
  sourceRevision: 1,
  stateRevision: 1,
  status: 'open',
  closeReason: null,
  currentOutcome: null,
  history: [],
}

const HANDLED_OUTCOME: NonNullable<FeedbackHandlingState['currentOutcome']> = {
  id: 'outcome-1',
  inboxItemId: inboxItemId(ITEM_ID),
  organizationId: organizationId('33333333-3333-4333-8333-333333333333'),
  propertyId: propertyId(PROPERTY_ID),
  feedbackId: feedbackId('fb-composer'),
  cycleNumber: 1,
  sourceRevision: 1,
  outcomeRevision: 1,
  outcome: 'follow_up_completed',
  internalNote: null,
  recordedBy: userId('44444444-4444-4444-8444-444444444444'),
  recordedAt: NOW,
  completionAt: NOW,
  deadlineResult: 'on_time',
  supersedesOutcomeId: null,
}

const HANDLED_CYCLE: FeedbackHandlingState = {
  ...OPEN_CYCLE,
  stateRevision: 2,
  status: 'closed',
  closeReason: 'private_feedback_handled',
  currentOutcome: HANDLED_OUTCOME,
  history: [HANDLED_OUTCOME],
}

const WITHDRAWN_CYCLE: FeedbackHandlingState = {
  ...OPEN_CYCLE,
  stateRevision: 2,
  status: 'closed',
  closeReason: 'guest_withdrawn',
}

/**
 * An open handling cycle. The region hosts `Mark as handled` at the foot,
 * under the note form's own submit, and that is the whole of what row 10 adds
 * to this file's surface.
 *
 * TWO accents here, and this is the one state row 10 leaves with two. It used
 * to be one: `Mark as handled` took the region and the note submit stepped back
 * to `outline` beside it. That was finding 4 — the action offered here is
 * offered off THIS cycle's `status === 'open'`, while
 * `handling-outcome-authority.ts` refuses an outcome forever and item-wide once
 * any cycle closed as `guest_withdrawn` or `source_ineligible`, and such an
 * item can still acquire a later open cycle. The refusal lands inside the write
 * transaction, after the dialog has collected an outcome and an internal note
 * that are discarded with it. Making that button the only thing in the region
 * worth pressing is the pane steering every manager into the one action it may
 * never be able to complete, so `Add note` — which always works — keeps its own
 * accent. `FeedbackPrimaryOnAHandledCycle` below is the `correct` branch, where
 * the action IS known to be permitted and the single-primary rule holds.
 *
 * BOTH variants are still asserted, because asserting only the action's would
 * let the note submit drift either way unnoticed.
 *
 * `Add note`'s NAME is untouched by any of this; the two e2e journeys that fill
 * it (`inbox-triage.spec.ts:183-184`,
 * `activity-notification-facts.spec.ts:168-169`) reach for it by name and are
 * unaffected.
 */
export const FeedbackPrimaryOnAnOpenCycle: Story = {
  args: { modes: ['note'], handling: OPEN_CYCLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    onMark.mockClear()
    onCorrect.mockClear()

    const mark = canvas.getByRole('button', { name: 'Mark as handled' })
    expect(mark).toBeVisible()
    expect(mark).toHaveAttribute('data-variant', 'default')
    // An open cycle has nothing to correct, so the correction path does not
    // exist yet — `submitFeedbackHandlingDecision` resolves silently without a
    // `currentOutcome` to pin, and the dialog would close as though it saved.
    expect(canvas.queryByRole('button', { name: 'Correct outcome' })).toBeNull()

    // The note form is untouched by the arrival of a neighbour, accent
    // included: both names the e2e journeys reach for
    // (`inbox-triage.spec.ts:183-184`,
    // `activity-notification-facts.spec.ts:168-169`) are where they were, and
    // the submit is still visible, still enabled by the same rule, and still
    // the region's own reliable move beside an action that may be refused.
    expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()
    const addNote = canvas.getByRole('button', { name: 'Add note' })
    expect(addNote).toBeVisible()
    expect(addNote).toHaveAttribute('data-variant', 'default')
    expectAccents(canvasElement, ['Add note', 'Mark as handled'])
    expectNoRemovedSentences(canvasElement)

    // The deleted card's chrome is not rebuilt here either.
    expect(canvas.queryByText('Feedback handling')).toBeNull()
    expect(canvas.queryByText('Current outcome')).toBeNull()

    await userEvent.click(mark)
    expect(onMark).toHaveBeenCalledTimes(1)
    expect(onCorrect).not.toHaveBeenCalled()
  },
}

/**
 * A handled cycle. The same slot, the same position, a different command — and
 * `Mark as handled` is gone rather than disabled, because the cycle is closed
 * and re-marking it is not a thing the server has a path for.
 */
export const FeedbackPrimaryOnAHandledCycle: Story = {
  args: { modes: ['note'], handling: HANDLED_CYCLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    onMark.mockClear()
    onCorrect.mockClear()

    const correct = canvas.getByRole('button', { name: 'Correct outcome' })
    expect(correct).toBeVisible()
    expect(correct).toHaveAttribute('data-variant', 'default')
    expect(canvas.queryByRole('button', { name: 'Mark as handled' })).toBeNull()

    expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Add note' })).toHaveAttribute(
      'data-variant',
      'outline',
    )
    expectSolePrimary(canvasElement, 'Correct outcome')

    await userEvent.click(correct)
    expect(onCorrect).toHaveBeenCalledTimes(1)
    expect(onMark).not.toHaveBeenCalled()
  },
}

/**
 * Withdrawn. The domain refuses a manager outcome — and a manual reopen — for
 * this cycle forever, so the slot carries a sentence instead of a button.
 *
 * Explanation by exception, not at rest (row 8): the open and handled states
 * above render no prose at all, and this one renders it only because the blank
 * where a button would be otherwise reads as a bug. Neither control is present
 * in EITHER spelling, and the region still has exactly one primary — the note
 * form's, which a manager may always use.
 *
 * The `default` assertion on `Add note` is the counterweight to
 * `FeedbackPrimaryOnAHandledCycle`, the one state that really does demote it: a
 * host that demoted the note submit whenever it hosts a handling node at all
 * would leave THIS region with no accent whatsoever, since there is no button
 * here to have taken it. `feedbackHandlingAction` returning `null` rather than
 * `'correct'` is what keeps the two apart.
 *
 * Note that this story and `FeedbackPrimaryOnAnOpenCycle` now agree on the
 * variant and disagree on the count — `Add note` is `default` in both, and only
 * the open cycle has a second accent beside it. That is the shape of the rule,
 * not a gap: the demotion tracks `correct` specifically, never "an action
 * exists".
 */
export const FeedbackPrimaryRefusedForWithdrawn: Story = {
  args: { modes: ['note'], handling: WITHDRAWN_CYCLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryAllByRole('button', { name: 'Mark as handled' })).toHaveLength(0)
    expect(canvas.queryAllByRole('button', { name: 'Correct outcome' })).toHaveLength(0)
    expect(
      canvas.getByText(
        'This feedback was withdrawn by the guest. No manager outcome was recorded.',
      ),
    ).toBeVisible()
    expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Add note' })).toHaveAttribute(
      'data-variant',
      'default',
    )
    expectSolePrimary(canvasElement, 'Add note')
  },
}

/**
 * A caller without `feedback.handle`, handed a live cycle anyway.
 *
 * Production cannot reach this — the server null-gates `feedbackHandling` on
 * the same permission pair, so a read-only caller arrives with no state and the
 * pane passes no slot — but a story can, and it is the one place the client's
 * own `can()` pair is observable. No button, and no explanation of an
 * affordance this reader never had either.
 */
export const FeedbackPrimaryWithoutHandlePermission: Story = {
  args: { modes: ['note'], handling: OPEN_CYCLE, canHandle: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryAllByRole('button', { name: 'Mark as handled' })).toHaveLength(0)
    expect(canvas.queryAllByRole('button', { name: 'Correct outcome' })).toHaveLength(0)
    expect(canvas.queryByText(/No manager outcome/)).toBeNull()
    // The region is still a region, and still has its one primary — which is
    // the note submit, undemoted, because the action that would have taken the
    // accent was never offered to this reader.
    expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Add note' })).toHaveAttribute(
      'data-variant',
      'default',
    )
    expectSolePrimary(canvasElement, 'Add note')
  },
}

/**
 * A TWO-mode composer drops the slot.
 *
 * The reply panel one arrow key away owns the region's primary through
 * `ReplyComposerFooter`, so a second one parked under the note form would be
 * two — in the region built to fix exactly that. The prop is passed here and
 * must have no effect in either mode, which is why both are visited: a guard
 * that only held on the mode the story happened to open in would look correct.
 */
export const TwoModeComposerDropsTheHandlingPrimary: Story = {
  args: { handling: OPEN_CYCLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Mark as handled' })).toBeNull()
    expectSolePrimary(canvasElement, 'Submit for approval')

    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    expect(canvas.queryByRole('button', { name: 'Mark as handled' })).toBeNull()
    expectSolePrimary(canvasElement, 'Add note')
  },
}

/**
 * A single-mode REPLY composer drops it too — `modes: ['reply']`, which is what
 * a caller holding `reply.manage` without `inbox.write` gets. There is no note
 * form to sit under and the reply panel already has a primary of its own, so
 * the slot's condition is the shape AND the surface, not the shape alone.
 */
export const SingleModeReplyComposerDropsTheHandlingPrimary: Story = {
  args: { modes: ['reply'], handling: OPEN_CYCLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('tablist')).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Mark as handled' })).toBeNull()
    expect(canvas.queryByPlaceholderText('Add a note…')).toBeNull()
    expectSolePrimary(canvasElement, 'Submit for approval')
  },
}

/**
 * The template path is the recommended one for a review with no text, and the
 * order follows the recommendation rather than the file.
 *
 * Worth its own story: with only the AI-primary case covered, "the recommended
 * control is first" would pass against a hard-coded order.
 */
export const TemplateIsTheRecommendedDraftingControl: Story = {
  args: { reviewLanguageReadiness: 'no_review_text' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectDraftingControls(canvasElement, 'template', TEMPLATE_EXPLANATION)
    // AI drafting needs review text, and says so where a reader can hear it
    // rather than in the region's prose.
    expect(canvas.getByRole('button', { name: 'Draft with AI' })).toBeDisabled()
    expect(canvas.getByText('AI drafting needs review text.')).toBeInTheDocument()
    expectSolePrimary(canvasElement, 'Submit for approval')
  },
}

// ── the save state ──────────────────────────────────────────────────────────

/**
 * Row 16 at the integration level: the REAL composer's autosave, printed in
 * the dock's head. Idle says nothing; typing runs the 700 ms debounce
 * (`Saving…`); a failed save reads `Not saved` in destructive ink with its
 * explanation and `Retry save` in the foot; the retry recovers to `Saved`.
 *
 * `saveFailures: 1` rather than "always fails": Retry has to have something to
 * recover TO, or the assertion stops at "the button exists" and never shows
 * that pressing it does anything.
 *
 * It is also the story that keeps the coordinator's status channel honest: it
 * used to latch shut on the first teardown, which StrictMode runs before the
 * first keystroke, so `unsaved` and `error` — and with them `Retry save` and
 * the `autosave.status !== 'error'` clause in `canSubmit`, which stops a
 * manager submitting words the server never received — were dead in dev and
 * in every story. The channel is a replaceable listener slot now; the path
 * below is the one a real failing save takes.
 */
export const AutosaveStatesAt720: Story = atPane({
  args: { saveFailures: 1 },
  play: async ({ args, canvas, canvasElement }) => {
    onSaveDraft.mockClear()
    await arrive(canvasElement, args.phone, 'Reply…')
    expectSaveState(canvasElement, '')

    fireEvent.change(canvas.getByRole('textbox', { name: 'Public reply' }), {
      target: { value: DRAFT_TEXT },
    })
    await waitFor(() => expect(saveStateOf(canvasElement).textContent).toBe(SAVING_STATE))
    await waitFor(
      () => expect(saveStateOf(canvasElement).textContent).toBe(NOT_SAVED_STATE),
      { timeout: 4_000 },
    )
    expect(saveStateOf(canvasElement).className).toMatch(/text-destructive/)
    expect(canvas.getByText(AUTOSAVE_ERROR)).toBeVisible()
    expectNoRemovedSentences(canvasElement)

    // ...and submitting is refused while it stands, because the draft the
    // approver would be sent is not the draft on screen.
    expect(canvas.getByRole('button', { name: 'Submit for approval' })).toBeDisabled()

    // The retry affordance is a real, reachable, non-primary control.
    const retry = canvas.getByRole('button', { name: 'Retry save' })
    expect(retry).toBeEnabled()
    expect(retry).toHaveAttribute('data-variant', 'ghost')
    expectSolePrimary(canvasElement, 'Submit for approval')

    // Pressing it re-sends the SAME draft and recovers.
    await userEvent.click(retry)
    await waitFor(
      () => expect(saveStateOf(canvasElement).textContent).toBe(SAVED_STATE),
      { timeout: 4_000 },
    )
    expect(saveStateOf(canvasElement).className).not.toMatch(/text-destructive/)
    expect(onSaveDraft).toHaveBeenCalledTimes(2)
    expect(onSaveDraft).toHaveBeenLastCalledWith(DRAFT_TEXT)
    expect(canvas.queryByRole('button', { name: 'Retry save' })).toBeNull()
    expect(canvas.queryByText(AUTOSAVE_ERROR)).toBeNull()
    expect(canvas.getByRole('button', { name: 'Submit for approval' })).toBeEnabled()
  },
})

export const AutosaveStatesAt390: Story = onPhone(AutosaveStatesAt720)

// ── the mode switch ─────────────────────────────────────────────────────────

/**
 * A half-typed internal note survives a look at the reply box.
 *
 * This is the PR 3 HIGH defect's successor, and the region used to reintroduce
 * it: the segment is a Radix tab set, and Radix unmounts the panel it is not
 * showing, so one click on Public reply destroyed the note form. Both panels
 * are force-mounted now with an explicit `hidden` on the inactive one, so the
 * form is not rebuilt at all — the words stay in it, and the pane's hoisted
 * copy is the second line of defence that carries them across a change of
 * SELECTION instead.
 *
 * Which is why the middle assertion is `not.toBeVisible()` and not `toBeNull()`.
 * The two are not interchangeable: `null` is what the defect produced, so
 * asserting it would pin the bug. `hidden` is the fix, and it is the strong
 * form of gone — `display: none` from the UA stylesheet, out of the
 * accessibility tree, out of the tab order, and out of every `getByRole` query
 * the e2e specs use, which the role assertion beside it states directly.
 *
 * `fireEvent.change` rather than `userEvent.type`: the same path
 * (`Textarea.onChange` → the field's mirrored `handleChange` → the host), in
 * one update instead of one per character.
 */
export const NoteSurvivesReplyRoundTrip: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    const noteField = canvas.getByPlaceholderText('Add a note…')
    fireEvent.change(noteField, { target: { value: NOTE_TEXT } })
    await expect(canvas.getByRole('button', { name: 'Add note' })).toBeEnabled()

    // Out of the manager's view and out of every role query — but still there,
    // still holding the words, because it was never torn down.
    await userEvent.click(canvas.getByRole('tab', { name: 'Public reply' }))
    await expect(noteField).not.toBeVisible()
    await expect(noteField).toHaveValue(NOTE_TEXT)
    await expect(canvas.queryByRole('textbox', { name: 'Add a note' })).toBeNull()
    await expect(canvas.getByRole('textbox', { name: 'Public reply' })).toBeVisible()

    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    await expect(canvas.getByRole('textbox', { name: 'Add a note' })).toHaveValue(
      NOTE_TEXT,
    )
    // The form's own store agrees, so its submit is live.
    await expect(canvas.getByRole('button', { name: 'Add note' })).toBeEnabled()
  },
}

/**
 * The other direction, and it used to be the losing one.
 *
 * The note is held by the pane. The reply text is NOT: it lives in
 * `useReplyComposer`, inside the panel the segment unmounted, so a mode switch
 * threw away whatever had not yet reached the server. Verified at the time,
 * not assumed: Radix activates a `TabsTrigger` on `mousedown`, before focus
 * moves, and React flushes that discrete update synchronously — so the focused
 * textarea was detached before `focusout`, `onBlur` never ran, `flushOnBlur`
 * never fired, and `dispose()` cancelled the pending 700 ms autosave and
 * dropped its snapshot on the way out.
 *
 * Deliberately the AUTO-DETECT language case, which is the amplified form of
 * the same defect and the reason this story does not wait for a save: with the
 * review's language to be detected, `updateDraft` schedules with
 * `eligible: false`, so no autosave is ever queued, no timer is ever set and
 * NOTHING was ever recoverable — 100 % of the draft was lost, however long it
 * had been sitting there. `onSaveDraft` is asserted un-called for exactly that
 * reason: the text that comes back cannot have come back from the stand-in
 * cache, so what is pinned here is the panel keeping its own state.
 *
 * The `unsaved` save state — `Not saved` in the dock's head (row 16) — is a
 * second thing this story can only now assert. It was unreachable until the
 * autosave coordinator stopped latching its status channel shut on the first
 * teardown, which StrictMode runs before the first keystroke.
 */
export const ReplyDraftSurvivesNoteRoundTrip: Story = {
  args: { propertyDefaultReplyLanguage: null, reviewReplyLanguage: null },
  play: async ({ canvas, canvasElement }) => {
    onSaveDraft.mockClear()
    const replyField = canvas.getByRole('textbox', { name: 'Public reply' })
    fireEvent.change(replyField, { target: { value: DRAFT_TEXT } })
    // Auto-detect: the draft is never eligible to save, and the head says so.
    await waitFor(() =>
      expect(saveStateOf(canvasElement).textContent).toBe(NOT_SAVED_STATE),
    )

    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    await expect(canvas.queryByRole('textbox', { name: 'Public reply' })).toBeNull()
    // Hidden, not destroyed — and the words are still in it.
    await expect(canvas.getByPlaceholderText('Write a reply…')).not.toBeVisible()
    await expect(canvas.getByPlaceholderText('Write a reply…')).toHaveValue(DRAFT_TEXT)

    await userEvent.click(canvas.getByRole('tab', { name: 'Public reply' }))
    await expect(canvas.getByRole('textbox', { name: 'Public reply' })).toHaveValue(
      DRAFT_TEXT,
    )
    // Nothing was saved at any point, so nothing could have been re-seeded.
    await expect(onSaveDraft).not.toHaveBeenCalled()
  },
}

// ── the state matrix: what the assist actions leave behind (rows 17, 18) ────

/**
 * The ONE Tailwind rule the template switch's story needs, restored by hand.
 *
 * This runner compiles no Tailwind (contract), so both assist menus'
 * `w-72` is inert here and the menu is `max-content` wide. Switching
 * `Templates in` while the menu is open swaps the list through its loading
 * row, which is wider than a template title: the floating element was
 * measured going 125 → 193 → 125 px wide inside floating-ui's own
 * ResizeObserver callback, and Chromium reports that as `ResizeObserver loop
 * completed with undelivered notifications` — an unhandled error this gate
 * fails on. In a compiled build the menu is a fixed 288 px and the same play
 * emits no error: probed against `pnpm storybook` (:6006) in a 390 and a
 * 1440 px Chromium window, zero `error` events from load to the final tag.
 * So the rule is put back rather than the switch left unproven; nothing else
 * in the story depends on a stylesheet.
 */
const withCompiledMenuWidth: Decorator = (Story) => (
  <>
    <style>{'[data-slot="dropdown-menu-content"] { width: 18rem; }'}</style>
    <Story />
  </>
)

/**
 * An AI draft, start to finish, and the result tag it leaves.
 *
 * `Draft with AI` in the property's language → `Use draft` → the tag reads
 * `AI draft · Bulgarian ▾`. Its menu offers the OTHER target only; choosing it
 * requests the draft in that target WITHOUT selecting it — the request goes
 * out for `review_language` (the scope `regenerateScope` builds), while the
 * draft, its saved language and the ghost `Reply language` control stay
 * Bulgarian until the manager adopts (PR 4 review: committing first saved
 * the Bulgarian text as Turkish before the call was made). The preview names
 * its own language; adopting it retags the draft `AI draft · Turkish ▾`, and
 * `Write in`, the switch and the ghost control follow.
 */
export const AiDraftTagAt720: Story = atPane({
  args: { ...HOTEL_LANGUAGES, onGenerateSuggestion: onGenerateByTarget },
  play: async ({ args, canvas, canvasElement }) => {
    onGenerateByTarget.mockClear()
    await arrive(canvasElement, args.phone, 'Reply…')

    await userEvent.click(canvas.getByRole('button', { name: 'Draft with AI' }))
    await waitFor(() =>
      expect(onGenerateByTarget).toHaveBeenLastCalledWith(
        'professional',
        { kind: 'property_default' },
        false,
        expect.any(String),
      ),
    )
    await userEvent.click(await canvas.findByRole('button', { name: 'Use draft' }))
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Public reply' })).toHaveValue(
        BG_AI_TEXT,
      ),
    )

    const tag = await canvas.findByRole('button', { name: 'AI draft · Bulgarian' })
    // The tag is the first thing in the text row, above the text it names.
    expect(
      tag.compareDocumentPosition(canvas.getByRole('textbox', { name: 'Public reply' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await userEvent.click(tag)
    await waitFor(() => expect(page().getByRole('menu')).toBeVisible())
    expect(
      page()
        .getAllByRole('menuitem')
        .map((row) => row.textContent),
    ).toEqual(['Regenerate in Turkish · review language'])
    await userEvent.click(
      page().getByRole('menuitem', { name: 'Regenerate in Turkish · review language' }),
    )
    await waitFor(() =>
      expect(onGenerateByTarget).toHaveBeenLastCalledWith(
        'professional',
        { kind: 'review_language' },
        false,
        expect.any(String),
      ),
    )
    await expect(canvas.findByText(TR_AI_TEXT)).resolves.toBeVisible()
    // A preview: the Bulgarian text is untouched until the manager adopts,
    // and so is the language — the preview says it is Turkish, the ghost
    // control still says what `Draft with AI` would use.
    expect(canvas.getByRole('textbox', { name: 'Public reply' })).toHaveValue(BG_AI_TEXT)
    const preview = canvas.getByRole('region', { name: 'Draft suggestion' })
    expect(preview).toHaveTextContent(/Personalized AI suggestion\s*· Turkish/)
    expectNoStandaloneLanguageControl(canvasElement)
    expectSolePrimary(canvasElement, 'Submit for approval')
    await userEvent.click(canvas.getByRole('button', { name: 'Use draft' }))

    await expect(
      canvas.findByRole('button', { name: 'AI draft · Turkish' }),
    ).resolves.toBeVisible()
    expectNoStandaloneLanguageControl(canvasElement)
    await expectLanguageInBothMenus('Turkish · review language', [
      'Bulgarian · property default',
    ])
  },
})

export const AiDraftTagAt390: Story = onPhone(AiDraftTagAt720)

/**
 * A library template, loaded in the OTHER language from inside `Template ▾`.
 *
 * The `Templates in` switch heads the list it scopes: picking Turkish keeps
 * the menu open and reloads the list for `review_language` in the same event
 * (the scope again — a bare `prepareMenu` would fetch the Bulgarian list the
 * switch just left). The Turkish template loads with its language stamped, and
 * the tag names it by the title it was loaded under: `Template · Teşekkür,
 * övgü · Turkish` — plain text, because a template has no "other language" of
 * itself to offer.
 */
export const LibraryTemplateTagAt720: Story = atPane({
  decorators: [withCompiledMenuWidth],
  args: { ...HOTEL_LANGUAGES, library: true },
  play: async ({ args, canvas, canvasElement }) => {
    onListByTarget.mockClear()
    onLoadByTarget.mockClear()
    await arrive(canvasElement, args.phone, 'Reply…')

    await openMenu(TEMPLATE_TRIGGER)
    await expect(
      page().findByRole('menuitem', { name: BG_TEMPLATE.title }),
    ).resolves.toBeVisible()
    expect(page().getByRole('group', { name: 'Templates in Bulgarian' })).toBeVisible()
    await userEvent.click(
      within(page().getByRole('group', { name: 'Templates in' })).getByRole('menuitem', {
        name: 'Turkish · review language',
      }),
    )
    // Still open, now scoped to Turkish.
    const turkishList = await page().findByRole('group', { name: 'Templates in Turkish' })
    expect(onListByTarget).toHaveBeenLastCalledWith({ kind: 'review_language' })
    const turkish = await within(turkishList).findByRole('menuitem', {
      name: TR_TEMPLATE.title,
    })
    expect(page().queryByRole('menuitem', { name: BG_TEMPLATE.title })).toBeNull()
    await userEvent.click(turkish)

    await waitFor(() =>
      expect(onLoadByTarget).toHaveBeenCalledWith(TR_TEMPLATE.id, {
        kind: 'review_language',
      }),
    )
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Public reply' })).toHaveValue(
        TEMPLATE_TEXT[TR_TEMPLATE.id],
      ),
    )
    await expect(
      canvas.findByText(tagText(`Template · ${TR_TEMPLATE.title} · Turkish`)),
    ).resolves.toBeVisible()
    expect(
      canvas.queryByRole('button', { name: `Template · ${TR_TEMPLATE.title} · Turkish` }),
    ).toBeNull()
    await expectLanguageInBothMenus('Turkish · review language', [
      'Bulgarian · property default',
    ])
    expectSolePrimary(canvasElement, 'Submit for approval')
  },
})

export const LibraryTemplateTagAt390: Story = onPhone(LibraryTemplateTagAt720)

/**
 * `Local safe template`: no library, no id, so no title. The tag reads
 * `Template · Bulgarian` and invents nothing between the two words (row 18).
 */
export const LocalSafeTemplateTagAt720: Story = atPane({
  args: { ...HOTEL_LANGUAGES, library: true, onGenerateSuggestion: onGenerateByTarget },
  play: async ({ args, canvas, canvasElement }) => {
    onGenerateByTarget.mockClear()
    await arrive(canvasElement, args.phone, 'Reply…')

    await openMenu(TEMPLATE_TRIGGER)
    await userEvent.click(page().getByRole('menuitem', { name: 'Local safe template' }))
    await waitFor(() =>
      expect(onGenerateByTarget).toHaveBeenLastCalledWith(
        'professional',
        { kind: 'property_default' },
        true,
        expect.any(String),
      ),
    )
    await expect(canvas.findByText('Local safe starting point')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Use draft' }))
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Public reply' })).toHaveValue(
        BG_SAFE_TEXT,
      ),
    )
    await expect(
      canvas.findByText(tagText('Template · Bulgarian')),
    ).resolves.toBeVisible()
    expectSolePrimary(canvasElement, 'Submit for approval')
    expectNoRemovedSentences(canvasElement)
  },
})

export const LocalSafeTemplateTagAt390: Story = onPhone(LocalSafeTemplateTagAt720)

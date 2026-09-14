import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  equivalentReplyLanguageTags,
  targetForReplyLanguage,
  type ReplyLanguageTarget,
  type ReviewLanguageReadiness,
} from './reply-language-options'
import type { ReplyDraftAdoption } from './reply-draft-origin'
import type { ReplyDraftSnapshot } from './use-reply-autosave'
import type { ReplyAssistScope } from './use-reply-suggestion'

/*
 * The pure steps `useReplyComposer` takes between one draft and the next —
 * which target a selection runs in, what a language change commits, what Undo
 * puts back, what an adoption teaches the composer about the review, and what
 * a regenerate asks for. Lifted out of the hook so each is tested without a
 * renderer (the unit project has none) and the hook stays a wiring of state
 * under its 300-line budget.
 */

export type LanguageContext = Readonly<{
  propertyLanguage: string | null
  reviewLanguage: string | null
  reviewLanguageReadiness: ReviewLanguageReadiness
}>

/**
 * The target the assist actions run in for a selection — the formula the hook
 * always used, lifted out so `updateLanguage` can compute the target it is
 * about to commit. With nothing selected and no detectable review the target
 * is still `review_language`: the server maps that to the review's recorded
 * language and otherwise falls back to the property default
 * (`reply-template-operations.ts:82-93`), so a template can still load.
 */
export function assistTargetFor(
  selection: string | null,
  context: LanguageContext,
): ReplyLanguageTarget | null {
  const selected = targetForReplyLanguage(
    selection,
    context.propertyLanguage,
    context.reviewLanguage,
    context.reviewLanguageReadiness,
  )
  if (selected !== null) return selected
  return selection === null && context.reviewLanguageReadiness !== 'detectable'
    ? { kind: 'review_language' }
    : null
}

/** The draft `updateLanguage` commits: the sentinel carries no tag. */
export function draftInLanguage(
  draft: ReplyDraftSnapshot,
  languageTag: string,
): ReplyDraftSnapshot {
  return {
    ...draft,
    languageTag: languageTag === AUTO_DETECT_REVIEW_LANGUAGE ? null : languageTag,
  }
}

/**
 * What a regenerate row on the result tag asks for (row 18): the other
 * language's target, and the draft its answer is verified against
 * (`resolveSuggestedReplyLanguageTag` requires an explicit tag to match).
 *
 * Built WITHOUT committing the language. The row used to call `updateLanguage`
 * first, which dismissed any preview, retagged the manager's text in the new
 * language and flushed it to the server — before the AI call was even made. A
 * mis-tap, a dismissed preview or an `unavailable` answer then left a Bulgarian
 * text saved as Turkish under a tag still reading `AI draft · Bulgarian`, and
 * `Regenerate in the review's language` additionally dropped the draft into
 * automatic detection, which stops autosave and Submit. The language now
 * commits only when the preview is adopted (`adoptDraft`), the one moment the
 * text and the tag change together.
 */
export function regenerateScope(
  draft: ReplyDraftSnapshot,
  languageTag: string,
  context: LanguageContext,
): ReplyAssistScope {
  return {
    draft: draftInLanguage(draft, languageTag),
    target: assistTargetFor(languageTag, context),
  }
}

/**
 * Whether adopting a draft tells the composer the review's language — the
 * `effectiveReviewLanguage` that puts `Turkish · review language` on the
 * language lists once an AI draft has detected it.
 *
 * Only an AI draft (`personalized`, or the `local_fallback` the AI boundary
 * returns) can: its tag is the language the governed boundary verified for the
 * target it was asked, and a tag other than the property default can only have
 * come from the review-language target. A LIBRARY template never can. Its tag
 * is the server's `resolveTargetLanguage` answer, which falls back to the
 * property default whenever the review's language is unrecorded — i.e. always
 * (`google-review-api.adapter.ts:450`). Treating that `bg` as the review's
 * language folded the real Turkish option into the property one and took
 * `Turkish` and `Detect automatically` off every menu for the rest of the
 * mount. The old rule keyed on the RENDER's target, which a regenerate that no
 * longer commits its language (`regenerateScope`) would also have got wrong.
 */
export function adoptionRevealsReviewLanguage(
  adoption: Pick<ReplyDraftAdoption, 'kind' | 'languageTag'>,
  propertyLanguage: string | null,
): boolean {
  if (adoption.kind === 'library_template' || adoption.languageTag === null) return false
  return !equivalentReplyLanguageTags(adoption.languageTag, propertyLanguage)
}

/**
 * One step of the composer's Undo history: the draft AND where it came from.
 *
 * The history used to hold the draft alone, so Undo put back the earlier text
 * under the provenance of the draft it undid — the manager's own Bulgarian
 * reply under `AI draft · Turkish`, or a hand-typed reply under `Template ·
 * Guest appreciation · Bulgarian` — and that tag is what a manager checks
 * before submitting to a guest.
 */
export type ReplyComposerSnapshot = Readonly<{
  draft: ReplyDraftSnapshot
  adoption: ReplyDraftAdoption | null
  hasAiDraft: boolean
}>

type RestoreContext = Readonly<{
  /** `effectiveReviewLanguage`: recorded, or detected by an adopted AI draft. */
  detectedReviewLanguage: string | null
  reviewLanguageReadiness: ReviewLanguageReadiness
}>

/**
 * What Undo puts back, and the selection that goes with it.
 *
 * A draft that was still detecting (no tag) comes back in the language
 * detected since — the language stays known once an AI draft has found it.
 * With nothing detected it returns to automatic detection on a detectable
 * review, and to no selection otherwise. The provenance is the snapshot's own.
 */
export function restoreSnapshot(
  snapshot: ReplyComposerSnapshot,
  context: RestoreContext,
): Readonly<{ snapshot: ReplyComposerSnapshot; selection: string | null }> {
  const draft =
    snapshot.draft.languageTag === null && context.detectedReviewLanguage !== null
      ? { ...snapshot.draft, languageTag: context.detectedReviewLanguage }
      : snapshot.draft
  const selection =
    draft.languageTag ??
    (context.reviewLanguageReadiness === 'detectable'
      ? AUTO_DETECT_REVIEW_LANGUAGE
      : null)
  return { snapshot: { ...snapshot, draft }, selection }
}

import {
  equivalentReplyLanguageTags,
  languageDisplayName,
  type ReplyLanguageOption,
  type ReviewLanguageReadiness,
} from './reply-language-options'

/*
 * Plan v2.1 rows 17-18: the reply language leaves the composer chrome and
 * lives inside the two assist menus, `Draft with AI ▾` (`reply-ai-menu.tsx`)
 * and `Template ▾` (`reply-template-menu.tsx`). Why it can: the picker only
 * ever chooses between two targets (`reply-language-options.ts`,
 * `ReplyLanguageTarget` = `property_default | review_language`), and only the
 * two assist actions read it — templates are per-language
 * (`reply-template-operations.ts:137` filters the library by the target's
 * `templateGroup`, `:304` stamps `replyLanguageTag` on the loaded draft), an AI
 * draft is stamped the same way (`ai-suggested-draft-store.ts:360`), and a
 * hand-typed draft only RECORDS the tag (`reply-operations.ts:325`), which no
 * publication path reads.
 *
 * This module is the words both menus print, kept pure so the two cannot
 * drift and so the sentences are tested without a DOM.
 */

/**
 * One row of a `Write in` group or one segment of `Templates in` — named
 * `MenuEntry`, not `Choice`, so it cannot be confused with the composer's
 * `ReplyLanguageChoices` (`use-reply-composer.ts`), the value these entries are
 * built FROM. `name` is the
 * language as a manager says it; `source` is the quiet suffix that says why it
 * is on the list. They are separate parts because the two menus lay them out
 * differently: the AI menu prints both on one line, the template switch prints
 * the name and keeps the source for assistive tech only.
 */
export type ReplyLanguageMenuEntry = Readonly<{
  tag: string
  name: string
  source: string | null
  disabledReason: string | null
  isSelected: boolean
}>

/**
 * Lower-case on purpose: it follows a middle dot as the second half of one
 * phrase (`Bulgarian · property default`), the canvas's spelling. Automatic
 * detection has no suffix — its name already says where the language comes
 * from.
 */
const SOURCE_SUFFIX: Readonly<Record<ReplyLanguageOption['source'], string | null>> = {
  property: 'property default',
  review: 'review language',
  review_auto: null,
  saved: 'saved draft',
}

function entryName(option: ReplyLanguageOption): string {
  if (option.source === 'review_auto') return 'Detect automatically'
  return languageDisplayName(option.tag) ?? option.tag
}

/**
 * Selection is matched by LANGUAGE, not by spelling. The composer adopts the
 * concrete tag the AI boundary verified (`use-reply-composer.ts`, `adoptDraft`
 * → `setSelectedLanguage(nextDraft.languageTag)`), and that tag may carry a
 * region the option list does not (`bg-Cyrl-BG` against `bg-Cyrl`) — an exact
 * comparison would leave the menu with no check after every AI draft.
 * `replyLanguageOptions` already de-duplicates equivalent tags, so at most one
 * entry can match.
 */
export function replyLanguageMenuEntries(
  options: ReadonlyArray<ReplyLanguageOption>,
  selectedTag: string | null,
): ReadonlyArray<ReplyLanguageMenuEntry> {
  return options.map((option) => ({
    tag: option.tag,
    name: entryName(option),
    source: SOURCE_SUFFIX[option.source],
    disabledReason: option.disabledReason ?? null,
    isSelected:
      selectedTag !== null &&
      (option.tag === selectedTag ||
        equivalentReplyLanguageTags(option.tag, selectedTag)),
  }))
}

/**
 * The whole choice as one string: `Bulgarian · property default`, and a
 * disabled reason after a dash — `reply-language-select.tsx` appended
 * `— ${disabledReason}` to the label so a disabled option says WHY to a screen
 * reader, which cannot hover for a tooltip. The menus keep that.
 */
export function replyLanguageEntryText(entry: ReplyLanguageMenuEntry): string {
  const named = entry.source === null ? entry.name : `${entry.name} · ${entry.source}`
  return entry.disabledReason === null ? named : `${named} — ${entry.disabledReason}`
}

export function selectedReplyLanguageName(
  entries: ReadonlyArray<ReplyLanguageMenuEntry>,
): string | null {
  return entries.find((entry) => entry.isSelected)?.name ?? null
}

/**
 * Derived rather than passed: `replyLanguageOptions` pushes a `property`
 * option exactly when it is given a property tag
 * (`reply-language-options.ts:71`), and a saved tag equivalent to it is folded
 * into that option rather than listed twice (`:98-100`). The test pins the
 * pairing, so a change to that contract fails here, not in a menu.
 */
export function hasPropertyDefaultOption(
  options: ReadonlyArray<ReplyLanguageOption>,
): boolean {
  return options.some((option) => option.source === 'property')
}

/**
 * The three readiness sentences `reply-language-readiness.tsx` printed under
 * `Property reply language not set`, moved verbatim (row 18 deletes the
 * standing alert, not its reasoning). Each says why the missing default
 * matters in THAT state: a detectable review can still be answered in its own
 * language, so the default is about future replies; a short or empty review
 * cannot be detected, so without a default there is no language to load a
 * local template in.
 */
export function propertyLanguageMissingReason(
  readiness: ReviewLanguageReadiness,
  isAutoDetecting: boolean,
): string {
  if (readiness === 'insufficient_language_evidence') {
    return 'This review is too short to detect its language. Set a property default to load a local template.'
  }
  if (readiness === 'no_review_text') {
    return 'This review has no text. Set a property default to load a local template.'
  }
  return isAutoDetecting
    ? 'We’ll detect this review’s language for this draft. Set a property default so future replies start in your local language.'
    : 'Set a property default so future replies start in your local language.'
}

/**
 * The languages `Template ▾`'s `Templates in` switch may offer: only those the
 * template LIBRARY can be filtered by.
 *
 * The switch looks like a filter on the list under it, so every segment has to
 * list templates in the language it names. The server resolves a
 * `review_language` target from the review's RECORDED language and otherwise
 * falls back to the property default (`reply-template-operations.ts`,
 * `resolveTargetLanguage`, `:82-93`) — and the review's language is never
 * recorded (`google-review-api.adapter.ts:450`). So:
 *
 * - `review_auto` (`Detect automatically`) always lists the property default's
 *   templates, and picking it put the draft into automatic detection, which
 *   stops autosave and Submit (`use-reply-composer.ts`, `canSubmit`) — a
 *   filter that silently makes the draft unsaveable.
 * - A `review` option the AI detected (`effectiveReviewLanguage`, with no
 *   recorded language behind it) listed Bulgarian templates as `Templates in
 *   Turkish`; loading one stamped `bg` on a draft the switch had called Turkish.
 * - A `saved` option is no target at all (`targetForReplyLanguage` → `null`),
 *   so it lists nothing.
 *
 * The property default and a RECORDED review language are what is left. The
 * menu hides the switch below two of them; the list is labelled by the
 * language the server actually returned (`reply-template-menu.tsx`).
 */
export function templateLanguageOptions(
  options: ReadonlyArray<ReplyLanguageOption>,
  isReviewLanguageRecorded: boolean,
): ReadonlyArray<ReplyLanguageOption> {
  return options.filter(
    (option) =>
      option.source === 'property' ||
      (option.source === 'review' && isReviewLanguageRecorded),
  )
}

/**
 * Why `Submit for approval` is disabled while the composer is detecting the
 * review's language.
 *
 * A draft in automatic detection is never autosaved and never submitted — it
 * has not resolved a language and must not persist a stale one
 * (`use-reply-composer.ts`, `updateLanguage` and `canSubmit`). The reply
 * language used to sit above the box as a select reading `Review language ·
 * Detect automatically`, with a standing alert beside it; row 17 took both out
 * of the chrome, and a manager who typed a whole reply met a disabled Submit
 * with nothing on screen or in its description saying why (measured in the
 * `no-property-default` story: `Not saved`, Submit `aria-describedby=null`).
 *
 * The sentence names the way out that exists in THAT state: with a property
 * default, choosing a language is enough; without one, only an AI draft (which
 * detects the language) or a property default resolves it.
 */
export function unresolvedLanguageSubmitReason(hasPropertyDefault: boolean): string {
  return hasPropertyDefault
    ? 'This reply has no language yet. Choose a reply language to save and submit it.'
    : 'This reply has no language yet. Draft with AI to detect the review’s language, or set a property reply language, to save and submit it.'
}

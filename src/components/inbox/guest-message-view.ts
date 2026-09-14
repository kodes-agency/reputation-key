import { parseCanonicalReplyLanguageTag } from '#/shared/reply-language-catalogue'
import { languageDisplayName } from './reply-language-options'
// Type-only, like `reply-message-view.ts`: this file must stay free of any
// runtime import from a `.tsx` module so its unit test never loads the editor
// tree. Both value imports are pure — `reply-language-options.ts` itself reaches
// no further than `#/shared/reply-language-catalogue`, the first import here.
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'

/** `'available' | 'expired' | 'not_found' | null`, read from its owner. */
type ReviewContentStatus = InboxItemDetailResult['reviewContentStatus']

/**
 * The half of the pair that is folded away. `label` is the `<summary>`, `text`
 * the prose behind it, and `lang` the BCP 47 tag of that prose when — and only
 * when — we know it (see `GuestReviewBodyView`).
 */
export type GuestReviewDisclosure = Readonly<{
  label: string
  text: string
  lang: string | null
}>

/**
 * Plan row 8, as amended by review (see `presentGuestReviewBody`). Five shapes,
 * and the render site reads exactly one of them:
 *
 * - `no_text` — nothing to print. Covers a rating-only review AND content the
 *   source will no longer serve; the variant deliberately carries no reason,
 *   because `GuestMessage` already prints the right sentence from
 *   `detail.reviewContentStatus` (`expired` vs `not_found` vs silence).
 * - `original_only` — the guest's words, no disclosure at all.
 * - `original_first` — today's arrangement: the guest's words as the body, the
 *   machine translation behind `Google translation`.
 * - `translation_first` — the translation as the body, the guest's words behind
 *   `Original in <language>`, and an attribution line above it.
 * - `translation_only` — Google's envelope arrived with no `(Original)` half
 *   (`google-review-comment.ts:59` keeps that shape on purpose), so the
 *   translation is the only prose we hold. It is printed rather than dropped:
 *   a review article with a name, stars and topic chips and no words at all —
 *   not even an "unavailable" sentence, because the content IS available —
 *   hides text the payload is carrying.
 *
 * The attribution line is NOT optional on either translation variant: the body
 * is machine text, and machine text presented as a guest's own words without a
 * marker is the one thing this rule must never do.
 *
 * `bodyLang` / `disclosure.lang` exist for WCAG 3.1.2 (Language of Parts). They
 * are set on the ORIGINAL, whose language is the review's, and are null on the
 * translation, whose language nothing records: `review.schema.ts:80-82` has no
 * companion column for `translatedText`, and Google picks the target from the
 * READER locale at fetch time (`google-review-api.adapter.ts:454-457`), not
 * from the property. Guessing it would be a lie a screen reader speaks aloud.
 *
 * `disclosure` and `translationLine` are present-and-null on the variants that
 * do not use them so a caller can render `view.disclosure && …` after a single
 * `kind === 'no_text'` early return, instead of switching five ways.
 */
export type GuestReviewBodyView =
  | Readonly<{ kind: 'no_text' }>
  | Readonly<{
      kind: 'original_only'
      body: string
      bodyLang: string | null
      disclosure: null
      translationLine: null
    }>
  | Readonly<{
      kind: 'original_first'
      body: string
      bodyLang: string | null
      disclosure: GuestReviewDisclosure
      translationLine: null
    }>
  | Readonly<{
      kind: 'translation_first'
      body: string
      bodyLang: null
      disclosure: GuestReviewDisclosure
      translationLine: string
    }>
  | Readonly<{
      kind: 'translation_only'
      body: string
      bodyLang: null
      disclosure: null
      translationLine: string
    }>

export type GuestReviewBodyInput = Readonly<{
  /** `detail.reviewText` — the guest's own words. */
  reviewText: string | null
  /** `detail.reviewTranslatedText` — Google's machine translation of it. */
  reviewTranslatedText: string | null
  /** `detail.reviewContentStatus`. See `isContentGone`. */
  reviewContentStatus: ReviewContentStatus
  /**
   * `detail.reviewReplyLanguage` — the review's language CANONICALIZED by
   * `get-inbox-item-detail.ts:183-188` (`bg-BG` → `bg-Cyrl-BG`). The only
   * operand the comparison can use; see `provenForeignToProperty`.
   */
  reviewLanguageTag: string | null | undefined
  /**
   * `item.reviewLanguageCode` — the raw code the source served (`tr-TR`, `de`).
   * Never compared: a raw code does not canonicalize, so it can prove neither
   * sameness nor difference. It is still a valid BCP 47 tag, so it names the
   * language and labels the original's `lang` when the canonical tag is absent.
   */
  reviewLanguageCode: string | null | undefined
  /** `detail.propertyDefaultReplyLanguage` — canonical, or null when unset. */
  propertyDefaultReplyLanguage: string | null | undefined
}>

/**
 * The summaries name the CONTENT behind them, not an action, so each stays true
 * whichever way the disclosure points. An action label (`Show original`) goes
 * on reading "show" while the original is on screen, and native `<details>`
 * announces it as "Show original, expanded" — a name promising to reveal what
 * the same announcement says is revealed. v1's `Translated by Google` was a
 * noun phrase for this reason, and the repo's other flex-summary disclosure
 * (`property-guest-voice-page.tsx:52`, "What is in this figure") is one too.
 */
const TRANSLATION_LABEL = 'Google translation'
const ORIGINAL_LABEL = 'Original'

/**
 * The attribution when the language has no name to print. `languageDisplayName`
 * returns null for an absent tag (`reply-language-options.ts:36-45`), and
 * `null` in the middle of a sentence is not honest, nor is silence. This is the
 * sentence the pane shipped with, minus the language it never knew.
 */
const UNNAMED_TRANSLATION_LINE = 'Translated by Google'

function translatedFromLine(languageName: string | null): string {
  return languageName === null
    ? UNNAMED_TRANSLATION_LINE
    : `Translated from ${languageName} by Google`
}

function originalLabel(languageName: string | null): string {
  return languageName === null ? ORIGINAL_LABEL : `${ORIGINAL_LABEL} in ${languageName}`
}

/** Whitespace is not prose: a blank body is no body, a blank translation none. */
function hasText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== ''
}

/**
 * A tag the browser will accept as `lang`, or null. The raw code is served
 * data (`inbox.repository.ts:782` copies it unvalidated from the snippet), so
 * it passes through `Intl.Locale`, which throws `RangeError` on a structurally
 * invalid tag, before it reaches an attribute.
 */
function validLanguageTag(tag: string | null | undefined): string | null {
  if (!hasText(tag)) return null
  try {
    return new Intl.Locale(tag).toString()
  } catch {
    return null
  }
}

/**
 * `inbox.repository.ts:769-787` nulls every snippet field when the eligibility
 * lookup answers `expired` or `not_found`, so at runtime this is belt and
 * braces. The TYPE, though, lets a caller hand us a translation beside a gone
 * status — a story, or `inbox-cache-policy.ts` replaying an entry written while
 * the snippet was still available. A translation of content the source has
 * withdrawn is not ours to promote to the body of the pane.
 */
function isContentGone(status: ReviewContentStatus): boolean {
  return status === 'expired' || status === 'not_found'
}

/**
 * True only when BOTH languages are known and they differ. Unknown is not
 * different, and that distinction is the whole of the review fix.
 *
 * Plan row 8 as first written compared with `equivalentReplyLanguageTags` and
 * promoted the translation whenever that answered false — but it answers false
 * whenever EITHER side is null (`reply-language-options.ts:51`), and in
 * production the review side is always null: the only review source,
 * `google-review-api.adapter.ts:450`, hard-codes `languageCode: null`, and
 * `google-review-comment.ts:7` measured `reviews.language_code` NULL for all
 * 256 rows. So every translated review flipped to translation-first — a
 * Bulgarian guest's Bulgarian sentence folded away at a Bulgarian property,
 * under Google's ENGLISH rendering of it — and the "same language keeps
 * today's arrangement" half of the row could never run.
 *
 * Both sides must canonicalize. `parseCanonicalReplyLanguageTag` needs a
 * `<lang>-<Script>` group (`reply-language-catalogue.ts:81-96`), so a raw
 * `bg-BG` proves nothing either way and keeps the guest's words as the body.
 * `propertyDefaultReplyLanguage` is already canonical or null
 * (`get-inbox-item-detail.ts:178-182`); parsing it again costs nothing and
 * keeps this function honest for a caller that is not the use case.
 *
 * What this still does NOT prove is that the reader can read the translation:
 * its language is recorded nowhere (see `GuestReviewBodyView`), and on this
 * repo's own measurement it is English (`google-review-comment.ts:8-10`). That
 * is why the attribution line names the source language and never claims a
 * target, and it is the question row 8 must answer before a review-language
 * signal is ever written — the moment one is, this branch goes live.
 */
function provenForeignToProperty(input: GuestReviewBodyInput): boolean {
  const review = input.reviewLanguageTag ?? null
  const property = input.propertyDefaultReplyLanguage ?? null
  if (!review || !property) return false
  const reviewLanguage = parseCanonicalReplyLanguageTag(review)
  const propertyLanguage = parseCanonicalReplyLanguageTag(property)
  return (
    reviewLanguage !== null &&
    propertyLanguage !== null &&
    reviewLanguage.templateGroup !== propertyLanguage.templateGroup
  )
}

/**
 * Which of the guest's two texts is the body (plan row 8, amended). The guest's
 * own words lead unless the review is PROVABLY in a language other than the
 * one the property replies in; only then is Google's rendering promoted, with
 * the original one click away and never discarded.
 *
 * The default direction matters more than the promotion. Before row 8 the pane
 * always led with the original; keeping that whenever the evidence is missing
 * means the worst this rule can do on unknown data is what v1 already did,
 * rather than put machine text in a guest's mouth.
 */
export function presentGuestReviewBody(input: GuestReviewBodyInput): GuestReviewBodyView {
  if (isContentGone(input.reviewContentStatus)) return { kind: 'no_text' }

  const { reviewText: original, reviewTranslatedText: translation } = input
  // One validated tag feeds both the `lang` attribute and the printed name, so
  // a string the browser would reject can neither label an element nor reach a
  // sentence as `Translated from not a tag! by Google`.
  const reviewLang =
    validLanguageTag(input.reviewLanguageTag) ??
    validLanguageTag(input.reviewLanguageCode)
  const languageName = languageDisplayName(reviewLang)

  if (!hasText(original)) {
    if (!hasText(translation)) return { kind: 'no_text' }
    return {
      kind: 'translation_only',
      body: translation,
      bodyLang: null,
      disclosure: null,
      translationLine: translatedFromLine(languageName),
    }
  }

  // Google returns the source text unchanged when it has nothing to translate.
  // A disclosure that opens onto the sentence already on screen is noise, so
  // that is not a translation for our purposes. Compared trimmed and rendered
  // untrimmed: the guest's own leading and trailing whitespace is theirs.
  const isTranslated = hasText(translation) && translation.trim() !== original.trim()
  if (!isTranslated) {
    return {
      kind: 'original_only',
      body: original,
      bodyLang: reviewLang,
      disclosure: null,
      translationLine: null,
    }
  }

  if (!provenForeignToProperty(input)) {
    return {
      kind: 'original_first',
      body: original,
      bodyLang: reviewLang,
      disclosure: { label: TRANSLATION_LABEL, text: translation, lang: null },
      translationLine: null,
    }
  }

  return {
    kind: 'translation_first',
    body: translation,
    bodyLang: null,
    disclosure: {
      label: originalLabel(languageName),
      text: original,
      lang: reviewLang,
    },
    translationLine: translatedFromLine(languageName),
  }
}

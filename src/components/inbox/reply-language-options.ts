import { parseCanonicalReplyLanguageTag } from '#/shared/reply-language-catalogue'

export type ReplyLanguageTarget =
  Readonly<{ kind: 'property_default' }> | Readonly<{ kind: 'review_language' }>

export const AUTO_DETECT_REVIEW_LANGUAGE = '__review_language_auto__' as const

export type ReplyLanguageOption = Readonly<{
  tag: string
  label: string
  source: 'property' | 'review' | 'review_auto' | 'saved'
}>

export function languageDisplayName(tag: string | null | undefined): string | null {
  if (!tag) return null
  try {
    const language = new Intl.Locale(tag).language
    const label = new Intl.DisplayNames(['en'], { type: 'language' }).of(language)
    return label ?? tag
  } catch {
    return tag
  }
}

function equivalentReplyLanguageTags(left: string | null, right: string | null): boolean {
  if (!left || !right) return false
  if (left === right) return true
  const leftLanguage = parseCanonicalReplyLanguageTag(left)
  const rightLanguage = parseCanonicalReplyLanguageTag(right)
  return (
    leftLanguage !== null &&
    rightLanguage !== null &&
    leftLanguage.templateGroup === rightLanguage.templateGroup
  )
}

export function replyLanguageOptions(
  input: Readonly<{
    propertyTag: string | null
    reviewTag: string | null
    savedTag: string | null
    canDetectReviewLanguage?: boolean
  }>,
): ReadonlyArray<ReplyLanguageOption> {
  const options: ReplyLanguageOption[] = []
  if (input.propertyTag) {
    options.push({
      tag: input.propertyTag,
      label: `Property default · ${languageDisplayName(input.propertyTag)}`,
      source: 'property',
    })
  }
  if (
    input.reviewTag &&
    !equivalentReplyLanguageTags(input.reviewTag, input.propertyTag)
  ) {
    options.push({
      tag: input.reviewTag,
      label: `Review language · ${languageDisplayName(input.reviewTag)}`,
      source: 'review',
    })
  } else if (!input.reviewTag && input.canDetectReviewLanguage === true) {
    options.push({
      tag: AUTO_DETECT_REVIEW_LANGUAGE,
      label: 'Review language · Detect automatically',
      source: 'review_auto',
    })
  }
  if (
    input.savedTag &&
    !options.some((option) => equivalentReplyLanguageTags(option.tag, input.savedTag))
  ) {
    options.push({
      tag: input.savedTag,
      label: `Saved draft · ${languageDisplayName(input.savedTag)}`,
      source: 'saved',
    })
  }
  return options
}

export function defaultReplyLanguageTag(
  input: Readonly<{
    propertyTag: string | null
    reviewTag: string | null
    savedTag: string | null
  }>,
): string | null {
  if (input.savedTag) {
    if (equivalentReplyLanguageTags(input.savedTag, input.propertyTag)) {
      return input.propertyTag
    }
    if (equivalentReplyLanguageTags(input.savedTag, input.reviewTag)) {
      return input.reviewTag
    }
  }
  return input.savedTag ?? input.propertyTag ?? input.reviewTag
}

export function targetForReplyLanguage(
  tag: string | null,
  propertyTag: string | null,
  reviewTag: string | null,
  options?: Readonly<{ canDetectReviewLanguage?: boolean }>,
): ReplyLanguageTarget | null {
  if (tag === AUTO_DETECT_REVIEW_LANGUAGE && options?.canDetectReviewLanguage === true) {
    return { kind: 'review_language' }
  }
  if (equivalentReplyLanguageTags(tag, propertyTag)) {
    return { kind: 'property_default' }
  }
  if (equivalentReplyLanguageTags(tag, reviewTag)) {
    return { kind: 'review_language' }
  }
  return null
}

/**
 * Verifies the concrete language returned by the governed AI boundary before
 * the composer adopts it. An explicit selection must match exactly. A deferred
 * review-language target may resolve a previously unknown tag through CLD3.
 */
export function resolveSuggestedReplyLanguageTag(
  suggestedTag: string,
  selectedTag: string | null,
  target: ReplyLanguageTarget,
): string | null {
  const suggested = parseCanonicalReplyLanguageTag(suggestedTag)
  if (suggested === null) return null
  if (selectedTag === null) {
    return target.kind === 'review_language' ? suggested.tag : null
  }
  const selected = parseCanonicalReplyLanguageTag(selectedTag)
  return selected?.tag === suggested.tag ? suggested.tag : null
}

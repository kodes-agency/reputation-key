import { parseCanonicalReplyLanguageTag } from '#/shared/reply-language-catalogue'

export type ReplyLanguageTarget =
  Readonly<{ kind: 'property_default' }> | Readonly<{ kind: 'review_language' }>

export type ReplyLanguageOption = Readonly<{
  tag: string
  label: string
  source: 'property' | 'review' | 'saved'
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
): ReplyLanguageTarget | null {
  if (equivalentReplyLanguageTags(tag, propertyTag)) {
    return { kind: 'property_default' }
  }
  if (equivalentReplyLanguageTags(tag, reviewTag)) {
    return { kind: 'review_language' }
  }
  return null
}

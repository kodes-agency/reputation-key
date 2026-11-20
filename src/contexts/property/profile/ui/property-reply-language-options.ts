import {
  REPLY_TEMPLATE_LANGUAGE_GROUPS,
  type ReplyTemplateLanguageGroup,
} from '#/shared/reply-language-catalogue'

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })

type PropertyReplyLanguageOption = Readonly<{
  tag: ReplyTemplateLanguageGroup
  label: string
}>

export const PROPERTY_REPLY_LANGUAGE_OPTIONS: ReadonlyArray<PropertyReplyLanguageOption> =
  Object.freeze(
    REPLY_TEMPLATE_LANGUAGE_GROUPS.map((tag) => ({
      tag,
      label: displayNames.of(tag) ?? tag,
    })).sort((a, b) => a.label.localeCompare(b.label, 'en')),
  )

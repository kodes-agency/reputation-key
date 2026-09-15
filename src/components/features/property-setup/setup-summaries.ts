import { REPLY_TEMPLATE_LANGUAGE_GROUPS } from '#/shared/reply-language-catalogue'
import type { SetupMember } from './property-setup-contract'
import { suggestedLanguageFor, type SetupPropertyFacts } from './setup-plan'

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })

function primaryLanguage(tag: string): string {
  return tag.split('-')[0] ?? tag
}

/**
 * The language's everyday name ("German"). The script is named only where one
 * language has several reply languages ("Simplified Chinese").
 */
export function replyLanguageLabel(tag: string): string {
  const primary = primaryLanguage(tag)
  const scripts = REPLY_TEMPLATE_LANGUAGE_GROUPS.filter(
    (group) => primaryLanguage(group) === primary,
  )
  return (scripts.length > 1 ? displayNames.of(tag) : displayNames.of(primary)) ?? tag
}

export const SETUP_REPLY_LANGUAGE_OPTIONS: ReadonlyArray<
  Readonly<{ tag: string; label: string }>
> = Object.freeze(
  REPLY_TEMPLATE_LANGUAGE_GROUPS.map((tag) => ({
    tag,
    label: replyLanguageLabel(tag),
  })).sort((a, b) => a.label.localeCompare(b.label, 'en')),
)

export function countLabel(count: number, noun = 'property'): string {
  if (count === 1) return `1 ${noun}`
  return `${count} ${noun === 'property' ? 'properties' : `${noun}s`}`
}

/** "Hotel A", "Hotel A and Hotel B", "Hotel A, Hotel B and 3 more". */
export function namesPhrase(names: readonly string[], shown = 2): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length <= shown)
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`
}

/** How the country suggestions read for the properties the question asks. */
export function languageSuggestionSummary(
  properties: readonly SetupPropertyFacts[],
): string {
  const groups = new Map<string, string[]>()
  for (const property of properties) {
    const language = suggestedLanguageFor(property)
    groups.set(language, [...(groups.get(language) ?? []), property.propertyName])
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  if (ordered.length === 1) {
    const [language, names] = ordered[0]!
    return names.length === 1
      ? `${replyLanguageLabel(language)}, based on the property's country.`
      : `${replyLanguageLabel(language)} for all ${names.length}, based on their country.`
  }
  return `Based on each country: ${ordered
    .map(
      ([language, names]) => `${replyLanguageLabel(language)} for ${namesPhrase(names)}`,
    )
    .join('; ')}.`
}

/** The language most suggestions agree on: the starting pick for "choose". */
export function mostSuggestedLanguage(properties: readonly SetupPropertyFacts[]): string {
  const counts = new Map<string, number>()
  for (const property of properties) {
    const language = suggestedLanguageFor(property)
    counts.set(language, (counts.get(language) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'en-Latn'
}

export function memberLabel(
  members: ReadonlyMap<string, SetupMember>,
  userId: string,
): string {
  const member = members.get(userId)
  return member ? member.name || member.email : 'Former member'
}

/** Everyone eligible somewhere in the batch, by name. */
export function eligibleManagerChoices(
  properties: readonly SetupPropertyFacts[],
  members: ReadonlyMap<string, SetupMember>,
): readonly Readonly<{ userId: string; label: string; eligibleCount: number }>[] {
  const counts = new Map<string, number>()
  for (const property of properties) {
    for (const userId of property.eligibleManagerIds) {
      counts.set(userId, (counts.get(userId) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([userId]) => members.has(userId))
    .map(([userId, eligibleCount]) => ({
      userId,
      label: memberLabel(members, userId),
      eligibleCount,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'))
}

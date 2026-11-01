import type { Portal } from './types'
import { portalError } from './errors'

const commonWords = new Set([
  'the',
  'and',
  'for',
  'your',
  'our',
  'with',
  'from',
  'del',
  'las',
  'los',
  'una',
  'con',
  'por',
  'para',
  'della',
  'dei',
  'gli',
  'una',
  'per',
  'con',
  'les',
  'des',
  'une',
  'avec',
  'pour',
  'sur',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'und',
  'mit',
  'von',
  'für',
  'наш',
  'ваш',
  'със',
  'при',
  'или',
  'като',
])
const wordingKeys = new Set([
  'title',
  'shortDescription',
  'heroAlt',
  'linktreeTitle',
  'label',
  'line',
  'headline',
  'subline',
])

/** Names remain manager labels even when wording is entered by hand. */
export function assertPersonalPortalPublicText(
  portal: Pick<Portal, 'kind' | 'name'>,
  value: unknown,
): void {
  if (portal.kind !== 'personal') return
  const words =
    portal.name
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  const textWords = stringsIn(value).flatMap(
    (text) =>
      text
        .normalize('NFKC')
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
  )
  if (
    words.some(
      (word) => word.length >= 3 && !commonWords.has(word) && textWords.includes(word),
    )
  )
    throw portalError(
      'personal_portal_name_private',
      'Remove the staff name from the guest wording before saving or publishing',
    )
}

function stringsIn(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, child]) => {
      if (wordingKeys.has(key)) return allStrings(child)
      return child && typeof child === 'object' ? stringsIn(child) : []
    })
  return []
}

function allStrings(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings)
  return []
}

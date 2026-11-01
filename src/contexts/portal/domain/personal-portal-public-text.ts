import type { Portal } from './types'
import { portalError } from './errors'

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
  if (words.some((word) => textWords.includes(word)))
    throw portalError(
      'personal_portal_name_private',
      'Remove the staff name from the guest wording before saving or publishing',
    )
}

function stringsIn(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn)
  return []
}

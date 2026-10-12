// What the leave prompt names when something could not be saved: each autosave
// or explicit-save key, in the words of the field it belongs to ("this portal's
// welcome line in Bulgarian"), so the person knows what they would lose. A key
// with no name here is left out of the list rather than shown raw.

import { GUEST_LOCALE_METADATA, isGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalDraftAttention } from '../portal-editor/portal-draft-autosave'

const FIXED: Readonly<Record<string, string>> = {
  welcome: 'the portal’s name',
  'private-note': 'the private note setting',
  'linktree-title': 'the Linktree title',
  languages: 'the languages',
  'responsible-managers': 'the responsible managers',
  look: 'the property look',
  locales: 'the property’s languages',
  'photo-focal': 'the photo’s focus point',
}

const IN_A_LANGUAGE: ReadonlyArray<readonly [prefix: string, name: string]> = [
  ['override-', 'this portal’s welcome line and link preview'],
  ['content-', 'the property wording'],
]

function languageName(code: string): string | null {
  return isGuestLocale(code) ? GUEST_LOCALE_METADATA[code].englishName : null
}

/** The words for one key, or null when the key names nothing a person would recognise. */
export function unsavedPartName(key: string): string | null {
  const fixed = FIXED[key]
  if (fixed !== undefined) return fixed
  if (key.startsWith('link-texts:')) return 'a Linktree link’s words'
  for (const [prefix, name] of IN_A_LANGUAGE) {
    if (!key.startsWith(prefix)) continue
    const language = languageName(key.slice(prefix.length))
    return language === null ? name : `${name} in ${language}`
  }
  return null
}

/** "a, b and c", each name once, in the order they came. */
function joinNames(names: ReadonlyArray<string>): string {
  const unique = [...new Set(names)]
  if (unique.length <= 1) return unique[0] ?? ''
  return `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
}

export type UnsavedSummary = Readonly<{
  /** "Not saved: the portal’s name." — null when no key could be named. */
  line: string | null
  /** Every cause is a write that failed: trying again may save it all. */
  retryable: boolean
}>

/** What the leave prompt says about what needs the person, and whether a retry could save it. */
export function describeUnsaved(attention: PortalDraftAttention): UnsavedSummary {
  const keys = [...attention.failed, ...attention.invalid, ...attention.explicit]
  const names = keys.map(unsavedPartName).filter((name) => name !== null)
  const joined = joinNames(names)
  return {
    line: joined === '' ? null : `Not saved: ${joined}.`,
    retryable:
      attention.failed.length > 0 &&
      attention.invalid.length === 0 &&
      attention.explicit.length === 0,
  }
}

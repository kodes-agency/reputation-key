const TITLE = /^(?:dr|mr|mrs|ms|miss|prof|sr|sra)\.?\s+/iu
const BUSINESS_TOKENS = new Set([
  'llc',
  'inc',
  'ltd',
  'co',
  'corp',
  'salon',
  'spa',
  'cafe',
  'café',
  'restaurant',
  'hotel',
  'services',
  'group',
  'studio',
  'official',
])
const LETTER = /\p{Letter}/u
const LATIN_LETTER = /\p{Script_Extensions=Latin}/u
const CYRILLIC_LETTER = /\p{Script_Extensions=Cyrillic}/u
const SHORT_UPPERCASE_NAMES = new Set(['AMY', 'BO', 'EVA', 'JO', 'LI', 'TOM'])

function looksLikeBusiness(value: string): boolean {
  const tokens = value
    .toLocaleLowerCase()
    .replaceAll(/[^\p{Letter}&]+/gu, ' ')
    .trim()
    .split(/\s+/u)
  return (
    tokens.some((token) => BUSINESS_TOKENS.has(token)) ||
    tokens.some((token, index) => token === '&' && tokens[index + 1] === 'sons')
  )
}

function isInitialsOnly(value: string): boolean {
  const scalars = [...value]
  const letters = scalars.filter((scalar) => LETTER.test(scalar))
  if (
    letters.length === 0 ||
    letters.length > 3 ||
    !scalars.every(
      (scalar) => LETTER.test(scalar) || scalar === '.' || /\s/u.test(scalar),
    )
  ) {
    return false
  }
  if (letters.length === 1 || value.includes('.')) return true
  const allUpper = letters.every(
    (letter) =>
      letter === letter.toLocaleUpperCase() && letter !== letter.toLocaleLowerCase(),
  )
  return allUpper && !SHORT_UPPERCASE_NAMES.has(letters.join(''))
}

function isGooglePlaceholder(value: string): boolean {
  const compact = value.toLocaleLowerCase().replaceAll(/\s+/gu, ' ')
  return compact === 'google user' || compact === 'a google user'
}

function canShowEveryLetter(value: string, languageGroup: string): boolean {
  const accepts = languageGroup.endsWith('-Latn')
    ? LATIN_LETTER
    : languageGroup === 'bg-Cyrl'
      ? CYRILLIC_LETTER
      : null
  if (accepts === null) return false
  for (const scalar of value) {
    if (/\p{Letter}/u.test(scalar) && !accepts.test(scalar)) return false
  }
  return true
}

function titleCase(value: string, locale: string): string {
  return value
    .split(/([-’'])/u)
    .map((part) => {
      if (part === '-' || part === "'" || part === '’' || part.length === 0) return part
      const [first, ...rest] = [...part]
      return `${first!.toLocaleUpperCase(locale)}${rest.join('').toLocaleLowerCase(locale)}`
    })
    .join('')
}

/** Conservative first-token extraction for a locally rendered greeting. */
export function firstNameForGreeting(
  displayName: string | null | undefined,
  languageGroup: string,
): string | null {
  if (displayName === null || displayName === undefined) return null
  const normalized = displayName.normalize('NFKC').trim()
  if (
    normalized.length === 0 ||
    isGooglePlaceholder(normalized) ||
    TITLE.test(normalized) ||
    looksLikeBusiness(normalized) ||
    /[\d_@]/u.test(normalized) ||
    /\.com\b/iu.test(normalized)
  ) {
    return null
  }

  const cleaned = normalized
    .replaceAll(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/gu, ' ')
    .replaceAll(/\p{Symbol}/gu, ' ')
    .replaceAll(/[^\p{Letter}\p{Mark}\s.'’-]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  if (cleaned.length === 0 || isInitialsOnly(cleaned)) {
    return null
  }

  const first = cleaned.split(/\s+/u)[0]?.replace(/^\.+|\.+$/gu, '') ?? ''
  if (
    first.length === 0 ||
    isInitialsOnly(first) ||
    !canShowEveryLetter(first, languageGroup)
  ) {
    return null
  }
  const letters = [...first].filter((scalar) => /\p{Letter}/u.test(scalar))
  const allUpper =
    letters.length > 0 && letters.every((letter) => letter === letter.toLocaleUpperCase())
  const allLower =
    letters.length > 0 && letters.every((letter) => letter === letter.toLocaleLowerCase())
  return allUpper || allLower
    ? titleCase(first, languageGroup.startsWith('bg-') ? 'bg' : 'en')
    : first
}

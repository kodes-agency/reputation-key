/**
 * Initials for a person's disc (plan v2.1 row 4: the owner control; row 12
 * reuses it for a note author's indicator).
 *
 * Why not `name.split(' ').map((w) => w[0]).join('').slice(0, 2)`, as
 * `layout/app-top-bar.tsx:40` does for the account menu. Run under Node 22:
 *
 * - `'𝒜lex Ivanov'` → `'\ud835I'`. `w[0]` is a UTF-16 code UNIT; a letter
 *   outside the Basic Multilingual Plane is two, so the disc gets half a
 *   surrogate pair and renders `�`.
 * - `'E\u0301lodie Martin'` → `'EM'`. A decomposed accent is two code POINTS
 *   and one grapheme; the first code point drops the accent the person typed.
 * - `'Georgi\tIvanov'` and `'Georgi\u00A0Ivanov'` → `'G'`. `split(' ')` sees
 *   one word, and U+00A0 is what a name pasted from a document carries.
 *   (A LEADING space happens to survive there — the empty word maps to
 *   `undefined`, which `join` prints as nothing — but only by accident.)
 * - `'Maria (Front desk)'` → `'M('`. A member directory name is free text.
 *
 * So: split on any Unicode whitespace, and in each word take the first
 * GRAPHEME whose first code point is a letter or a digit, skipping words that
 * have none (`Georgi – Reception` → `GR`). Two words at most, so a middle name
 * never widens a 20 px disc.
 *
 * `toUpperCase`, not `toLocaleUpperCase`: the same person must read the same
 * to every viewer, whatever their browser locale (a Turkish locale would turn
 * `i` into `İ` for one teammate and `I` for the next).
 *
 * Returns `null` — never `''` or a placeholder letter — when there is nothing
 * to draw, so the caller chooses its own fallback (the person glyph) instead
 * of rendering an empty disc or an initial the person does not have.
 */

const MAX_INITIALS = 2

/** A letter (any script) or a digit, tested against a grapheme's first code point. */
const INITIAL_START = /^[\p{L}\p{N}]/u

/**
 * `Intl.Segmenter` is ES2022 and present in every engine the app supports
 * (Chrome 87, Safari 14.1, Firefox 125, Node 16). The fallback keeps a missing
 * implementation from throwing inside render: `Array.from` iterates code
 * points, which still never splits a surrogate pair — it only loses the
 * combining-mark case.
 */
const graphemeSegmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

function graphemes(word: string): ReadonlyArray<string> {
  if (graphemeSegmenter === null) return Array.from(word)
  return Array.from(graphemeSegmenter.segment(word), (part) => part.segment)
}

function wordInitial(word: string): string | null {
  return graphemes(word).find((grapheme) => INITIAL_START.test(grapheme)) ?? null
}

export function personInitials(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null

  const initials = name
    .trim()
    .split(/\s+/u)
    .map(wordInitial)
    .filter((initial): initial is string => initial !== null)
    .slice(0, MAX_INITIALS)

  return initials.length === 0 ? null : initials.join('').toUpperCase()
}

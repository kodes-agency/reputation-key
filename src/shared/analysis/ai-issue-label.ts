// Anchored and evaluated only after the 40-character bound below; the repeated
// word group cannot receive attacker-controlled unbounded input.
// eslint-disable-next-line security/detect-unsafe-regex
export const AI_ISSUE_LABEL_PATTERN = /^[a-z]+(?: [a-z]+){0,3}$/
export const AI_ISSUE_LABEL_MAX_LENGTH = 40

/** The storage, read, and rendering boundary for model-authored issue labels. */
export function isAiIssueLabel(value: string): boolean {
  return value.length <= AI_ISSUE_LABEL_MAX_LENGTH && AI_ISSUE_LABEL_PATTERN.test(value)
}

/**
 * The consented merchant notice states the issue label "never reproduces
 * review text". `isAiIssueLabel` only enforces shape, and a lowercase excerpt
 * such as `worst hotel ever` satisfies it, so the claim rested entirely on a
 * prompt sentence. This is the structural half of it.
 *
 * A SINGLE word is a category, not an excerpt: `cleanliness` appears verbatim
 * in any review that complains about cleanliness, and rejecting it would
 * discard the discovery signal the open label exists to provide. Two or more
 * words appearing contiguously in the source is quotation, and is refused.
 *
 * Both sides are compared as words. A label holds only `a-z` and single
 * spaces, so a phrase copied from a review can never carry what touched it
 * there: the full stop or comma after it, a quotation mark, an accent, the
 * apostrophe in `didn't`. The review is therefore read as words before
 * matching, and a match is whole words in a row, never an incidental
 * substring.
 *
 * An apostrophe or a hyphen inside a word has two readings, and a copy can
 * take either: dropped (`didn't` as `didnt`, `Wi-Fi` as `wifi`) or as a word
 * break (`l'accueil froid` as `accueil froid`, `check-in` as `check in`). The
 * label is refused when it follows the review under either reading, chosen
 * mark by mark: `eau netait` copies `l'eau n'était`. An invisible format
 * character inside a word (a soft hyphen) is read the same two ways.
 *
 * Punctuation does not keep two words apart: `Dirty. Staff were kind` refuses
 * `dirty staff`. Telling a sentence break from a clause break would need a
 * grammar, and erring this way costs one optional label, never an excerpt.
 *
 * Known limit: a letter without a decomposition (`ß`, `ø`, `œ`, `æ`, `ł`) is
 * compared as written, so a transliterated copy (`grosse` for `große`) is not
 * recognised.
 */
export function issueLabelReproducesSource(label: string, sourceText: string): boolean {
  const labelWords = wordPieces(label).map((piece) => piece.text)
  if (labelWords.length < 2) return false
  const source = wordPieces(sourceText)
  return source.some((_piece, start) => spellsWordsFrom(source, start, labelWords))
}

/**
 * A run of letters and digits in the text. `joinsPrevious` says an in-word
 * mark, not a break, separates it from the piece before: `didn't` is the
 * pieces `didn` and `t`, which a label can spell as one word or as two.
 */
type WordPiece = Readonly<{ text: string; joinsPrevious: boolean }>

const WORD_BREAK = ' '
/** Stands for an in-word mark once every other mark has become a break. */
const IN_WORD_MARK = "'"

const COMBINING_MARKS = /\p{M}+/gu
/**
 * U+00B4 (acute accent) typed for an apostrophe. NFKC and NFKD both spell it
 * as a space carrying a combining acute, and review text arrives in NFKC, so it
 * is recognised in that form, while the combining marks are still in the text.
 */
const ACUTE_ACCENT_IN_WORD = /(?<=\p{L}\p{M}*) \u0301(?=\p{L})/gu
/**
 * Everything that is not a letter or a digit. The first alternative is one
 * mark between two letters, captured: the apostrophe as typed (`'`, U+2019,
 * U+02BC), what guests type for it (U+0060 grave accent, U+2018 left
 * quotation mark, U+2032 prime, U+02B9 modifier prime), the hyphen (`-`,
 * U+2010) and a format character such as the soft hyphen. The second is any
 * other run. The two modifier letters count as letters in Unicode, so they are
 * named there too and never stay in a word.
 */
const NOT_A_WORD_CHARACTER =
  /(?<=\p{L})(['`\u2018\u2019\u2032\u02b9\u02bc\u2010\p{Cf}-])(?=\p{L})|(?:[^\p{L}\p{N}]|[\u02b9\u02bc])+/gu

/**
 * The text as lowercase word pieces: compatibility forms folded (NFKD),
 * diacritics removed, a mark inside a word kept as a join between its two
 * pieces, and every other run that is not a letter or a digit read as a break.
 */
function wordPieces(value: string): ReadonlyArray<WordPiece> {
  return value
    .normalize('NFKD')
    .replace(ACUTE_ACCENT_IN_WORD, IN_WORD_MARK)
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NOT_A_WORD_CHARACTER, (_run, inWordMark: string | undefined) =>
      inWordMark === undefined ? WORD_BREAK : IN_WORD_MARK,
    )
    .trim()
    .split(WORD_BREAK)
    .flatMap((word) =>
      word.split(IN_WORD_MARK).map((text, index) => ({ text, joinsPrevious: index > 0 })),
    )
}

const NOT_SPELLED = -1

/** Whether `words` follow one another in `source`, the first at piece `start`. */
function spellsWordsFrom(
  source: ReadonlyArray<WordPiece>,
  start: number,
  words: ReadonlyArray<string>,
): boolean {
  let position = start
  for (const word of words) {
    position = endOfWordAt(source, position, word)
    if (position === NOT_SPELLED) return false
  }
  return true
}

/**
 * Where `word` ends when it starts at piece `start`: after that piece, or
 * after the pieces an in-word mark joins to it when the word is longer
 * (`didnt` over `didn` and `t`). The next word may start at any piece, since
 * a mark also reads as a break. `NOT_SPELLED` when the source has another
 * word there.
 */
function endOfWordAt(
  source: ReadonlyArray<WordPiece>,
  start: number,
  word: string,
): number {
  let spelled = ''
  let position = start
  while (spelled.length < word.length) {
    const piece = source[position]
    if (piece === undefined || (position > start && !piece.joinsPrevious)) break
    spelled += piece.text
    position += 1
  }
  return spelled === word ? position : NOT_SPELLED
}

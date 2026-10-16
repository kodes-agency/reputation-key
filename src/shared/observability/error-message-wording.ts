// What an error report may say in place of an error's message (Privacy Notice
// 2.4, section 2).
//
// Only an error of a type the JavaScript runtime raises itself keeps any
// wording: TypeError, RangeError, ReferenceError, SyntaxError, URIError and
// EvalError. Their messages name the part of the program that failed
// ("replies.map is not a function"); where they quote a value, the value is in
// quotation marks. Of that wording the report keeps the first line, at most 200
// characters, after removing anything in quotation marks, web addresses, file
// paths, email addresses, identifiers, keys and numbers of four or more digits.
// Every other error's message (the application's own, the database's, a
// library's) can carry a value nothing marks, so it is still replaced whole:
// the codes in error-facts.ts tell those apart.
//
// No lookbehind and no nested quantifier: this runs in every supported browser
// and on every error, so each pattern must parse there and stay linear.

const REDACTED = '[REDACTED]'
const MAX_WORDING_LENGTH = 200
const MIN_DIGITS_REMOVED = 4

const RUNTIME_ERROR_TYPES: ReadonlySet<string> = new Set([
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
])

const QUOTED = /"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|“[^”\n]*”|‘[^’\n]*’/gu
const URL = /\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/giu
const PATH = /(^|\s)\/[^\s"'<>]+/gu
const EMAIL = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/giu
const UUID = /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/giu
const WORD = /\b[\w-]{16,}\b/gu
const NUMBER = /\+?\d[\d\s()./-]*\d/gu

/** A long word with both letters and digits is a key or a token, not a name in the program. */
function withoutKeys(text: string): string {
  return text.replace(WORD, (word) =>
    /\d/u.test(word) && /[a-z]/iu.test(word) ? '<key>' : word,
  )
}

function withoutLongNumbers(text: string): string {
  return text.replace(NUMBER, (run) =>
    (run.match(/\d/gu)?.length ?? 0) >= MIN_DIGITS_REMOVED ? '<number>' : run,
  )
}

export function errorMessageWording(type: unknown, message: unknown): string {
  if (typeof type !== 'string' || !RUNTIME_ERROR_TYPES.has(type)) return REDACTED
  if (typeof message !== 'string') return REDACTED
  const [firstLine = ''] = message.split('\n', 1)
  const wording = withoutLongNumbers(
    withoutKeys(
      firstLine
        .replace(QUOTED, '"…"')
        .replace(URL, '<url>')
        .replace(PATH, '$1<path>')
        .replace(EMAIL, '<email>')
        .replace(UUID, '<id>'),
    ),
  )
  return wording.slice(0, MAX_WORDING_LENGTH)
}

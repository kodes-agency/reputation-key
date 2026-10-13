// Expiry for the container scan exceptions in `.grype.yaml`.
//
// grype has no expiry field for an ignore rule, so each rule's owner, reason and
// `expiresAt: YYYY-MM-DD` live in the comment block directly above it
// (docs/operations/security-ci-policy.md, "Exception schema and expiry"). Until
// this module nothing read those dates: twelve rules stayed in force four days
// past theirs at a green commit, while the audit and license gates already
// failed on an expired entry. `pnpm check:container-images` now fails a rule
// whose date has passed and a rule with no readable date, so the largest class
// of exceptions expires like the other two.
//
// The file is read as lines, not as YAML: the dates are comments, which a YAML
// parser drops. grype does parse YAML, and honours a rule in any shape YAML
// allows, so the reader fails closed: a line it cannot place is a violation,
// never "no rule here". It accepts one shape only, the one the file is written
// in: a plain top-level `ignore:` key, then one `- ` item per rule on its own
// line, each under a dated comment.

export type GrypeException = Readonly<{
  /** What the rule ignores: the CVE, with its version scope, or the package. */
  rule: string
  /** 1-based line of the rule in `.grype.yaml`. */
  line: number
  /** 1-based first line of the comment block that governs it; 0 when none does. */
  commentLine: number
  /** The one valid date in that comment block, else null. */
  expiresAt: string | null
  /** True when that comment block names more than one date. */
  ambiguous: boolean
}>

const LINE_BREAK = /\r?\n/u
const IGNORE_KEY = 'ignore'
// A line at column 0 that is neither a comment nor a list item is a key: it
// ends the list above it, and only a plain `key:` is one the reader can name.
const STARTS_AT_COLUMN_ZERO = /^[^\s#-]/u
const PLAIN_KEY = /^([A-Za-z_][\w.-]*):(?:\s+(.*))?$/u
// What may follow `ignore:` on its own line: nothing, `[]`, a comment.
const NO_INLINE_RULES = /^(?:\[\s*\])?\s*(?:#.*)?$/u
// A list item: a dash, then whitespace or the end of the line.
const RULE_START = /^\s*-(?:\s|$)/u
const COMMENT = /^\s*#/u
const BLANK = /^\s*$/u
const FIRST_NON_SPACE = /\S/u
const EXPIRES_AT = /expiresAt:\s*(\d{4}-\d{2}-\d{2})\b/gu
const VULNERABILITY = /\bvulnerability:\s*([^\s#]+)/u
const PACKAGE_NAME = /\bname:\s*([^\s#]+)/u
const PACKAGE_VERSION = /\bversion:\s*([^\s#]+)/u

type CommentBlock = Readonly<{ line: number; text: readonly string[] }>
type OpenRule = Readonly<{
  line: number
  text: readonly string[]
  comment: CommentBlock
}>

/** Why the reader cannot place a line. */
type UnreadableShape = 'not-a-key' | 'value-on-key-line' | 'stray'
type UnreadableLine = Readonly<{ line: number; shape: UnreadableShape }>

type Scan = Readonly<{
  inIgnore: boolean
  comment: CommentBlock
  inComment: boolean
  /** Column of the open rule's dash; NO_OPEN_RULE when no rule is open. */
  ruleColumn: number
  rules: readonly OpenRule[]
  unreadable: readonly UnreadableLine[]
}>

const NO_COMMENT: CommentBlock = { line: 0, text: [] }
const NO_OPEN_RULE = -1
const EMPTY_SCAN: Scan = {
  inIgnore: false,
  comment: NO_COMMENT,
  inComment: false,
  ruleColumn: NO_OPEN_RULE,
  rules: [],
  unreadable: [],
}

function isCalendarDay(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function describeRule(lines: readonly string[]): string {
  const text = lines.join('\n')
  const vulnerability = VULNERABILITY.exec(text)?.[1]
  const version = PACKAGE_VERSION.exec(text)?.[1]
  if (vulnerability) return version ? `${vulnerability} (${version})` : vulnerability
  return [PACKAGE_NAME.exec(text)?.[1], version].filter(Boolean).join(' ') || 'unnamed'
}

function toException(rule: OpenRule): GrypeException {
  const dates = [...rule.comment.text.join('\n').matchAll(EXPIRES_AT)]
    .map((match) => match[1])
    .filter((date): date is string => date !== undefined)
  const only = dates.length === 1 ? dates[0] : undefined
  return {
    rule: describeRule(rule.text),
    line: rule.line,
    commentLine: rule.comment.line,
    expiresAt: only && isCalendarDay(only) ? only : null,
    ambiguous: dates.length > 1,
  }
}

function columnOf(text: string): number {
  return text.search(FIRST_NON_SPACE)
}

function unreadable(scan: Scan, line: number, shape: UnreadableShape): Scan {
  return {
    ...scan,
    inComment: false,
    unreadable: [...scan.unreadable, { line, shape }],
  }
}

/** A top-level key ends whatever list was open; `ignore` opens the one read. */
function readKey(scan: Scan, text: string, line: number): Scan {
  const closed: Scan = {
    ...scan,
    inIgnore: false,
    comment: NO_COMMENT,
    inComment: false,
    ruleColumn: NO_OPEN_RULE,
  }
  const key = PLAIN_KEY.exec(text)
  if (!key) return unreadable(closed, line, 'not-a-key')
  if (key[1] !== IGNORE_KEY) return closed
  const opened: Scan = { ...closed, inIgnore: true }
  return NO_INLINE_RULES.test(key[2] ?? '')
    ? opened
    : unreadable(opened, line, 'value-on-key-line')
}

function readComment(scan: Scan, text: string, line: number): Scan {
  const comment = scan.inComment
    ? { line: scan.comment.line, text: [...scan.comment.text, text] }
    : { line, text: [text] }
  return { ...scan, comment, inComment: true }
}

function openRule(scan: Scan, text: string, line: number): Scan {
  return {
    ...scan,
    inComment: false,
    ruleColumn: columnOf(text),
    rules: [...scan.rules, { line, text: [text], comment: scan.comment }],
  }
}

/** A line belongs to the open rule only when it is indented past its dash. */
function continueRule(scan: Scan, text: string, line: number): Scan {
  const open = scan.rules.at(-1)
  if (!open || scan.ruleColumn === NO_OPEN_RULE || columnOf(text) <= scan.ruleColumn) {
    return unreadable(scan, line, 'stray')
  }
  return {
    ...scan,
    inComment: false,
    rules: [...scan.rules.slice(0, -1), { ...open, text: [...open.text, text] }],
  }
}

function readIgnoreLine(scan: Scan, text: string, line: number): Scan {
  if (BLANK.test(text)) return { ...scan, comment: NO_COMMENT, inComment: false }
  if (COMMENT.test(text)) return readComment(scan, text, line)
  return RULE_START.test(text)
    ? openRule(scan, text, line)
    : continueRule(scan, text, line)
}

function readLine(scan: Scan, text: string, index: number): Scan {
  if (STARTS_AT_COLUMN_ZERO.test(text)) return readKey(scan, text, index + 1)
  return scan.inIgnore ? readIgnoreLine(scan, text, index + 1) : scan
}

function scanGrypeFile(yaml: string): Scan {
  return yaml.split(LINE_BREAK).reduce(readLine, EMPTY_SCAN)
}

/**
 * Every ignore rule with the expiry of the comment block directly above it. A
 * comment block is a run of comment lines; it governs the rules that follow it
 * until a blank line or the next comment block, so a rule can never borrow the
 * date of an earlier section.
 */
export function parseGrypeExceptions(yaml: string): readonly GrypeException[] {
  return scanGrypeFile(yaml).rules.map(toException)
}

const HOW_TO_WRITE_A_RULE =
  'write each rule as a "- …" item on its own line under a dated comment'

const UNREADABLE: Readonly<Record<UnreadableShape, string>> = {
  'not-a-key':
    'is a top-level line the expiry gate cannot read, so an ignore list could sit behind it — write a plain, unquoted "key:"',
  'value-on-key-line': `"ignore:" is followed by a value on the same line, where no expiry comment governs a rule — ${HOW_TO_WRITE_A_RULE}`,
  stray: `is inside the ignore list but is neither a rule ("- …") nor part of one, so grype may honour it with no expiry — ${HOW_TO_WRITE_A_RULE}`,
}

/** One violation for each run of adjacent lines unreadable in the same way. */
function unreadableViolations(lines: readonly UnreadableLine[]): readonly string[] {
  return lines
    .filter((entry, index) => {
      const before = lines[index - 1]
      return before?.shape !== entry.shape || before.line !== entry.line - 1
    })
    .map(({ line, shape }) => `.grype.yaml:${line} ${UNREADABLE[shape]}`)
}

type Verdict = 'undated' | 'ambiguous' | 'expired' | 'current'

function verdictFor(exception: GrypeException, today: string): Verdict {
  if (exception.ambiguous) return 'ambiguous'
  if (exception.expiresAt === null) return 'undated'
  return exception.expiresAt < today ? 'expired' : 'current'
}

const COMPLAINT: Readonly<
  Record<Exclude<Verdict, 'current'>, (expiresAt: string | null) => string>
> = {
  undated: () =>
    'carry no valid "expiresAt: YYYY-MM-DD" in the comment directly above them',
  ambiguous: () => 'name more than one expiresAt in the comment directly above them',
  expired: (expiresAt) =>
    `EXPIRED on ${expiresAt} — remove them with the fix, or renew them with a fresh reason and date`,
}

type FailingException = GrypeException & Readonly<{ complaint: string }>

function failingOn(today: string): (exception: GrypeException) => FailingException[] {
  return (exception) => {
    const verdict = verdictFor(exception, today)
    if (verdict === 'current') return []
    return [{ ...exception, complaint: COMPLAINT[verdict](exception.expiresAt) }]
  }
}

/** A rule with no comment block above it stands alone, keyed by its own line. */
function blockKey({ commentLine, line }: GrypeException): number {
  return commentLine || line
}

/** One violation per comment block whose rules fail on `today`. */
function expiryViolations(
  exceptions: readonly GrypeException[],
  today: string,
): readonly string[] {
  const failing = exceptions.flatMap(failingOn(today))
  const firstOfBlock = failing.filter(
    (exception, index) =>
      failing.findIndex((other) => blockKey(other) === blockKey(exception)) === index,
  )
  return firstOfBlock.map((first) => {
    const named = failing
      .filter((exception) => blockKey(exception) === blockKey(first))
      .map(({ rule }) => rule)
      .join(', ')
    return `.grype.yaml:${first.line} exception(s) for ${named} ${first.complaint}`
  })
}

/**
 * Every line the reader cannot place, then one violation per comment block
 * whose rules are expired, undated or doubly dated on `today` (a UTC
 * `YYYY-MM-DD`, compared as the audit and license gates compare theirs). An
 * exception is valid through its `expiresAt` day and fails the day after.
 */
export function validateGrypeExceptionExpiry(
  yaml: string,
  today: string,
): readonly string[] {
  const scan = scanGrypeFile(yaml)
  return [
    ...unreadableViolations(scan.unreadable),
    ...expiryViolations(scan.rules.map(toException), today),
  ]
}

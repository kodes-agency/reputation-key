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
// parser drops.

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

const IGNORE_KEY = /^ignore:/u
// The next top-level key ends the ignore list; other lists are not exceptions.
const TOP_LEVEL_KEY = /^[A-Za-z_]/u
const RULE_START = /^\s*-\s/u
const COMMENT = /^\s*#/u
const EXPIRES_AT = /expiresAt:\s*(\d{4}-\d{2}-\d{2})\b/gu
const VULNERABILITY = /\bvulnerability:\s*([^\s#]+)/u
const PACKAGE_NAME = /\bname:\s*([^\s#]+)/u
const PACKAGE_VERSION = /\bversion:\s*([^\s#]+)/u

type CommentBlock = Readonly<{ line: number; text: readonly string[] }>
type OpenRule = Readonly<{ line: number; text: string[]; comment: CommentBlock }>

const NO_COMMENT: CommentBlock = { line: 0, text: [] }

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

/**
 * Every ignore rule with the expiry of the comment block directly above it. A
 * comment block is a run of comment lines; it governs the rules that follow it
 * until a blank line or the next comment block, so a rule can never borrow the
 * date of an earlier section.
 */
export function parseGrypeExceptions(yaml: string): readonly GrypeException[] {
  const lines = yaml.split('\n')
  const start = lines.findIndex((line) => IGNORE_KEY.test(line))
  if (start === -1) return []
  const next = lines.findIndex((line, index) => index > start && TOP_LEVEL_KEY.test(line))
  const end = next === -1 ? lines.length : next

  const rules: OpenRule[] = []
  let comment = NO_COMMENT
  let inComment = false
  for (const [index, line] of lines.entries()) {
    if (index <= start || index >= end) continue
    const wasInComment = inComment
    inComment = COMMENT.test(line)
    if (inComment) {
      comment = wasInComment
        ? { line: comment.line, text: [...comment.text, line] }
        : { line: index + 1, text: [line] }
    } else if (line.trim() === '') {
      comment = NO_COMMENT
    } else if (RULE_START.test(line)) {
      rules.push({ line: index + 1, text: [line], comment })
    } else {
      rules.at(-1)?.text.push(line)
    }
  }
  return rules.map(toException)
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

/**
 * One violation per comment block whose rules are expired, undated or doubly
 * dated on `today` (a UTC `YYYY-MM-DD`, compared as the audit and license
 * gates compare theirs). An exception is valid through its `expiresAt` day and
 * fails the day after.
 */
export function validateGrypeExceptionExpiry(
  yaml: string,
  today: string,
): readonly string[] {
  const failing = parseGrypeExceptions(yaml).flatMap(failingOn(today))
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

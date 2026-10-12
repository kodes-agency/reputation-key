// Where an interpolation stands in a raw SQL statement.
//
// `WHERE organization_id = ${orgId}`, `SELECT ${orgId} AS organization_id` and
// `SET organization_id = ${orgId}` interpolate the same value, and only the
// first restricts the statement. For each interpolation of one `sql` template
// this module says what the text before it compares it with, and whether the
// place it stands in can restrict the rows the statement reads or writes.
//
// It is a scanner, not a parser. It knows parentheses, CASE … END, the clause
// keywords, comments and quoted strings: enough to tell a predicate from a
// projection, an assignment, a VALUES row, a CASE branch, a negation or one
// side of an OR. Where it cannot tell it answers "cannot restrict", so the
// tenant-predicate canary reports the statement instead of passing it.

export type SqlComparison = 'equality' | 'range' | null

export type SqlSlot = Readonly<{
  /**
   * What the text before the interpolation holds it to: `= ?`, `= ANY(?`,
   * `IN (?` and `IS NOT DISTINCT FROM ?` are equalities, `> ?` and `<> ?`
   * ranges. Only an operator written BEFORE the interpolation is read.
   */
  comparison: SqlComparison
  /**
   * False in a projection, an assignment, a VALUES row or a CASE branch, under
   * NOT, and beside an OR. That is asked where the interpolation stands and,
   * going outwards, at every query around it that reads held rows itself: a
   * predicate inside `(SELECT … FROM held WHERE …)` restricts the subquery, and
   * the statement only when the statement filters by that subquery. `a OR b`
   * never restricts here, even when both sides do.
   */
  canRestrict: boolean
}>

/** What an interpolation is, as far as the shape of the statement goes. */
export type SqlInterpolation = Readonly<{
  /** The clause keyword a spliced-in fragment begins with: `FROM` for `${fromAndWhereSql}`. */
  lead?: string
  /** An interpolated table, and whether its rows are held. */
  table?: 'held' | 'other'
}>

export type SqlTemplate = Readonly<{
  /** The literal parts: the head, then the text after each interpolation. */
  literals: readonly string[]
  /** One entry per interpolation; a missing one is a plain value. */
  interpolations?: readonly SqlInterpolation[]
  /** Database names of the tables whose rows a predicate has to restrict. */
  heldTables: ReadonlySet<string>
}>

type Group = Readonly<{
  /** Index of the `(` or `CASE` that opens the group; -1 for the statement. */
  opener: number
  /** First index inside the group, and one past the last. */
  start: number
  end: number
  /** The clause a position inside the group is in before any keyword of its own. */
  clause: string | null
}>

type OpenGroup = Pick<Group, 'opener' | 'start' | 'clause'>

/** A group with its own text: what the groups inside it hold is blanked. */
type Level = Readonly<{ group: Group; text: string }>

const PLACEHOLDER = '?'
const HELD_TABLE = '__held__'
const OTHER_TABLE = '__other__'
// A comment, or a quoted string: text whose words are not SQL.
const NOISE = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/gu
const GROUP_TOKEN = /\(|\)|\bCASE\b|\bEND\b/giu
// Where one clause, or one item of a list, ends and the next begins.
// `IS NOT DISTINCT FROM` is an operator, not the start of a FROM clause.
const BOUNDARY =
  /[,;]|\b(?:SELECT|(?<!\bDISTINCT\s+)FROM|WHERE|JOIN|ON|USING|HAVING|GROUP|ORDER|LIMIT|OFFSET|RETURNING|UNION|EXCEPT|INTERSECT|SET|VALUES|WITH|AS|FOR|WHEN|THEN|ELSE|INSERT|UPDATE|DELETE|INTO|DO|WINDOW)\b/giu
/** The keywords a fragment begins a clause of its own with: `${fromAndWhereSql}`. */
const LEADING_CLAUSES: ReadonlySet<string> = new Set([
  'FROM',
  'WHERE',
  'JOIN',
  'ON',
  'USING',
  'HAVING',
  'GROUP',
  'ORDER',
  'LIMIT',
  'RETURNING',
  'UNION',
  'SET',
  'VALUES',
  'FOR',
])
/** `LEFT OUTER JOIN`: the words a join may be written with before `JOIN`. */
const JOIN_MODIFIERS: ReadonlySet<string> = new Set([
  'LEFT',
  'RIGHT',
  'INNER',
  'FULL',
  'CROSS',
  'OUTER',
])
/** Clauses whose content is produced, assigned or ordered, never filtered by. */
const NOT_A_PREDICATE: ReadonlySet<string> = new Set([
  'SELECT',
  'SET',
  'VALUES',
  'RETURNING',
  'GROUP',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'INSERT',
  'UPDATE',
  'DELETE',
  'INTO',
  'DO',
  'WINDOW',
])
const DISJUNCTION = /\bOR\b/iu
// `NOT (…)`, `NOT EXISTS (…)`, `NOT IN (…)`: what follows is excluded, not required.
const NEGATION = /\bNOT(?: EXISTS| IN)? ?$/iu
// A query of its own, as opposed to a parenthesised part of a predicate.
const QUERY = /\b(?:SELECT|UPDATE|DELETE|INSERT)\b/iu
// The tables a query reads or rewrites rows of. An INSERT's target is not one.
const ROW_SOURCE = /\b(?:(?<!\bDISTINCT\s+)FROM|JOIN|UPDATE|USING)\s+(\w+|\?)/giu
// `?,`, `?::uuid,` and `?::text[],`: an earlier member of the row value an interpolation sits in.
const ROW_VALUE_MEMBER = /\?,$|\?::\w+,$|\?::\w+\[\],$/u
const RANGE_OPERATOR = /(?:[<>]=?|<>|!=)$/u
const EQUALITY_OPERATOR = /(?:=|=ANY|(?<!\bNOT )\bIN|\bIS NOT DISTINCT FROM)$/iu
const INSERT_STATEMENT = /^\s*INSERT\s+INTO\b/iu
const VALUES_CLAUSE = /\bVALUES\b/iu
const SELECT_CLAUSE = /\bSELECT\b/iu

/** A comment becomes blanks and a string keeps only its quotes; every offset stays. */
function maskNoise(sql: string): string {
  return sql.replace(NOISE, (noise) =>
    noise.startsWith("'")
      ? `'${'_'.repeat(noise.length - 2)}'`
      : ' '.repeat(noise.length),
  )
}

/** `FROM ?` for a fragment that begins a clause, a marker for a table, `?` for the rest. */
function spell(interpolation: SqlInterpolation | undefined): readonly [string, string] {
  if (interpolation?.table !== undefined) {
    return ['', interpolation.table === 'held' ? HELD_TABLE : OTHER_TABLE]
  }
  const lead = interpolation?.lead ?? ''
  return [lead === '' ? '' : `${lead} `, PLACEHOLDER]
}

/** The statement's text with each interpolation spelled out, and where each one is. */
function layOut(
  template: Pick<SqlTemplate, 'literals' | 'interpolations'>,
): Readonly<{ sql: string; offsets: readonly number[] }> {
  const offsets: number[] = []
  let sql = template.literals[0] ?? ''
  template.literals.slice(1).forEach((literal, index) => {
    const [lead, mark] = spell(template.interpolations?.[index])
    offsets.push(sql.length + lead.length)
    sql += `${lead}${mark}${literal}`
  })
  return { sql: maskNoise(sql), offsets }
}

/** Every parenthesis and every CASE … END of the statement, and the statement itself. */
function readGroups(sql: string): readonly Group[] {
  const groups: Group[] = [{ opener: -1, start: 0, end: sql.length, clause: null }]
  const open: OpenGroup[] = []
  for (const match of sql.matchAll(GROUP_TOKEN)) {
    const token = match[0].toUpperCase()
    if (token === '(' || token === 'CASE') {
      open.push({
        opener: match.index,
        start: match.index + token.length,
        clause: token === 'CASE' ? token : null,
      })
      continue
    }
    const innermost = open.at(-1)
    // A `)` closes a parenthesis and an END a CASE; a stray one closes nothing.
    if (innermost === undefined || (innermost.clause === 'CASE') !== (token === 'END')) {
      continue
    }
    open.pop()
    groups.push({ ...innermost, end: match.index })
  }
  // A fragment may open a group that another fragment closes.
  return [...groups, ...open.map((group) => ({ ...group, end: sql.length }))]
}

function blank(text: string, from: number, to: number): string {
  return `${text.slice(0, from)}${' '.repeat(to - from)}${text.slice(to)}`
}

function ownText(sql: string, group: Group, groups: readonly Group[]): string {
  let text = sql.slice(group.start, group.end)
  for (const inner of groups) {
    if (inner === group || inner.opener < group.start || inner.end > group.end) continue
    text = blank(text, inner.start - group.start, inner.end - group.start)
  }
  return text
}

/** The groups around an offset with their own text, innermost first. */
function levelsAround(
  sql: string,
  groups: readonly Group[],
  offset: number,
): readonly Level[] {
  return groups
    .filter((group) => group.start <= offset && offset < group.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))
    .map((group) => ({ group, text: ownText(sql, group, groups) }))
}

/**
 * The query a level belongs to: itself, or the nearest level around it that
 * has a query keyword. A parenthesised part of a predicate has none of its
 * own. -1 for a fragment with no query in sight.
 */
function queryOf(levels: readonly Level[], index: number): number {
  return levels.findIndex(
    (level, position) => position >= index && QUERY.test(level.text),
  )
}

/** Whether a query reads held rows itself. One that is not in sight is taken to. */
function readsHeldRows(
  query: Level | undefined,
  heldTables: ReadonlySet<string>,
): boolean {
  if (query === undefined) return true
  const plain = query.text.replace(/"/gu, '').replace(/\bpublic\./giu, '')
  return [...plain.matchAll(ROW_SOURCE)].some(
    ([, source = PLACEHOLDER]) =>
      // A table the scanner cannot name may be a held one.
      source === PLACEHOLDER ||
      source === HELD_TABLE ||
      heldTables.has(source.toLowerCase()),
  )
}

/** Whether `position` of a level is in a predicate that no OR and no NOT weakens. */
function placeCanRestrict(level: Level, position: number): boolean {
  const { text } = level
  let clause = level.group.clause
  let itemStart = 0
  let itemEnd = text.length
  for (const boundary of text.matchAll(BOUNDARY)) {
    if (boundary.index > position) {
      itemEnd = boundary.index
      break
    }
    itemStart = boundary.index + boundary[0].length
    if (boundary[0].length > 1) clause = boundary[0].toUpperCase()
  }
  if (clause !== null && NOT_A_PREDICATE.has(clause)) return false
  if (NEGATION.test(text.slice(itemStart, position).replace(/\s+/gu, ' '))) return false
  return !DISJUNCTION.test(text.slice(itemStart, itemEnd))
}

function canRestrict(
  levels: readonly Level[],
  offset: number,
  heldTables: ReadonlySet<string>,
): boolean {
  const ownQuery = queryOf(levels, 0)
  let position = offset
  for (const [index, level] of levels.entries()) {
    // The query the interpolation stands in always counts; a query further out
    // only when it has held rows of its own for the predicate to restrict.
    const query = queryOf(levels, index)
    const counts = query === ownQuery || readsHeldRows(levels[query], heldTables)
    if (counts && !placeCanRestrict(level, position - level.group.start)) return false
    position = level.group.opener
  }
  return true
}

function comparisonBefore(before: string): SqlComparison {
  let compared = before
    .replace(/\s+/gu, ' ')
    .replace(/ ?([(),=<>!:]) ?/gu, '$1')
    .trimEnd()
  while (ROW_VALUE_MEMBER.test(compared))
    compared = compared.replace(ROW_VALUE_MEMBER, '')
  if (compared.endsWith('(')) compared = compared.slice(0, -1)
  if (RANGE_OPERATOR.test(compared)) return 'range'
  return EQUALITY_OPERATOR.test(compared) ? 'equality' : null
}

/** One slot per interpolation of a `sql` template. */
export function readSqlSlots(template: SqlTemplate): readonly SqlSlot[] {
  const { sql, offsets } = layOut(template)
  const groups = readGroups(sql)
  return offsets.map((offset) => ({
    comparison: comparisonBefore(sql.slice(0, offset)),
    canRestrict: canRestrict(
      levelsAround(sql, groups, offset),
      offset,
      template.heldTables,
    ),
  }))
}

/** The clause keyword a fragment of SQL begins with, or '' when it continues one. */
export function leadingClause(fragment: string): string {
  const words = maskNoise(fragment).trimStart().toUpperCase().split(/\W+/u)
  const first = words.find((word) => !JOIN_MODIFIERS.has(word)) ?? ''
  return LEADING_CLAUSES.has(first) ? first : ''
}

/**
 * `INSERT INTO t (…) VALUES (…)`: a statement that only writes the row it is
 * handed, so it has no predicate to hold. An upsert is read as its insert.
 */
export function insertsOnlyValues(literals: readonly string[]): boolean {
  const { sql } = layOut({ literals })
  return INSERT_STATEMENT.test(sql) && VALUES_CLAUSE.test(sql) && !SELECT_CLAUSE.test(sql)
}

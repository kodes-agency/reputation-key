import { createHash } from 'node:crypto'
import legacyMigrations from './legacy-migration-hashes.json'

type MigrationIdentity = Readonly<{ tag: string; when: number }>

const legacyEntries: Readonly<Record<string, Readonly<{ when: number; hash: string }>>> =
  legacyMigrations

/** Compatibility applies only to the original journal identity and SQL bytes. */
function isLegacyMigration(sql: string, entry?: MigrationIdentity): boolean {
  if (!entry || !Object.hasOwn(legacyEntries, entry.tag)) return false
  const legacy = legacyEntries[entry.tag]
  return (
    legacy?.when === entry.when &&
    legacy.hash === createHash('sha256').update(sql).digest('hex')
  )
}

function blockCommentEnd(sql: string, index: number): number {
  let depth = 1
  index += 2
  while (index < sql.length && depth > 0) {
    if (sql.startsWith('/*', index)) {
      depth++
      index += 2
    } else if (sql.startsWith('*/', index)) {
      depth--
      index += 2
    } else index++
  }
  if (depth) throw new Error('Unterminated migration comment')
  return index
}

function quotedTokenEnd(sql: string, start: number, escaped: boolean): number {
  const quote = sql[start]
  let index = start + 1
  while (index < sql.length) {
    if (escaped && sql[index] === '\\') {
      index += 2
      continue
    }
    if (sql[index++] !== quote) continue
    if (sql[index] === quote) {
      index++
      continue
    }
    return index
  }
  throw new Error('Unterminated migration literal')
}

function dollarBodyEnd(sql: string, start: number, delimiter: string): number {
  const end = sql.indexOf(delimiter, start + delimiter.length)
  if (end < 0) throw new Error('Unterminated migration body')
  return end
}

function appendQuotedTokens(tokens: string[], value: string, escaped: boolean): void {
  if (value[0] === '"') {
    tokens.push(value)
  } else if (tokens.at(-1) === 'EXECUTE' || (escaped && tokens.at(-2) === 'EXECUTE')) {
    if (escaped) tokens.pop()
    tokens.push(...migrationTokens(value.slice(1, -1).replaceAll("''", "'")))
  } else tokens.push('<literal>')
}

/** SQL tokens, excluding comments and literal values. Quoted names stay quoted. */
export function migrationTokens(sql: string): string[] {
  sql = sql.replaceAll('--> statement-breakpoint', ';\n')
  const tokens: string[] = []
  for (let index = 0; index < sql.length;) {
    if (/\s/.test(sql[index]!)) {
      index++
      continue
    }
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index)
      index = end < 0 ? sql.length : end + 1
      continue
    }
    if (sql.startsWith('/*', index)) {
      index = blockCommentEnd(sql, index)
      continue
    }
    const delimiter = /^\$[a-z_0-9]*\$/i.exec(sql.slice(index))?.[0]
    if (delimiter) {
      const end = dollarBodyEnd(sql, index, delimiter)
      tokens.push(...migrationTokens(sql.slice(index + delimiter.length, end)))
      index = end + delimiter.length
      continue
    }
    const quote = sql[index]
    if (quote === "'" || quote === '"') {
      const start = index
      const escaped = quote === "'" && tokens.at(-1) === 'E'
      index = quotedTokenEnd(sql, start, escaped)
      appendQuotedTokens(tokens, sql.slice(start, index), escaped)
      continue
    }
    const word = /^[a-z_][a-z_0-9]*/i.exec(sql.slice(index))?.[0]
    tokens.push(word ? word.toUpperCase() : sql[index]!)
    index += word?.length ?? 1
  }
  return tokens
}

export function assertOnlineConstraints(sql: string, entry?: MigrationIdentity): void {
  if (isLegacyMigration(sql, entry)) return
  const tokens = migrationTokens(sql)
  const text = tokens.join(' ')
  const additions = text
    .split(';')
    .filter((statement) =>
      /\bALTER TABLE\b[\s\S]*\bADD\b[\s\S]*\b(CHECK|FOREIGN KEY|REFERENCES)\b/.test(
        statement,
      ),
    )
  if (!additions.length) return
  if (/\bVALIDATE CONSTRAINT\b/.test(text)) {
    throw new Error('Constraint validation must run in a separate file from its addition')
  }
  // Check every ADD action independently; another constraint's NOT VALID does
  // not make an immediate constraint safe. Parenthesized commas remain in the action.
  for (const action of additions.flatMap((addition) => addition.split(/\bADD\b/))) {
    if (
      /\b(CHECK|FOREIGN KEY|REFERENCES)\b/.test(action) &&
      !/\bNOT VALID\b/.test(action)
    ) {
      throw new Error(
        'Existing-table CHECK and foreign-key additions require NOT VALID and a separate VALIDATE file',
      )
    }
  }
}

function nameEnd(tokens: readonly string[], start: number): number {
  const name = tokens[start]
  if (!name || !(/^[A-Z_][A-Z_0-9]*$/.test(name) || name.startsWith('"'))) return -1
  const end = start + 1
  if (tokens[end] === '.') return nameEnd(tokens, end + 1)
  return end
}

function groupEnd(tokens: readonly string[], start: number): number {
  if (tokens[start] !== '(') return -1
  let depth = 0
  for (let end = start; end < tokens.length; end++) {
    if (tokens[end] === '(') depth++
    if (tokens[end] === ')' && --depth === 0) return end + 1
  }
  return -1
}

function builtInTypeEnd(tokens: readonly string[], start: number): number {
  if (tokens[start] === 'PG_CATALOG' && tokens[start + 1] === '.') start += 2
  let end = start + 1
  switch (tokens[start]) {
    case 'DOUBLE':
      if (tokens[end++] !== 'PRECISION') return -1
      break
    case 'CHARACTER':
      if (tokens[end] === 'VARYING') end++
      break
    case 'TIMESTAMP':
    case 'TIME':
      if (tokens[end] === 'WITH' || tokens[end] === 'WITHOUT') {
        if (tokens[end + 1] !== 'TIME' || tokens[end + 2] !== 'ZONE') return -1
        end += 3
      }
      break
    default:
      if (
        !/^(SMALLINT|INT2|INTEGER|INT|INT4|BIGINT|INT8|REAL|FLOAT4|FLOAT8|NUMERIC|DECIMAL|BOOLEAN|BOOL|TEXT|VARCHAR|CHAR|BYTEA|UUID|JSON|JSONB|DATE|TIMESTAMPTZ|TIMETZ|INTERVAL)$/.test(
          tokens[start] ?? '',
        )
      )
        return -1
  }
  return end
}

function typeModifiersEnd(tokens: readonly string[], start: number): number {
  if (tokens[start] !== '(') return start
  const close = groupEnd(tokens, start)
  if (close < 0) return -1
  const modifiers = tokens
    .slice(start + 1, close - 1)
    .join('')
    .split(',')
  if (modifiers.length > 2 || !modifiers.every((value) => /^\d+$/.test(value))) return -1
  return close
}

function typeEnd(tokens: readonly string[], start: number): number {
  let end = builtInTypeEnd(tokens, start)
  if (end < 0) return -1
  end = typeModifiersEnd(tokens, end)
  if (end < 0) return -1
  while (tokens[end] === '[' && tokens[end + 1] === ']') end += 2
  return end
}

function numericConstantEnd(tokens: readonly string[], start: number): number {
  let end = start
  if (tokens[end] === '+' || tokens[end] === '-') end++
  const digits = end
  while (/^\d+$/.test(tokens[end] ?? '')) end++
  if (end === digits) return -1
  if (tokens[end] !== '.') return end
  end++
  const fraction = end
  while (/^\d+$/.test(tokens[end] ?? '')) end++
  return end === fraction ? -1 : end
}

function constantEnd(tokens: readonly string[], start: number): number {
  let end = start
  if (tokens[end] === '(') {
    end = constantEnd(tokens, end + 1)
    if (end < 0 || tokens[end++] !== ')') return -1
  } else if (['<literal>', 'TRUE', 'FALSE', 'NULL'].includes(tokens[end] ?? '')) {
    end++
  } else {
    end = numericConstantEnd(tokens, end)
    if (end < 0) return -1
  }
  if (tokens[end] === ':' && tokens[end + 1] === ':') end = typeEnd(tokens, end + 2)
  return end
}

function isColumnAddition(tokens: readonly string[]): boolean {
  let end = 1 // ADD
  if (tokens[end] === 'COLUMN') end++
  if (tokens.slice(end, end + 3).join(' ') === 'IF NOT EXISTS') end += 3
  end = nameEnd(tokens, end)
  if (end < 0) return false
  end = typeEnd(tokens, end)
  if (end < 0) return false
  let nullable = true
  let nullabilitySeen = false
  let defaultSeen = false
  let defaultIsNull = false
  while (end < tokens.length) {
    if (tokens[end] === 'DEFAULT' && !defaultSeen) {
      defaultSeen = true
      const start = end + 1
      end = constantEnd(tokens, start)
      if (end < 0) return false
      defaultIsNull = tokens.slice(start, end).includes('NULL')
    } else if (tokens[end] === 'NULL' && !nullabilitySeen) {
      nullabilitySeen = true
      end++
    } else if (tokens[end] === 'NOT' && tokens[end + 1] === 'NULL' && !nullabilitySeen) {
      nullabilitySeen = true
      nullable = false
      end += 2
    } else return false
  }
  return nullable || (defaultSeen && !defaultIsNull)
}

function columnListEnd(tokens: readonly string[], start: number): number {
  if (tokens[start] !== '(') return -1
  let end = nameEnd(tokens, start + 1)
  if (end < 0) return -1
  while (tokens[end] === ',') {
    end = nameEnd(tokens, end + 1)
    if (end < 0) return -1
  }
  return tokens[end] === ')' ? end + 1 : -1
}

function isConstraintAddition(tokens: readonly string[]): boolean {
  if (tokens[1] !== 'CONSTRAINT') return false
  let end = nameEnd(tokens, 2)
  if (end < 0) return false
  if (tokens[end] === 'CHECK') {
    end = groupEnd(tokens, end + 1)
  } else if (tokens[end] === 'FOREIGN' && tokens[end + 1] === 'KEY') {
    end = columnListEnd(tokens, end + 2)
    if (end < 0 || tokens[end++] !== 'REFERENCES') return false
    end = nameEnd(tokens, end)
    if (end < 0) return false
    end = columnListEnd(tokens, end)
  } else return false
  return end >= 0 && tokens.slice(end).join(' ') === 'NOT VALID'
}

function isTableExpandAction(action: readonly string[]): boolean {
  if (action[0] === 'VALIDATE' && action[1] === 'CONSTRAINT') {
    return nameEnd(action, 2) === action.length
  }
  return action[0] === 'ADD' && (isColumnAddition(action) || isConstraintAddition(action))
}

function isTableExpand(tokens: readonly string[]): boolean {
  let start = 2 // ALTER TABLE
  if (tokens[start] === 'IF' && tokens[start + 1] === 'EXISTS') start += 2
  if (tokens[start] === 'ONLY') start++
  start = nameEnd(tokens, start)
  if (start < 0) return false
  if (tokens[start] === '*') start++
  let depth = 0
  for (let end = start; end <= tokens.length; end++) {
    if (end === tokens.length || (tokens[end] === ',' && depth === 0)) {
      if (!isTableExpandAction(tokens.slice(start, end))) return false
      start = end + 1
    } else if (tokens[end] === '(') depth++
    else if (tokens[end] === ')' && --depth < 0) return false
  }
  return depth === 0
}

function isConcurrentIndexExpand(tokens: readonly string[]): boolean {
  let end = 1 // CREATE
  if (tokens[end++] !== 'INDEX' || tokens[end++] !== 'CONCURRENTLY') return false
  if (tokens.slice(end, end + 3).join(' ') === 'IF NOT EXISTS') end += 3
  end = nameEnd(tokens, end)
  if (end < 0 || tokens[end++] !== 'ON') return false
  end = nameEnd(tokens, end)
  if (end < 0) return false
  end = columnListEnd(tokens, end)
  if (end < 0) return false
  if (end === tokens.length) return true
  if (tokens[end++] !== 'WHERE') return false
  const predicate = tokens.slice(end)
  while (predicate[0] === '(' && groupEnd(predicate, 0) === predicate.length) {
    predicate.pop()
    predicate.shift()
  }
  end = nameEnd(predicate, 0)
  if (end < 0 || predicate[end++] !== '=') return false
  return constantEnd(predicate, end) === predicate.length
}

/** Only complete, known-compatible forms may bypass reader-removal preflight. */
function isExpandStatement(tokens: readonly string[]): boolean {
  if (tokens[0] === 'ALTER' && tokens[1] === 'TABLE') return isTableExpand(tokens)
  if (tokens[0] !== 'CREATE') return false
  if (tokens[1] !== 'TABLE') return isConcurrentIndexExpand(tokens)
  let start = 2
  if (tokens.slice(start, start + 3).join(' ') === 'IF NOT EXISTS') start += 3
  start = nameEnd(tokens, start)
  return start >= 0 && tokens[start] === '(' && groupEnd(tokens, start) === tokens.length
}

export function contractionRequirement(
  sql: string,
  entry?: MigrationIdentity,
): string | null {
  if (isLegacyMigration(sql, entry)) return null
  const marker = /^-- migrate:contract ([a-f0-9]{40})\s*$/m.exec(sql)?.[1]
  const tokens = migrationTokens(sql)
  const statements: string[][] = [[]]
  for (const part of tokens) {
    if (part === ';') statements.push([])
    else statements.at(-1)!.push(part)
  }
  const contracts = statements.some(
    (statement) => statement.length > 0 && !isExpandStatement(statement),
  )
  if (contracts && !marker) {
    throw new Error(
      'Contract migration requires -- migrate:contract <reader-removal commit>',
    )
  }
  return marker ?? null
}

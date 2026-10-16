// Content-free facts about a failure, for error monitoring.
//
// The scrubber replaces every error message before a report leaves (Privacy
// Notice section 2), so on its own an issue reads "TypeError: [REDACTED]" and
// failures that differ only in their message cannot be told apart. These facts
// come from an error's own machine fields instead: the code it was thrown with,
// the code of the failure it wraps, a database refusal's SQLSTATE and schema
// names, and a fixed kind for the few browser messages that say a code file or
// the network failed. Each value is checked against a closed shape before it
// becomes a tag, so nothing a person typed or a row held can pass as one.

const MAX_CAUSE_DEPTH = 5
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/u
const SQLSTATE = /^[0-9A-Z]{5}$/u
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/u

const CHUNK_LOAD_MESSAGES = [
  /^Failed to fetch dynamically imported module\b/u, // Chromium
  /^error loading dynamically imported module\b/u, // Firefox
  /^Importing a module script failed\.?$/u, // Safari
  /^Unable to preload CSS for\b/u, // Vite's stylesheet preload
]
const NETWORK_MESSAGES = [
  /^Failed to fetch$/u, // Chromium
  /^NetworkError when attempting to fetch resource\.?$/u, // Firefox
  /^Load failed$/u, // Safari
]

export type ErrorKind = 'chunk_load' | 'network'

export type ErrorFactTags = Readonly<{
  error_code?: string
  cause_code?: string
  error_kind?: ErrorKind
  db_code?: string
  db_constraint?: string
  db_table?: string
  db_column?: string
}>

type ErrorFields = Readonly<Record<string, unknown>>

function asFields(value: unknown): ErrorFields | undefined {
  return value !== null && typeof value === 'object' ? (value as ErrorFields) : undefined
}

/** The error, then each `cause` below it, without revisiting one. */
function causeChain(error: unknown): ReadonlyArray<ErrorFields> {
  const chain: ErrorFields[] = []
  let current = asFields(error)
  while (current && chain.length < MAX_CAUSE_DEPTH && !chain.includes(current)) {
    chain.push(current)
    current = asFields(current.cause)
  }
  return chain
}

function matching(value: unknown, shape: RegExp): string | undefined {
  return typeof value === 'string' && shape.test(value) ? value : undefined
}

function errorCode(fields: ErrorFields): string | undefined {
  return matching(fields.code, ERROR_CODE) ?? matching(fields.code, SQLSTATE)
}

/** node-postgres's server-reported failure: a severity and a SQLSTATE code. */
function isDatabaseRefusal(fields: ErrorFields): boolean {
  return (
    typeof fields.severity === 'string' && matching(fields.code, SQLSTATE) !== undefined
  )
}

function databaseFacts(chain: ReadonlyArray<ErrorFields>): ErrorFactTags {
  const refusal = chain.find(isDatabaseRefusal)
  if (!refusal) return {}
  const constraint = matching(refusal.constraint, SQL_IDENTIFIER)
  const table = matching(refusal.table, SQL_IDENTIFIER)
  const column = matching(refusal.column, SQL_IDENTIFIER)
  return {
    db_code: refusal.code as string,
    ...(constraint ? { db_constraint: constraint } : {}),
    ...(table ? { db_table: table } : {}),
    ...(column ? { db_column: column } : {}),
  }
}

function errorKind(fields: ErrorFields | undefined): ErrorKind | undefined {
  const message = fields?.message
  if (typeof message !== 'string') return undefined
  if (CHUNK_LOAD_MESSAGES.some((shape) => shape.test(message))) return 'chunk_load'
  if (NETWORK_MESSAGES.some((shape) => shape.test(message))) return 'network'
  return undefined
}

export function errorFactTags(error: unknown): ErrorFactTags {
  const chain = causeChain(error)
  const [outermost, ...causes] = chain
  const code = outermost ? errorCode(outermost) : undefined
  const causeCode = causes.map(errorCode).find((value) => value !== undefined)
  const kind = errorKind(outermost)
  return {
    ...(code ? { error_code: code } : {}),
    ...(causeCode ? { cause_code: causeCode } : {}),
    ...(kind ? { error_kind: kind } : {}),
    ...databaseFacts(chain),
  }
}

import { errorFactTags } from './error-facts'

const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/u
// A class that leaves `name` at "Error" (Drizzle's query error) still says what
// it is through its constructor; a minifier's one-letter name is not a class.
const ERROR_CLASS = /^[A-Z][A-Za-z0-9]{0,79}Error$/u

type ErrorFields = Readonly<Record<string, unknown>>

function errorClass(fields: ErrorFields | undefined): string {
  const name = typeof fields?.name === 'string' ? fields.name : undefined
  if (name !== undefined && name !== 'Error' && ERROR_NAME.test(name)) return name
  const constructorName = (fields?.constructor as { name?: unknown } | undefined)?.name
  if (typeof constructorName === 'string' && ERROR_CLASS.test(constructorName)) {
    return constructorName
  }
  return name !== undefined && ERROR_NAME.test(name) ? name : 'UnknownError'
}

/**
 * What a log line may say about a failure: its class, its codes, and a database
 * refusal's SQLSTATE and schema names (error-facts.ts). Never the message or the
 * stack, which carry the values a query was bound to.
 */
export function summarizeError(error: unknown): Readonly<Record<string, unknown>> {
  const fields =
    error !== null && typeof error === 'object' ? (error as ErrorFields) : undefined
  const { error_code: code, ...facts } = errorFactTags(error)
  return {
    name: errorClass(fields),
    ...(code ? { code } : {}),
    ...facts,
  }
}

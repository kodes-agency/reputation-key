/**
 * Coercions for values read from pg rows, where bigint and timestamp columns
 * arrive as strings or Dates. Each store words its own failure message.
 */
export function rowValues(invalid: (field: string) => string) {
  function safeInteger(value: unknown, field: string, minimum = 0): number {
    const parsed = typeof value === 'string' ? Number(value) : value
    if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < minimum) {
      throw new Error(invalid(field))
    }
    return parsed
  }

  function epochMillis(value: unknown, field: string): number {
    const result = value instanceof Date ? value.getTime() : Date.parse(String(value))
    if (!Number.isSafeInteger(result)) throw new Error(invalid(field))
    return result
  }

  return { safeInteger, epochMillis }
}

// Feed notification surface — reading identifier fields off a stored fact.
//
// The schema registry has already validated the payload's shape by the time a
// consumer reads it; these readers turn "the schema says this may be absent"
// into a value or a loud failure, and they name the route in the message so a
// worker log says which fact was malformed. Shared by every Feed consumer that
// parses a payload by hand, because two copies of them drifted apart once.

export const isRecordPayload = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A non-empty string the route cannot proceed without. */
export const requiredString = (
  payload: Readonly<Record<string, unknown>>,
  key: string,
  subject: string,
): string => {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${subject} payload is missing ${key}`)
  }
  return value
}

/**
 * A string the fact may legitimately omit — an absent actor, an unset id.
 * An empty or ill-typed value is still a malformed fact, not an absent one.
 */
export const nullableString = (
  payload: Readonly<Record<string, unknown>>,
  key: string,
  subject: string,
): string | null => {
  const value = payload[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${subject} payload has invalid ${key}`)
  }
  return value
}

// Feed activity surface — reading fields off a durable fact's validated payload.
//
// A leaf: the Recent Activity consumers and the Goal mapping beside them both
// read a fact through these, so neither has to import the other.

export type ActivityFactPayload = Readonly<Record<string, unknown>>

export const stringValue = (payload: ActivityFactPayload, key: string): string => {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Recent Activity fact ${key} is invalid`)
  }
  return value
}

export const optionalString = (
  payload: ActivityFactPayload,
  key: string,
): string | null => {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

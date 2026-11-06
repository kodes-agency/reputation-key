// Read fields from a durable Operational Action History fact.

export type ActivityFactPayload = Readonly<Record<string, unknown>>

export const stringValue = (payload: ActivityFactPayload, key: string): string => {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Operational Action History fact ${key} is invalid`)
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

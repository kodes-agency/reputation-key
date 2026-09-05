export type JsonRecord = Readonly<Record<string, unknown>>

export function record(
  value: unknown,
  label: string,
  invalidMessage = `${label} must be an object`,
): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(invalidMessage)
  }
  return value as JsonRecord
}

export function array(
  value: unknown,
  label: string,
  invalidMessage = `${label} must be an array`,
): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(invalidMessage)
  return value
}

export function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '')
    throw new Error(`${label} must be a string`)
  return value
}

export function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

export type RailwayServiceSource = Readonly<{
  repo: string | null
  image: string | null
}>

export function parseRailwayServiceSource(
  value: unknown,
  label: string,
  nullableString: (candidate: unknown, candidateLabel: string) => string | null,
  invalidRecordMessage?: string,
): RailwayServiceSource | null {
  if (value === null) return null
  const source = record(value, label, invalidRecordMessage)
  return Object.freeze({
    repo: nullableString(source.repo, `${label}.repo`),
    image: nullableString(source.image, `${label}.image`),
  })
}

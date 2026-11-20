// A country's English name from its ISO 3166-1 alpha-2 code ("BG" → "Bulgaria").
// Falls back to the code itself when the runtime has no display names or does
// not know the region, so a label is never blank.
const regionDisplayNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null

export function countryLabel(code: string): string {
  const normalized = code.trim().toUpperCase()
  if (normalized.length !== 2) return normalized
  try {
    return regionDisplayNames?.of(normalized) ?? normalized
  } catch {
    return normalized
  }
}

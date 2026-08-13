export function validateGoogleProviderSuffix(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  let characters = 0
  for (const character of value) {
    characters += 1
    if (characters > 255 || /[/?#\s]/u.test(character)) return false
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return false
    }
  }
  return true
}

export function parseGoogleProviderResourceSuffix(
  resourceName: string,
  prefix: 'accounts/' | 'locations/',
): string | null {
  if (!resourceName.startsWith(prefix)) return null
  const suffix = resourceName.slice(prefix.length)
  return validateGoogleProviderSuffix(suffix) ? suffix : null
}

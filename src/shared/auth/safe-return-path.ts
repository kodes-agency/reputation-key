const INTERNAL_ORIGIN = 'https://repkey.invalid'
const MAX_RETURN_PATH_LENGTH = 2048

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 31 || codePoint === 127
  })

function decodeRepeatedly(pathname: string): string | undefined {
  let decoded = pathname
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
    return decoded
  } catch {
    return undefined
  }
}

/**
 * Normalize an authentication return target to a same-origin history path.
 * This protects the boundary even if navigation later changes from the router
 * history API to a browser redirect.
 */
export function safeReturnPath(candidate: unknown): string | undefined {
  if (
    typeof candidate !== 'string' ||
    candidate.length === 0 ||
    candidate.length > MAX_RETURN_PATH_LENGTH ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\') ||
    hasControlCharacter(candidate)
  ) {
    return undefined
  }

  let parsed: URL
  try {
    parsed = new URL(candidate, INTERNAL_ORIGIN)
  } catch {
    return undefined
  }
  if (parsed.origin !== INTERNAL_ORIGIN) return undefined

  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`
  if (normalized !== candidate) return undefined

  const decodedPath = decodeRepeatedly(parsed.pathname)
  if (
    decodedPath === undefined ||
    decodedPath.startsWith('//') ||
    decodedPath.includes('\\') ||
    hasControlCharacter(decodedPath)
  ) {
    return undefined
  }
  return normalized
}

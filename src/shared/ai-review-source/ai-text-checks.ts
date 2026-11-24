// Dependency-free text checks shared by the browser-safe language catalogue and
// the server-side source and leakage checks.

/** U+FDD0..U+FDEF and the last two code points of every plane. */
export function isNoncharacter(codePoint: number): boolean {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe
}

function isAsciiLetter(codePoint: number): boolean {
  return (
    (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a)
  )
}

function isAsciiAlphanumeric(codePoint: number): boolean {
  return isAsciiLetter(codePoint) || (codePoint >= 0x30 && codePoint <= 0x39)
}

/** A primary subtag of 2 to 8 letters, then dash-separated subtags of 1 to 8 letters or digits. */
export function isStructurallyValidLanguageTag(value: string): boolean {
  const parts = value.split('-')
  const primary = parts[0]
  if (
    primary === undefined ||
    primary.length < 2 ||
    primary.length > 8 ||
    [...primary].some((scalar) => !isAsciiLetter(scalar.codePointAt(0)!))
  ) {
    return false
  }
  return parts
    .slice(1)
    .every(
      (part) =>
        part.length >= 1 &&
        part.length <= 8 &&
        [...part].every((scalar) => isAsciiAlphanumeric(scalar.codePointAt(0)!)),
    )
}

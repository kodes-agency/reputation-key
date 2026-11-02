/** A pasted line may put the email in any column. Keep unrecognised lines editable. */
export function parseStaffPaste(text: string): readonly Readonly<{
  displayName: string
  email: string
}>[] {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .filter(
      (line, index) =>
        index !== 0 || line.includes('@') || !/\b(?:name|email)\b/iu.test(line),
    )
    .map((line) => {
      const email = line.match(/[^\s,;<>"\t]+@[^\s,;<>"\t]+/u)?.[0] ?? ''
      const displayName = line
        .replace(email, '')
        .replace(/[\t,;<>"]+/gu, ' ')
        .trim()
        .replace(/\s+/gu, ' ')
      return { displayName, email }
    })
}

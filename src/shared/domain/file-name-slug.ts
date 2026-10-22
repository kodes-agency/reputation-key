// A name made safe to put in a file name, for the files a manager downloads.

const FILE_NAME_SLUG_MAX = 60

/**
 * The name in lower case with everything but letters and digits made one hyphen,
 * at most 60 characters. Letters and digits of any script stay (a Cyrillic name
 * is common here), so a name is not lost to a plain fallback; an empty string
 * means nothing was left and the caller names the file itself. A path in the
 * name ("../../etc") cannot survive: its slashes and dots are hyphens.
 */
export function fileNameSlug(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, FILE_NAME_SLUG_MAX)
    .replace(/-$/gu, '')
}

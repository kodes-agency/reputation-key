// Portal context — whether a language's Property content row carries wording.
//
// A row can exist only to hold the photograph's description (`hero_alt_text`),
// with its title and description empty. That row is not wording: every reader
// (language coverage, the draft preview and the publication's working copy)
// asks this one question, so a Portal override on such a language is not
// counted as wording until the Property has written some.

const isWritten = (value: string): boolean => value.trim().length > 0

export function hasPropertyWording(
  row: Readonly<{ title: string; shortDescription: string }> | undefined,
): row is Readonly<{ title: string; shortDescription: string }> {
  return row !== undefined && (isWritten(row.title) || isWritten(row.shortDescription))
}

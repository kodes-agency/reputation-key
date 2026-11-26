/** Whether an If-None-Match header names `etag` (weak comparison, as the spec asks for GET). */
export const ifNoneMatchMatches = (
  header: string | null | undefined,
  etag: string,
): boolean => {
  if (!header) return false
  if (header.trim() === '*') return true
  const bare = (value: string) => value.trim().replace(/^W\//u, '')
  return header.split(',').some((candidate) => bare(candidate) === etag)
}

// What the Organization's strip says it covers, apart from the results index it
// is told the counts of.

/**
 * What the Organization's strip says it covers. A Property the results leave out
 * (no dashboard access, not assigned, or no time zone) is not in the total, so
 * when the read names fewer Properties than the list shows the line says how many.
 * Until the results are here (`read` null) there is nothing to count.
 */
export function organizationScopeLine(
  read: number | null,
  listed: number | undefined,
): string {
  return read !== null && listed !== undefined && read < listed
    ? `${read} of ${listed} properties`
    : 'all properties'
}

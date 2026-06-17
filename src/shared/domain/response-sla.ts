// Shared kernel — response-SLA default + extraction helper.
// The response SLA is an org-level setting (identity context owns persistence)
// that other contexts consume (dashboard attention band). Defining the default
// and the safe extraction here keeps it in the shared kernel so no context
// imports from another context's server layer.

/** Default response SLA in hours — used when the org has no value set. */
export const DEFAULT_RESPONSE_SLA_HOURS = 48

/**
 * Extract the response SLA (hours) from a loosely-typed org object
 * (e.g. a better-auth getFullOrganization response). Falls back to the default
 * when the field is missing or invalid.
 */
export function extractResponseSlaHours(org: unknown): number {
  const raw = (org as Record<string, unknown> | null)?.responseSlaHours
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : DEFAULT_RESPONSE_SLA_HOURS
}

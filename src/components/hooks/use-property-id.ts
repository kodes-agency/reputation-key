import { useRouterState } from '@tanstack/react-router'
import { z } from 'zod/v4'

const propertyScopeSchema = z.uuid()

const validPropertyScope = (value: unknown): string | null => {
  const parsed = propertyScopeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Resolve the active property id from a parsed location.
 *
 * The `/properties/$propertyId` path segment takes precedence; otherwise fall
 * back to a `?propertyId=` search param carried by cross-property pages
 * (inbox, fleet overview) — see ADR 0016.
 *
 * Pure so non-React callers share the same rule: `_authenticated`'s
 * `beforeLoad` resolves the property-scoped capability set from it, exactly as
 * the property switcher and property-aware navigation do.
 */
export function propertyIdFromLocation(
  pathname: string | undefined,
  search: unknown,
): string | null {
  // A location without a pathname carries no property scope. `beforeLoad` runs
  // against router state that has not always parsed a path yet, so this is a
  // real input rather than a defensive guard.
  const m = pathname?.match(/\/properties\/([^/]+)/)
  const pathPropertyId = validPropertyScope(m?.[1])
  if (pathPropertyId) return pathPropertyId
  if (search !== null && typeof search === 'object' && 'propertyId' in search) {
    return validPropertyScope(search.propertyId)
  }
  return null
}

/**
 * React binding for {@link propertyIdFromLocation}.
 *
 * Used by the property switcher and property-aware navigation.
 */
export function usePropertyId(): string | null {
  return useRouterState({
    select: (s) => propertyIdFromLocation(s.location.pathname, s.location.search),
  })
}

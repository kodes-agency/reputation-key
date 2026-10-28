import { useMatches } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { renderedLocationFromMatches } from '#/components/layout/rendered-location'

const propertyScopeSchema = z.uuid()

const validPropertyScope = (value: unknown): string | null => {
  const parsed = propertyScopeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Resolve the active property id from a parsed location.
 *
 * The `/properties/$propertyId` path segment takes precedence; otherwise fall
 * back to a `?propertyId=` search param, which the Inbox deep link and
 * Notification settings carry. There it is a scope, not passing context: see
 * ADR 0016 as amended on 2026-10-13.
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
 * Used by the property switcher and property-aware navigation. It answers for the
 * page ON SCREEN (the deepest presented match), not the address the router is
 * heading for: the switcher and the sidebar links keep naming the Property of the
 * page the person still sees until the new page replaces it.
 */
export function usePropertyId(): string | null {
  return useMatches({
    select: (matches) => {
      const { pathname, search } = renderedLocationFromMatches(matches)
      return propertyIdFromLocation(pathname, search)
    },
  })
}

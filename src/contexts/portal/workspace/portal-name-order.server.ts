// Portal context — the order Portals are listed in.
//
// By name, ignoring case, then by id, so two Portals with one name keep the
// same order whatever order storage returns them in. Every Portal list that
// another surface shows beside its own (the Portals overview, the goal-readiness
// facts) sorts with this one comparator.

import type { Portal } from '../domain/types'

export const comparePortalsByName = (
  a: Pick<Portal, 'id' | 'name'>,
  b: Pick<Portal, 'id' | 'name'>,
): number => {
  const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  if (byName !== 0) return byName
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

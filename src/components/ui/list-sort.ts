// The direction a sortable list can take, written once for every list toolbar
// and every list's own ordering (UI consistency scan: COLL-06). The Properties
// list and the Portals overview each declared this type and the helper that
// orders the two directions, so a third list would have declared them again.

export type SortDirection = 'asc' | 'desc'

export const SORT_DIRECTIONS = [
  'asc',
  'desc',
] as const satisfies ReadonlyArray<SortDirection>

/** The sort's natural direction first, so "A to Z" is offered before "Z to A". */
export function directionsFor(natural: SortDirection): ReadonlyArray<SortDirection> {
  return natural === 'asc' ? ['asc', 'desc'] : ['desc', 'asc']
}

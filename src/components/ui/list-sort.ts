// The direction a sortable list can take, written once for every list toolbar
// and every list's own ordering.

export type SortDirection = 'asc' | 'desc'

/** The sort's natural direction first, so "A to Z" is offered before "Z to A". */
export function directionsFor(natural: SortDirection): ReadonlyArray<SortDirection> {
  return natural === 'asc' ? ['asc', 'desc'] : ['desc', 'asc']
}

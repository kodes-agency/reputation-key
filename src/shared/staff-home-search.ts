export type StaffHomeSearch = Readonly<{
  p?: string
  tab: 'code' | 'results'
  period: 'today' | 'week' | 'month' | 'last_month'
}>

export function staffHomeSearch(search: Record<string, unknown>): StaffHomeSearch {
  return {
    p: typeof search.p === 'string' ? search.p : undefined,
    tab: search.tab === 'results' ? 'results' : 'code',
    period:
      search.period === 'today' ||
      search.period === 'week' ||
      search.period === 'last_month'
        ? search.period
        : 'month',
  }
}

/** Search input is optional; the normalized feature state always has defaults. */
export function validateStaffHomeSearch(
  search: Record<string, unknown>,
): Partial<StaffHomeSearch> {
  return staffHomeSearch(search)
}

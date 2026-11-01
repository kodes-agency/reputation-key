export const PORTAL_LINK_TAPS_COUNTED_SINCE = '2026-11-01'
export type PortalLinkTaps = Readonly<{
  total: number
  countedSince: string
  rows: ReadonlyArray<
    Readonly<{ linkId: string; label: string; iconKey: string | null; taps: number }>
  >
  removedTaps: number
}>

/** Stable sort keeps the Portal’s own order on ties, including links with no taps. */
export function portalLinkTaps(
  links: Readonly<{
    enabled: boolean
    rows: ReadonlyArray<
      Readonly<{ linkId: string; label: string; iconKey: string | null }>
    >
  }>,
  counts: ReadonlyArray<Readonly<{ linkId: string; taps: number }>>,
): PortalLinkTaps | null {
  const taps = new Map(counts.map((row) => [row.linkId, row.taps]))
  const total = counts.reduce((sum, row) => sum + row.taps, 0)
  if (total === 0 && (!links.enabled || links.rows.length === 0)) return null
  const current = new Set(links.rows.map((row) => row.linkId))
  return {
    total,
    countedSince: PORTAL_LINK_TAPS_COUNTED_SINCE,
    rows: links.rows
      .map((row) => ({ ...row, taps: taps.get(row.linkId) ?? 0 }))
      .sort((a, b) => b.taps - a.taps),
    removedTaps: counts.reduce(
      (sum, row) => sum + (current.has(row.linkId) ? 0 : row.taps),
      0,
    ),
  }
}

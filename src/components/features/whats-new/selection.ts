import type { ProductUpdate, ProductUpdatesView } from '#/shared/whats-new/types'

const KIND_ORDER = { highlight: 0, fix: 1 } as const

/** Newest date first; on one date, highlights before fixes, then registry order. */
function newestFirst(entries: readonly ProductUpdate[]): ProductUpdate[] {
  return [...entries].sort(
    (a, b) =>
      b.publishedOn.localeCompare(a.publishedOn) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  )
}

export function selectModalUpdates(view: ProductUpdatesView) {
  const unseen = new Set(view.unseenIds)
  const newest = newestFirst(view.entries)
  const highlights = newest.filter((entry) => entry.kind === 'highlight')
  const fixes = newest.filter((entry) => entry.kind === 'fix')
  const unseenHighlights = highlights.filter(({ id }) => unseen.has(id))
  const unseenFixes = fixes.filter(({ id }) => unseen.has(id))
  return {
    highlights: (unseenHighlights.length ? unseenHighlights : highlights).slice(0, 3),
    fixes: unseenFixes.length ? unseenFixes : fixes.slice(0, 3),
  }
}

export function updatesByMonth(entries: readonly ProductUpdate[]) {
  const months = new Map<string, ProductUpdate[]>()
  for (const entry of newestFirst(entries)) {
    const month = entry.publishedOn.slice(0, 7)
    const group = months.get(month) ?? []
    group.push(entry)
    months.set(month, group)
  }
  return [...months]
}

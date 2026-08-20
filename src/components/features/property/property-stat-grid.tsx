// A labelled grid of plain figures — the shape the engagement funnel and the
// reply-performance block both had, written out twice.
//
// Extracted when property-dashboard.tsx crossed the 200-line cap: main gained
// the reputation trend section and the guest-topics section in the same window,
// and neither PR alone exceeded it. Collapsing the duplicate was the honest way
// back under, rather than deleting a section or raising the cap.

export type StatGridItem = Readonly<{ value: string; label: string }>

export function StatGrid({
  heading,
  items,
}: Readonly<{
  heading: string
  items: readonly StatGridItem[]
}>) {
  return (
    <div>
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </h2>
      <div
        className={`mt-3 grid gap-4 ${items.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}
      >
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums">{item.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

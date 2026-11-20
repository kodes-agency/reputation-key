// The guest page's clock. `servedAt` is the server's instant: the server and the
// first browser render both print deadlines against it, so they match
// (React #418). A page that stays open past a deadline must not keep reading
// it, so after hydration the clock moves on by the time the page has been open.
// Pure here; `use-guest-clock.ts` binds it to React.

/** The served instant moved on by `elapsedMs` of page time; never earlier than it. */
export function advanceServedAt(servedAt: string, elapsedMs: number): string {
  const served = Date.parse(servedAt)
  if (Number.isNaN(served)) return servedAt
  return new Date(served + Math.max(0, elapsedMs)).toISOString()
}

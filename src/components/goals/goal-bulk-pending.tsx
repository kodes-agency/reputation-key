// Set goals for several portals — what stands where the table will be. The
// table is a chunk of its own and needs the Property's goals before it can say
// which rows are taken, so the page shows this while either is on its way: one
// look for both waits, never a blank and never a table that changes its mind.
import { Skeleton } from '#/components/ui/skeleton'

export function GoalBulkPending() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 rounded-lg border p-4">
      <span className="sr-only">Loading portals and goals</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  )
}

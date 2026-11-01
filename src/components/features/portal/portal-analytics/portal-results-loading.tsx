import { Skeleton } from '#/components/ui/skeleton'

/** Keep the four question bands’ space while the first read is on the way. */
export function PortalResultsLoading() {
  return (
    <div
      className="@container flex flex-col gap-4 md:gap-6"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading results…</span>
      {[
        'Are guests using it?',
        'Are they happy?',
        'Are they going on to Google?',
        'What else do they tap?',
      ].map((question) => (
        <div key={question} className="space-y-3 rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">{question}</p>
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  )
}

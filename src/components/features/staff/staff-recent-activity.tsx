import { MessageSquare } from 'lucide-react'
import { Stars } from '#/components/features/property/property-dashboard-helpers'
import { EmptyState } from '#/components/ui/empty-state'
import type { StaffRecentReview } from '#/contexts/review/application/public-api'

type StaffRecentActivityProps = Readonly<{
  reviews: readonly StaffRecentReview[]
}>

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function truncate(text: string, maxLen = 100): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '…'
}

export function StaffRecentActivity({ reviews }: StaffRecentActivityProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Recent Activity</h2>

      {reviews.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No recent reviews yet" />
      ) : (
        <div className="grid gap-3">
          {reviews.map((review) => (
            <div key={review.id} className="flex items-start gap-4 rounded-lg border p-3">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <span className="text-lg font-semibold tabular-nums">
                  {review.rating}
                </span>
                <Stars rating={review.rating} />
              </div>
              <div className="min-w-0 flex-1">
                {review.snippet ? (
                  <p className="text-sm leading-snug">{truncate(review.snippet)}</p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">No review text</p>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  <span>{formatDate(review.date)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

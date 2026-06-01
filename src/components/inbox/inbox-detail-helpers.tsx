// Inbox detail helpers — extracted from inbox-detail-sheet for line-count compliance
import { Star } from 'lucide-react'

// Re-export from extracted file
export { getStatusActions } from './inbox-status-actions'

export function RatingStars({ rating }: Readonly<{ rating: number | null }>) {
  if (rating === null) return null
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`size-4 ${
            i < rating ? 'fill-chart-1 text-chart-1' : 'text-muted-foreground/30'
          }`}
        />
      ))}
      <span className="ml-1 text-sm font-medium">{rating}/5</span>
    </div>
  )
}

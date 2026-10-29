import { Badge } from '#/components/ui/badge'
import { formatNumber } from '#/lib/format'

/**
 * What was wrong, or right, named in the guests' own everyday words: the causes of an
 * issue as a row of quiet chips. With counts (the drawer) each says how many reviews
 * name it; without (a card) it is just the name.
 */
export function GuestVoiceCauses({
  causes,
  label,
}: Readonly<{
  causes: readonly Readonly<{ cause: string; reviewCount?: number }>[]
  /** Names the list for a screen reader: "Causes". */
  label: string
}>) {
  if (causes.length === 0) return null
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {causes.map(({ cause, reviewCount }) => (
        <li key={cause}>
          <Badge variant="neutral" className="text-[13px]">
            {cause}
            {reviewCount === undefined ? null : (
              <span className="font-semibold tabular-nums text-foreground">
                {formatNumber(reviewCount)}
                <span className="sr-only">
                  {reviewCount === 1 ? ' review' : ' reviews'}
                </span>
              </span>
            )}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

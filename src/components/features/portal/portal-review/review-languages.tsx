// "Languages": each language the portal offers, how much of its wording is
// written, and drafts nobody has checked. A gap is a note, not a stop, unless it
// is in the fallback language; the checks above say which.

import { Check, CircleAlert, Sparkles } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { ReviewLanguageRow } from '#/contexts/portal/application/public-api'
import { Badge } from '#/components/ui/badge'
import { describeReviewLanguage } from './portal-review-languages'

export function ReviewLanguages({
  languages,
}: Readonly<{ languages: readonly ReviewLanguageRow[] }>) {
  return (
    <section aria-labelledby="review-languages-heading" className="space-y-3">
      <h2 id="review-languages-heading" className="text-lg font-semibold">
        Languages
      </h2>
      <ul className="divide-y border-y">
        {languages.map((row) => (
          <LanguageRow key={row.locale} row={row} />
        ))}
      </ul>
    </section>
  )
}

function LanguageRow({ row }: Readonly<{ row: ReviewLanguageRow }>) {
  const line = describeReviewLanguage(row)
  const isBlocked = row.status === 'blocked'
  const isMissing = line.coverage.tone === 'missing'
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
      <span
        aria-hidden="true"
        className="w-7 shrink-0 text-xs font-semibold text-muted-foreground"
      >
        {line.chip}
      </span>
      <span className="min-w-0 flex-1">
        <span lang={line.locale} className="font-medium">
          {line.native}
        </span>{' '}
        <span className="text-muted-foreground">{line.english}</span>
        {line.tag === null ? null : (
          <Badge variant="secondary" className="ml-2">
            {line.tag}
          </Badge>
        )}
      </span>
      {/* Shows only when a stored text carries `ai_draft` provenance. Nothing
          writes that today (no AI translation, owner decision 3); the line stays
          so a future AI draft is never published without being flagged. */}
      {line.aiDrafts === null ? null : (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Sparkles aria-hidden="true" className="size-3.5" />
          {line.aiDrafts}
        </span>
      )}
      <span
        className={cn(
          'flex items-center gap-1',
          isMissing
            ? isBlocked
              ? 'font-medium text-negative'
              : 'font-medium text-warn'
            : 'text-muted-foreground',
        )}
      >
        {isMissing ? (
          <CircleAlert aria-hidden="true" className="size-3.5" />
        ) : (
          <Check aria-hidden="true" className="size-3.5" />
        )}
        {line.coverage.text}
      </span>
    </li>
  )
}

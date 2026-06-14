// Badge context — staff home badge summary UI

import type { BadgeAwardWithTarget } from '#/contexts/badge/application/public-api'

type StaffBadgeSummaryProps = Readonly<{
  badges: ReadonlyArray<BadgeAwardWithTarget>
}>

export function StaffBadgeSummary({ badges }: StaffBadgeSummaryProps) {
  if (badges.length === 0) {
    return null
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Your badges</h2>
          <p className="text-xs text-muted-foreground">
            Recognition earned on your assigned portals.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {badges.map((badge) => (
          <div
            key={`${badge.award.badgeDefinitionId}:${badge.award.uniqueKey}`}
            className="rounded-lg border bg-muted/40 p-3 text-center"
          >
            <div className="text-xl" aria-hidden>
              {badge.definition.icon}
            </div>
            <p className="mt-1 text-xs font-medium">{badge.definition.name}</p>
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
              {badge.definition.description ?? badge.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

// Badge context — portal detail badge section

import type { BadgeAwardWithTarget } from '#/contexts/badge/application/public-api'

type PortalBadgeSectionProps = Readonly<{
  badges: ReadonlyArray<BadgeAwardWithTarget>
}>

export function PortalBadgeSection({ badges }: PortalBadgeSectionProps) {
  if (badges.length === 0) {
    return null
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold">Badges earned</h2>
      <div className="flex flex-wrap gap-3">
        {badges.map((badge) => (
          <div
            key={`${badge.award.badgeDefinitionId}:${badge.award.uniqueKey}`}
            className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2"
          >
            <span className="text-lg" aria-hidden>
              {badge.definition.icon}
            </span>
            <div>
              <p className="text-xs font-medium">{badge.definition.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {badge.definition.description ?? badge.label}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

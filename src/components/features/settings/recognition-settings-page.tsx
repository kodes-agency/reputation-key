// Recognition settings page — per-badge-definition org enablement toggles.
// Lists every system badge definition with its current org enablement and a
// switch to enable/disable. Toggles are optimistic and revert on failure.

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Switch } from '#/components/ui/switch'
import { Label } from '#/components/ui/label'
import type { Action } from '#/components/hooks/use-action'
import type { OrganizationBadgeEnablement } from '#/contexts/badge/application/public-api'
import type {
  BadgeDefinitionWithEnablementOutput,
  BadgeCriteriaSummary,
} from '#/contexts/badge/application/dto/badge.dto'

type ToggleInput = Readonly<{
  data: Readonly<{ badgeDefinitionId: string; enabled: boolean }>
}>

type Props = Readonly<{
  badges: readonly BadgeDefinitionWithEnablementOutput[]
  toggleBadge: Action<ToggleInput, OrganizationBadgeEnablement>
}>

// Compact human summary of a badge's evaluation criteria.
function formatCriteria(criteria: BadgeCriteriaSummary): string {
  if (criteria.type === 'streak') {
    return `${criteria.streakDays ?? '?'}-day streak`
  }
  const base = `${criteria.operator} ${criteria.threshold}`
  return criteria.period ? `${base} (${criteria.period.replace(/_/g, ' ')})` : base
}

export function RecognitionSettingsPage({ badges, toggleBadge }: Props) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(badges.map((b) => [b.id, b.orgEnabled])),
  )

  const onToggle = async (id: string, next: boolean) => {
    const prev = enabled[id]
    setEnabled((s) => ({ ...s, [id]: next }))
    try {
      await toggleBadge({ data: { badgeDefinitionId: id, enabled: next } })
    } catch {
      setEnabled((s) => ({ ...s, [id]: prev }))
      toast.error('Failed to update badge setting')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recognition badges</CardTitle>
        <CardDescription>
          Choose which achievement badges are active for your organization.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {badges.map((badge) => (
          <div
            key={badge.id}
            className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-base"
                aria-hidden
              >
                {badge.icon}
              </span>
              <div className="max-w-sm">
                <p className="text-sm font-medium">{badge.name}</p>
                {badge.description && (
                  <p className="text-xs text-muted-foreground">{badge.description}</p>
                )}
                <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">
                  {formatCriteria(badge.criteria)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label
                htmlFor={`badge-${badge.id}`}
                className="text-xs text-muted-foreground"
              >
                {enabled[badge.id] ? 'Enabled' : 'Disabled'}
              </Label>
              <Switch
                id={`badge-${badge.id}`}
                checked={enabled[badge.id]}
                onCheckedChange={(v) => onToggle(badge.id, v)}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

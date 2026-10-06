// PROTOTYPE — variant A. One row of the settings rail, in the Portal editor's anatomy:
// icon, label, and one status line that carries the tone (a step to finish, unpublished
// changes, a lock). The row classes are the shared SectionNav recipe, so the active
// fill, hover and focus ring are the editor's own.
import { ArrowRight, Lock, TriangleAlert } from 'lucide-react'
import {
  SECTION_NAV_ICON,
  SECTION_NAV_ROW,
  SECTION_NAV_ROW_HEIGHT,
} from '#/components/ui/section-nav-styles'
import { cn } from '#/lib/utils'
import { SettingsPrototypeLink } from '../../settings-prototype-nav'
import type { RailRow } from '../../settings-prototype-types'
import { SECTION_ICON } from './variant-a-copy'

function StatusLine({ row }: Readonly<{ row: RailRow }>) {
  if (row.statusText === '') return null
  const lead =
    row.tone === 'needs' ? (
      <TriangleAlert className="size-3 shrink-0 text-warn" aria-hidden />
    ) : row.tone === 'locked' ? (
      <Lock className="size-3 shrink-0" aria-hidden />
    ) : row.tone === 'draft' ? (
      <span className="size-1.5 shrink-0 rounded-full bg-link" aria-hidden />
    ) : null
  return (
    <span
      data-slot="settings-rail-status"
      data-tone={row.tone}
      className={cn(
        'flex items-center gap-1 truncate text-xs font-normal',
        row.tone === 'needs' || row.tone === 'draft'
          ? 'text-foreground'
          : 'text-muted-foreground',
      )}
    >
      {lead}
      <span className="truncate">{row.statusText}</span>
    </span>
  )
}

export function RailRowLink({
  row,
  current,
}: Readonly<{ row: RailRow; current: boolean }>) {
  const Icon = SECTION_ICON[row.key]
  return (
    <SettingsPrototypeLink
      href={row.href}
      current={current}
      className={cn(SECTION_NAV_ROW, SECTION_NAV_ROW_HEIGHT.rail)}
    >
      <Icon
        className={cn(SECTION_NAV_ICON, row.key === 'danger' && 'text-negative')}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block whitespace-nowrap">{row.label}</span>
        <StatusLine row={row} />
      </span>
      {row.isLinkOut ? (
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </SettingsPrototypeLink>
  )
}

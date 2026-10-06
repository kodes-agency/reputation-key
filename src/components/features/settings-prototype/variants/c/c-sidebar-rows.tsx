// PROTOTYPE — variant C. The parts of the Settings block in the sidebar: the status
// dot, one section row, the group label and the "Setup n of 7, Next" meter.
import { ArrowUpRight, Lock, Plus, TriangleAlert } from 'lucide-react'
import {
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#/components/ui/sidebar'
import { cn } from '#/lib/utils'
import { SettingsPrototypeLink } from '../../settings-prototype-nav'
import { SECTION_LABEL } from '../../settings-prototype-shape'
import type { RailRow, RowTone, SettingsRail } from '../../settings-prototype-types'

/** The quiet dot is "nothing to do"; amber needs a step; a ring is unpublished changes. */
const DOT: Readonly<Record<Exclude<RowTone, 'locked'>, string>> = {
  ok: 'size-2 rounded-full bg-positive/60',
  needs: 'size-2 rounded-full bg-warn',
  draft: 'size-2 rounded-full border-[1.5px] border-link',
}

/** A fixed 16 px slot, so a dot, a ring and a lock line the labels up. */
export function StatusMark({ tone }: Readonly<{ tone: RowTone }>) {
  return (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
      {tone === 'locked' ? <Lock className="size-3.5" /> : <span className={DOT[tone]} />}
    </span>
  )
}

/** The sidebar draws every icon in the accent; a lock or a link-out is quiet, a danger is red. */
function iconInkOf(row: RailRow): string | undefined {
  if (row.key === 'danger') return '[&_svg]:text-negative'
  return row.locked || row.isLinkOut ? '[&_svg]:text-muted-foreground' : undefined
}

/** The footer rows are actions, not settings to finish: an icon where the others have a dot. */
function RowMark({ row }: Readonly<{ row: RailRow }>) {
  if (row.key === 'add-location') {
    return (
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center"
      >
        <Plus className="size-4" />
      </span>
    )
  }
  if (row.key === 'danger') {
    return (
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center"
      >
        <TriangleAlert className="size-3.5" />
      </span>
    )
  }
  return <StatusMark tone={row.tone} />
}

/**
 * One section: dot and label. A row that needs something (or has a draft) prints its
 * status line under the label, so the sidebar says what is missing without a click; the
 * quiet rows keep it for a screen reader only, so the list stays compact.
 */
export function SettingsRow({
  row,
  current,
}: Readonly<{ row: RailRow; current: boolean }>) {
  const loud = row.tone === 'needs' || row.tone === 'draft'
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={current}
        className={cn(
          'h-auto min-h-8 items-start py-1.5 max-md:items-center',
          iconInkOf(row),
        )}
      >
        <SettingsPrototypeLink href={row.href} current={current}>
          <span className="flex h-5 items-center">
            <RowMark row={row} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{row.label}</span>
            {loud ? (
              <span className="truncate text-xs font-normal text-muted-foreground">
                {row.statusText}
              </span>
            ) : (
              <span className="sr-only">
                {row.locked ? 'Read only. ' : ''}
                {row.statusText}
              </span>
            )}
          </span>
          {row.isLinkOut ? (
            <ArrowUpRight aria-hidden="true" className="mt-0.5 shrink-0" />
          ) : null}
        </SettingsPrototypeLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function GroupLabel({ label }: Readonly<{ label: string }>) {
  return <SidebarGroupLabel>{label}</SidebarGroupLabel>
}

/**
 * "Setup 5 of 7" with a thin bar and the way to the next unfinished step. It goes away
 * when the property is done; the status lines on the rows stay, and show a regression.
 */
export function SetupMeter({
  setup,
  className = 'px-2 pt-1 pb-2',
}: Readonly<{ setup: SettingsRail['setup']; className?: string }>) {
  if (setup === null || setup.isComplete) return null
  const percent = Math.round((setup.done / setup.total) * 100)
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground tabular-nums">
          Setup {setup.done} of {setup.total}
        </span>
        {setup.nextHref ? (
          <SettingsPrototypeLink
            href={setup.nextHref}
            current={false}
            aria-label={
              setup.nextKey === null
                ? 'Next step'
                : `Next step: ${SECTION_LABEL[setup.nextKey]}`
            }
            className="focus-ring -mx-1 inline-flex items-center gap-1 rounded-sm px-1 font-medium text-link hover:underline max-md:min-h-11"
          >
            Next
            <span aria-hidden="true">›</span>
          </SettingsPrototypeLink>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={setup.total}
        aria-valuenow={setup.done}
        className="h-1 overflow-hidden rounded-full bg-sidebar-border"
      >
        <div
          className="h-full rounded-full bg-(--accent)"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

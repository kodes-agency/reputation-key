// PROTOTYPE — "Jump to": the section header's menu, so moving between sections does not
// need a trip home. It lists what the home lists, in the same groups and with the same
// marks, and its first item is the way back to all of Settings.
import { Fragment } from 'react'
import { Check, ChevronDown, LayoutList } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { RailGroup, SettingsPrototypeContext } from '../../settings-prototype-types'
import { SECTION_ICON } from './b-icons'
import { BLink, HOME_TARGET } from './b-links'
import { allRowsOf, labelOf, targetOf, type SettingsHome } from './b-model'
import { ToneMark } from './b-tone'

function groupsOf(home: SettingsHome): readonly RailGroup[] {
  const all = allRowsOf(home.all)
  return [
    ...(all.length === 0
      ? []
      : [{ key: 'all', label: 'All properties', rows: all } as const]),
    ...home.ctx.rail.groups.map((group) =>
      group.label === '' ? { ...group, label: 'More' } : group,
    ),
  ]
}

export function JumpMenu({
  home,
  open,
}: Readonly<{ home: SettingsHome; open: SettingsPrototypeContext }>) {
  const groups = groupsOf(home)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0">
          <LayoutList aria-hidden />
          Jump to
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" data-density="compact">
        <DropdownMenuItem asChild>
          <BLink go={HOME_TARGET}>All settings</BLink>
        </DropdownMenuItem>
        {groups.map((group) => (
          <Fragment key={group.key}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {group.label}
            </DropdownMenuLabel>
            {group.rows.map((row) => {
              const Icon = SECTION_ICON[row.key]
              const isCurrent = row.key === open.current.key
              return (
                <DropdownMenuItem
                  key={row.key}
                  asChild
                  className="aria-[current=page]:bg-accent"
                >
                  <BLink go={targetOf(row, home, home.ctx)} current={isCurrent}>
                    <Icon aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{labelOf(row)}</span>
                    <ToneMark tone={row.tone} />
                    {isCurrent ? <Check aria-hidden className="ml-1" /> : null}
                  </BLink>
                </DropdownMenuItem>
              )
            })}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

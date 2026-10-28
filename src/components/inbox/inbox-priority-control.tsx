import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Fact } from '#/components/ui/fact'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  INBOX_PRIORITY_LEVELS,
  type InboxItem,
  type InboxPriority,
} from '#/contexts/inbox/application/public-api'
import type { InboxCurrentUser, InboxPriorityMenuBox } from './inbox-case-toolbar-props'
import { INBOX_SOURCE_HANDLE_PERMISSION } from './inbox-owner-control'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { InboxPriorityGlyph } from './inbox-priority-glyph'
import {
  PRIORITY_WORD,
  presentInboxPriority,
  type InboxPriorityView,
} from './inbox-priority-view'

type Props = Readonly<{
  item: Pick<
    InboxItem,
    'sourceType' | 'managerPriority' | 'managerPrioritySetBy' | 'managerPrioritySetAt'
  >
  /** The review's current AI attention; null for feedback, none, or AI off. */
  suggestion: InboxPriority | null
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>
  currentUser?: InboxCurrentUser
  isPending: boolean
  onSetPriority: (priority: InboxPriority | null) => void
  /** Filled with this menu's opener while it is mounted, for the `p` shortcut. */
  menuRef?: InboxPriorityMenuBox
  /** Fixes the source line's age; stories and tests pass it. */
  now?: Date
}>

/**
 * Urgent prints in the negative tone (the #857 red), Not set recedes to the
 * muted ink, and every other level keeps the toolbar's own ink. Applied to the
 * glyph and the word rather than the button, so the outline button's hover ink
 * cannot take the red away.
 */
function inkFor(level: InboxPriority | null): string | undefined {
  if (level === 'urgent') return TONE_INK.negative
  return level === null ? TONE_INK.neutral : undefined
}

/**
 * A viewer without the command sees a level only when it asks for attention:
 * Urgent or High as a box-less fact (copy C-11). Medium, Low and Not set print
 * nothing, as an item with no escalation prints no escalation fact.
 */
function PriorityFact({ view }: Readonly<{ view: InboxPriorityView }>) {
  if (!view.keepsWordOnPhone) return null
  return (
    <Fact className={inkFor(view.level)}>
      <InboxPriorityGlyph level={view.level} className="size-3.5" />
      <span className="sr-only">Priority: </span>
      {view.word}
    </Fact>
  )
}

/**
 * The menu, top to bottom (plan §3.1): the label, one muted line saying where
 * the level comes from, the four levels as radios, and — only while a person
 * has set one — the way back. The check mark shows a level a PERSON set only;
 * the AI's level carries a trailing "Suggested", as the owner menu tags who
 * holds the item. Typeahead reaches every row by its first letter: U, H, M, L,
 * then B ("Back to suggestion") or R ("Remove priority").
 */
function PriorityMenuItems({
  view,
  onSetPriority,
}: Readonly<{
  view: InboxPriorityView
  onSetPriority: (priority: InboxPriority | null) => void
}>) {
  return (
    <>
      <DropdownMenuLabel>Priority</DropdownMenuLabel>
      <DropdownMenuLabel className="pt-0 text-xs font-normal text-muted-foreground">
        {view.sourceLine}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={view.setLevel ?? ''}
        // A radio item selects on its checked value too: picking the level
        // already set must not send a command.
        onValueChange={(next) => {
          if (next !== view.setLevel) onSetPriority(next as InboxPriority)
        }}
      >
        {INBOX_PRIORITY_LEVELS.map((level) => (
          <DropdownMenuRadioItem
            key={level}
            value={level}
            textValue={PRIORITY_WORD[level]}
          >
            <InboxPriorityGlyph level={level} className={cn('size-4', inkFor(level))} />
            {PRIORITY_WORD[level]}
            {level === view.suggestion && (
              <span className="ml-auto text-xs text-muted-foreground">Suggested</span>
            )}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {view.resetLabel !== null && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onSetPriority(null)}>
            {view.resetLabel}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}

/**
 * The priority member of the case toolbar's `ButtonGroup`, between the owner
 * and the escalation (owner P-8): the level a manager sees and the one control
 * that changes it. A pick saves at once; picking the suggested level stores it
 * as the manager's own (there is no "Accept"). Priority and Escalate stay
 * independent, so this member wears signal bars and Escalate keeps its flag.
 *
 * The gate copies Escalate's exactly: `inbox.write`, the source's handle
 * permission and `inbox.manage` (`inbox-detail-manager-actions.tsx`).
 *
 * Geometry. One element, like the owner control: Radix's root draws no DOM, so
 * the trigger `Button` is the group's direct child. Below `md`, Urgent and High
 * keep their word (and drop the chevron) because the word is the signal;
 * Medium, Low and Not set become the 36 px glyph square (`iconBelow="md"`), the
 * word kept for a screen reader. "Suggested" is for a screen reader there.
 */
export function InboxPriorityControl({
  item,
  suggestion,
  assignmentOptions,
  currentUser,
  isPending,
  onSetPriority,
  menuRef,
  now,
}: Props) {
  const { can } = usePermissions()
  const [open, setOpen] = useState(false)
  const canCommand =
    can('inbox.write') &&
    can(INBOX_SOURCE_HANDLE_PERMISSION[item.sourceType]) &&
    can('inbox.manage')

  useEffect(() => {
    if (!menuRef || !canCommand) return undefined
    const openMenu = () => setOpen(true)
    menuRef.current = openMenu
    return () => {
      if (menuRef.current === openMenu) menuRef.current = null
    }
  }, [menuRef, canCommand])

  const view = presentInboxPriority({
    item,
    suggestion,
    assignmentOptions,
    currentUser,
    now,
  })
  if (!canCommand) return <PriorityFact view={view} />

  const ink = inkFor(view.level)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          aria-label={view.accessibleName}
          iconBelow={view.keepsWordOnPhone ? undefined : 'md'}
        >
          <InboxPriorityGlyph level={view.level} className={cn('size-4', ink)} />
          <span className={cn(ink, !view.keepsWordOnPhone && 'max-md:sr-only')}>
            {view.word}
          </span>
          {view.isSuggested && (
            <span className="text-xs font-normal text-muted-foreground max-md:sr-only">
              Suggested
            </span>
          )}
          <ChevronDown className="size-3.5 opacity-60 max-md:hidden" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      {/* A menu ITEM keeps 44 px below `md`: it is a different target class
          from a toolbar control (row 20), as in the owner menu. */}
      <DropdownMenuContent align="start" className="min-w-52">
        <PriorityMenuItems view={view} onSetPriority={onSetPriority} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

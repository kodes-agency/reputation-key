import { ChevronDown, UserRound, UserRoundCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { ReactNode } from 'react'
import type { Permission } from '#/shared/domain/permissions'
import type { SourceType } from '#/contexts/inbox/application/public-api'
import {
  resolveInboxOwner,
  type InboxAssignmentOption,
  type InboxOwnerView,
} from './inbox-owner-view'
// The viewer has ONE definition for the whole pane, in the pure selector module
// every surface above this control already imports from; see its comment.
import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import { CASE_SQUARE_CLASS, CaseFact } from './inbox-case-member'

/**
 * Mirror of `SOURCE_HANDLE_PERMISSION` in
 * `contexts/inbox/application/inbox-access.ts`: every command that acts on an
 * item — assigning, reopening, escalating it — is `inbox.write` **and** the owning
 * context's handle permission, so `inbox.write` alone is not a licence to
 * touch private feedback. Shared with the case toolbar so the two gates cannot
 * drift, and `satisfies` keeps the record total: a third source type fails the
 * build here rather than silently defaulting open.
 */
export const INBOX_SOURCE_HANDLE_PERMISSION = {
  review: 'review.read',
  feedback: 'feedback.handle',
} as const satisfies Readonly<Record<SourceType, Permission>>

type AssignmentChoice = Readonly<{
  /** `null` releases the item. */
  userId: string | null
  label: string
  isCurrent: boolean
}>

/** What the control shows for the holder: the words, and the mark. */
type Props = Readonly<{
  assignedTo: string | null
  /** Decides the second half of the server's handle gate, with `inbox.write`. */
  sourceType: SourceType
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>
  currentUser?: InboxCurrentUser
  isPending: boolean
  onAssign: (assignedToUserId: string | null) => void
}>

/**
 * The item carries an opaque user id and no name; the detail payload adds
 * none. Resolve through the viewer, then the option list, then a neutral
 * placeholder — a raw id is never rendered, as a label OR as initials.
 *
 * Initials come from a PERSON's name, never from the label: the placeholder
 * `Assigned` would otherwise draw an `A` for someone who is not called that,
 * and `You` a `Y`. So the two fallbacks (`Unassigned`, `Assigned`) carry no
 * initials and the control draws the person glyph.
 *
 * For the viewer, the session name wins and the directory name is the
 * fallback — the member directory can exclude the viewer (see `buildChoices`),
 * and the session can lack a name, but rarely both. A blank directory name is
 * treated as unresolvable: it would otherwise render an empty label and an
 * accessible name of `Assignment: `.
 */
/**
 * `assign-inbox-item.ts` lets `inbox.write` claim an item that is unassigned or
 * already theirs and release one they hold, and nothing else; every wider move
 * — including stealing an item held by someone else to assign it to yourself —
 * needs `inbox.manage`.
 *
 * The caller reaches this function only once the source conjunct has passed —
 * `assign-inbox-item.ts:52` runs `canHandleInboxSource` after its write check,
 * so a custom role holding `inbox.write` and only `feedback.read` may read a
 * private-feedback item but not assign it. Within that envelope the menu
 * offers exactly what the caller may do, so the server never has to refuse a
 * choice this control presented. An empty list means a static fact rather
 * than an empty menu.
 */
function buildChoices(
  assignedTo: string | null,
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>,
  canManage: boolean,
  currentUserId?: string,
): ReadonlyArray<AssignmentChoice> {
  const holdsIt = currentUserId !== undefined && assignedTo === currentUserId
  const release: AssignmentChoice = {
    userId: null,
    label: 'Unassign',
    isCurrent: false,
  }

  if (!canManage) {
    if (holdsIt) return [release]
    if (assignedTo === null && currentUserId !== undefined) {
      return [{ userId: currentUserId, label: 'Assign to me', isCurrent: false }]
    }
    return []
  }

  // Candidates are drawn from the member directory, which can exclude the
  // viewer (or be empty); without this the only manager on a small account
  // could assign everyone but themselves.
  const self: ReadonlyArray<AssignmentChoice> =
    currentUserId !== undefined &&
    !holdsIt &&
    !assignmentOptions.some((option) => option.userId === currentUserId)
      ? [{ userId: currentUserId, label: 'Assign to me', isCurrent: false }]
      : []
  const listed = assignmentOptions.map((option) => ({
    userId: option.userId,
    label: option.name,
    isCurrent: option.userId === assignedTo,
  }))

  // Releasing an already-unassigned item is a no-op the server short-circuits.
  return assignedTo === null ? [...self, ...listed] : [...self, ...listed, release]
}

/*
 * Geometry. Plan v2.1 row 2: a control is an outlined 32 px button inside ONE
 * `ButtonGroup`, and the group owns the corner radii of its members
 * (`ui/button-group.tsx:12` squares every inner edge and drops the doubled
 * left border). So neither look sets a radius or a pill shape of its own: the
 * member keeps `Button`'s default `rounded-md` and the group squares it. That
 * also means this component must render exactly ONE element — the group's
 * `[&>*]` selectors only reach direct children, and Radix's `DropdownMenu`
 * root renders no DOM, so the trigger `Button` is that child.
 *
 * Below `md` the TRIGGER is `CASE_SQUARE_CLASS`'s 36 px square (row 20, the
 * canvas's `[Closed ▾][GI][⚑]` = 180 px at 390), so its label goes `sr-only`
 * and its chevron away, and the disc or glyph alone remains. `sr-only`, not
 * `hidden`: the `aria-label` is the name either way, and the word stays in the
 * DOM. The FACT does not collapse — see `CaseFact` — so its label is never
 * `sr-only`: on a phone `GH Grace Hopper` and `Assigned` are still words.
 *
 * `max-w-40 truncate` caps a long directory name at 160 px so one person
 * cannot push the reply-due fact off the toolbar; the full name stays in
 * the accessible name.
 */
const NAME_CLASS = 'max-w-40 truncate'
const TRIGGER_LABEL_CLASS = `${NAME_CLASS} max-md:sr-only`

/**
 * The disc's two tones. Purple is interactive-only (contract, "Colour and
 * token rules"), so only the trigger's disc is accent: `bg-accent` is the
 * accent-MUTED ground — `styles.css` maps `--color-accent` to `--accent-muted`
 * for shadcn's hover surfaces — and the text is the strong `--accent` read
 * straight from the token, because no utility maps it (`text-primary` diverges
 * from `--accent` in the dark theme). That same `hover:bg-accent` is the
 * outline button's hover fill, which would swallow the disc's ground on hover;
 * `group-hover/owner:bg-background` keeps the disc a disc. The group is NAMED
 * because a bare `group-hover` matches ANY hovered `.group` ancestor, so a row
 * or panel above the pane could repaint the disc from a hover nowhere near it.
 *
 * A fact's disc is ink on `--border` (0.9 / 0.28 lightness): `--muted` is
 * 0.96 against a 0.98 background in the light theme, a disc too faint to read
 * as a shape once the fact lost its own box, and a purple disc on a fact would
 * tell a Member that `GH` can be pressed.
 */
const DISC_TONE = {
  control: 'bg-accent text-(--accent) group-hover/owner:bg-background',
  fact: 'bg-border text-foreground',
} as const

/**
 * The holder's mark: a 20 px initials disc, or a person glyph. The glyph says
 * WHETHER someone holds the item even when no name can be found for them —
 * `UserRound` for nobody, `UserRoundCheck` for a holder the directory cannot
 * name (a Member has no `member.list`, so every colleague's item resolves to
 * `Assigned`) or a viewer with no session name. Below `md` the trigger shows
 * nothing BUT this mark, so a single shared glyph made an item a colleague
 * holds pixel-identical to one that is free to claim.
 *
 * Initials are a picture of the name and the name is already in the label or
 * the `aria-label`, so the mark is `aria-hidden` either way.
 */
function OwnerMark({
  owner,
  tone,
}: Readonly<{ owner: InboxOwnerView; tone: keyof typeof DISC_TONE }>): ReactNode {
  if (owner.initials === null) {
    const Glyph = owner.isAssigned ? UserRoundCheck : UserRound
    return (
      <Glyph aria-hidden="true" className={tone === 'fact' ? 'size-3.5' : undefined} />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] leading-none font-semibold md:-ml-0.5 ${DISC_TONE[tone]}`}
    >
      {owner.initials}
    </span>
  )
}

/**
 * Owner member of the case toolbar's `ButtonGroup`: who holds the item, and
 * the moves available. The toolbar composes it; it draws no group of its own.
 */
export function InboxOwnerControl({
  assignedTo,
  sourceType,
  assignmentOptions,
  currentUser,
  isPending,
  onAssign,
}: Props) {
  const { can } = usePermissions()
  const owner = resolveInboxOwner(assignedTo, assignmentOptions, currentUser)
  const canHandle = can('inbox.write') && can(INBOX_SOURCE_HANDLE_PERMISSION[sourceType])
  const choices = canHandle
    ? buildChoices(assignedTo, assignmentOptions, can('inbox.manage'), currentUser?.id)
    : []

  // A caller with no move gets a fact, not an empty menu (contract,
  // "Permission pairs") — and since row 2 a fact is text, not a box: the same
  // `CaseFact` an open item's status uses. `min-w-0` on the fact and
  // `truncate` on the name let a long name be the thing that gives at 320 px.
  if (choices.length === 0) {
    return (
      <CaseFact>
        <OwnerMark owner={owner} tone="fact" />
        <span className={NAME_CLASS}>{owner.label}</span>
      </CaseFact>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          aria-label={`Assignment: ${owner.label}`}
          className={`group/owner ${CASE_SQUARE_CLASS}`}
        >
          <OwnerMark owner={owner} tone="control" />
          <span className={TRIGGER_LABEL_CLASS}>{owner.label}</span>
          <ChevronDown className="size-3.5 opacity-60 max-md:hidden" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {choices.map((choice) => (
          // A menu ITEM keeps 44 px below `md`: it is a different target class
          // from a toolbar control, stacked edge to edge with no gap between
          // neighbours, and it was never what inflated the row (row 20).
          <DropdownMenuItem
            key={choice.userId ?? 'release'}
            aria-current={choice.isCurrent ? 'true' : undefined}
            className="max-md:min-h-11"
            onSelect={() => onAssign(choice.userId)}
          >
            {choice.label}
            {choice.isCurrent && (
              <span className="ml-auto text-xs text-muted-foreground">Assigned</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

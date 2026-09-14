import { UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { TimelineIndicator } from '#/components/ui/timeline'
import { cn } from '#/lib/utils'
import { MESSAGE_PROSE_CLASS } from './guest-message'
import { personInitials } from './person-initials'
import { formatDateTime, formatRelativeTime } from './utils'
import type { InboxNoteView } from '#/contexts/inbox/application/public-api'

/**
 * IBX-01-T6: never render a raw user id. The server resolves the author's
 * current display name inside the Organization; an unresolvable author is an
 * opaque "Unknown user", not an id fragment and not an email.
 */
function authorLabel(note: InboxNoteView, currentUserId?: string): string {
  if (note.userId === currentUserId) return 'You'
  return note.displayName ?? 'Unknown user'
}

type NoteProps = Readonly<{ note: InboxNoteView; currentUserId?: string }>

/**
 * The note's node on the thread's rail (plan v2.1 row 12): the AUTHOR'S
 * initials on the warn surface, in the rail's 32 px `default` weight — row 9's
 * weight for a node a person wrote, the same as the guest's avatar and the
 * reply's. It IS the `TimelineIndicator`, toned, rather than a disc to nest in
 * one: the primitive draws its own neutral disc (`ui/timeline.tsx`), so a
 * second disc inside it would ring the initials twice.
 *
 * Why initials and not the lock v1 put here: the rail says WHO for every other
 * node — the guest's photo, the property's `H`, the actor at the head of each
 * event sentence — and a note is the one entry a teammate wrote by hand. v1
 * spent the slot on a lock and then printed `Not visible to the guest` in the
 * box as well: two marks for one idea, and no author on the rail. Privacy is
 * said on the BOX, not the disc (`NoteMessage`): in words, spoken and printed,
 * and by a dashed edge — never by the amber alone, which the composer's Note
 * mode wears too (row 19) and which a grayscale or low-vision reader cannot
 * tell from the reply's box.
 *
 * The initials come from `note.displayName`, never from `authorLabel`: for the
 * viewer's own note that label is `You`, which would draw `Y`, and for an
 * unresolvable author it is `Unknown user`, which would draw `UU` — initials
 * nobody has. `You` therefore shows the viewer's real initials (row 4's rule
 * for the owner control) and an unknown author shows the person glyph, which is
 * the fallback `personInitials` returns `null` for.
 *
 * The tone overrides only the primitive's colours (`cn` resolves border, fill
 * and ink in this call's favour); the 11 px semibold initials stay the rail's.
 * `text-warn` on `bg-warn-muted` measured 4.62:1 light and 9.16:1 dark
 * (`styles.css`). The primitive is `aria-hidden` by construction, which is
 * right here: the author's name is printed in `NoteMessage` beside it.
 *
 * Exported apart from `NoteMessage` because the rail owns the indicator column:
 * `TimelineItem` takes this node, `TimelineConnector` and `TimelineContent`
 * wrapping the message, so the connector runs through the disc rather than
 * beside the box.
 */
export function NoteIndicator({ note }: Readonly<{ note: InboxNoteView }>): ReactNode {
  return (
    <TimelineIndicator className="border-warn-line bg-warn-muted text-warn">
      {personInitials(note.displayName) ?? <UserRound />}
    </TimelineIndicator>
  )
}

/**
 * One internal note as a message on the rail — the box beside `NoteIndicator`.
 *
 * The header reads `Grace Hopper · Internal note · 3h ago`: no lock glyph, no
 * `Team only` (row 12 — the lock survives only on the composer's Note tab).
 * `Internal note` is printed in the warn ink so the word and the surface say
 * the same thing, and it is text rather than a `Badge` because it is a fact
 * about the entry, not a control (row 2).
 *
 * WHAT SAYS "PRIVATE", AND WHY NOT THE AMBER. Row 12 took away v1's two
 * non-colour cues — the lock and the dashed border — and left the amber to say
 * it. PR 3's review measured what that leaves, in Chromium against `pnpm
 * storybook`: the surface is 1.01:1 against the pane in the light theme and
 * its `--warn-line` edge 1.47:1 (2.17:1 dark), so in grayscale, in sunlight or
 * to a low-vision reader the note is a box of the same shape as the reply's
 * beside it (`#edcb84` vs `#dcdee2`, 1.16:1), told apart only by one 12 px
 * word. And a screen reader heard `Internal note from Grace Hopper` — the word
 * "guest" never came up, while the outcome row's lock in the same rail
 * promises `Internal note, not visible to the guest`. A manager must never
 * mistake a note for something the guest can see, so the promise is carried
 * by things that survive the loss of colour:
 *
 * - SPOKEN. The article's name is `Internal note from <author>, not visible to
 *   the guest` — the outcome lock's sentence (`history-event-node.tsx`), so the
 *   one rail makes one promise, in one form, for both kinds of private text. It
 *   is the name rather than printed text for the reason row 12 gives: the box
 *   already says `Internal note` visibly, and a second printed line is the
 *   repetition row 7 found.
 * - SHAPED. `border-dashed`, v1's cue, which row 12 never named: a dashed edge
 *   reads as a different KIND of box at any contrast, where a solid one only
 *   differs from the reply's by hue. The colours stay row 12's tokens; making
 *   the amber louder would still be colour carrying the meaning.
 * - PRINTED. The `Internal note` label, at 4.62:1 light and 9.16:1 dark.
 *
 * The time is `text-muted-foreground`, the thread's quiet grade, not the
 * `--text-tertiary` token the canvas names: tertiary measured 2.48:1 (light)
 * and 2.90:1 (dark) on `--warn-muted`, a 12 px timestamp below the 4.5:1 bar,
 * while muted-foreground measured 6.10:1 and 6.51:1 on the same surface.
 *
 * The author is a `span`, as the reply message's comment relies on
 * (`reply-message.tsx`): an `h*` here would add an outline level per note that
 * cannot tell one note from the next. The article's `aria-label` names the
 * region, and the stories pin that name (`Internal note from Ada Lovelace, not
 * visible to the guest`, `… from You, …`, `… from Unknown user, …`).
 *
 * The separators are `aria-hidden` so a reader hears the three facts, not the
 * word "dot" between them.
 *
 * The author wraps (`wrap-anywhere`) rather than truncating: it is the one
 * word on the node that says who wrote a private note, and a flex item's
 * min-content is its longest word, so a spaceless display name would otherwise
 * refuse to shrink — measured in Chromium against `pnpm storybook`, a
 * 300-character author pushed the thread 1365 px past its 720 px pane at a
 * 1440 px viewport, 1727 px past its 358 px pane at 390 and 1797 px past its
 * 288 px pane at 320; with it, zero. `anywhere` lowers that min-content; ordinary
 * names still break only at their spaces, and the row's `flex-wrap` still moves
 * `Internal note` and the time to the next line before any word is split.
 */
export function NoteMessage({ note, currentUserId }: NoteProps): ReactNode {
  const author = authorLabel(note, currentUserId)
  const at =
    typeof note.createdAt === 'string' ? new Date(note.createdAt) : note.createdAt

  return (
    <article
      aria-label={`Internal note from ${author}, not visible to the guest`}
      className="min-w-0 rounded-lg border border-dashed border-warn-line bg-warn-muted px-4 py-3"
    >
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
        <span className="min-w-0 text-sm font-medium wrap-anywhere text-foreground">
          {author}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <span className="font-medium text-warn">Internal note</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <time
          className="text-muted-foreground"
          dateTime={at.toISOString()}
          title={formatDateTime(at)}
        >
          {formatRelativeTime(at)}
        </time>
      </p>
      {/* `text-sm` carries its own line-height, so the caller that sets the
          type scale restates the leading the shared measure asks for. */}
      <p
        className={cn(
          MESSAGE_PROSE_CLASS,
          'mt-1.5 text-sm leading-relaxed text-foreground',
        )}
      >
        {note.text}
      </p>
    </article>
  )
}

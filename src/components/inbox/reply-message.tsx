import { Building2 } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import {
  TimelineConnector,
  TimelineContent,
  TimelineIndicator,
  TimelineItem,
} from '#/components/ui/timeline'
import type { ReplyPublicationCheckResult } from '#/contexts/review/application/public-api'
import { cn } from '#/lib/utils'
import { MESSAGE_PROSE_CLASS } from './guest-message'
import { INBOX_CHIP_STATIC_CLASS } from './inbox-chip'
import { personInitials } from './person-initials'
import { ReplyCheckStatus } from './reply-check-status'
import { ReplyMessageActions } from './reply-message-actions'
import { presentReplyMessage, type ReplyMessageTone } from './reply-message-view'
import { resolveReplyView, type ReplyData } from './reply-status-view'
import { useReplyCheckRun } from './use-reply-check-run'
import { formatDateTime, formatRelativeTime } from './utils'
import { useRef, type ReactNode } from 'react'

/**
 * Chip tone. `accent` is NOT the purple `--accent` token: purple is
 * interactive-only in this pane (plan row 12) and must never fill a chip that
 * carries data.
 *
 * Nor is it amber any more. v1 borrowed the warning amber for "waiting on a
 * person here", and PR 3 first moved it onto the warn pair — the very pixels
 * the internal note now wears to say PRIVATE (row 12) and the composer's Note
 * mode will wear to say the same (row 19). PR 3's review measured the result:
 * an `Awaiting approval` reply and a note rendered `#a45f00` on `#fff6dd`
 * (light) / `#f5af20` on `#231806` (dark) on both chip and disc, the two discs
 * differing only by the note's 1.47:1 ring — so a teammate named `Hristo` and
 * `Hotel Elegance` drew two identical amber `H`s, one private and one about to
 * go to the guest. The one entry in the thread that WILL be public cannot wear
 * the colour that means it will not.
 *
 * So `accent` is the strongest neutral instead: the chip inverts to
 * `bg-foreground text-background`, the same ink as the open-status dot (row 3's
 * amendment: a fact that needs a person is `foreground`, not a hue). It stays
 * distinct in grayscale from `neutral` (an outline) and from the note (a
 * dashed amber box), and inverted text is the pane's own text contrast, so it
 * needs no measured exception. Every tinted chip prints its own words, so
 * colour never carries the meaning alone.
 */
const TONE_CLASS: Readonly<Record<ReplyMessageTone, string>> = {
  neutral: '',
  positive: 'bg-positive-muted text-positive',
  negative: 'bg-negative-muted text-negative',
  accent: 'bg-foreground text-background',
}

/**
 * The reply's disc on the rail, toned by the SAME `ReplyMessageTone` that tones
 * the chip (plan v2.1 PR 3: "a 32 px `H` indicator toned by the chip") — so the
 * rail and the box can never disagree about the state. Concretely:
 *
 * | state (chip)                          | tone     | disc                   |
 * | ------------------------------------- | -------- | ---------------------- |
 * | `Awaiting approval`, `Needs a check`  | accent   | foreground fill, inked |
 * | `Waiting for Google`                  | neutral  | the rail's own disc    |
 * | `Live on Google` (sent or mirrored)   | positive | positive fill          |
 * | `Not published`, `Rejected`           | negative | negative fill          |
 *
 * `Waiting for Google` stays neutral because its chip is neutral
 * (`reply-message-view.ts`: an approved reply is in the machine's hands, not
 * waiting on a person here). The canvas drew that disc in the accent colour
 * beside a neutral chip; toning the disc by the chip instead is what keeps one
 * state from reading two ways.
 *
 * No reply disc is amber, for the reason `TONE_CLASS` gives: amber on the rail
 * is the note's alone, so an initial in an amber disc is always a teammate's
 * private note and never the property's public reply. The toned rings are
 * transparent, like the canvas's toned discs. Neither disc carries its meaning
 * alone: the chip beside this one prints the state, and the note's box speaks
 * and prints `Internal note`.
 */
const INDICATOR_TONE_CLASS: Readonly<Record<ReplyMessageTone, string>> = {
  neutral: '',
  positive: 'border-transparent bg-positive-muted text-positive',
  negative: 'border-transparent bg-negative-muted text-negative',
  accent: 'border-transparent bg-foreground text-background',
}

/**
 * The property's initial — ONE letter, the plan's `H` for Hotel Elegance — taken
 * from the name's first word through `personInitials`, the one Unicode-safe
 * helper (PR 2 fact), rather than a second `charAt(0)` that splits a surrogate
 * pair. A property is a brand, not a person: `HE` would read as a teammate's
 * initials on a rail where a note's author draws exactly that shape.
 *
 * No property name at all draws the building glyph v1 used, rather than the `P`
 * of the `Property` placeholder the box prints — a letter the property does
 * not have.
 */
function propertyInitial(propertyName: string | null): string | null {
  const firstWord = propertyName?.trim().split(/\s+/u)[0]
  return personInitials(firstWord)
}

type Props = Readonly<{
  reply: ReplyData
  propertyName: string | null
  isSaving: boolean
  /** Whether the pane's published-reply editor is open — see `ReplyMessageActions`. */
  isEditing: boolean
  onApprove: () => Promise<unknown>
  onReject: (reason?: string) => Promise<unknown>
  /** Resolves what the check found; see `useReplyCheckRun`. */
  onCheck: () => Promise<ReplyPublicationCheckResult>
  onRetry: () => Promise<unknown>
  onEditPublished: () => void
  onEditRejected: () => void
}>

/**
 * The property's reply as ONE message in the thread (plan row 6), in the same
 * grammar as the guest's message and an internal note: avatar slot, author,
 * one prose measure. It replaced seven components across eight branches, each
 * of which had invented its own heading, badge placement and action row.
 *
 * A node on the rail since plan v2.1 row 9, in the 32 px weight a message
 * takes. The 44 px `Building2` avatar that sat inside the article is now the
 * `TimelineIndicator` beside it, and the ARTICLE is the box: its border, fill,
 * padding, header row, state chip, meta line, detail, reason attribution and
 * `ReplyMessageActions` are v1's, class for class. Only where the avatar lives
 * changed. The article therefore no longer contains the disc, which is right —
 * the disc is `aria-hidden` and repeats the author the box prints.
 *
 * It renders its own `TimelineItem`, like `HistoryEventNode`, because a draft
 * renders NOTHING here and the rail forbids an item around nothing
 * (`ui/timeline.tsx`: an empty item still draws a disc and a connector). So the
 * null check stays inside, where `presentReplyMessage` already decides it, and
 * `inbox-thread.tsx` never has to ask first. Rendered outside a `Timeline`
 * (`reply-message.stories.tsx`) the item is a plain flex row whose connector
 * hides itself as the last child.
 *
 * The meta line is a TIMESTAMP ONLY. `ReplyView` carries `createdBy`,
 * `approvedBy` and `rejectedBy` as bare `UserId` and no name exists anywhere
 * in the payload, so "Submitted by <name>" has no data source without a server
 * change. A raw id is never rendered and a name is never invented.
 *
 * The author is a `span`, exactly as in `NoteMessage`: as an `h2` the property
 * name is identical on every item in a single-property inbox, so it added a
 * level to the outline that could not tell one entry from another. The
 * article's `aria-label` already names this region.
 *
 * `ReplyMessageActions` is keyed by reply identity because this message sits at
 * a fixed position under a thread row keyed by the constant `'reply'`: without
 * the key React carries its local state — a half-typed rejection reason —
 * across a reply-state change and across a change of item. The check's pending
 * state, status line and focus repair live HERE, above that key, for the same
 * reason in reverse: they must survive the remount the check's own result
 * causes, and put focus back when that remount takes the focused button.
 */
export function ReplyMessage({
  reply,
  propertyName,
  isSaving,
  isEditing,
  onApprove,
  onReject,
  onCheck,
  onRetry,
  onEditPublished,
  onEditRejected,
}: Props): ReactNode {
  const view = presentReplyMessage(resolveReplyView(reply))
  const articleRef = useRef<HTMLElement>(null)
  const checkRun = useReplyCheckRun(reply, onCheck, articleRef)
  // A draft lives in the composer, so it is not a thread message at all.
  if (!view || !reply) return null

  // The item carries the property's name or nothing; the pane header settles
  // on the same neutral noun rather than leaving the author blank.
  const author = propertyName ?? 'Property'

  return (
    <TimelineItem className="pb-4">
      <TimelineIndicator className={INDICATOR_TONE_CLASS[view.tone]}>
        {propertyInitial(propertyName) ?? <Building2 />}
      </TimelineIndicator>
      <TimelineConnector />
      <TimelineContent>
        <article
          ref={articleRef}
          aria-label={`Reply from ${author}`}
          className="min-w-0 rounded-lg border bg-muted/30 px-4 py-3"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {author}
            </span>
            <Badge
              variant={view.tone === 'neutral' ? 'outline' : 'secondary'}
              className={cn(
                INBOX_CHIP_STATIC_CLASS,
                'font-normal',
                TONE_CLASS[view.tone],
              )}
            >
              {view.chip}
            </Badge>
          </div>

          {view.meta && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {view.meta.label} ·{' '}
              <time
                dateTime={view.meta.at.toISOString()}
                title={formatDateTime(view.meta.at)}
              >
                {formatRelativeTime(view.meta.at)}
              </time>
            </p>
          )}

          {/* `text-sm` carries its own line-height, so the caller that sets the
            type scale restates the leading the shared measure asks for. */}
          <p
            className={cn(
              MESSAGE_PROSE_CLASS,
              'mt-1.5 text-sm leading-relaxed text-foreground',
            )}
          >
            {reply.text}
          </p>

          {view.detail && (
            <p className={cn(MESSAGE_PROSE_CLASS, 'mt-2 text-xs text-muted-foreground')}>
              {view.detail}
            </p>
          )}

          {/* A colleague's words, labelled as such. Unprefixed, an authored
            reason sits in the same muted slot and the same type as RepKey's own
            failure sentences, and a reader cannot tell person from product. */}
          {view.reason && (
            <p className={cn(MESSAGE_PROSE_CLASS, 'mt-2 text-xs text-muted-foreground')}>
              <span className="font-medium text-foreground">Reason:</span> {view.reason}
            </p>
          )}

          <ReplyMessageActions
            key={`${reply.id}:${reply.status}`}
            actions={view.actions}
            text={reply.text}
            isSaving={isSaving}
            isChecking={checkRun.isChecking}
            isEditing={isEditing}
            onApprove={onApprove}
            onReject={onReject}
            onCheck={checkRun.check}
            onRetry={onRetry}
            onEditPublished={onEditPublished}
            onEditRejected={onEditRejected}
          />
          <ReplyCheckStatus message={checkRun.statusMessage} />
        </article>
      </TimelineContent>
    </TimelineItem>
  )
}

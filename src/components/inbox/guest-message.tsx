import { useState } from 'react'
import { UserRound } from 'lucide-react'
import { StarRating } from '#/components/ui/star-rating'
import {
  TimelineConnector,
  TimelineContent,
  TimelineIndicator,
  TimelineItem,
} from '#/components/ui/timeline'
import { cn } from '#/lib/utils'
import { presentGuestReviewBody } from './guest-message-view'
import { personInitials } from './person-initials'
import { languageDisplayName } from './reply-language-options'
import { TopicChips } from './topic-chips'
import { formatDate } from './utils'
import type { GuestReviewBodyView, GuestReviewDisclosure } from './guest-message-view'
import type { ReactNode } from 'react'
import type {
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'

/**
 * Finding 9: review and reply text ran the full ≈670 px pane at ≈110 characters
 * a line. Every message body in the thread — guest, note, reply — caps its
 * measure here so they all break at the same rhythm. Type scale AND leading
 * stay with the caller: `cn` is tailwind-merge, which treats `text-<size>` as
 * also setting line-height, so a `leading-*` in here is silently dropped by any
 * caller that sets its own type scale. Only the measure and the wrapping are
 * shared, which is what this constant claims to be.
 *
 * `wrap-anywhere` (`overflow-wrap: anywhere`) is the wrapping half for a word
 * longer than the line — a pasted URL, a booking reference, a keyboard mash.
 * `whitespace-pre-wrap` alone breaks only at spaces: measured in Chromium
 * against `pnpm storybook` (`Inbox/Thread/Full Rail`), one 300-character
 * unbroken word in the review pushed the thread 1508 px past its 720 px pane
 * at a 1440 px viewport, 1870 px past its 358 px pane at 390 and 1940 px past
 * its 288 px pane at 320, taking the rail's content column off screen; with
 * it, zero at all three. `anywhere` rather than `break-word` because only
 * `anywhere` also lowers the element's min-content width, and the `Google
 * translation` disclosure is `w-fit` — a fit-content box sizes from
 * min-content, so `break-word` would still overflow there.
 */
export const MESSAGE_PROSE_CLASS = 'max-w-[62ch] whitespace-pre-wrap wrap-anywhere'

/**
 * Private feedback carries no name we are allowed to show, and the submitter is
 * not the reviewer of anything. A role noun says who wrote it without implying
 * an identity we do not have.
 */
const FEEDBACK_AUTHOR = 'Guest'

/**
 * A null `reviewerName` has TWO meanings and the pane may only claim one of
 * them: the guest really did post anonymously, or the source snippet is gone —
 * `inbox.repository.ts` nulls every snippet field for both `expired` and
 * `not_found`. Only an available review can say anonymous; anything else says
 * the name is missing, in the same register as the unavailable-content lines
 * below, and asserts nothing about the person.
 */
function resolveReviewerName(detail: InboxItemDetailResult): string {
  const { reviewerName } = detail.item
  if (reviewerName !== null) return reviewerName
  return detail.reviewContentStatus === 'available'
    ? 'Anonymous guest'
    : 'Reviewer name unavailable'
}

/**
 * The guest's disc on the rail — node zero's indicator (plan v2.1 row 10).
 *
 * v1 drew a 44 px avatar INSIDE the article, beside the header, so the review
 * sat above the thread rather than in it (finding 3). The avatar now IS the
 * first `TimelineIndicator`, in row 9's 32 px weight for a person, and the
 * connector runs down from it to the first event: the guest's words are the
 * first entry of the case's record, not a heading over a list.
 *
 * What it draws, in order:
 *
 * - Google's profile photo, while it loads. A failed load falls back rather
 *   than leaving a broken-image glyph in a 32 px circle; the caller keys this
 *   component on the photo URL, so a different reviewer's photo clears a
 *   previous failure instead of inheriting the fallback.
 * - The reviewer's initials, from `personInitials` (`person-initials.ts`, the
 *   one Unicode-safe helper; PR 2 fact). Row 10 says "initial": a Google
 *   reviewer handle is usually one word (`majestique` on the canvas), for
 *   which the helper returns exactly that one letter. A two-word name gets two,
 *   which is what every other person's disc in this pane draws — the owner
 *   control (row 4) and a note's author (row 12) — so a person reads the same
 *   on every node. The deleted `name.charAt(0)` took a UTF-16 code unit, which
 *   is half of any letter outside the Basic Multilingual Plane.
 * - The person glyph, when there is no NAME to take initials from. `name` is
 *   null for private feedback (no submitter name we may show) and for a review
 *   whose name is missing: `Anonymous guest` and `Reviewer name unavailable`
 *   are the pane's words ABOUT a missing name, and their initials (`AG`, `RN`)
 *   would draw letters nobody has. `personInitials` also returns null for a
 *   name with no letter or digit in it.
 *
 * Decorative in every branch: the primitive is `aria-hidden` by construction
 * and the name is printed in the header beside it, so the `<img>` keeps
 * `alt=""` rather than repeating the name a screen reader has just heard.
 */
function GuestIndicator({
  name,
  photoUrl,
}: Readonly<{ name: string | null; photoUrl: string | null }>): ReactNode {
  const [failed, setFailed] = useState(false)
  const initials = personInitials(name)
  return (
    <TimelineIndicator>
      {photoUrl && !failed ? (
        <img
          src={photoUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        (initials ?? <UserRound />)
      )}
    </TimelineIndicator>
  )
}

/**
 * Node zero's `TimelineItem`. The guest message owns its whole item, as
 * `HistoryEventNode` and `ReplyMessage` do, because the rail forbids an item
 * around nothing (`ui/timeline.tsx`): `GuestMessage` renders nothing while the
 * detail is still missing, and an empty item would still draw a disc and a
 * connector at the head of the thread.
 *
 * `pb-5` (20 px) rather than a message's `pb-4`: the review is the subject of
 * everything below it, and its topic chips end on a row of 24 px pills that
 * would otherwise sit as close to the first event as two events sit to each
 * other. The canvas leaves 14–18 px under the chips (`LedgerNote.dc.html`).
 */
function GuestNode({
  indicator,
  children,
}: Readonly<{ indicator: ReactNode; children: ReactNode }>): ReactNode {
  return (
    <TimelineItem className="pb-5">
      {indicator}
      <TimelineConnector />
      <TimelineContent>{children}</TimelineContent>
    </TimelineItem>
  )
}

/**
 * Row 10's header LINE: name · stars · `5.0` · date, one wrapping run, with
 * the language fact after the date where the review has one. v1 stacked a
 * 16 px name over a 12 px meta line beside the avatar; with the avatar on the
 * rail the header is one baseline, which is what the canvas draws.
 *
 * `items-center`, not the canvas's `baseline`. Measured in Chromium against
 * `pnpm storybook`: under `items-baseline` the printed `5.0` sat 2.25 px above
 * the date beside it, because `StarRating`'s first flex child is its row of
 * glyphs, which has no text baseline, so the browser synthesises one from the
 * box edge. Centred, the `5.0` and the date share one line (both centred at the
 * same y) and the 16 px name sits 0.75 px off them. `pt-1` puts that first line
 * — the name's 24 px line box — on the middle of the 32 px indicator
 * (4 + 12 = 16; measured 0), so the disc and the name read as one row.
 *
 * The name stays an `h2`: the stories pin `heading level 2` for the resolved,
 * anonymous and unavailable names alike, and it is the one heading in the
 * thread — the note and the reply deliberately have none (`note-message.tsx`,
 * `reply-message.tsx`). `min-w-0 max-w-full truncate` lets a name longer than
 * the phone sheet ellipsise on a line of its own rather than push the pane
 * wide; the facts wrap to the next line.
 *
 * The facts are 13 px, the thread's fact scale — the same as an event line and
 * `StarRating size="sm"` — in `text-muted-foreground`, not the canvas's
 * tertiary: `--text-tertiary` measured below 4.5:1 on both surfaces
 * (`history-event-node.tsx`, `note-message.tsx`).
 */
function MessageHeader({
  name,
  rating,
  sourceDate,
  language,
}: Readonly<{
  name: string
  rating: number | null
  sourceDate: Date
  language: string | null
}>): ReactNode {
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[13px] text-muted-foreground">
      <h2 className="min-w-0 max-w-full truncate text-base font-semibold text-foreground">
        {name}
      </h2>
      {/* The deleted `RatingStars` returned null for a null rating and the
          shared primitive does not — a rating is a number or it is not
          rendered, and `StarRating` has no way to draw "no rating". So the
          guard is the caller's now, here, where the two meanings of a
          missing number are already known apart: a rating-only review has
          one, an expired snippet does not (plan row 7).

          `size="sm"` (13 px) is the thread's fact scale: a larger star stands
          taller than the text it belongs to. `tone="rating"` is the amber (v1
          row 12) — the primitive's default stays the foreground tone its
          notification caller shipped with, and the number printed beside it
          is what makes the amber's low light-theme contrast acceptable here
          and nowhere the stars stand alone (`star-rating.tsx`, `TONE_CLASS`).
          `showValue` prints `5.0` beside the glyphs, which is also the text
          equivalent: the primitive's hidden span narrows to `out of 5 stars`
          so the pair reads as one sentence instead of saying the number
          twice. */}
      {rating !== null && <StarRating value={rating} size="sm" tone="rating" showValue />}
      <time dateTime={new Date(sourceDate).toISOString()}>{formatDate(sourceDate)}</time>
      {language && <span>Review language: {language}</span>}
    </header>
  )
}

function UnavailableReview({ status }: Readonly<{ status: string | null }>): ReactNode {
  if (status !== 'expired' && status !== 'not_found') return null
  return (
    <p className="text-sm text-muted-foreground">
      {status === 'expired'
        ? 'Review content unavailable (source cache expired)'
        : 'Review content unavailable'}
    </p>
  )
}

/**
 * The half of the guest's two texts that is folded away — the original behind
 * `Original in Turkish`, or Google's translation behind `Google translation`.
 * Which one lands here is `presentGuestReviewBody`'s decision (plan row 8), so
 * this component states neither: it takes the label, the text and its language
 * together.
 *
 * `<details>` is kept deliberately. It is the disclosure this repo already uses
 * for supplementary prose (`property-insights-aspect-table.tsx`,
 * `google-performance-report.tsx`), and unlike a Radix `Collapsible` it leaves
 * the text in the DOM while closed — find-in-page reaches a review's original
 * words even when the translation is what is on screen.
 *
 * The label is a noun phrase and never an action (`guest-message-view.ts`,
 * `TRANSLATION_LABEL`): native `<details>` exposes expanded/collapsed on its
 * own, so the name only has to say WHAT is behind it to stay true both ways.
 *
 * `lang` is WCAG 3.1.2: `__root.tsx:83` sets the document to `en` or `bg`, and
 * a Turkish original read with that voice is unintelligible. It is the tag the
 * rule vouched for, or omitted — React drops an `undefined` attribute. `dir`
 * is `auto` rather than derived, because guest prose carries no reliable
 * direction metadata and the first strong character is the right judge for an
 * Arabic or Hebrew review (`REPLY_TEMPLATE_LANGUAGE_GROUPS` has both).
 *
 * The `<summary>` is a CONTROL — it toggles, it takes focus, it is the one
 * target on its line — so it takes row 20's 36 px: `min-h-9`. v1 gave it 44
 * (`min-h-11`) as its touch target; row 20 lowered the pane's controls to 36
 * because WCAG 2.5.8 AA asks for 24 px and 44 was what inflated the phone pane,
 * and PR 5's sweep is where this one moved. It is unprefixed, at every width,
 * as v1's was: the summary draws no box, so the desktop pane gains no visible
 * density from a smaller value, while a mouse still gets a generous row.
 * `min-h-`, as v1 had it, so the row still grows with its text rather than
 * clipping it.
 * Measured in Chromium against Storybook dev
 * (`inbox-thread--original-first-when-review-language-unknown`):
 * `Google translation` 44 px tall before, 36 after, at 390 and at 1440 alike.
 */
function ReviewDisclosure({
  disclosure,
}: Readonly<{ disclosure: GuestReviewDisclosure }>): ReactNode {
  return (
    <details className="w-fit max-w-full text-muted-foreground">
      <summary className="flex min-h-9 cursor-pointer items-center text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {disclosure.label}
      </summary>
      <p
        lang={disclosure.lang ?? undefined}
        dir="auto"
        className={cn(MESSAGE_PROSE_CLASS, 'pb-1 text-base leading-relaxed')}
      >
        {disclosure.text}
      </p>
    </details>
  )
}

/**
 * The review's prose, in the arrangement plan row 8 chose for it.
 *
 * The attribution line sits ABOVE the body, not under it. On both translation
 * branches the body is machine text, and a marker read after the prose
 * retro-labels words the reader has already taken as the guest's own; read
 * before them it is what it claims to be, a label. It also lands directly
 * under the header's `Review language: Turkish` fact, so both statements about
 * language sit together instead of straddling the paragraph.
 *
 * Line and body share a tight column of their own: the article's `gap-4` is the
 * rhythm between the header, the prose and the disclosure, and would read as
 * three separate things rather than a labelled one.
 */
function ReviewBody({
  view,
}: Readonly<{ view: Exclude<GuestReviewBodyView, { kind: 'no_text' }> }>): ReactNode {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        {view.translationLine && (
          <p className="text-xs text-muted-foreground">{view.translationLine}</p>
        )}
        {/* `bodyLang` is null whenever the body is Google's text: nothing
            records the translation's language, so it inherits the document's
            rather than claim one. See `ReviewDisclosure` for `lang` and `dir`. */}
        <p
          lang={view.bodyLang ?? undefined}
          dir="auto"
          className={cn(MESSAGE_PROSE_CLASS, 'text-base leading-relaxed')}
        >
          {view.body}
        </p>
      </div>
      {view.disclosure && <ReviewDisclosure disclosure={view.disclosure} />}
    </>
  )
}

type Props = Readonly<{
  item: InboxItem
  detail: InboxItemDetailResult | null
  reviewReplyLanguage?: string | null
}>

/**
 * The first message of the thread: what the guest said, and — for a review —
 * what it was about. The guest's identity moved here out of the pane header
 * (plan rows 2, 5), so the header carries the case and the thread carries the
 * conversation.
 *
 * Node zero of the rail (plan v2.1 row 10): this renders its own
 * `TimelineItem` — the guest's disc, the connector down to the first event,
 * and the article beside them — so `inbox-thread.tsx` maps every entry onto
 * one `Timeline` and the review is no longer split off above it. The article
 * holds exactly what it held before minus the avatar: header, the plan row 8
 * body, and the topic chips.
 */
export function GuestMessage({ item, detail, reviewReplyLanguage }: Props): ReactNode {
  if (!detail) return null

  if (item.sourceType === 'feedback') {
    // No name and no photo: private feedback carries neither, so the disc is
    // the person glyph (`GuestIndicator`) and the header prints the role noun.
    return (
      <GuestNode indicator={<GuestIndicator name={null} photoUrl={null} />}>
        <article aria-label="Guest feedback" className="flex min-w-0 flex-col gap-4">
          {/* Feedback's number is `feedbackRatingValue`, from the feedback
            lookup, and nothing else. `item.rating` cannot stand in for it:
            the detail read builds `item` through `inboxItemFromRow`, which
            sets `rating: null` for EVERY row, feedback included
            (`inbox.mapper.ts:37`, BQC-1.2), and `findDetailById` never writes
            it back (`inbox.repository.ts:778`, `:811`). */}
          <MessageHeader
            name={FEEDBACK_AUTHOR}
            rating={detail.feedbackRatingValue}
            sourceDate={item.sourceDate}
            language={null}
          />
          {detail.feedbackComment && (
            // No `lang`: feedback carries no language field at all. `dir="auto"`
            // for the same reason as the review's prose (`ReviewDisclosure`).
            <p
              dir="auto"
              className={cn(MESSAGE_PROSE_CLASS, 'text-base leading-relaxed')}
            >
              {detail.feedbackComment}
            </p>
          )}
        </article>
      </GuestNode>
    )
  }

  const reviewerName = resolveReviewerName(detail)
  /**
   * The review's language as a CANONICAL tag (`tr-TR` → `tr-Latn-TR`), which
   * `get-inbox-item-detail.ts:184-188` derived from `item.reviewLanguageCode`.
   * `InboxThread` passes the payload's own value down as a prop today; reading
   * the payload when a caller omits it keeps the two spellings from drifting,
   * and costs one `??`. It matters twice below — the header names the language
   * with it, and plan row 8's comparison can only use the canonical form.
   */
  const reviewLanguageTag = reviewReplyLanguage ?? detail.reviewReplyLanguage
  const language = languageDisplayName(reviewLanguageTag ?? item.reviewLanguageCode)
  /**
   * Plan row 8's rule, decided outside React so it can be tested without one
   * (`guest-message-view.ts`). Row 8 says `GuestMessage` gains the property's
   * default reply language; it is already on the payload this component holds
   * (`get-inbox-item-detail.ts:178-182`), so it is READ rather than added as a
   * prop — a prop would have to be threaded through `inbox-thread.tsx`, which
   * PR 3 rewrites, for a value that arrives here anyway.
   */
  const body = presentGuestReviewBody({
    reviewText: detail.reviewText,
    reviewTranslatedText: detail.reviewTranslatedText,
    reviewContentStatus: detail.reviewContentStatus,
    reviewLanguageTag,
    reviewLanguageCode: item.reviewLanguageCode,
    propertyDefaultReplyLanguage: detail.propertyDefaultReplyLanguage,
  })

  const indicator = (
    // Keyed on the photo so a different reviewer clears a previous image's load
    // failure instead of inheriting the initials fallback. The disc takes the
    // RAW name, not `reviewerName`: the resolved placeholder is the pane's
    // sentence about a missing name, and has no initials of its own.
    <GuestIndicator
      key={detail.reviewerProfilePhotoUrl ?? reviewerName}
      name={detail.item.reviewerName}
      photoUrl={detail.reviewerProfilePhotoUrl}
    />
  )

  return (
    <GuestNode indicator={indicator}>
      <article aria-label="Guest review" className="flex min-w-0 flex-col gap-4">
        <MessageHeader
          name={reviewerName}
          /* Plan row 7. `detail.reviewRating` is the rating carried from the same
           `ReviewSnippet` as `reviewText`, so it is null for exactly the same
           reasons the words are: `expired`, `not_found`, or a review that
           carried no score. It is the ONLY source.

           Row 7 as written reads `detail.reviewRating ?? item.rating`. The
           right-hand side is a constant null here, not a fallback:
           `use-inbox-detail.ts:232` makes the pane's `item` the DETAIL's item
           whenever `detail` exists (and this component has returned above when
           it does not), and the detail read builds that item through
           `inboxItemFromRow`, which sets `rating: null` for every row
           (`inbox.mapper.ts:37`, "Legacy column values must not be served").
           The one place a row DOES carry a rating is the list projection
           (`inbox.repository.ts:433`), and that object never reaches here.
           Reading it anyway would only matter the day someone re-adds a
           rating to the detail item — and then it would print stars beside an
           `expired` snippet, which BQC-1.2 forbids. So it is not read.

           `?? null` only collapses the key's absence: the type keeps it
           optional for fixtures that predate it (`domain/types.ts`), and
           `getInboxItemDetail` already sends `null` rather than omit it. */
          rating={detail.reviewRating ?? null}
          sourceDate={item.sourceDate}
          language={language}
        />

        {body.kind === 'no_text' ? (
          /* The view deliberately carries no reason for its silence: which
           sentence a textless review earns is `reviewContentStatus`'s to say,
           and a rating-only available review earns none at all. */
          <UnavailableReview status={detail.reviewContentStatus} />
        ) : (
          <ReviewBody view={body} />
        )}

        <TopicChips analysis={detail.analysis} />
      </article>
    </GuestNode>
  )
}

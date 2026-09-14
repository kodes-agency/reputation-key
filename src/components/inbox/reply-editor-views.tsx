// Inbox detail — the edit-and-republish editor for a reply that already
// reached Google, plus the open-focus hook every reply editing surface shares.
// The read-only views that used to share this file (`ReviewReplyApproved`,
// `ReviewReplyPublished`, `ReviewReplyMirror`) are gone: every read-only reply
// state is one message in the thread now, rendered by `reply-message.tsx`.
//
// The hook lives here because this is the only editor module nothing else in
// the editor chain imports, so `reply-status-view.tsx` can reach it without a
// cycle — for the composer it routes to as well as for the editor below.

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import {
  MAX_REPLY_LENGTH,
  unfilledReplySlotsMessage,
} from '#/contexts/review/application/public-api'
import { putCaretIn } from './composer-caret'
import {
  DOCK_FOOT_ROW_CLASS,
  DOCK_SURFACE_CLASS,
  DOCK_TEXT_ROW_CLASS,
  DOCK_TEXTAREA_CLASS,
} from './composer-dock-rows'

/**
 * Puts the caret in a reply editing surface as it opens, and brings it just
 * far enough into view to be seen.
 *
 * Every one of these surfaces mounts at the FOOT of the pane's scroller, in a
 * different subtree from the thread button that opened it — routinely below
 * the fold on an item with any handling history, so without this the click
 * reads as "nothing happened". On the rejected path the trigger is worse than
 * far away: reopening drafts the reply, which re-resolves the message to
 * `compose` and unmounts the very button that was focused, dropping focus to
 * `<body>`.
 *
 * `active` is a real dependency rather than a guard read once at mount: that
 * same rejected path mounts the composer on the commit that lands the drafted
 * reply in the cache, one commit BEFORE the pane raises its edit target, so
 * the focus has to follow the flag rather than the mount.
 *
 * Revealing it goes through `putCaretIn`, which moves region 4's own scroller
 * and refuses to touch anything above it. This used to be
 * `focus({ preventScroll: true })` followed by
 * `field.scrollIntoView({ block: 'nearest' })`, and that second call scrolled
 * the wrong box: `scrollIntoView` walks EVERY scrollable ancestor, an
 * `overflow: hidden` box is still programmatically scrollable, and the pane's
 * column is exactly that — so opening this editor scrolled region 1 (the
 * header: Close detail, Escalate / Resolve, the copy menu) and region 2 (the
 * case strip) off the top of a box with no scrollbar, no wheel and no touch to
 * bring them back. The reply half of the same defect was fixed in
 * `reply-status-view.tsx`; this is the published-editor half, and unlike that
 * one this surface pins no scroller of its own, so the region's backstop is
 * the box that moves.
 */
export function useEditorOpenFocus(active = true) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const field = ref.current?.querySelector('textarea')
    if (!field) return
    putCaretIn(field)
  }, [active])
  return ref
}

/** The reply as this editor needs it. The two fields it does not read are the
 *  shape the pane's other reply surfaces share, so one literal fits them all. */
type ReplyView = Readonly<{
  text: string
  publishedAt: Date | null
  rejectionReason: string | null
}>

/**
 * Inline editor for a published reply (edit-and-republish). Saving re-enters
 * the durable publication machine — the provider update is an upsert, so the
 * Google-visible reply is updated in place, never duplicated.
 */
export function ReviewReplyPublishedEditor({
  reply,
  isSaving,
  onSave,
  onCancel,
}: Readonly<{
  reply: ReplyView
  isSaving: boolean
  onSave: (text: string) => Promise<unknown>
  onCancel: () => void
}>) {
  const [text, setText] = useState(reply.text)
  const charCount = text.length
  const isOverLimit = charCount > MAX_REPLY_LENGTH
  const publishBlockedReason = unfilledReplySlotsMessage(text)
  const publishBlockedReasonId = useId()
  // Per instance, not the module constant it used to be: the desktop panel is
  // `hidden md:flex` rather than unmounted, so a fixed id could in principle be
  // in the document twice and point the second field's label at the first.
  const headingId = useId()
  // Split from `isSaving` on purpose: these are the reasons the manager can do
  // something about, and the trigger has to stay reachable to say so.
  const isBlocked =
    text.trim().length === 0 || isOverLimit || publishBlockedReason !== null
  const canSave = !isBlocked && !isSaving
  // This editor exists only because someone pressed Edit reply, so it always
  // takes the focus on mount.
  const openRef = useEditorOpenFocus()

  return (
    // The dock's two writing rows (plan v2.1 row 14, `composer-dock-rows.ts`).
    // This root was a `space-y-3` block — a block box, `min-height: auto` — so
    // region 4's cap could not reach the textarea, and a long live edit at
    // 320x568 put `Review update` 57 px below the viewport. As the surface's
    // column, the text row now absorbs the deficit and the foot keeps the
    // primary on screen. The textarea also drops its own box: inside the dock
    // it drew a second edge, and the count sat on the dock's left border.
    <div ref={openRef} className={DOCK_SURFACE_CLASS}>
      {/* No `border-t pt-4`, no visible heading and no `Republishes to Google`
          badge any more. This editor opens INSIDE region 4
          (`reply-composer.tsx`), whose `REGION_CLASS` already draws the rule
          above it — so the border was a second, inset rule — and whose row-9
          editing band already says the fact once, in the one line it exists to
          be: "Editing a live reply · republishes to Google". Heading plus badge
          plus band stated it three times under two rules. Same reasoning, and
          the same `border-t`, as `reply-form.tsx`.

          The heading itself survives as the field's LABEL only. The band's id
          is not reachable from here: `reply-composer.tsx` mints `bandId` with
          `useId()` and hands it to `ComposerModeRow` as `lockedById` and to
          nothing in the reply slot, and the slot is an opaque `ReactNode` built
          by the pane. Re-pointing `aria-labelledby` at the band therefore needs
          the region to thread that id into the slot (see the PR report). Until
          it does, `sr-only` is the right trade: an unlabelled textarea — a
          screen reader announcing "edit text" and nothing about which reply is
          being republished to Google — is worse than a sentence no sighted
          reader ever sees. It also keeps the field's accessible name exactly
          `Edit published reply`, which `reply-composer.stories.tsx` and
          `reply-form.stories.tsx` both query by. */}
      <div className={DOCK_TEXT_ROW_CLASS}>
        <h2 id={headingId} className="sr-only">
          Edit published reply
        </h2>
        <Textarea
          aria-labelledby={headingId}
          className={DOCK_TEXTAREA_CLASS}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          disabled={isSaving}
        />
      </div>
      <div className={DOCK_FOOT_ROW_CLASS}>
        <span
          className={`px-1.5 text-xs tabular-nums ${isOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {charCount}/{MAX_REPLY_LENGTH}
        </span>
        <div className="ml-auto flex gap-2">
          {/* 36 px on mobile (row 20), matching the mode segment
              (`composer-mode-row.tsx`) and every other control in the dock's
              foot. v1's row 15 raised these to 44; row 20 lowered the rule to
              36 because WCAG 2.5.8 AA asks for 24 and 44 inflated the strip. */}
          <Button
            size="sm"
            variant="ghost"
            className="max-md:h-9"
            disabled={isSaving}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                // The same rule the thread message's Confirm & Publish follows:
                // a natively disabled button leaves the tab order and takes its
                // `aria-describedby` with it, so the one sentence naming the
                // unfilled placeholder becomes reachable by no keyboard and no
                // screen reader. Blocked stays focusable and refuses the click;
                // `isSaving` keeps the native attribute, because it has nothing
                // to explain and nothing the reader can act on.
                disabled={isSaving}
                aria-disabled={isBlocked}
                // The look the native attribute used to carry, kept on the
                // states that no longer set it, plus row 20's mobile target.
                className="aria-disabled:opacity-50 max-md:h-9"
                aria-describedby={
                  publishBlockedReason !== null ? publishBlockedReasonId : undefined
                }
                // `AlertDialogTrigger` composes this ahead of its own handler
                // and honours a prevented default, so the dialog stays shut.
                onClick={(event) => {
                  if (isBlocked) event.preventDefault()
                }}
              >
                Review update
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm and update this Google reply?</AlertDialogTitle>
                <AlertDialogDescription>
                  This records your confirmation and starts replacing the current Google
                  reply with the exact text shown here. RepKey keeps the update pending
                  until Google confirms it is live.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {/* No class, for the reason the publish confirmation in
                    `reply-message-actions.tsx` gives: the primitive's own
                    `size="default"` is 36 px, which is row 20's control height
                    below `md`. v1's row 15 raised this pair — the confirm and
                    cancel for republishing to Google, one tap from the
                    composer — to 44 at the call site (`max-md:h-11`, 36 → 44
                    at 390 and 320); row 20 lowers it back to the primitive's
                    own 36, so the override is deleted rather than re-spelled.
                    Measured in Chromium against Storybook dev
                    (`inbox-mobile-390--composer-editing-a-live-reply`, dialog
                    open) at 390 and 320: 44 px tall before, 36 after. */}
                <AlertDialogCancel>Keep editing</AlertDialogCancel>
                <AlertDialogAction
                  disabled={!canSave}
                  onClick={() => void onSave(text).catch(() => undefined)}
                >
                  {isSaving ? 'Confirming…' : 'Confirm & Update'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {/* NOT a live region. This paragraph mounts with its own content the
          moment the text contains an unfilled slot, and a live region announces
          only what changes AFTER it is being watched — so `role="status"` here
          announced nothing while costing the description its only route to the
          reader. The id and the trigger's `aria-describedby` are that route.
          In the foot, on a line of its own (`basis-full`), directly under the
          button it describes. */}
        {publishBlockedReason !== null && (
          <p
            id={publishBlockedReasonId}
            className="basis-full px-1.5 text-xs text-destructive"
          >
            {publishBlockedReason}
          </p>
        )}
      </div>
    </div>
  )
}

import {
  approvedReplyStateCopy,
  REPLY_CHIP_WORDS,
  REPLY_STATE_COPY,
  replyStateDescription,
} from './reply-state-copy'
// `import type` in a `typeof` position: `ResolvedReplyView` is not exported
// from `reply-status-view.tsx`, but the function that returns it is, and this
// file must stay free of any runtime import from a `.tsx` module so the unit
// test never loads the editor tree.
import type { resolveReplyView } from './reply-status-view'

/** The nine-variant union `resolveReplyView` returns. */
export type ResolvedReplyView = ReturnType<typeof resolveReplyView>

/** The reply exactly as a rendered thread message receives it. */
type ReplyEntity = Extract<ResolvedReplyView, { kind: 'pending' }>['reply']

export type ReplyMessageAction =
  'approve' | 'reject' | 'check' | 'retry' | 'editPublished' | 'editRejected'

export type ReplyMessageTone = 'neutral' | 'positive' | 'negative' | 'accent'

export type ReplyMessageView = Readonly<{
  chip: string
  tone: ReplyMessageTone
  /** Timestamp-only meta. NEVER a person's name — none exists in the payload. */
  meta: { label: string; at: Date } | null
  /**
   * RepKey's own sentence about this reply — what the publication machine is
   * doing, or what it stopped on. Always product copy, never a person's words.
   */
  detail: string | null
  /**
   * A COLLEAGUE's words: the reason a reply was refused. Kept apart from
   * `detail` so the render site can attribute it. Rendered in the same muted
   * slot, an authored sentence is indistinguishable from RepKey speaking.
   */
  reason: string | null
  actions: readonly ReplyMessageAction[]
}>

/**
 * The mirror's meta keeps the meaning of the copy it replaces (`Observed: …  —
 * via Google Business Profile`): this reply was seen on Google, not sent from
 * here, and the timestamp is an observation rather than a publication RepKey
 * performed.
 */
const MIRROR_META_LABEL = 'Observed via Google Business Profile'

/**
 * A server fn serializes a `Date` over the wire, so the runtime value can be a
 * string while the type still says `Date` — the guard every inbox component
 * carries. A missing milestone is no meta line at all; the pane never prints a
 * label with nothing after it.
 */
function meta(label: string, at: Date | string | null): ReplyMessageView['meta'] {
  return at === null ? null : { label, at: new Date(at) }
}

/**
 * A publish failure that is safe to send again. Retry is its ONLY action: no
 * server path changes the text of a `publish_failed` reply. `editPublishedReply`
 * refuses anything but `published` (`reply-operations.ts`), and
 * `REPLY_TRANSITIONS.publish_failed` has no `draft` (`domain/rules.ts`), so it
 * cannot be re-drafted either. An Edit reply here would open an editor headed
 * "Edit published reply" whose every save fails into a toast.
 */
function failedRetryView(reply: ReplyEntity): ReplyMessageView {
  const copy =
    reply.publicationLastErrorClass === 'terminal_rejection'
      ? REPLY_STATE_COPY.terminal_rejection
      : REPLY_STATE_COPY.retryable
  return {
    chip: REPLY_CHIP_WORDS.notPublished,
    tone: 'negative',
    // There is no `failedAt`; the confirmation is the last milestone this
    // reply actually reached, and the detail below says what happened after.
    meta: meta('Confirmed', reply.approvedAt),
    detail: replyStateDescription(copy, reply.publicationAttempts),
    reason: null,
    actions: ['retry'],
  }
}

/**
 * One reply, one message shape (plan row 6). `null` means the thread renders
 * nothing: a draft — and the absence of a reply — lives in the composer, never
 * in the thread, so a manager is never editing one thing in two places.
 *
 * `accent` is the tone for "this reply is waiting on a person here", which is
 * true of exactly `pending` and `failed-check`. It is deliberately not
 * `negative`: an ambiguous publication may well be live on Google, and red
 * would assert a failure the domain says is unknown.
 */
export function presentReplyMessage(view: ResolvedReplyView): ReplyMessageView | null {
  switch (view.kind) {
    case 'compose':
    case 'none':
      return null
    case 'pending':
      return {
        chip: REPLY_CHIP_WORDS.awaitingApproval,
        tone: 'accent',
        meta: meta('Submitted', view.reply.submittedAt),
        detail: null,
        reason: null,
        actions: ['approve', 'reject'],
      }
    case 'approved':
      return {
        chip: REPLY_CHIP_WORDS.waitingForGoogle,
        tone: 'neutral',
        meta: meta('Confirmed', view.reply.approvedAt),
        // One chip covers five publication states, so the stage the machine is
        // in is the description's job — and this is its only renderer. Without
        // it nothing separates `approved` (nothing attempted yet) from
        // `pending_observation` (Google already accepted it).
        detail: replyStateDescription(
          approvedReplyStateCopy(view.reply.publicationState),
        ),
        reason: null,
        actions: [],
      }
    case 'published':
      return {
        chip: REPLY_CHIP_WORDS.liveOnGoogle,
        tone: 'positive',
        meta: meta('Live on Google', view.reply.publishedAt),
        detail: null,
        reason: null,
        actions: ['editPublished'],
      }
    case 'mirror':
      return {
        chip: REPLY_CHIP_WORDS.liveOnGoogle,
        tone: 'positive',
        meta: meta(MIRROR_META_LABEL, view.reply.publishedAt),
        detail: null,
        reason: null,
        // Editing a Google-authored reply from here is a future feature.
        actions: [],
      }
    case 'failed-check':
      return {
        chip: REPLY_CHIP_WORDS.needsCheck,
        tone: 'accent',
        meta: meta('Confirmed', view.reply.approvedAt),
        // The one sentence a manager must read before touching this reply:
        // RepKey will only ever re-read Google, never send a second copy.
        detail: replyStateDescription(REPLY_STATE_COPY.ambiguous),
        reason: null,
        actions: ['check'],
      }
    case 'failed-retry':
      return failedRetryView(view.reply)
    case 'rejected':
      return {
        chip: REPLY_CHIP_WORDS.rejected,
        tone: 'negative',
        // `ReplyView` carries `rejectedBy` but no `rejectedAt`; `updatedAt` is
        // the only field that moved when the rejection was recorded.
        meta: meta('Rejected', view.reply.updatedAt),
        detail: null,
        // An empty reason is no reason: it must not open a blank line under
        // the reply that reads as a redaction.
        reason: view.reply.rejectionReason || null,
        actions: ['editRejected'],
      }
  }
}

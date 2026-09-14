// The words of one Handling History entry, as PARTS a renderer can weight (plan
// v2.1 row 11). Pure: no JSX, no React, no clock — `history-event-node.tsx`
// owns the icon, the time and the markup.
//
// Why parts and not a sentence. v1's `history-event-row.tsx` built a finished
// string and the row tacked the actor on after it — `Assigned to Georgi Ivanov
// · Maria Petrova · 20h ago` — so the one word that says WHO sat in the same
// muted run as the time, and the reader had to parse the sentence to find the
// person twice. Row 11 reads actor · verb · object: `Maria Petrova assigned this
// to Georgi Ivanov · 20h ago`, the two people at `font-medium text-foreground`
// and the verb muted. A renderer can only weight what it can tell apart, so the
// builders stop concatenating.
//
// The capital is part of the contract, not of the markup. A line that has an
// actor leads with the name, so its verb is lower case; a line without one leads
// with the verb, which carries the capital. Every builder decides that here,
// through `verbFor`, so no renderer ever upper- or lower-cases a string it did
// not write — and the tests can assert the exact words a reader sees.
//
// The actor-less wording of every sentence is v1's, word for word. That is the
// vocabulary the stories and e2e specs already read (`Reopened — new
// information` is asserted verbatim by `activity-notification-facts.spec.ts`),
// so an entry with no actor renders exactly the text it rendered before. The
// actor-led form is that wording with its first letter lowered, EXCEPT where the
// lowered form is not English:
//
//   | alone (no actor)              | led (after a name)                |
//   | ----------------------------- | --------------------------------- |
//   | `Assigned to` + name          | `assigned this to` + name         |
//   | `Unassigned`                  | `unassigned this`                 |
//   | `Assigned to` + name (claim)  | `claimed this`                    |
//   | `Escalated`                   | `escalated this`                  |
//   | `Closed` / `Closed — <why>`   | `closed this` / `closed this — …` |
//   | `Reopened` (no reason)        | `reopened this`                   |
//   | `Escalation resolved`         | `resolved the escalation`         |
//   | `Outcome corrected — <label>` | `corrected the outcome — <label>` |
//
// A transitive verb keeps its object after a name: `Maria Petrova escalated`
// reads as something done TO her, and `Maria Petrova closed` as a shop at night.
// The first two are row 11's example and its release; the third is a claim,
// where the actor and the holder are one person; the last two are noun phrases,
// which cannot take a subject (`Maria Petrova escalation resolved`). A release
// the system made for lost eligibility has no led form at all: it never names
// the person whose command triggered it (`assignmentLine`).
// `Reopened — …` keeps its words after a name (`Maria Petrova reopened — new
// information`), so the pinned phrase survives as a contiguous run of the
// rendered text.

import {
  feedbackHandlingOutcomeLabel,
  presentFeedbackHandlingOutcomeEvent,
} from './feedback-handling-presentation'
import type { InboxHistoryEntry } from './inbox-thread-model'
import type { ManualReopenReason } from '#/contexts/inbox/application/public-api'

type InboxHistoryDetail = InboxHistoryEntry['detail']
type DetailOf<K extends InboxHistoryDetail['kind']> = Extract<
  InboxHistoryDetail,
  { kind: K }
>

/**
 * One entry's words, in the order a reader meets them.
 */
export type HistoryEventLine = Readonly<{
  /**
   * The person who acted, or `null` — in which case the line starts at `verb`.
   *
   * Null for three reasons the renderer need not tell apart: a backfilled row
   * (`redactLegacyActor`, `domain/handling-history.ts:176`, strips the name and
   * `historyEventLine` strips it again); an event no person caused (the
   * source-originated openings, a transition whose `actorType` is not `user`,
   * and any row the server wrote with no `actorUserId`); and a person whose
   * display name did not resolve. The raw `actorUserId` is never a fallback for
   * a missing name.
   */
  actor: string | null
  /**
   * The verb phrase, capitalised exactly when `actor` is null. Reasons ride
   * inside it (`closed — the guest withdrew`): the canvas draws a close or a
   * reopen as one muted run, and only a person is weighted.
   */
  verb: string
  /** The person acted UPON — today only an assignee. Weighted like the actor. */
  object: string | null
  /**
   * A qualifier that follows the sentence inside the same muted run — a quiet
   * clause, not a chip, because every row here is one line. Only a first
   * handling outcome has one, so it is optional rather than a `null` the other
   * builders would each have to repeat.
   */
  clause?: string | null
  /** A manager's free text, rendered under the line. */
  body: string | null
  /**
   * The body is a manager-internal note and must be marked as one, the way
   * `note-message.tsx` marks the only other text of this class in the thread.
   *
   * It is a property of the LINE BUILDER, not of the note: `outcomeLine` sets
   * it for every outcome row it returns, with or without a note, so the flag
   * itself carries no evidence that a note exists. The marker is rendered
   * inside `body`'s own paragraph and only when there is a `body`, so an
   * outcome whose note is absent renders byte for byte what an outcome that
   * never had one renders.
   */
  internal?: boolean
}>

type Actor = string | null

// The three maps below are total over today's unions, but an unknown key is
// reachable *without a client deploy*: the repository casts `openedReason`,
// `manualReopenReason` and `outcome` straight out of `varchar` columns
// (`inbox-history.repository.ts`), and the union is enforced only by a DB CHECK
// constraint. A migration that widens one ships server-side while a manager's
// cached bundle still runs this file. So every lookup is guarded and an unknown
// value returns `null` from its line builder — the same rule the file states
// for a sixth `kind`: silence, not a row that names a person and asserts
// nothing, and never `Reopened — undefined`.
const OPENED_SENTENCES = {
  // A backfilled row proves the episode existed and nothing else, so it must
  // not name a source it does not know.
  legacy_backfill: 'Earlier handling',
  review_observed: 'Opened from Google',
  feedback_submitted: 'Opened from guest feedback',
  material_revision_changed: 'Reopened — the review was edited',
  manual_reopen: 'Reopened',
  provider_reply_deleted: 'Reopened — the reply was removed from Google',
  provider_reply_diverged: 'Reopened — the reply on Google no longer matches',
} as const satisfies Readonly<Record<DetailOf<'cycle_opened'>['openedReason'], string>>

const MANUAL_REOPEN_WORDS = {
  guest_follow_up_still_needed: 'guest follow-up still needed',
  internal_follow_up_still_needed: 'internal follow-up still needed',
  new_information: 'new information',
  correcting_handling_status: 'correcting the handling status',
  other: 'another reason',
} as const satisfies Readonly<Record<ManualReopenReason, string>>

// `transitionReason` is a plain `string` on the wire, not a union, so this is a
// lookup with a fallback rather than an exhaustive map.
const CLOSE_REASON_WORDS: Readonly<Record<string, string>> = {
  confirmed_on_google: 'the reply is confirmed on Google',
  external_reply_observed: 'a reply was already on Google',
  guest_withdrawn: 'the guest withdrew',
  private_feedback_handled: 'the feedback was handled',
  source_ineligible: 'the source is no longer eligible',
  superseded_by_source_revision: 'a newer version superseded it',
}

/** The words of the lower-cased form, for a verb phrase that follows a name. */
/**
 * An own-property lookup. The three maps above are plain object literals, and a
 * bare `MAP[key]` finds `Object.prototype` too: a `varchar` that reads
 * `constructor` or `toString` would pass a truthiness guard and render
 * `function Object() { [native code] }` as a sentence. The file promises that
 * an unknown value is silence; this is what makes an inherited name unknown.
 */
function ownWord<K extends string>(
  map: Readonly<Partial<Record<K, string>>>,
  key: string,
): string | undefined {
  return Object.hasOwn(map, key) ? map[key as K] : undefined
}

function lowerFirst(words: string): string {
  return words.charAt(0).toLowerCase() + words.slice(1)
}

/**
 * The verb phrase in the form the line's lead demands: `alone` when nobody is
 * named (it carries the capital, and it is v1's sentence verbatim), `led` after
 * a name. `led` defaults to `alone` with its first letter lowered, which is
 * right for every participle here (`Closed`, `Reopened`, `Escalated`,
 * `Handled`); a noun phrase passes its own.
 */
function verbFor(actor: Actor, alone: string, led: string = lowerFirst(alone)): string {
  return actor === null ? alone : led
}

function closeReasonWords(raw: string): string | null {
  // A backfilled close knows no reason; naming one would invent it.
  if (raw === 'legacy_backfill') return null
  const known = ownWord(CLOSE_REASON_WORDS, raw)
  if (known) return known
  const humanised = raw.replaceAll('_', ' ').trim().toLowerCase()
  return humanised.length > 0 ? humanised : null
}

function cycleOpenedLine(
  detail: DetailOf<'cycle_opened'>,
  actor: Actor,
): HistoryEventLine | null {
  if (detail.openedReason === 'manual_reopen') {
    const reason = detail.manualReopenReason
    if (!reason) {
      return {
        actor,
        verb: verbFor(actor, OPENED_SENTENCES.manual_reopen, 'reopened this'),
        object: null,
        body: detail.manualReopenExplanation || null,
      }
    }
    const words = ownWord(MANUAL_REOPEN_WORDS, reason)
    if (!words) return null
    return {
      actor,
      verb: verbFor(actor, `Reopened — ${words}`),
      object: null,
      body: detail.manualReopenExplanation || null,
    }
  }
  const sentence = ownWord(OPENED_SENTENCES, detail.openedReason)
  if (!sentence) return null
  // Every other opening names its own agent in its words — Google, the guest,
  // the provider, an edit — and no person caused it: the first cycle is written
  // with `openedBy: null` (`domain/handling-cycles.ts:82`), and so is every
  // automatic reopen (`inbox-command-store.ts:797`, `:1192`, `:1295`, `:3163`).
  // Only a manual reopen writes a user (`:1692`, `:2282`), and the domain
  // refuses one without (`handling-cycles.ts:164`). So the line takes no actor
  // here even if a row arrives carrying one: `Ada Lovelace opened from Google`
  // would credit a manager with the review.
  return { actor: null, verb: sentence, object: null, body: null }
}

function cycleTransitionLine(
  detail: DetailOf<'cycle_transition'>,
  rowActor: Actor,
): HistoryEventLine | null {
  // Every opening writes a `cycle_opened` row at the same instant carrying
  // strictly more (the reopen reason, the explanation, the superseded cycle);
  // rendering the transition it produced would show one event twice.
  if (detail.transition === 'opened') return null
  // A transition says who moved it in its own field, and the domain pins the
  // name to it: `closeHandlingCycle` refuses `actorType === 'user'` without an
  // `actorUserId` and any other type with one (`handling-cycles.ts:371`). So a
  // guest's withdrawal, a provider's confirmation and a system close name
  // nobody, even if a row reaches this client carrying a name — `Ada Lovelace
  // closed — the guest withdrew` would put a manager's name on the guest's act.
  // `actorType` is cast out of a `varchar` too, so an unknown type names nobody
  // either: the sentence stays true without the person.
  const actor = detail.actorType === 'user' ? rowActor : null
  if (detail.transition === 'reopened') {
    return {
      actor,
      verb: verbFor(actor, 'Reopened', 'reopened this'),
      object: null,
      body: null,
    }
  }
  const words = closeReasonWords(detail.transitionReason)
  return {
    actor,
    verb: words
      ? verbFor(actor, `Closed — ${words}`, `closed this — ${words}`)
      : verbFor(actor, 'Closed', 'closed this'),
    object: null,
    body: null,
  }
}

/**
 * An assignment row's `actorUserId` is the person whose command WROTE the row,
 * which is not always the person the sentence would make its subject. Row 11
 * turns the actor into the grammatical subject of the verb, where v1 only put a
 * name after the sentence (`Unassigned · Maria Petrova`), so the reason decides
 * whether that subject is true:
 *
 * - `eligibility_lost` is a release the SYSTEM made. The row carries whoever
 *   triggered it — the admin removing a member, on every item that member held
 *   (`composition/member-authority-lifecycle.ts:80` → `inbox-command-store.ts
 *   :1908`), or the manager reopening an item whose holder can no longer take
 *   it (`:1755` bulk, `:2396` single). `Ada Lovelace unassigned this` would credit Ada with
 *   a release on items she never opened, and a manual reopen would read
 *   `Maria Petrova reopened — new information` over `Maria Petrova unassigned
 *   this`. So the line names nobody and says why instead, in the register of
 *   `Closed — the source is no longer eligible` — the same rule
 *   `cycleTransitionLine` applies to a non-user transition and
 *   `cycleOpenedLine` to an automatic opening.
 * - `claim` is written only when the new holder IS the actor (`:1476` bulk,
 *   `:2768` single), so `Ada Lovelace assigned this to Ada Lovelace` is true
 *   but reads like a mistake. Led, it is `claimed this`. Compared by id, not by
 *   name: two members may share a display name, and a row whose ids disagree
 *   is not one this reason's writers produce, so it falls back to the plain
 *   assignment, which stays true whoever the two are. Alone, a claim keeps
 *   v1's `Assigned to <holder>`, which still says who holds it.
 */
function assignmentLine(
  detail: DetailOf<'assignment'>,
  actor: Actor,
  actorUserId: InboxHistoryEntry['actorUserId'],
): HistoryEventLine {
  if (detail.reason === 'eligibility_lost') {
    return {
      actor: null,
      verb: 'Unassigned — the assignee is no longer eligible',
      object: null,
      body: null,
    }
  }
  if (detail.nextAssignee === null) {
    return {
      actor,
      verb: verbFor(actor, 'Unassigned', 'unassigned this'),
      object: null,
      body: null,
    }
  }
  if (
    actor !== null &&
    detail.reason === 'claim' &&
    detail.nextAssignee === actorUserId
  ) {
    return { actor, verb: 'claimed this', object: null, body: null }
  }
  // A null display name means the member left the Organization OR simply has no
  // name set, so the placeholder must not claim either one — it stays opaque.
  // 'Unknown user' is the established copy (IBX-01-T6, note-message.tsx,
  // inbox-actor-directory.port.ts:16), and the same unresolved person must not
  // read one way on their note and another way on their assignment row. The raw
  // id is never a fallback.
  return {
    actor,
    verb: verbFor(actor, 'Assigned to', 'assigned this to'),
    object: detail.nextAssigneeDisplayName ?? 'Unknown user',
    body: null,
  }
}

function escalationLine(detail: DetailOf<'escalation'>, actor: Actor): HistoryEventLine {
  // No guard needed: the repository normalises the column to exactly these two
  // values before the row leaves the server (`inbox-history.repository.ts:232`).
  const verb =
    detail.escalation === 'escalated'
      ? verbFor(actor, 'Escalated', 'escalated this')
      : verbFor(actor, 'Escalation resolved', 'resolved the escalation')
  return { actor, verb, object: null, body: null }
}

function outcomeLine(
  detail: DetailOf<'handling_outcome'>,
  actor: Actor,
): HistoryEventLine | null {
  // `supersedesOutcomeId`, not `outcomeRevision`, decides whether this entry is
  // a first completion or a correction: it is the field that literally names the
  // outcome being replaced. The two agree today only because the domain derives
  // the revision from the previous fact; reading the discriminator directly
  // keeps the sentence honest if a backfill ever lands a cycle whose first
  // outcome does not start at revision 1.
  const presented = presentFeedbackHandlingOutcomeEvent(detail)
  if (!presented) return null
  // The presenter stays the source of the actor-less sentence — the words the
  // feedback pane's stories read. Only the correction's led form needs the bare
  // label, because `outcome corrected` cannot follow a name. The presenter
  // already returned null for a label this build cannot spell, so this second
  // guard only restates that for the compiler.
  const label = feedbackHandlingOutcomeLabel(detail.outcome)
  if (!label) return null
  const led =
    detail.supersedesOutcomeId === null
      ? lowerFirst(presented.sentence)
      : `corrected the outcome — ${label}`
  // `internalNote` is absent — not null, not empty — both when no note was
  // recorded and when this reader may not see one, so presence is the only safe
  // test and there is no "withheld" affordance to render either way. The
  // sentence, the clause and `internal` above are all computed without it, so an
  // unauthorized read renders a row of exactly the same shape as an authorized
  // read of an outcome that carried no note.
  //
  // `internal` is unconditional for that reason. This is the one body in the
  // thread the guest may never see — the deleted `feedback-handling-card.tsx`
  // put a lock on it and this render inherited the text without the marker, so
  // the note sat in the same column and the same muted style as the guest's own
  // message with nothing saying whose eyes it was for.
  return {
    actor,
    verb: verbFor(actor, presented.sentence, led),
    object: null,
    clause: presented.deadlineClause,
    // `||`, not `??`: an empty note is no note, so the node draws no lock beside
    // an empty paragraph.
    body: ('internalNote' in detail && detail.internalNote) || null,
    internal: true,
  }
}

/**
 * The parts for one entry, or `null` when this build cannot say what happened —
 * an unknown enum value, a sixth kind, or the `opened` transition a
 * `cycle_opened` row already tells. A caller renders nothing for `null`: not an
 * empty node, not a timestamp beside no sentence.
 */
export function historyEventLine(entry: InboxHistoryEntry): HistoryEventLine | null {
  // `redactLegacyActor` already nulls a backfilled row's name on the server;
  // this repeats it so a row cached before the redaction, or a server that
  // forgot, still cannot print one. An empty name is no name: v1's row tested
  // the actor for truthiness, and a line that led with `''` would open on a
  // lower-case verb after nothing.
  const actor = entry.legacy || !entry.actorDisplayName ? null : entry.actorDisplayName
  const { detail } = entry
  switch (detail.kind) {
    case 'cycle_opened':
      return cycleOpenedLine(detail, actor)
    case 'cycle_transition':
      return cycleTransitionLine(detail, actor)
    case 'assignment':
      return assignmentLine(detail, actor, entry.actorUserId)
    case 'escalation':
      return escalationLine(detail, actor)
    case 'handling_outcome':
      return outcomeLine(detail, actor)
    default:
      // A sixth InboxHistoryKind reaching an older client must be silence, not
      // a crash or a half-written sentence.
      return null
  }
}

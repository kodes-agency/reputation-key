import { useId } from 'react'
import { Flag, FlagOff } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { SourceType } from '#/contexts/inbox/application/public-api'
import { CASE_SQUARE_CLASS, CaseFact } from './inbox-case-member'
import { INBOX_SOURCE_HANDLE_PERMISSION } from './inbox-owner-control'

type Props = Readonly<{
  /** Decides the second half of the server's handle gate, with `inbox.write`. */
  sourceType: SourceType
  /**
   * A raised escalation not yet resolved (`isEscalated && escalationResolvedAt
   * === null`), derived once in `inbox-case-toolbar-props.ts` so this control,
   * the list and the `e` shortcut cannot disagree about which command a press
   * issues.
   */
  isEscalationActive: boolean
  /**
   * `isHeaderCommandPending` over all six item commands — the same predicate
   * this button called on the whole `detailState` while it lived in the header.
   * It is computed upstream now only because the toolbar hands one flag to all
   * three group members; the set it covers is unchanged, so no member can lock
   * a narrower set than its siblings (`inbox-header-command-pending.ts:19-26`).
   */
  isPending: boolean
  /** Already bound to the item's revision fence by the props selector. */
  onEscalate: () => void
  onResolveEscalation: () => void
}>

/**
 * `sr-only`, not `hidden`, below `md`: the word leaves the screen but stays the
 * element's text, so the accessible name is `Escalate` / `Resolve` at EVERY
 * width with no `aria-label` to keep in step with it. Two e2e journeys match
 * those names with `exact: true` (`inbox-triage.spec.ts:194,206,225`,
 * `inbox-handling-cycle.spec.ts:155,166`). Only the CONTROL's word goes: the
 * `Escalated` fact beside it is never `sr-only` (see `CaseFact`).
 */
const LABEL_CLASS = 'max-md:sr-only'

/**
 * Third member of the case toolbar's `ButtonGroup` (plan v2.1 row 5): the
 * escalation, moved here from the header. It is a control and a fact, kept
 * apart, because the escalation is both a thing you can DO and a thing that IS:
 *
 * | caller    | not escalated              | escalated                                    |
 * | --------- | -------------------------- | -------------------------------------------- |
 * | may act   | `[⚑ Escalate]` control     | `[⚐ Resolve]` control, then `⚑ Escalated`     |
 * | may not   | nothing (no fact to state) | `⚑ Escalated` fact alone                     |
 *
 * PR 2's first cut folded the state INTO the control — `Resolve` on a
 * negative-muted fill with a filled flag, and `This item is escalated` in a
 * `title` — and the review measured what that cost on a phone, where the
 * control is a 36 px glyph square (row 20): a red square with a flag and no
 * word, for a manager AND, as the static fact, for a Member. `title` never
 * shows on touch. v1's separate `Escalated` badge had printed the word at every
 * width for everyone. The word could not simply go back on the control either:
 * its accessible name is pinned to `Resolve`, and a visible `Escalated` the
 * name does not contain fails WCAG 2.5.3 (label in name).
 *
 * So the state is a FACT, in words, at every width, for everyone — a filled
 * flag and `Escalated` in the negative text tone, which clears 4.5:1 on the
 * pane in both themes (`styles.css`, `--negative`). It follows the control, so
 * a manager's controls stay one joined run (`[● Closed ▾][GH][⚐] ⚑ Escalated`
 * at 390) and the fact sits in the same place whether or not a control precedes
 * it. The control is an ordinary outlined button — the fact beside it carries
 * the tone, so one red thing says "escalated" instead of two — and its glyph is
 * `FlagOff`, what a press does. The fact is the control's
 * `aria-describedby`, so a reader tabbing onto `Resolve` also hears why.
 *
 * Row 5 describes the escalated look as "a filled flag on `negative-muted`";
 * the flag is still filled and still negative, but on no surface, because row 2
 * forbids a fact its box. Reported as a proposed amendment to row 5.
 *
 * The permission gate reproduces the server's, then narrows it. Both commands
 * check `inbox.write` (`escalate-inbox-item.ts:42`, `resolve-escalation.ts:41`)
 * and then `canHandleInboxSource` (`:52`, `:51`), which is `inbox.write` AND
 * `SOURCE_HANDLE_PERMISSION[sourceType]` (`inbox-access.ts:36-38`). Neither
 * checks `inbox.manage`, and `inbox.manage` does not imply `inbox.write` — the
 * client `can` is a flat membership test (`usePermissions.ts:26`) and custom
 * roles carry no implication rules. The header gated this button on
 * `inbox.manage` ALONE, so a custom role holding it without `inbox.write` (or
 * without `feedback.handle`, on a private-feedback item) was offered a command
 * the server throws on. Both server conjuncts are reproduced here, and
 * `inbox.manage` stays on top, deliberately narrower than the server: who may
 * escalate is a product decision (v1 row 2, v2.1 row 5), not a review fix. For
 * every built-in role the three coincide, so no seeded journey changes.
 *
 * Two elements, as a fragment, are two direct children of the group — which is
 * what its `[&>*]` edge rules and `CASE_GROUP_CLASS` need to see.
 */
export function InboxDetailManagerActions({
  sourceType,
  isEscalationActive,
  isPending,
  onEscalate,
  onResolveEscalation,
}: Props) {
  const { can } = usePermissions()
  const factId = useId()
  const canCommand =
    can('inbox.write') &&
    can(INBOX_SOURCE_HANDLE_PERMISSION[sourceType]) &&
    can('inbox.manage')

  const fact = isEscalationActive ? (
    // `shrink-0`: the one fact whose word must never be ellipsised — at 320 px
    // a long status or name gives first.
    <CaseFact id={factId} className="shrink-0 text-negative">
      <Flag className="size-3.5 fill-current" aria-hidden="true" />
      Escalated
    </CaseFact>
  ) : null

  if (!canCommand) return fact

  const Glyph = isEscalationActive ? FlagOff : Flag
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        aria-describedby={isEscalationActive ? factId : undefined}
        className={CASE_SQUARE_CLASS}
        onClick={isEscalationActive ? onResolveEscalation : onEscalate}
      >
        <Glyph data-icon="inline-start" aria-hidden="true" />
        <span className={LABEL_CLASS}>{isEscalationActive ? 'Resolve' : 'Escalate'}</span>
      </Button>
      {fact}
    </>
  )
}

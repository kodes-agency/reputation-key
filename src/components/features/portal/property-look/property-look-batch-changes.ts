// What a portal's review lists as waiting, sorted into what this page did and
// what it did not. Publishing the look publishes the portal's whole saved draft,
// so a portal whose draft also holds someone's half-written wording or a link
// prepared for later would send that live with the colours. The batch says so on
// the row, and does not tick such a portal by itself.
import type { PortalReview } from '#/contexts/portal/application/public-api'

type Change = PortalReview['changes'][number]

export type ChangeMix = Readonly<{
  /** Saved edits to the property look: colours, wordmark, photograph, logo. */
  look: number
  /** Saved edits to anything else on the portal: wording, links, settings. */
  other: number
  /** The draft differs in ways the review cannot name, so there is more than the list shows. */
  hasUnlisted: boolean
}>

/** A change this page made: an edit to (or an unrecorded move of) the property look. */
function isLookChange(change: Change): boolean {
  if (change.type === 'edit') return change.subject.area === 'look'
  return change.type === 'unrecorded' && change.kind === 'property_brand_profile'
}

/** An edit someone saved to the draft: not a reason the review adds ("the live page is the earlier design"). */
function isDraftEdit(change: Change): boolean {
  return change.type === 'edit' || change.type === 'unrecorded'
}

export function changeMixOf(changes: readonly Change[]): ChangeMix {
  const edits = changes.filter(isDraftEdit)
  const look = edits.filter(isLookChange).length
  return {
    look,
    other: edits.length - look,
    hasUnlisted: changes.some((change) => change.type === 'unlisted'),
  }
}

/** Other draft edits are certainly there: counted, or present but unnameable. */
export function hasOtherEdits(mix: ChangeMix): boolean {
  return mix.other > 0 || mix.hasUnlisted
}

const editsOf = (count: number) =>
  count === 1 ? '1 other draft edit' : `${count} other draft edits`

/**
 * The other draft edits a publish would carry, as a noun phrase ("2 other draft
 * edits", "at least 2 other draft edits", "other draft edits"); null when there
 * are none. `mayBeMore` is the review's own "this list may be incomplete".
 */
export function describeOthers(mix: ChangeMix, mayBeMore: boolean): string | null {
  if (mix.other > 0) {
    return mix.hasUnlisted || mayBeMore
      ? `at least ${editsOf(mix.other)}`
      : editsOf(mix.other)
  }
  return mix.hasUnlisted ? 'other draft edits' : null
}

/** The part of a ready row after the version: what the publish carries beyond the look. */
export function describeMix(mix: ChangeMix, mayBeMore: boolean): string | null {
  const others = describeOthers(mix, mayBeMore)
  if (others !== null) return `also publishes ${others}`
  if (mix.look === 0) return null
  return mayBeMore ? 'the look, and possibly other edits' : 'the look only'
}

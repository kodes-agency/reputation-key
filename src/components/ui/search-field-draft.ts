// What a search field shows while the page it filters is still catching up with
// what was typed.
//
// A list keeps its search in the URL, and a keystroke is a navigation: the new
// search is committed only after the route has loaded, which on a slow network
// is long after the next keystroke. A field that shows the committed value then
// puts the person's text back to what the URL last said, and the next key is
// typed after the old text ("Bounded" became "d"). So the field keeps what was
// typed as a draft, and shows it until the committed value has caught up.
//
// Pure on purpose: the unit project has no DOM, and the rules are the part worth
// testing. `SearchField` holds the state and calls these.

export type SearchDraft = Readonly<{
  /** What the field shows: the last thing typed. */
  text: string
  /** Everything typed that the committed value has not reached yet, oldest first. */
  typed: readonly string[]
  /** The committed value when it was last looked at, to tell a change from no change. */
  seen: string
}>

/** A keystroke: the new text is the draft, and is now owed an echo from the page. */
export function typeIntoDraft(
  draft: SearchDraft | null,
  committed: string,
  text: string,
): SearchDraft {
  return {
    text,
    typed: [...(draft?.typed ?? []), text],
    seen: draft?.seen ?? committed,
  }
}

/**
 * The draft after the committed value moved (or did not).
 *
 * - The same value: nothing to do, the same draft comes back (so a caller can
 *   tell by identity that nothing changed).
 * - The value reached the draft: the page has caught up, the draft is done.
 * - A value the person typed, but an older one: a stale echo of an earlier
 *   keystroke. The newer text stays; only the echoes already seen are forgotten.
 * - A value the person never typed (Clear all, Back, a link): the page changed
 *   the search under the field, so the field shows it.
 */
export function reconcileDraft(
  draft: SearchDraft | null,
  committed: string,
): SearchDraft | null {
  if (draft === null || committed === draft.seen) return draft
  if (committed === draft.text) return null
  const index = draft.typed.indexOf(committed)
  if (index === -1) return null
  return { ...draft, typed: draft.typed.slice(index + 1), seen: committed }
}

/** What the field shows. */
export function shownText(draft: SearchDraft | null, committed: string): string {
  return draft === null ? committed : draft.text
}

// Keeps a hand-written list of measured Storybook stories honest.
//
// A metrics gate lists the stories it loads. The list drifts in two silent
// ways: a renamed story leaves an id that renders Storybook's "no preview"
// page, and a NEW story is never loaded at all, so it ships unmeasured with
// every check green. This is the check that closes both. It judges the list
// against Storybook's `/index.json`: every story defined under the measured
// area is measured, excluded by id, or under a title excluded, each with a
// reason, and every id the list names still exists.
//
// Pure: the harness fetches the index and passes it in, so the rules are
// unit-tested without a browser.

export type StoryIndexEntry = Readonly<{
  id: string
  type: string
  title: string
  importPath: string
}>

export type StoryAccountingInput = Readonly<{
  entries: ReadonlyArray<StoryIndexEntry>
  /** A story counts as "in the area" when its `importPath` starts with one of these. */
  importPrefixes: ReadonlyArray<string>
  /** Ids the harness measures. */
  measured: ReadonlyArray<string>
  /** Ids left out, each with the reason (the record's value). */
  excludedIds: Readonly<Record<string, string>>
  /** Whole titles left out, each with the reason. */
  excludedTitles: Readonly<Record<string, string>>
}>

export type StoryAccounting = Readonly<{
  /** Declared (measured or excluded by id) but no story in the area has that id. */
  missing: ReadonlyArray<string>
  /** A story in the area that is neither declared nor under an excluded title. */
  unaccounted: ReadonlyArray<string>
  /** Measured or excluded by id while its title is excluded: the two rules disagree. */
  contradictions: ReadonlyArray<string>
  /** An excluded title with no story in the area. */
  staleExclusions: ReadonlyArray<string>
}>

export function accountForStories(input: StoryAccountingInput): StoryAccounting {
  const inArea = input.entries.filter(
    (entry) =>
      entry.type === 'story' &&
      input.importPrefixes.some((prefix) => entry.importPath.startsWith(prefix)),
  )
  const titleOf = new Map(inArea.map((entry) => [entry.id, entry.title]))
  const declared = new Set([...input.measured, ...Object.keys(input.excludedIds)])

  // Against the stories IN THE AREA, not all of them: if `importPath` ever
  // changes shape the area is empty and every declared id lands here, loudly.
  const missing = [...declared].filter((id) => !titleOf.has(id))
  const unaccounted = inArea
    .filter((entry) => !declared.has(entry.id) && !(entry.title in input.excludedTitles))
    .map((entry) => `${entry.id} (${entry.title}, ${entry.importPath})`)
  const contradictions = [...declared]
    .filter((id) => (titleOf.get(id) ?? '') in input.excludedTitles)
    .map(
      (id) =>
        `${id} is declared, but its title "${titleOf.get(id)}" is in the excluded titles`,
    )
  const staleExclusions = Object.keys(input.excludedTitles).filter(
    (title) => !inArea.some((entry) => entry.title === title),
  )
  return { missing, unaccounted, contradictions, staleExclusions }
}

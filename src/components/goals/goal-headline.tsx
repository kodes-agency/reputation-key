// What is left, as the line every goal's card and page leads with (ADR 0068,
// amended 2026-10-19: one goal design system): the figure large, then its words,
// then the number it counts to in the link ink. This is the one place a figure
// wears that ink; a goal passes its three parts and none of its own words.

type Props = Readonly<{
  /** The figure that opens the line, already formatted. */
  count: string
  /** What the figure counts, ending in the word that leads to the target. */
  words: string
  /** The number the figure counts to. */
  target: string
}>

export function GoalHeadline({ count, words, target }: Props) {
  return (
    <p className="text-2xl leading-tight font-semibold">
      <span className="tabular-nums">{count}</span> {words}{' '}
      <span className="text-link tabular-nums">{target}</span>
    </p>
  )
}

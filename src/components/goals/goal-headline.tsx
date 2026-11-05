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

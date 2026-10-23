// How a face shares its spare height between its flexible gaps, as the design
// boards' flex column shares it (spec 2.5): equally, except that no gap goes
// under its minimum. A gap that would is held at its minimum and the rest is
// shared among the others, as CSS does for `flex: 1 1 0` with a `min-height`.
// When even the minimums do not fit, every gap is at its minimum and the face
// is over-full by the difference; the fit order is there so that it never is.

export function shareGaps(free: number, minimums: readonly number[]): readonly number[] {
  const share = (held: ReadonlySet<number>): readonly number[] => {
    const open = minimums.flatMap((_, index) => (held.has(index) ? [] : [index]))
    const heldTotal = [...held].reduce((sum, index) => sum + (minimums[index] ?? 0), 0)
    const each = open.length === 0 ? 0 : (free - heldTotal) / open.length
    const under = open.filter((index) => each < (minimums[index] ?? 0))
    if (under.length === 0) {
      return minimums.map((minimum, index) => (held.has(index) ? minimum : each))
    }
    return share(new Set([...held, ...under]))
  }
  return share(new Set())
}

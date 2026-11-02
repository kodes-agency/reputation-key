export type StaffHintFigures = Readonly<{
  portalId: string
  scans: number | null
  ratings: number | null
  average: number | null
}>
/** Unknown scans cannot establish a median. This is a manager hint with no downstream effect. */
export function highRatingFromFewGuests(
  people: readonly StaffHintFigures[],
): ReadonlySet<string> {
  if (people.length < 3 || people.some((person) => person.scans === null))
    return new Set()
  const scans = people.map((person) => person.scans!).sort((a, b) => a - b)
  const middle = Math.floor(scans.length / 2)
  const median =
    scans.length % 2 ? scans[middle]! : (scans[middle - 1]! + scans[middle]!) / 2
  return new Set(
    people
      .filter(
        (person) =>
          (person.ratings ?? 0) >= 5 &&
          (person.average ?? 0) >= 4.5 &&
          person.scans! < median / 2,
      )
      .map((person) => person.portalId),
  )
}

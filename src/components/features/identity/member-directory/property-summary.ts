// How the Members tables name the properties a manager works: the first few by
// name, the rest as a count, and the names behind the count for a tooltip and
// for a screen reader. Pure.

export type PropertySummary = Readonly<{
  /** The names printed in the cell. */
  shown: ReadonlyArray<string>
  /** How many further properties the cell counts instead of naming. */
  hiddenCount: number
  /** The names the count stands for, for text a screen reader reaches. */
  hiddenNames: ReadonlyArray<string>
  /** Every name, for a tooltip when some are hidden. */
  all: string
}>

const NAMED_PROPERTIES_SHOWN = 2

export function summarizeProperties(
  properties: ReadonlyArray<Readonly<{ name: string }>>,
  shownCount: number = NAMED_PROPERTIES_SHOWN,
): PropertySummary {
  const names = properties.map((property) => property.name)
  return {
    shown: names.slice(0, shownCount),
    hiddenCount: Math.max(0, names.length - shownCount),
    hiddenNames: names.slice(shownCount),
    all: names.join(', '),
  }
}

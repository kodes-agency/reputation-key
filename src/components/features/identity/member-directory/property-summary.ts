// How the Members tables name the properties a manager works: the first few by
// name, the rest as a count, and every name for a tooltip. Pure.

export type PropertySummary = Readonly<{
  /** The names printed in the cell. */
  shown: ReadonlyArray<string>
  /** How many further properties the cell counts instead of naming. */
  hiddenCount: number
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
    all: names.join(', '),
  }
}

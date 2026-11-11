// The properties a manager works, as one table cell: the first few by name and
// the rest as a count. The count's names are in text a screen reader reaches as
// well as in a tooltip, which a keyboard or a screen reader cannot open.

import { summarizeProperties } from './property-summary'

export function PropertyNames({
  properties,
}: Readonly<{ properties: ReadonlyArray<Readonly<{ name: string }>> }>) {
  const { shown, hiddenCount, hiddenNames, all } = summarizeProperties(properties)
  return (
    <span title={hiddenCount > 0 ? all : undefined}>
      {shown.join(', ')}
      {hiddenCount > 0 ? (
        <span className="text-muted-foreground">
          {' '}
          +{hiddenCount} more
          <span className="sr-only">: {hiddenNames.join(', ')}</span>
        </span>
      ) : null}
    </span>
  )
}

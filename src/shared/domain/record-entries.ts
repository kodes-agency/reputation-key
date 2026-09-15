// Equality for flat records whose key order means nothing: authorization
// vectors and capability runtime-profile maps are compared this way.

/**
 * True when both records have exactly the same keys and every key's values
 * match. A match is strict equality unless the caller passes `valuesMatch`,
 * which can relax what counts as the same value but never the key set: a key
 * on one side only is always a mismatch. Keys are compared sorted, so
 * insertion order never decides the answer.
 */
export function sameRecordEntries<Value>(
  left: Readonly<Record<string, Value>>,
  right: Readonly<Record<string, Value>>,
  valuesMatch: (key: string) => boolean = (key) => left[key] === right[key],
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && valuesMatch(key))
  )
}

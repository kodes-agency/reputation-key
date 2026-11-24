import { sha256Hex } from '../domain/sha256'

export type ReplyRotationUsage = Readonly<{
  key: string
  usedAtEpochMillis: number
}>

type Keyed = Readonly<{ key: string }>

function optionKey(option: string | Keyed): string {
  return typeof option === 'string' ? option : option.key
}

/** Unused first, then least recently published, with a stable seed/key tie-break. */
export function pickLeastRecentlyUsed<Option extends string | Keyed>(
  options: readonly Option[],
  usage: readonly ReplyRotationUsage[],
  tieBreakSeed: string,
): Option | null {
  const latest = new Map<string, number>()
  for (const item of usage) {
    latest.set(
      item.key,
      Math.max(latest.get(item.key) ?? -Infinity, item.usedAtEpochMillis),
    )
  }
  return (
    [...options].sort((left, right) => {
      const leftKey = optionKey(left)
      const rightKey = optionKey(right)
      const leftUsed = latest.get(leftKey)
      const rightUsed = latest.get(rightKey)
      if (leftUsed === undefined && rightUsed !== undefined) return -1
      if (leftUsed !== undefined && rightUsed === undefined) return 1
      if (leftUsed !== rightUsed) return (leftUsed ?? 0) - (rightUsed ?? 0)
      return sha256Hex(`${tieBreakSeed}\0${leftKey}`).localeCompare(
        sha256Hex(`${tieBreakSeed}\0${rightKey}`),
      )
    })[0] ?? null
  )
}

/** Every index below `count`, least recently used first, with the same seeded tie-break. */
export function orderOptions(
  count: number,
  usage: readonly ReplyRotationUsage[],
  seed: string,
): number[] {
  const remaining = Array.from({ length: count }, (_, index) => String(index))
  const ordered: number[] = []
  while (remaining.length) {
    const chosen = pickLeastRecentlyUsed(remaining, usage, seed)!
    ordered.push(Number(chosen))
    remaining.splice(remaining.indexOf(chosen), 1)
  }
  return ordered
}

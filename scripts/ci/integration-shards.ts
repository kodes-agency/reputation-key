// Which integration test files each CI shard runs.
//
// The integration files run one at a time against one database per shard, so a
// shard lasts as long as the sum of its files. Vitest's own split sorts files by
// a hash of their path and cuts equal counts, which ignores how long each file
// takes: on 2026-11-21 one shard ran 463 s of tests and the other two about
// 300 s, and that shard set the length of every CI run. This split takes each
// file's recorded duration (integration-durations.json, written from a CI run's
// log by record-integration-durations.ts) and gives the longest file left to the
// shard with the least work so far. Every shard computes the same split from the
// same file list, so each file runs in exactly one shard.

/** Importing a file and building its fixtures, on top of its recorded test time. */
const PER_FILE_OVERHEAD_MS = 1_000

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * The files shard `index` of `count` runs (1-based, as `--shard=index/count`),
 * in the order given. A file the record does not know yet costs the median
 * recorded duration.
 */
export function shardOf(
  files: readonly string[],
  durationsMs: Readonly<Record<string, number>>,
  index: number,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`shard count ${count} is not a positive integer`)
  }
  if (!Number.isInteger(index) || index < 1 || index > count) {
    throw new Error(`shard ${index} is outside 1..${count}`)
  }
  const unknownCost = median(Object.values(durationsMs))
  const cost = (file: string) => (durationsMs[file] ?? unknownCost) + PER_FILE_OVERHEAD_MS
  const longestFirst = [...new Set(files)].sort(
    (a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0),
  )
  const load = Array.from({ length: count }, () => 0)
  const mine = new Set<string>()
  for (const file of longestFirst) {
    let lightest = 0
    for (let shard = 1; shard < count; shard++) {
      if (load[shard]! < load[lightest]!) lightest = shard
    }
    load[lightest]! += cost(file)
    if (lightest === index - 1) mine.add(file)
  }
  return files.filter((file) => mine.has(file))
}

// Content-free facts an alert was raised on, for error monitoring.
//
// An alert reaches the monitor as an error whose message the scrubber replaces
// (Privacy Notice section 2), so on its own "[alert] sync.failed-nonzero" says
// that something failed and nothing about what. The facts below are what the
// alert's own reading already held: the governed job families, the readiness
// reasons and failure codes (closed sets the code raises them from) and counts.
// Each becomes a tag only after it passes a closed shape, so a value that came
// from a row or a person cannot pass as one.

const MACHINE_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/u
const OTHER_CODE = 'other'
const MAX_TAG_LENGTH = 200
// Room for the ",+NNNNNN" a cut list ends with.
const OMITTED_SUFFIX_RESERVE = 8

export type AlertFacts = Readonly<{
  /** Governed job families the alert is about (their contract names). */
  jobs?: readonly string[]
  /** Why: readiness reasons, or another closed set of reason codes. */
  reasons?: readonly string[]
  /** Failure codes with how many entries failed with each. */
  codes?: Readonly<Record<string, number>>
  /** How many entries the alert counts. */
  count?: number
}>

export type AlertFactTags = Readonly<{
  alert_jobs?: string
  alert_reasons?: string
  alert_codes?: string
  alert_count?: string
}>

function isMachineName(value: unknown): value is string {
  return typeof value === 'string' && MACHINE_NAME.test(value)
}

/** One entry per name, in a stable order, without any name that is not a machine name. */
function names(values: readonly string[] | undefined): string[] {
  return [...new Set((Array.isArray(values) ? values : []).filter(isMachineName))].sort()
}

/** The list as one tag value, cut at an entry boundary with a count of what it left out. */
function boundedList(entries: readonly string[]): string | undefined {
  if (entries.length === 0) return undefined
  const whole = entries.join(',')
  if (whole.length <= MAX_TAG_LENGTH) return whole
  const kept: string[] = []
  let length = 0
  for (const entry of entries) {
    const next = length + (kept.length > 0 ? 1 : 0) + entry.length
    if (next > MAX_TAG_LENGTH - OMITTED_SUFFIX_RESERVE) break
    kept.push(entry)
    length = next
  }
  return `${kept.join(',')},+${entries.length - kept.length}`
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** `code:count` entries, most frequent first; a code that is not a machine name counts as `other`. */
function codeCounts(codes: AlertFacts['codes']): string[] {
  const totals = new Map<string, number>()
  for (const [code, count] of Object.entries(codes ?? {})) {
    if (!isCount(count) || count === 0) continue
    const key = isMachineName(code) ? code : OTHER_CODE
    totals.set(key, (totals.get(key) ?? 0) + count)
  }
  return [...totals]
    .sort(([leftCode, left], [rightCode, right]) => {
      if (left !== right) return right - left
      return leftCode < rightCode ? -1 : leftCode > rightCode ? 1 : 0
    })
    .map(([code, count]) => `${code}:${count}`)
}

export function alertFactTags(facts: AlertFacts | undefined): AlertFactTags {
  if (!facts) return {}
  const jobs = boundedList(names(facts.jobs))
  const reasons = boundedList(names(facts.reasons))
  const codes = boundedList(codeCounts(facts.codes))
  return {
    ...(jobs ? { alert_jobs: jobs } : {}),
    ...(reasons ? { alert_reasons: reasons } : {}),
    ...(codes ? { alert_codes: codes } : {}),
    ...(isCount(facts.count) ? { alert_count: String(facts.count) } : {}),
  }
}

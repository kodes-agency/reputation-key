// A short, browser-only memory of errors monitoring already recorded.
//
// When a reporter says "it broke", the useful artifact usually already exists:
// the browser SDK captured the exception seconds earlier. This buffer keeps the
// resulting event ids so the report can point at one.
//
// Only opaque event ids are held — never the error, its message, or its stack.
// Nothing here is persisted, and it is cleared when the tab goes away.

const MAX_RECORDED_ERRORS = 5
const EVENT_ID = /^[a-f0-9]{32}$/u

export type RecordedBrowserError = Readonly<{
  eventId: string
  recordedAt: number
}>

let recorded: ReadonlyArray<RecordedBrowserError> = []

/** Note that monitoring accepted an event. Non-conforming ids are ignored. */
export function rememberRecordedError(
  eventId: string | undefined,
  recordedAt: number = Date.now(),
): void {
  if (!eventId || !EVENT_ID.test(eventId)) return
  if (recorded.some((entry) => entry.eventId === eventId)) return
  recorded = [{ eventId, recordedAt }, ...recorded].slice(0, MAX_RECORDED_ERRORS)
}

/** Most recent first. */
export function listRecordedErrors(): ReadonlyArray<RecordedBrowserError> {
  return recorded
}

/** The error a reporter most plausibly means, or null when none was recorded. */
export function latestRecordedError(): RecordedBrowserError | null {
  return recorded[0] ?? null
}

/** Test seam; production code never needs to forget an error deliberately. */
export function clearRecordedErrors(): void {
  recorded = []
}

// Reporting application — the day qualified scans began to be counted.
//
// The metric registry owns it (the qualified-scan version's `effectiveFrom`).
// Portal results read it here so a window that opens before it is never shown
// as a verified zero, and the client never keeps a copy of the date.

import { METRIC_VERSION_IDS, findMetricVersionById } from '../../domain/metric-registry'

const QUALIFIED_SCANS_SINCE: Date = (() => {
  const registered = findMetricVersionById(METRIC_VERSION_IDS.qualifiedScanGoal)
  if (!registered) throw new Error('The qualified scan metric version is not registered')
  return registered.version.effectiveFrom
})()

/** A fresh copy each call, so no caller can move the registry's date. */
export function qualifiedScansSince(): Date {
  return new Date(QUALIFIED_SCANS_SINCE)
}

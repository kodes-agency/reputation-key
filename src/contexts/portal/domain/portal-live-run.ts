// Portal live runs — when a Portal has been live, from its publication
// activations.
//
// A run is an unbroken stretch of being live. Publishing starts one. A
// republish or a rollback closes the live activation as `replaced` and opens
// the next at the same instant, so the run goes on. A disable or an archive
// closes it, and the next publication starts a new one. The current run is the
// one still open; its start is when the Portal went live, as a manager would
// say it.
//
// The rule reads only the activations that bound a run: each run's first
// activation, the one that closed it (`disabled` or `archived`) and the open
// one. Activations in the middle of a run change nothing, so a read may leave
// them out (`listActivationsForPortals` reads only the boundaries).

import type { PortalPublicationActivation } from './portal-publication-snapshot'

type LiveRunActivation = Pick<
  PortalPublicationActivation,
  'activationSequence' | 'activatedAt' | 'deactivatedAt' | 'deactivationReason'
>

/** A stretch a Portal was live; `to` is null while it still is. */
export type LiveInterval = Readonly<{ from: Date; to: Date | null }>

type LiveRun = Readonly<{ start: Date; end: Date | null }>

const bySequence = (a: LiveRunActivation, b: LiveRunActivation): number =>
  a.activationSequence - b.activationSequence

/** The Portal's runs, oldest first. */
function liveRuns(activations: readonly LiveRunActivation[]): readonly LiveRun[] {
  const ordered = [...activations].sort(bySequence)
  const runStarts = ordered.flatMap((current, index) =>
    ordered[index - 1]?.deactivationReason === 'replaced' ? [] : [current],
  )
  return runStarts.map((first, runIndex) => {
    const next = runStarts[runIndex + 1]
    const members = ordered.filter(
      (candidate) =>
        candidate.activationSequence >= first.activationSequence &&
        (next === undefined || candidate.activationSequence < next.activationSequence),
    )
    const last = members[members.length - 1] ?? first
    return { start: first.activatedAt, end: last.deactivatedAt }
  })
}

/**
 * A run closed at its own start was never live. An Organization closing writes
 * one when an activation is younger than the closing instant.
 */
const neverLive = (run: LiveRun): boolean =>
  run.end !== null && run.end.getTime() <= run.start.getTime()

/** When the current run began, or null when the Portal is not live. */
export function liveRunStart(activations: readonly LiveRunActivation[]): Date | null {
  const runs = liveRuns(activations)
  const current = runs[runs.length - 1]
  return current && current.end === null ? current.start : null
}

/**
 * The runs that overlap `[from, to)`, clipped to it, oldest first. A run still
 * open keeps a null end; a run closed at its own start gives no interval.
 */
export function liveIntervals(
  activations: readonly LiveRunActivation[],
  from: Date,
  to: Date,
): readonly LiveInterval[] {
  return liveRuns(activations)
    .filter(
      (run) =>
        !neverLive(run) &&
        run.start.getTime() < to.getTime() &&
        (run.end === null || run.end.getTime() > from.getTime()),
    )
    .map((run) => ({
      from: run.start.getTime() < from.getTime() ? from : run.start,
      to: run.end === null || run.end.getTime() <= to.getTime() ? run.end : to,
    }))
}

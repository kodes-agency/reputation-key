import type { GuestVoiceDetailTarget } from '#/contexts/ai/application/public-api'

/** Complete polarity/reason identity; topics never masquerade as issue ids. */
export function detailTargetKey(target: GuestVoiceDetailTarget | null): string {
  if (!target) return 'closed'
  if (target.kind === 'topic') return `topic:${target.topic}`
  return target.kind === 'issue'
    ? `issue:${target.issueId}:${target.sense}`
    : `concern:${target.issueId ?? 'other'}:${target.reason}`
}
export type DetailStep = Readonly<{
  target: GuestVoiceDetailTarget
  title: string
  scroll: number
  focus: string | null
}>
/** Browser Back/Forward replays a known step; direct targets begin a fresh trail. */
export function detailTrailFor(
  trail: readonly DetailStep[],
  target: GuestVoiceDetailTarget,
): readonly DetailStep[] {
  const index = trail.findIndex(
    (step) => detailTargetKey(step.target) === detailTargetKey(target),
  )
  return index < 0 ? [] : trail.slice(0, index)
}

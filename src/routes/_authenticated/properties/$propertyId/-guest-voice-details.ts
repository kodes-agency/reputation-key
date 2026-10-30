import { isReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type { GuestVoiceDetailTarget } from '#/contexts/ai/application/public-api'
import type { GuestVoiceDetailSearch as Search } from './-guest-voice-search'

const uuid = (value: string | undefined): value is string =>
  value !== undefined &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  )
const reason = (
  value: string | undefined,
): value is Extract<GuestVoiceDetailTarget, { kind: 'concern' }>['reason'] =>
  value === 'safety' ||
  value === 'health' ||
  value === 'discrimination' ||
  value === 'legal_threat'
export function guestVoiceDetailTarget(search: Search): GuestVoiceDetailTarget | null {
  if ((search.concern === 'other' || uuid(search.concern)) && reason(search.reason))
    return {
      kind: 'concern',
      issueId: search.concern === 'other' ? null : search.concern,
      reason: search.reason,
    }
  if (uuid(search.issue) && (search.sense === 'complaint' || search.sense === 'praise'))
    return { kind: 'issue', issueId: search.issue, sense: search.sense }
  if (search.topic && isReviewTopicV3(search.topic))
    return { kind: 'topic', topic: search.topic }
  return null
}
export function guestVoiceDetailParams(target: GuestVoiceDetailTarget | null): Search {
  const empty = {
    issue: undefined,
    sense: undefined,
    concern: undefined,
    reason: undefined,
    topic: undefined,
  }
  if (!target) return empty
  if (target.kind === 'topic') return { ...empty, topic: target.topic }
  if (target.kind === 'issue')
    return { ...empty, issue: target.issueId, sense: target.sense }
  return { ...empty, concern: target.issueId ?? 'other', reason: target.reason }
}

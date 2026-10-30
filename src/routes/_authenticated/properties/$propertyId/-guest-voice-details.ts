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
  const [kind, value, qualifier, extra] = search.detail?.split(':') ?? []
  if (extra !== undefined) return null
  if (kind === 'concern' && (value === 'other' || uuid(value)) && reason(qualifier))
    return {
      kind: 'concern',
      issueId: value === 'other' ? null : value,
      reason: qualifier,
    }
  if (
    kind === 'issue' &&
    uuid(value) &&
    (qualifier === 'complaint' || qualifier === 'praise')
  )
    return { kind: 'issue', issueId: value, sense: qualifier }
  if (kind === 'topic' && value && !qualifier && isReviewTopicV3(value))
    return { kind: 'topic', topic: value }
  return null
}
export function guestVoiceDetailParams(target: GuestVoiceDetailTarget | null): Search {
  if (!target) return { detail: undefined }
  if (target.kind === 'topic') return { detail: `topic:${target.topic}` }
  if (target.kind === 'issue')
    return { detail: `issue:${target.issueId}:${target.sense}` }
  return { detail: `concern:${target.issueId ?? 'other'}:${target.reason}` }
}

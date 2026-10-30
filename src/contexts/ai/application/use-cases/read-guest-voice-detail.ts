import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import { REVIEW_URGENT_REASONS_V3 } from '#/shared/review-analysis-v3'
import { addDays } from '../local-date'
import {
  loadGuestVoiceReadContext,
  type GuestVoiceReadDependencies,
  type GuestVoiceReadInput,
} from '../read-models/guest-voice-read-context'
import {
  buildGuestVoiceDetail,
  type GuestVoiceDetailDraft,
} from '../read-models/guest-voice-v2-details'
import type {
  GuestVoiceDetailRead,
  GuestVoiceDetailTarget,
} from '../read-models/guest-voice-v2-check-in'
import { withSentences } from '../read-models/guest-voice-v2-sentences'

export type ReadGuestVoiceDetailInput = GuestVoiceReadInput &
  Readonly<{
    startLocalDate: string
    endLocalDate: string
    target: GuestVoiceDetailTarget
  }>
export type ReadGuestVoiceDetailDeps = GuestVoiceReadDependencies
export type GuestVoiceDetailResponse =
  | Exclude<GuestVoiceDetailRead, { status: 'ready' }>
  | Readonly<{ status: 'drafted'; draft: GuestVoiceDetailDraft }>

function validTarget(target: GuestVoiceDetailTarget): boolean {
  if (target.kind === 'topic') return REVIEW_TOPICS_V3.includes(target.topic)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (target.kind === 'issue')
    return uuid.test(target.issueId) && ['complaint', 'praise'].includes(target.sense)
  return (
    target.kind === 'concern' &&
    (target.issueId === null || uuid.test(target.issueId)) &&
    REVIEW_URGENT_REASONS_V3.includes(target.reason)
  )
}
function validBounds(input: ReadGuestVoiceDetailInput): boolean {
  try {
    addDays(input.startLocalDate, 0)
    addDays(input.endLocalDate, 0)
    return (
      input.startLocalDate <= input.endLocalDate &&
      addDays(input.startLocalDate, 364) >= input.endLocalDate
    )
  } catch {
    return false
  }
}
export function createReadGuestVoiceDetail(deps: ReadGuestVoiceDetailDeps) {
  return async (input: ReadGuestVoiceDetailInput): Promise<GuestVoiceDetailResponse> => {
    // Validation is inside the shared authorization path; direct application callers
    // receive exactly the same Property admission as an RPC caller.
    const context = await loadGuestVoiceReadContext(
      deps,
      input,
      (window) =>
        validBounds(input) &&
        validTarget(input.target) &&
        window.startLocalDate === input.startLocalDate &&
        window.endLocalDate === input.endLocalDate,
    )
    if (context.status !== 'loaded')
      return { status: context.status === 'not_v3' ? 'preparing' : context.status }
    const draft = buildGuestVoiceDetail({
      build: context.build,
      history: context.history,
      historyStartLocalDate: context.historyStartLocalDate,
      target: input.target,
    })
    if (draft === null) return { status: 'not_found' }
    return {
      status: 'drafted',
      draft: {
        ...draft,
        evidence: await withSentences(deps.facts, context.scope, draft.evidence),
      },
    }
  }
}
export type ReadGuestVoiceDetail = ReturnType<typeof createReadGuestVoiceDetail>

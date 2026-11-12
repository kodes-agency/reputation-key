import { createHash } from 'node:crypto'
import { measureReplyDraftingAttempt } from './measurement.server'
import type { AiOperationState } from '../application/ports/ai-operation-store.port'
import { aiRequestFingerprint } from '../application/ai-workflow-support'
import type {
  GenerateReplySuggestionDependencies,
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from '../application/reply-suggestion-contract'
import { admitInteractiveDraft, type ReplyDraftingV2Attempt } from './workflow.server'
import {
  reportReplyProgress,
  type ReplyDraftingProgress,
  type ReplyDraftingProgressSink,
} from '#/shared/reply-drafting-progress'

export async function admitReplyDraft(
  deps: GenerateReplySuggestionDependencies,
  input: GenerateReplySuggestionInput,
  now: number,
) {
  if (input.intent !== 'background') return admitInteractiveDraft(deps, input, now)
  return deps.admission.acquire({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    lane: 'background',
    backgroundDraftActorUserId: input.actorUserId,
    nowEpochMillis: now,
  })
}

export function reportReplyReading(
  input: GenerateReplySuggestionInput,
  attempt: ReplyDraftingV2Attempt,
  frame?: Readonly<{ prefix: string; suffix: string }>,
  reviewText?: string,
): void {
  reportReplyProgress(
    input.onProgress,
    attempt.rewriteOrdinal === 1
      ? { step: 'rewording', ordinal: 1 }
      : {
          step: 'reading',
          ...(frame ? { frame: { prefix: frame.prefix, suffix: frame.suffix } } : {}),
          ...(reviewText === undefined
            ? {}
            : {
                reviewTextDigest: createHash('sha256')
                  .update(reviewText, 'utf8')
                  .digest('hex'),
              }),
        },
  )
}

/** Only the currently executing promise/metadata is owned here. No completed draft cache. */
type DraftingRequestDependencies = Pick<
  GenerateReplySuggestionDependencies,
  'measurements' | 'nowEpochMillis'
> &
  Readonly<{
    reviewSources: Pick<
      GenerateReplySuggestionDependencies['reviewSources'],
      'hasCurrentReply'
    >
  }>

export function manageReplyDraftingRequests(
  deps: DraftingRequestDependencies,
  attempt: ReplyDraftingV2Attempt,
  execute: (
    input: GenerateReplySuggestionInput,
  ) => Promise<GenerateReplySuggestionResult>,
): typeof execute {
  const measuredExecute = measureReplyDraftingAttempt(deps, attempt, execute)
  if (attempt.rewriteOrdinal !== 0) return measuredExecute
  const active = new Map<string, ActiveDraft>()
  const generate = async (
    input: GenerateReplySuggestionInput,
  ): Promise<GenerateReplySuggestionResult> => {
    const { onProgress } = input
    const key = aiRequestFingerprint({
      organizationId: input.organizationId,
      actor: input.actorUserId,
      key: input.idempotencyKey,
    })
    const fingerprint = draftRequestFingerprint(input)
    const existing = active.get(key)
    if (existing)
      return joinActiveDraft(existing, input, fingerprint, () => {
        if (active.get(key) === existing) active.delete(key)
        return generate(input)
      })
    const sinks = new Set<ReplyDraftingProgressSink>()
    if (onProgress) sinks.add(onProgress)
    const promise = Promise.resolve().then(() =>
      runEligibleDraft(
        deps,
        {
          ...input,
          onIdentity: (identity) => {
            entry.resolvedIdentity = identity
          },
        },
        measuredExecute,
        (event) => {
          if (event.step === 'reading') entry.admitted = true
          entry.history.push(event)
          for (const sink of sinks) reportReplyProgress(sink, event)
        },
      ),
    )
    const entry: ActiveDraft = {
      fingerprint,
      intent: input.intent ?? 'explicit',
      admitted: false,
      sinks,
      promise,
      history: [],
    }
    // Publish before starting asynchronous eligibility/claim work (Strict Mode/retries).
    active.set(key, entry)
    try {
      return await entry.promise
    } finally {
      if (active.get(key) === entry) active.delete(key)
      sinks.clear()
    }
  }
  return generate
}

function draftRequestFingerprint(input: GenerateReplySuggestionInput): string {
  return aiRequestFingerprint({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
    actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
    expectedSourceEpoch: input.expectedSourceEpoch,
    expectedSourceRevision: input.expectedSourceRevision,
    expectedBaseReplyStateRevision: input.expectedBaseReplyStateRevision,
    tone: input.tone,
    targetLanguage: input.targetLanguage.kind,
    contract: 'reply-suggestion-v2',
    templateOnly: input.templateOnly ?? false,
    variation: input.variation ?? null,
    length: input.length ?? null,
    maxWords: input.maxWords ?? null,
  })
}

async function runEligibleDraft(
  deps: DraftingRequestDependencies,
  input: GenerateReplySuggestionInput,
  execute: (
    input: GenerateReplySuggestionInput,
  ) => Promise<GenerateReplySuggestionResult>,
  onProgress: ReplyDraftingProgressSink,
): Promise<GenerateReplySuggestionResult> {
  if (
    input.intent === 'background' &&
    (input.templateOnly || (await deps.reviewSources.hasCurrentReply(input)))
  )
    return { status: 'unavailable', code: 'source_changed', retryAfterEpochMillis: null }
  const result = await execute({ ...input, onProgress })
  return result
}

export function replyProgressArguments(
  input: GenerateReplySuggestionInput,
): [ReplyDraftingProgressSink | undefined] {
  return [input.onProgress]
}

export type DraftingRequestIdentity = Readonly<{
  fingerprint: string
  isCurrent(): Promise<boolean>
}>

export function publishReplyDraftingIdentity(
  input: GenerateReplySuggestionInput,
  fingerprint: string,
  isCurrent: () => Promise<boolean>,
): void {
  input.onIdentity?.({ fingerprint, isCurrent })
}

export async function assertReplyDraftSourceCurrent(
  sources: GenerateReplySuggestionDependencies['reviewSources'],
  input: GenerateReplySuggestionInput,
  request: Parameters<
    GenerateReplySuggestionDependencies['reviewSources']['assertCurrent']
  >[0],
) {
  const current = await sources.assertCurrent(request)
  return input.intent === 'background' && (await sources.hasCurrentReply(input))
    ? { status: 'source_revision_changed' as const }
    : current
}

export function replyUnavailable(
  code: Extract<GenerateReplySuggestionResult, { status: 'unavailable' }>['code'],
  retryAfterEpochMillis: number | null = null,
): GenerateReplySuggestionResult {
  return { status: 'unavailable', code, retryAfterEpochMillis }
}

export const hasProducedDraft = (state: AiOperationState): boolean =>
  state === 'succeeded' || state === 'succeeded_pending_delivery'

type DraftIdentityResolvers = Readonly<{
  language(
    deps: GenerateReplySuggestionDependencies,
    input: GenerateReplySuggestionInput,
    observation: Extract<
      Awaited<
        ReturnType<GenerateReplySuggestionDependencies['reviewSources']['readForAi']>
      >,
      { status: 'available' }
    >['observation'],
  ): Promise<
    { kind: 'settled' } | { kind: 'draftable'; concreteReplyLanguage: { tag: string } }
  >
  grant(
    deps: GenerateReplySuggestionDependencies,
    input: GenerateReplySuggestionInput,
  ): Promise<
    { kind: 'refused' } | { kind: 'granted'; profile: { profileVersion: number } }
  >
}>

export async function isReplyDraftingIdentityCurrent(
  deps: GenerateReplySuggestionDependencies,
  input: GenerateReplySuggestionInput,
  languageTag: string,
  profileVersion: number,
  currentness: () => Promise<string>,
  resolvers: DraftIdentityResolvers,
): Promise<boolean> {
  if ((await currentness()) !== 'current') return false
  const source = await deps.reviewSources.readForAi({
    ...input,
    expected: {
      kind: 'reply',
      sourceEpoch: input.expectedSourceEpoch,
      sourceRevision: input.expectedSourceRevision,
    },
  })
  if (source.status !== 'available') return false
  const language = await resolvers.language(deps, input, source.observation)
  const grant = await resolvers.grant(deps, input)
  return (
    language.kind === 'draftable' &&
    language.concreteReplyLanguage.tag === languageTag &&
    grant.kind === 'granted' &&
    grant.profile.profileVersion === profileVersion
  )
}

type ActiveDraft = {
  fingerprint: string
  intent: 'explicit' | 'background'
  admitted: boolean
  promise: Promise<GenerateReplySuggestionResult>
  sinks: Set<ReplyDraftingProgressSink>
  history: ReplyDraftingProgress[]
  resolvedIdentity?: DraftingRequestIdentity
}

async function joinActiveDraft(
  existing: ActiveDraft,
  input: GenerateReplySuggestionInput,
  fingerprint: string,
  continueExplicit: () => Promise<GenerateReplySuggestionResult>,
): Promise<GenerateReplySuggestionResult> {
  if (existing.fingerprint !== fingerprint) return replyUnavailable('policy_unavailable')
  if (existing.resolvedIdentity && !(await existing.resolvedIdentity.isCurrent()))
    return replyUnavailable('source_changed')
  const { onProgress } = input
  if (onProgress) existing.sinks.add(onProgress)
  for (const event of existing.history) reportReplyProgress(onProgress, event)
  try {
    const result = await existing.promise
    // A refused background admission has consumed no operation or provider call.
    // Explicit work may take its own lane, sharing a single successor with other joins.
    if (
      existing.intent === 'background' &&
      input.intent !== 'background' &&
      !existing.admitted
    )
      return continueExplicit()
    return result
  } finally {
    if (onProgress) existing.sinks.delete(onProgress)
  }
}

/** The accepted closing may omit a second thank-you; deliver the actual local frame. */
export function deliveredReplyFrame(
  frame:
    import('#/shared/reply-drafting-v2-frame').ReplyDraftingV2Frame | null | undefined,
  text: string,
): Readonly<{ localFrame?: Readonly<{ prefix: string; suffix: string }> }> {
  const selected = frame?.candidates.find(
    (candidate) => text.startsWith(candidate.prefix) && text.endsWith(candidate.suffix),
  )
  return selected
    ? { localFrame: { prefix: selected.prefix, suffix: selected.suffix } }
    : {}
}

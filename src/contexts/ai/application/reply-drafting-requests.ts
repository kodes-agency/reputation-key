import { AI_PERSONALIZED_REPLY_LANGUAGES } from '#/shared/ai-personalized-reply-contract'
import type { AiOperationState } from './ports/ai-operation-store.port'
import { REPLY_DRAFTING_V2_LANGUAGES } from '#/shared/reply-drafting-v2-schema'
import { aiRequestFingerprint } from './ai-workflow-support'
import type {
  GenerateReplySuggestionDependencies,
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from './reply-suggestion-contract'
import {
  admitInteractiveDraft,
  type ReplyDraftingV2Attempt,
} from './reply-drafting-v2-workflow'
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
  attempt?: ReplyDraftingV2Attempt,
): void {
  if (!attempt) return
  reportReplyProgress(
    input.onProgress,
    attempt.rewriteOrdinal === 1
      ? { step: 'rewording', ordinal: 1 }
      : { step: 'reading' },
  )
}

/** Only the currently executing promise/metadata is owned here. No completed draft cache. */
export function manageReplyDraftingRequests(
  deps: GenerateReplySuggestionDependencies,
  attempt: ReplyDraftingV2Attempt | undefined,
  execute: (
    input: GenerateReplySuggestionInput,
  ) => Promise<GenerateReplySuggestionResult>,
): typeof execute {
  if (!attempt)
    return (input) =>
      input.intent === 'background'
        ? Promise.resolve({
            status: 'unavailable',
            code: 'policy_unavailable',
            retryAfterEpochMillis: null,
          })
        : execute(input)
  if (attempt.rewriteOrdinal !== 0) return execute
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
        execute,
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
  deps: GenerateReplySuggestionDependencies,
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
  attempt: ReplyDraftingV2Attempt | undefined,
  input: GenerateReplySuggestionInput,
): [] | [ReplyDraftingProgressSink | undefined] {
  return attempt ? [input.onProgress] : []
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
    supported: ReadonlySet<string>,
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
  const language = await resolvers.language(
    deps,
    input,
    source.observation,
    new Set(REPLY_DRAFTING_V2_LANGUAGES),
  )
  const grant = await resolvers.grant(deps, input)
  return (
    language.kind === 'draftable' &&
    language.concreteReplyLanguage.tag === languageTag &&
    grant.kind === 'granted' &&
    grant.profile.profileVersion === profileVersion
  )
}

export const PERSONALIZED_LANGUAGE_SET: ReadonlySet<string> = new Set(
  AI_PERSONALIZED_REPLY_LANGUAGES,
)

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

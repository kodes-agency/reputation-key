import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import type {
  GenerateReplySuggestionDependencies,
  GenerateReplySuggestionInput,
} from './reply-suggestion-contract'
import { resolveReplyDraftingV2Options } from '#/shared/reply-drafting-v2-request'
import type { AiExecutionBinding } from '../domain/types'
import { aiRequestFingerprint } from './ai-workflow-support'
import type { AiAdmissionPort } from './ports/ai-admission.port'
import type { ReplyBodyIssueCode } from '#/shared/domain/reply-body-lint-policy'

export type ReplyDraftingV2Attempt = Readonly<{
  parentOperationId: string | null
  rewriteOrdinal: 0 | 1
  rewriteIssues: readonly ReplyBodyIssueCode[]
  logicalDeadlineEpochMillis?: number
}>

function rootReplyDraftingV2Attempt(): ReplyDraftingV2Attempt {
  return { parentOperationId: null, rewriteOrdinal: 0, rewriteIssues: [] }
}

export function replyDraftingV2GenerationSeed(
  input: Readonly<{
    organizationId: string
    propertyId: string
    reviewId: string
    actorUserId: string
    idempotencyKey: string
  }>,
): string {
  return aiRequestFingerprint({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
    actorId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
  })
}

export function releaseReplyAdmissionOnce(
  admission: AiAdmissionPort,
  admissionId: string,
) {
  let released: Promise<void> | null = null
  return () => (released ??= admission.release({ admissionId }))
}

export async function rewriteReplyDraftingV2<Result>(
  input: Readonly<{
    attempt: ReplyDraftingV2Attempt | undefined
    operationId: string
    issues: readonly ReplyBodyIssueCode[] | undefined
    nowEpochMillis: number
    recheck: () => Promise<boolean>
    release: () => Promise<void>
    execute: (attempt: ReplyDraftingV2Attempt, idempotencyKey: string) => Promise<Result>
    refused: Result
    isBusy: (result: Result) => boolean
  }>,
): Promise<Result> {
  const { attempt, issues } = input
  if (!attempt || attempt.rewriteOrdinal !== 0 || !issues?.length) return input.refused
  const deadline = attempt.logicalDeadlineEpochMillis ?? input.nowEpochMillis + 150_000
  if (input.nowEpochMillis >= deadline || !(await input.recheck())) return input.refused
  await input.release()
  const rewritten = await input.execute(
    {
      parentOperationId: input.operationId,
      rewriteOrdinal: 1,
      rewriteIssues: [...new Set(issues)].sort(),
      logicalDeadlineEpochMillis: deadline,
    },
    aiRequestFingerprint({ parentOperationId: input.operationId, rewriteOrdinal: 1 }),
  )
  // The manager's draft has already failed. A lane too full for its one rewrite
  // leaves that the answer, and a new press is a new draft, not a busy retry.
  return input.isBusy(rewritten) ? input.refused : rewritten
}

export function bindReplyDraftingV2(
  base: AiExecutionBinding,
  facts: Readonly<{
    attempt: ReplyDraftingV2Attempt | undefined
    languageCode: string
    generationSeed: string
    voiceDigest: string | null
    input: Readonly<{
      variation?: number
      length?: 'standard' | 'short'
      maxWords?: number
    }>
  }>,
): AiExecutionBinding {
  const { attempt, input } = facts
  if (!attempt) return base
  if (!facts.voiceDigest) throw new TypeError('V2 reply requires a bound voice')
  return {
    ...base,
    providerDeploymentProfileVersion: 'private-beta-global-v3',
    replyDraftingV2: {
      options: resolveReplyDraftingV2Options({
        languageCode: facts.languageCode,
        variation:
          input.variation ?? Number.parseInt(facts.generationSeed.slice(0, 8), 16),
        ...(input.length === undefined ? {} : { length: input.length }),
        ...(input.maxWords === undefined ? {} : { maxWords: input.maxWords }),
      }),
      voiceDigest: facts.voiceDigest,
      generationSeed: facts.generationSeed,
      parentOperationId: attempt.parentOperationId,
      rewriteOrdinal: attempt.rewriteOrdinal,
      rewriteIssues: [...attempt.rewriteIssues],
    },
  }
}

/**
 * How long a draft request may wait for an interactive slot before answering
 * busy. Short enough that the manager is never left staring at a spinner, long
 * enough to absorb a slot that frees within the same request.
 */
const REPLY_ADMISSION_WAIT_MILLIS = 4_000

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/**
 * Take an interactive slot, waiting up to REPLY_ADMISSION_WAIT_MILLIS when the
 * lane says one frees in time. A busy answer consumes nothing, so asking again
 * is free; a slot that frees later than the wait allows is reported as busy
 * with its retry time rather than waited for.
 */
export async function admitInteractiveDraft(
  dependencies: Pick<
    GenerateReplySuggestionDependencies,
    'admission' | 'nowEpochMillis' | 'sleep'
  >,
  input: Pick<GenerateReplySuggestionInput, 'organizationId' | 'propertyId'>,
  startedAtEpochMillis: number,
) {
  const sleep = dependencies.sleep ?? defaultSleep
  const deadline = startedAtEpochMillis + REPLY_ADMISSION_WAIT_MILLIS
  let nowEpochMillis = startedAtEpochMillis
  for (;;) {
    const claim = await dependencies.admission.acquire({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      lane: 'interactive',
      nowEpochMillis,
    })
    if (claim.ok || claim.code !== 'admission_busy') return claim
    if (claim.retryAfterEpochMillis > deadline) return claim
    await sleep(Math.max(50, claim.retryAfterEpochMillis - nowEpochMillis))
    nowEpochMillis = Math.max(nowEpochMillis + 1, dependencies.nowEpochMillis())
  }
}

/** The explicit attempt is a contract-test seam; production follows the served catalogue. */
export function selectedReplyDraftingAttempt(
  attempt?: ReplyDraftingV2Attempt,
): ReplyDraftingV2Attempt | undefined {
  return (
    attempt ??
    (getAiRuntimeCapability('reply_drafting').operationProfileVersion ===
    'reply-suggestion-v2'
      ? rootReplyDraftingV2Attempt()
      : undefined)
  )
}

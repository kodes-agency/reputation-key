import type {
  GenerateReplySuggestionDependencies,
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from './reply-suggestion-contract'

/** Only error classification is safe to log, including wrapped database failures. */
function measurementFailure(error: unknown) {
  const failure =
    error instanceof Error && error.cause instanceof Error ? error.cause : error
  return {
    errorName: failure instanceof Error ? failure.name : 'UnknownError',
    errorCode:
      failure !== null &&
      typeof failure === 'object' &&
      'code' in failure &&
      typeof failure.code === 'string'
        ? failure.code
        : undefined,
  }
}

/** The rewrite is a provider attempt of its parent's logical generation. */
export function measureReplyDrafting(
  deps: Pick<
    GenerateReplySuggestionDependencies,
    'measurements' | 'nowEpochMillis' | 'logger'
  >,
  contract: 'v1' | 'v2',
  execute: (
    input: GenerateReplySuggestionInput,
  ) => Promise<GenerateReplySuggestionResult>,
): typeof execute {
  if (!deps.measurements) return execute
  return async (input) => {
    const started = deps.nowEpochMillis()
    const result = await execute(input)
    if (!deps.measurements || input.templateOnly || result.status === 'fallback')
      return result
    try {
      const generationId = await deps.measurements.record({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        actorUserId: input.actorUserId,
        requestKey: input.idempotencyKey,
        intent: input.intent ?? 'explicit',
        trigger: input.trigger ?? (input.length === 'short' ? 'shorter' : 'draft'),
        contract,
        outcome: result.status === 'ready' ? 'ready' : 'refused',
        refusalCode: result.status === 'unavailable' ? result.code : null,
        case: result.status === 'ready' ? (result.case ?? null) : null,
        latencyMs: Math.min(
          2147483647,
          Math.max(0, Math.round(deps.nowEpochMillis() - started)),
        ),
      })
      if (!generationId)
        deps.logger?.warn(
          { errorCode: 'measurement_not_recorded' },
          'Draft measurement skipped',
        )
      return result.status === 'ready' && generationId
        ? { ...result, measurementGenerationId: generationId }
        : result
    } catch (error) {
      // Never log the error object, message, request identity or generated content.
      deps.logger?.warn(measurementFailure(error), 'Draft measurement failed')
      return result
    }
  }
}

/** Only the root request is a generation; automatic rewrites keep their parent. */
export function measureReplyDraftingAttempt(
  deps: Pick<
    GenerateReplySuggestionDependencies,
    'measurements' | 'nowEpochMillis' | 'logger'
  >,
  attempt: import('./reply-drafting-v2-workflow').ReplyDraftingV2Attempt | undefined,
  execute: (
    input: GenerateReplySuggestionInput,
  ) => Promise<GenerateReplySuggestionResult>,
): typeof execute {
  return attempt?.rewriteOrdinal === 1
    ? execute
    : measureReplyDrafting(deps, attempt ? 'v2' : 'v1', execute)
}

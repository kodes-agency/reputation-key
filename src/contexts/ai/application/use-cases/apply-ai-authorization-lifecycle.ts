import type {
  AiAuthorizationLifecycleApplyResult,
  AiAuthorizationLifecycleTrigger,
  ReviewAnalysisEnrollmentStorePort,
} from '../ports/ai-review-analysis-enrollment.port'

export type ApplyAiAuthorizationLifecycleInput = AiAuthorizationLifecycleTrigger

export type ApplyAiAuthorizationLifecycleDeps = Readonly<{
  enrollments: ReviewAnalysisEnrollmentStorePort
}>

/**
 * Apply one Identity authorization transition through the single AI lifecycle
 * command store. The store is the transaction authority because the current
 * Identity/Property fence, local-derivative containment evidence, enrollment
 * outcome, supersession, and consumer receipt must commit together.
 */
export const createApplyAiAuthorizationLifecycle = (
  dependencies: ApplyAiAuthorizationLifecycleDeps,
): ((
  input: ApplyAiAuthorizationLifecycleInput,
) => Promise<AiAuthorizationLifecycleApplyResult>) => {
  return (input) => dependencies.enrollments.applyAuthorizationLifecycle(input)
}

export type ApplyAiAuthorizationLifecycle = ReturnType<
  typeof createApplyAiAuthorizationLifecycle
>

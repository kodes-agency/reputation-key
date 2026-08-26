import {
  type BetaFeedbackInput,
  classifyBetaFeedbackViewport,
} from '#/shared/beta-feedback-contract'

export type SubmitBetaFeedback = (
  input: Readonly<{ data: BetaFeedbackInput }>,
) => Promise<Readonly<{ reference: string }>>

export type BetaFeedbackFormProps = Readonly<{
  submitFeedback: SubmitBetaFeedback
  onSubmitted: (reference: string) => void
}>

export function currentBetaFeedbackContext() {
  return {
    routePath: typeof window === 'undefined' ? '/' : window.location.pathname,
    viewport: classifyBetaFeedbackViewport(
      typeof window === 'undefined' ? 1_024 : window.innerWidth,
    ),
  } as const
}

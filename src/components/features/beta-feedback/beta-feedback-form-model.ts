// The shape the reporter fills in, and how it becomes the wire contract.
//
// The form deliberately does not mirror `betaFeedbackInputSchema`: a good bug
// report is three short answers, while the contract carries one `message`. The
// fold happens here so the component stays presentation and the rules stay
// testable.

import { z } from 'zod/v4'
import {
  BUG_IMPACTS,
  SUGGESTION_IMPACTS,
  type BetaFeedbackImpact,
  type BetaFeedbackInput,
  type BetaFeedbackType,
} from '#/shared/beta-feedback-contract'
import type { MaskedLayout } from '#/shared/beta-feedback-layout'
import {
  composeBetaFeedbackMessage,
  DEFAULT_IMPACT,
  IMPACT_LABELS,
} from '#/shared/beta-feedback-narrative'
import type { BetaFeedbackChoice } from './beta-feedback-choice'

export const betaFeedbackFormSchema = z
  .object({
    kind: z.enum(['bug', 'suggestion']),
    impact: z.enum([...BUG_IMPACTS, ...SUGGESTION_IMPACTS]),
    /** Bug only: what the reporter was trying to do. */
    context: z.string().max(2_000).default(''),
    /** The one answer every report needs. */
    observed: z.string().trim().min(3, 'Please describe what happened.').max(2_000),
    /** Bug only: what they expected instead. */
    expected: z.string().max(2_000).default(''),
    /** Opt-in link to an error monitoring already recorded this session. */
    includeRecordedError: z.boolean().default(false),
    /** Per-submission consent for the masked layout; BETA.md §3 requires it
     *  to be explicit, so it starts false on every report. */
    includeMaskedLayout: z.boolean().default(false),
  })
  .strict()

export type BetaFeedbackFormValues = z.input<typeof betaFeedbackFormSchema>

export const emptyBetaFeedbackForm: BetaFeedbackFormValues = Object.freeze({
  kind: 'bug',
  impact: DEFAULT_IMPACT.bug,
  context: '',
  observed: '',
  expected: '',
  includeRecordedError: false,
  includeMaskedLayout: false,
})

type RouteContext = Readonly<{
  routePath: string
  viewport: BetaFeedbackInput['viewport']
}>

/**
 * Fold the answers into the wire contract. The recorded error id is attached
 * only for a Bug the reporter opted in on — the contract rejects it otherwise.
 */
export function toBetaFeedbackInput(
  values: z.output<typeof betaFeedbackFormSchema>,
  route: RouteContext,
  recordedErrorId: string | null,
  maskedLayout: MaskedLayout | null = null,
): BetaFeedbackInput {
  const attachError =
    values.kind === 'bug' && values.includeRecordedError && recordedErrorId !== null
  const attachLayout =
    values.kind === 'bug' && values.includeMaskedLayout && maskedLayout !== null

  return {
    kind: values.kind,
    impact: values.impact,
    message: composeBetaFeedbackMessage(values.kind, {
      context: values.context,
      observed: values.observed,
      expected: values.expected,
    }),
    routePath: route.routePath,
    viewport: route.viewport,
    clientErrorEventId: attachError ? recordedErrorId : null,
    maskedLayout: attachLayout ? maskedLayout : null,
  }
}

/** Impact is scored on a different scale per type, so the options swap with it. */
export function impactOptionsFor(
  kind: BetaFeedbackType,
): ReadonlyArray<BetaFeedbackChoice<BetaFeedbackImpact>> {
  const codes = kind === 'bug' ? BUG_IMPACTS : SUGGESTION_IMPACTS
  return codes.map((code) => ({ value: code, label: IMPACT_LABELS[code] }))
}

/** Switching type invalidates the current impact; move to that type's default. */
export function impactForType(
  kind: BetaFeedbackType,
  current: BetaFeedbackImpact,
): BetaFeedbackImpact {
  const allowed: ReadonlyArray<string> = kind === 'bug' ? BUG_IMPACTS : SUGGESTION_IMPACTS
  return allowed.includes(current) ? current : DEFAULT_IMPACT[kind]
}

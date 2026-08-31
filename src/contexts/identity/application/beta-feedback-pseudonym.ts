// OBS-01: content-free beta-feedback pseudonyms.
//
// The derivation is shared by two callers that live on opposite sides of a
// trust boundary: the HTTP server functions that rate-limit and report
// feedback, and the audited operator triage command. It is a pure keyed
// digest with no transport concern, so it belongs in application/ — keeping
// it in server/ forced scripts/ops/triage-beta-feedback.ts to import a
// browser-facing inbound adapter (ARC-03-T1).

import { createHmac } from 'node:crypto'

/**
 * Domain separation label. Every audience derives an unlinkable pseudonym for
 * the same subject, so a rate-limit key can never be correlated with a
 * telemetry field or a triage record.
 */
export type BetaFeedbackPseudonymAudience =
  | 'rate-limit-actor'
  | 'rate-limit-organization'
  | 'telemetry-actor'
  | 'telemetry-organization'
  | 'triage-operator'
  | 'triage-owner'

export function betaFeedbackPseudonym(
  secret: string,
  audience: BetaFeedbackPseudonymAudience,
  value: string,
): string {
  return createHmac('sha256', secret)
    .update(`repkey:beta-feedback:${audience}:v1\0`)
    .update(value)
    .digest('hex')
}

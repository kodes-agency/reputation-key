// What the app says of an Urgent review's reason, in one place so the Inbox and Guest
// voice never word it twice. Browser-safe words only: the reason itself is a closed
// enum the analysis stores (`ReviewUrgentReasonV3`), and it is read in the app, never
// carried by a notice or an email (ADR 0046 r.8).
import type { ReviewUrgentReasonV3 } from './review-analysis-v3'

/** The same reason as a sentence about the guest, for the review it explains. */
export const URGENT_REASON_SENTENCES_V3: Readonly<Record<ReviewUrgentReasonV3, string>> =
  Object.freeze({
    safety: 'The guest reports a risk to safety.',
    health: 'The guest reports a risk to health.',
    discrimination: 'The guest reports discrimination.',
    legal_threat: 'The guest says they will take legal action or report the business.',
  })

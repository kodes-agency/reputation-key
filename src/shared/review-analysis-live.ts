/**
 * Whether review analysis v3 is the analysis the product runs: true since the switch-on
 * (2026-10-30). What only v3 produces (the Urgent alert, the Monday Guest voice summary)
 * is offered in Settings only while it is, and `ai-runtime-capability-contract.test.ts`
 * pins this to the runtime catalogue's selection, so turning the selection back turns
 * this back with it, and the preferences for what v3 does not produce go with it.
 *
 * Its own module, because Settings imports it: the rest of `review-analysis-v3.ts` is a
 * schema module that would join the first paint for one constant.
 */
export const REVIEW_ANALYSIS_V3_LIVE: boolean = true

/**
 * The closed, content-free flags a normalizer run may record on its operation
 * (`REVIEW_ANALYSIS_NORMALIZATION_FLAGS`, which imports server-only code this
 * schema must not). `ai-review-analysis-v3.schema.test.ts` holds the two lists equal. The list
 * has its own module because ai.schema.ts is a grandfathered module of the file-length
 * ratchet, which may not grow, and a flag is a line.
 */
export const NORMALIZATION_FLAGS = [
  'mentions_capped',
  'sentence_refs_capped',
  'enum_case_repaired',
  'mention_dropped_malformed',
  'mention_dropped_enum',
  'mention_dropped_cause',
  'mention_dropped_sentences',
  'sentence_refs_repaired',
  'cause_refused_name',
  'cause_refused_quotation',
  'cause_refused_shape',
  'names_person_invalid',
  'names_person_raised',
  'mentions_merged',
  'urgent_reason_unknown',
] as const

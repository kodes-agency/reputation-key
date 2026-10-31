/** Which reply-output rule refused. Identifiers only, no provider content. */
export type AiReplyOutputRefusal = Readonly<{
  route: 'reply-suggestion'
  reason:
    | 'shape'
    | 'language'
    | 'grounding'
    | 'brand'
    | 'prohibited_content'
    | 'profile_version_mismatch'
    | 'language_verification'
    | 'reply_limits'
    | 'adoption_window_elapsed'
    | 'scanner_unavailable'
    | import('#/shared/domain/reply-body-lint-policy').ReplyBodyIssueCode
}>

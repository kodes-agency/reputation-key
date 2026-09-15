// Server import exception per src/components/CONTEXT.md "Server-function boundary" —
// this hook owns the reply command family (8 commands) plus the template
// list/load actions. The reply's read-only states render in the thread while the
// draft lives in the composer, so both surfaces drive one cohesive workflow;
// value imports stay centralized here instead of prop drilling the same ten
// server functions through two regions of the detail pane.

import {
  draftReplyFn,
  submitReplyFn,
  approveReplyFn,
  rejectReplyFn,
  deleteReplyFn,
  retryPublishFn,
  checkReplyPublicationFn,
  editPublishedReplyFn,
  listReplyTemplatesFn,
  loadReplyTemplateFn,
} from '#/contexts/review/server/reply'
import { useQueryClient } from '@tanstack/react-query'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import type { ReplyPublicationCheckResult } from '#/contexts/review/application/public-api'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'
import { inboxCachePolicy, type InboxReplyCacheChange } from './inbox-cache-policy'
import { replyCheckMutationOptions } from './reply-check-feedback'
import type { ReplyLanguageTarget } from './reply-language-options'
import type { LoadedReplyTemplateDraft } from './reply-suggestion-contract'

export type ReplyActions = Readonly<{
  isSaving: boolean
  saveDraft: (
    text: string,
    provenanceToken?: string,
    replyLanguageTag?: string,
  ) => Promise<unknown>
  submitReply: () => Promise<unknown>
  deleteDraft: () => Promise<unknown>
  approve: () => Promise<unknown>
  reject: (reason?: string) => Promise<unknown>
  /** Resolves what the check found; rejects (after its toast) only on an error. */
  check: () => Promise<ReplyPublicationCheckResult>
  retry: () => Promise<unknown>
  saveEdit: (text: string) => Promise<unknown>
  listTemplates: (targetLanguage: ReplyLanguageTarget) => Promise<ReplyTemplateListResult>
  loadTemplate: (
    templateId: string,
    targetLanguage: ReplyLanguageTarget,
  ) => Promise<LoadedReplyTemplateDraft>
}>

type CommandInput = Readonly<{ data: Readonly<{ reviewId: string }> }>

type Input = Readonly<{
  reviewId: string
  onReplyChanged: (change: InboxReplyCacheChange) => void
}>

/**
 * The reply command family as one bag of callbacks. `check` and `retry` are
 * different server functions: `checkReplyPublicationFn` only reads Google and
 * returns what it found, while `retryPublishFn` starts a new publication cycle
 * and refuses any reply Google may already have (plan D5). `isSaving`
 * deliberately excludes the draft, template-list and template-load mutations so
 * an autosave in flight never disables the action row.
 *
 * Every command a manager clicks opts into `errorMessage`. `Action` is
 * `mutateAsync`, so the call sites guard the promise against an unhandled
 * rejection, and before this nothing else reported a refusal: a failed
 * approve, reject, retry, update or check left the pane exactly as it was. The
 * draft and template mutations stay silent — autosave reports its own state in
 * the composer.
 */
export function useReplyActions(input: Input): ReplyActions {
  const { reviewId, onReplyChanged } = input
  const qc = useQueryClient()
  // The review a result belongs to comes from the command's own input, never
  // from `reviewId` above: a command that settles after the manager opened
  // another item runs these callbacks as that item's render built them
  // (`InboxReplyCacheChange.reviewId`).
  const changed =
    (kind: InboxReplyCacheChange['kind']) =>
    (reply: InboxReplyCacheChange['reply'], command: CommandInput) =>
      onReplyChanged({ kind, reply, reviewId: command.data.reviewId })
  const draft = useActionMutation(draftReplyFn, {
    onSuccess: changed('draft_saved'),
  })
  const submit = useActionMutation(submitReplyFn, {
    // Plan v2.1 row 14: the line under the composer that said a reply
    // "publishes only after approval" is gone. The guarantee now lives on
    // `Submit for approval`'s tooltip (`reply-composer-footer.tsx`) and HERE —
    // a phone never opens a tooltip, and this toast fires on every device at
    // the one moment the sentence is true of what the manager just did.
    successMessage:
      'Submitted for approval — nothing publishes until a manager approves it',
    errorMessage: actionErrorMessage,
    onSuccess: changed('state_changed'),
  })
  const approve = useActionMutation(approveReplyFn, {
    successMessage: 'Confirmation recorded. Waiting for Google',
    errorMessage: actionErrorMessage,
    onSuccess: changed('state_changed'),
  })
  const reject = useActionMutation(rejectReplyFn, {
    successMessage: 'Reply rejected',
    errorMessage: actionErrorMessage,
    onSuccess: changed('state_changed'),
  })
  const del = useActionMutation(deleteReplyFn, {
    successMessage: 'Reply deleted',
    errorMessage: actionErrorMessage,
    onSuccess: (_deleted, command) => changed('state_changed')(null, command),
  })
  const check = useActionMutation(
    checkReplyPublicationFn,
    replyCheckMutationOptions({
      reviewId,
      onReplyChanged,
      onCheckFailed: (checkedReviewId) =>
        inboxCachePolicy.onReplyCheckFailed(qc, checkedReviewId),
    }),
  )
  const retry = useActionMutation(retryPublishFn, {
    successMessage: 'Publishing restarted',
    errorMessage: actionErrorMessage,
    onSuccess: changed('state_changed'),
  })
  const edit = useActionMutation(editPublishedReplyFn, {
    successMessage: 'Update confirmed. Waiting for Google',
    errorMessage: actionErrorMessage,
    onSuccess: changed('state_changed'),
  })
  const listTemplates = useActionMutation(listReplyTemplatesFn)
  const loadTemplate = useActionMutation(loadReplyTemplateFn, {
    onSuccess: changed('draft_saved'),
  })
  const isSaving = [submit, approve, reject, del, check, retry, edit].some(
    (mutation) => mutation.isPending,
  )

  return {
    isSaving,
    saveDraft: (text, provenanceToken, replyLanguageTag) =>
      draft({
        data: {
          reviewId,
          text,
          ...(replyLanguageTag ? { replyLanguageTag } : {}),
          ...(provenanceToken ? { provenanceToken } : {}),
        },
      }),
    submitReply: () => submit({ data: { reviewId } }),
    deleteDraft: () => del({ data: { reviewId } }),
    approve: () => approve({ data: { reviewId } }),
    reject: (reason) => reject({ data: { reviewId, reason } }),
    check: () => check({ data: { reviewId } }),
    retry: () => retry({ data: { reviewId } }),
    saveEdit: (text) => edit({ data: { reviewId, text } }),
    listTemplates: (targetLanguage) =>
      listTemplates({ data: { reviewId, targetLanguage } }),
    loadTemplate: (templateId, targetLanguage) =>
      loadTemplate({ data: { reviewId, templateId, targetLanguage } }),
  }
}

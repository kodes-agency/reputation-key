// Server import exception per src/components/CONTEXT.md "Server-function boundary" —
// this hook owns the reply command family (9 mutations) plus the template
// list/load actions. The reply's read-only states render in the thread while the
// draft lives in the composer, so both surfaces drive one cohesive workflow;
// value imports stay centralized here instead of prop drilling the same nine
// server functions through two regions of the detail pane.

import {
  draftReplyFn,
  submitReplyFn,
  approveReplyFn,
  rejectReplyFn,
  deleteReplyFn,
  retryPublishFn,
  editPublishedReplyFn,
  listReplyTemplatesFn,
  loadReplyTemplateFn,
} from '#/contexts/review/server/reply'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'
import type { InboxReplyCacheChange } from './inbox-cache-policy'
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
  check: () => Promise<unknown>
  retry: () => Promise<unknown>
  saveEdit: (text: string) => Promise<unknown>
  listTemplates: (targetLanguage: ReplyLanguageTarget) => Promise<ReplyTemplateListResult>
  loadTemplate: (
    templateId: string,
    targetLanguage: ReplyLanguageTarget,
  ) => Promise<LoadedReplyTemplateDraft>
}>

type Input = Readonly<{
  reviewId: string
  onReplyChanged: (change: InboxReplyCacheChange) => void
}>

/**
 * The reply command family as one bag of callbacks. `check` and `retry` are two
 * mutations over the SAME server function (`retryPublishFn`): the server decides
 * check-vs-resend, and only the success toast differs. `isSaving` deliberately
 * excludes the draft, template-list and template-load mutations so an autosave
 * in flight never disables the action row.
 */
export function useReplyActions(input: Input): ReplyActions {
  const { reviewId, onReplyChanged } = input
  const draft = useActionMutation(draftReplyFn, {
    onSuccess: (reply) => onReplyChanged({ kind: 'draft_saved', reply }),
  })
  const submit = useActionMutation(submitReplyFn, {
    // Plan v2.1 row 14: the line under the composer that said a reply
    // "publishes only after approval" is gone. The guarantee now lives on
    // `Submit for approval`'s tooltip (`reply-composer-footer.tsx`) and HERE —
    // a phone never opens a tooltip, and this toast fires on every device at
    // the one moment the sentence is true of what the manager just did.
    successMessage:
      'Submitted for approval — nothing publishes until a manager approves it',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const approve = useActionMutation(approveReplyFn, {
    successMessage: 'Confirmation recorded. Waiting for Google',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const reject = useActionMutation(rejectReplyFn, {
    successMessage: 'Reply rejected',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const del = useActionMutation(deleteReplyFn, {
    successMessage: 'Reply deleted',
    onSuccess: () => onReplyChanged({ kind: 'state_changed', reply: null }),
  })
  const check = useActionMutation(retryPublishFn, {
    successMessage: 'Google check complete',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const retry = useActionMutation(retryPublishFn, {
    successMessage: 'Publishing restarted',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const edit = useActionMutation(editPublishedReplyFn, {
    successMessage: 'Update confirmed. Waiting for Google',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const listTemplates = useActionMutation(listReplyTemplatesFn)
  const loadTemplate = useActionMutation(loadReplyTemplateFn, {
    onSuccess: (reply) => onReplyChanged({ kind: 'draft_saved', reply }),
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

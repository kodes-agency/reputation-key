import {
  createCld3ReplyLanguageDetector,
  resolveConcreteReplyLanguage,
} from '#/shared/ai-reply-language-verifier'
import {
  draftReply,
  submitReply,
  approveReply,
  rejectReply,
  deleteReply,
  retryPublish,
  editPublishedReply,
} from './replies/reply-operations.server'
import {
  checkReplyDraft,
  listReplyTemplates,
  loadReplyTemplate,
  type ResolveReplyTemplateLanguage,
} from './library/layered-reply-template-operations.server'
import {
  getReplyLibrary,
  resetReplyTemplate,
  saveReplyTemplate,
  saveReplyVoice,
  setReplyTemplateHidden,
} from './library/reply-library-layer-operations.server'
import { checkReplyPublication } from './publication/check-reply-publication.server'
import type { ReplyDeps } from './replies/reply-operations.server'
import type { ReplyLibraryRepository } from './library/reply-library-repository.port.server'
import type { ReconcileReplyPublication } from './publication/reconcile-reply-publication.server'
import type { LoggerPort } from '#/shared/domain/logger.port'

export function wireReplyUseCases(
  input: Readonly<{
    deps: ReplyDeps
    library: ReplyLibraryRepository
    resolveReplyLanguage?: ResolveReplyTemplateLanguage
    reconcileReplyPublication: ReconcileReplyPublication
    logger: LoggerPort
  }>,
) {
  const draftReplyUseCase = draftReply(input.deps)
  let replyLanguageDetector:
    Awaited<ReturnType<typeof createCld3ReplyLanguageDetector>> | undefined
  const resolveReplyLanguage =
    input.resolveReplyLanguage ??
    (async (request: Parameters<ResolveReplyTemplateLanguage>[0]) => {
      replyLanguageDetector ??= await createCld3ReplyLanguageDetector()
      return resolveConcreteReplyLanguage({
        ...request,
        detector: replyLanguageDetector,
      })
    })
  const layeredReplyTemplateDeps = {
    repository: input.library,
    reviewRepo: input.deps.reviewRepo,
    staffPublicApi: input.deps.staffPublicApi,
    draftReply: draftReplyUseCase,
    resolveReplyLanguage,
  }
  const replyLibraryDeps = {
    repository: input.library,
    staffPublicApi: input.deps.staffPublicApi,
  }

  return {
    draftReply: draftReplyUseCase,
    submitReply: submitReply(input.deps),
    approveReply: approveReply(input.deps),
    rejectReply: rejectReply(input.deps),
    deleteReply: deleteReply(input.deps),
    retryPublish: retryPublish(input.deps),
    checkReplyPublication: checkReplyPublication({
      replyRepo: input.deps.replyRepo,
      reviewRepo: input.deps.reviewRepo,
      staffPublicApi: input.deps.staffPublicApi,
      commandStore: input.deps.commandStore,
      dispatchEvidence: input.deps.dispatchEvidence,
      reconcileReplyPublication: input.reconcileReplyPublication,
      clock: input.deps.clock,
      logger: input.logger,
    }),
    editPublishedReply: editPublishedReply(input.deps),
    listReplyTemplates: listReplyTemplates(layeredReplyTemplateDeps),
    loadReplyTemplate: loadReplyTemplate(layeredReplyTemplateDeps),
    checkReplyDraft: checkReplyDraft(layeredReplyTemplateDeps),
    getReplyLibrary: getReplyLibrary(replyLibraryDeps),
    saveReplyVoice: saveReplyVoice(replyLibraryDeps),
    saveReplyTemplate: saveReplyTemplate(replyLibraryDeps),
    setReplyTemplateHidden: setReplyTemplateHidden(replyLibraryDeps),
    resetReplyTemplate: resetReplyTemplate(replyLibraryDeps),
  } as const
}

export function projectReviewReplyApi(useCases: ReturnType<typeof wireReplyUseCases>) {
  return Object.freeze({
    draft: useCases.draftReply,
    submit: useCases.submitReply,
    approve: useCases.approveReply,
    editPublished: useCases.editPublishedReply,
    reject: useCases.rejectReply,
    delete: useCases.deleteReply,
    retryPublish: useCases.retryPublish,
    checkPublication: useCases.checkReplyPublication,
    listTemplates: useCases.listReplyTemplates,
    loadTemplate: useCases.loadReplyTemplate,
    checkDraft: useCases.checkReplyDraft,
    getLibrary: useCases.getReplyLibrary,
    saveVoice: useCases.saveReplyVoice,
    saveTemplate: useCases.saveReplyTemplate,
    setTemplateHidden: useCases.setReplyTemplateHidden,
    resetTemplate: useCases.resetReplyTemplate,
  })
}

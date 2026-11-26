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
    reconcileReplyPublication: ReconcileReplyPublication
    logger: LoggerPort
  }>,
) {
  const draftReplyUseCase = draftReply(input.deps)
  let replyLanguageDetector:
    Awaited<ReturnType<typeof createCld3ReplyLanguageDetector>> | undefined
  const resolveReplyLanguage: ResolveReplyTemplateLanguage = async (request) => {
    replyLanguageDetector ??= await createCld3ReplyLanguageDetector()
    return resolveConcreteReplyLanguage({ ...request, detector: replyLanguageDetector })
  }
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

  return Object.freeze({
    draft: draftReplyUseCase,
    submit: submitReply(input.deps),
    approve: approveReply(input.deps),
    reject: rejectReply(input.deps),
    delete: deleteReply(input.deps),
    retryPublish: retryPublish(input.deps),
    checkPublication: checkReplyPublication({
      replyRepo: input.deps.replyRepo,
      reviewRepo: input.deps.reviewRepo,
      staffPublicApi: input.deps.staffPublicApi,
      commandStore: input.deps.commandStore,
      dispatchEvidence: input.deps.dispatchEvidence,
      reconcileReplyPublication: input.reconcileReplyPublication,
      clock: input.deps.clock,
      logger: input.logger,
    }),
    editPublished: editPublishedReply(input.deps),
    listTemplates: listReplyTemplates(layeredReplyTemplateDeps),
    loadTemplate: loadReplyTemplate(layeredReplyTemplateDeps),
    checkDraft: checkReplyDraft(layeredReplyTemplateDeps),
    getLibrary: getReplyLibrary(replyLibraryDeps),
    saveVoice: saveReplyVoice(replyLibraryDeps),
    saveTemplate: saveReplyTemplate(replyLibraryDeps),
    setTemplateHidden: setReplyTemplateHidden(replyLibraryDeps),
    resetTemplate: resetReplyTemplate(replyLibraryDeps),
  })
}

import type { LoggerPort } from '#/shared/domain/logger.port'
import { getExecutionPolicy, type DecisionRequest } from '#/shared/auth/execution-policy'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/public-api'
import type { PropertyPublicApi } from '#/contexts/property/public-api'
import type { ActiveConnectionTokenProvider } from '../connections/active-connection-token-provider.server'
import {
  createGoogleImportCommandAuthorizer,
  createGoogleImportReauthorizer,
  type GoogleImportContentAuthorizer,
} from './google-import-command-authorizer.server'
import { createGoogleImportDiscovery } from './google-import-discovery.server'
import { createGoogleImportPropertyClassifier } from './google-import-property-classifier.server'
import { createGoogleImportTransaction } from './google-import-transaction.server'
import { createGoogleImportLifecycle } from './google-import-lifecycle.server'
import { createGoogleImportProcessor } from './google-import-processor.server'
import type { GoogleImportStore } from './import-store.port.server'
import type { GoogleImportReferenceStore } from './durable-import-reference-store.port.server'
import { createRefreshBoundGoogleCategories } from './refresh-bound-google-categories.server'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderTokenAccess,
} from '../provider/google-client.port.server'
import { createSingle401RefreshExecutor } from '../provider/google-client.server'
import { createGoogleAccountManagementAdapter } from './google-account-management.adapter.server'
import { createGoogleBusinessInformationAdapter } from './google-business-information.adapter.server'
import type { ActiveMemberAuthResolver } from '../provider/active-member-auth.adapter.server'
import type { ActiveConnectionTokenProviderDeps } from '../connections/active-connection-token-provider.server'

export type GoogleImportRuntimeDeps = Readonly<{
  clock: () => Date
  logger: LoggerPort
  newId: () => string
  connectionRepo: ActiveConnectionTokenProviderDeps['connectionRepo']
  tokenProvider: ActiveConnectionTokenProvider
  store: GoogleImportStore
  propertyApi: PropertyPublicApi
  propertyBindingApi: PropertyGoogleBindingPublicApi
  resolveActiveMember: ActiveMemberAuthResolver
  /** The raw executor; the runtime wraps it with the single-401 refresh. */
  providerExecutor: GoogleAuthorizedProviderExecutor | undefined
  providerTokenAccess: GoogleProviderTokenAccess
  references: GoogleImportReferenceStore | undefined
  replayKeys: VersionedHmacKeyring | undefined
  authorizeContent: GoogleImportContentAuthorizer | undefined
}>

export type GoogleImportRuntime = Readonly<{
  lifecycle: ReturnType<typeof createGoogleImportLifecycle>
  processor: ReturnType<typeof createGoogleImportProcessor>
  discovery: ReturnType<typeof createGoogleImportDiscovery> | null
  transaction: ReturnType<typeof createGoogleImportTransaction> | null
  refreshBoundCategories:
    ReturnType<typeof createRefreshBoundGoogleCategories> | undefined
}>

/**
 * Wires the Google import: lifecycle, item processor, discovery and the
 * transaction. Discovery needs a provider executor and references, the
 * transaction needs references and replay keys.
 */
export const createGoogleImportRuntime = (
  deps: GoogleImportRuntimeDeps,
): GoogleImportRuntime => {
  const binding = deps.propertyBindingApi
  const lifecycle = createGoogleImportLifecycle({
    store: deps.store,
    propertyBindingApi: binding,
    clock: deps.clock,
    newEventId: deps.newId,
    references: deps.references,
  })
  const decideGoogleImport = async (request: DecisionRequest) =>
    getExecutionPolicy().decide(request)
  const authorizeCommand = createGoogleImportCommandAuthorizer({
    connectionRepo: deps.connectionRepo,
    tokenProvider: deps.tokenProvider,
    decide: decideGoogleImport,
    authorizeGoogleContent:
      deps.authorizeContent ??
      (async () => ({ ok: false as const, code: 'runtime_unavailable' as const })),
    readProperty: binding.readInternal,
    clock: deps.clock,
    // The refusal is otherwise invisible: six checks share the
    // `authorization_changed` outcome code and the persisted item row cannot
    // say which fired. Content-free fields (version counters, a sha256); no tenant
    // identifier, which BANNED_LOG_KEYS forbids as a log field.
    warn: (fields, message) => deps.logger.warn(fields, message),
  })
  const nowMs = () => deps.clock().getTime()
  const reauthorizeProviderCall = createGoogleImportReauthorizer({
    resolveActor: deps.resolveActiveMember,
    authorize: authorizeCommand,
  })
  const executor = deps.providerExecutor
    ? createSingle401RefreshExecutor({
        executor: deps.providerExecutor,
        ...deps.providerTokenAccess,
        reauthorize: reauthorizeProviderCall,
      })
    : undefined
  const refreshBoundCategories = executor
    ? createRefreshBoundGoogleCategories({
        findPropertyIds: deps.propertyApi.findIdsByGoogleConnection,
        binding,
        authorize: authorizeCommand,
        locations: createGoogleBusinessInformationAdapter({ executor, nowMs }),
        clock: deps.clock,
      })
    : undefined
  const processor = createGoogleImportProcessor({
    store: deps.store,
    propertyBindingApi: binding,
    authorizeGoogleImportCommand: authorizeCommand,
    resolveActor: deps.resolveActiveMember,
    clock: deps.clock,
    newClaimFence: deps.newId,
    logger: deps.logger,
  })
  const discovery =
    executor && deps.references
      ? createGoogleImportDiscovery({
          authorizeGoogleImportCommand: authorizeCommand,
          classifyCandidates: createGoogleImportPropertyClassifier({
            readByLocationIds: binding.readByLocationIds,
            isAllowed: async ({ actor, action, propertyId }) =>
              (
                await decideGoogleImport({
                  principal: { kind: 'user', ctx: actor },
                  action,
                  capability: 'property.import_gbp_v2',
                  organizationId: actor.organizationId,
                  ...(propertyId ? { propertyId } : {}),
                  executionKind: 'interactive',
                  now: deps.clock(),
                })
              ).allowed,
          }),
          references: deps.references,
          accounts: createGoogleAccountManagementAdapter({ executor, nowMs }),
          locations: createGoogleBusinessInformationAdapter({ executor, nowMs }),
          nowMs,
          logger: deps.logger,
        })
      : null
  const transaction =
    deps.references && deps.replayKeys
      ? createGoogleImportTransaction({
          store: deps.store,
          references: deps.references,
          authorizeGoogleImportCommand: authorizeCommand,
          replayKeys: deps.replayKeys,
          clock: deps.clock,
          logger: deps.logger,
          idGen: deps.newId,
          cancelImport: lifecycle.cancelRequest,
        })
      : null
  return {
    lifecycle,
    processor,
    discovery,
    transaction,
    refreshBoundCategories,
  }
}

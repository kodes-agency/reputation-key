import type { LoggerPort } from '#/shared/domain/logger.port'
import { getExecutionPolicy, type DecisionRequest } from '#/shared/auth/execution-policy'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { ActiveConnectionTokenProvider } from '../application/active-connection-token-provider'
import {
  createGoogleImportCommandAuthorizer,
  createGoogleImportReauthorizer,
  type GoogleImportContentAuthorizer,
} from '../application/google-import-command-authorizer'
import { createGoogleImportDiscovery } from '../application/google-import-discovery'
import { createGoogleImportPropertyClassifier } from '../application/google-import-property-classifier'
import { createGoogleImportTransaction } from '../application/google-import-transaction'
import { createGoogleImportV2Lifecycle } from '../application/google-import-v2-lifecycle'
import { createGoogleImportV2Processor } from '../application/google-import-v2-processor'
import type { GoogleImportV2Store } from '../application/ports/google-import-v2-store.port'
import type { GoogleImportReferenceStore } from '../application/ports/google-import-reference-store.port'
import { createRefreshBoundGoogleCategories } from '../application/refresh-bound-google-categories'
import type { GoogleAuthorizedProviderExecutor } from '../application/ports/google-authorized-provider-executor.port'
import { createGoogleAccountManagementAdapter } from '../infrastructure/adapters/google-account-management.adapter'
import { createGoogleBusinessInformationAdapter } from '../infrastructure/adapters/google-business-information.adapter'
import type { ActiveMemberAuthResolver } from '../infrastructure/active-member-auth.adapter'
import type { ActiveConnectionTokenProviderDeps } from '../application/active-connection-token-provider'

export type GoogleImportRuntimeDeps = Readonly<{
  clock: () => Date
  logger: LoggerPort
  newId: () => string
  connectionRepo: ActiveConnectionTokenProviderDeps['connectionRepo']
  tokenProvider: ActiveConnectionTokenProvider
  store: GoogleImportV2Store
  propertyApi: PropertyPublicApi
  propertyBindingApi: PropertyGoogleBindingPublicApi | undefined
  resolveActiveMember: ActiveMemberAuthResolver
  /** Executor already wrapped with the single-401 refresh. */
  providerExecutor: GoogleAuthorizedProviderExecutor | undefined
  references: GoogleImportReferenceStore | undefined
  replayKeys: VersionedHmacKeyring | undefined
  authorizeContent: GoogleImportContentAuthorizer | undefined
  refreshPolicyStoreRequired: (() => Promise<void>) | undefined
}>

export type GoogleImportRuntime = Readonly<{
  lifecycle: ReturnType<typeof createGoogleImportV2Lifecycle> | null
  processor: ReturnType<typeof createGoogleImportV2Processor> | null
  discovery: ReturnType<typeof createGoogleImportDiscovery> | null
  transaction: ReturnType<typeof createGoogleImportTransaction> | null
  refreshBoundCategories:
    ReturnType<typeof createRefreshBoundGoogleCategories> | undefined
  reauthorizeProviderCall: ReturnType<typeof createGoogleImportReauthorizer> | undefined
}>

/**
 * Wires the Google import: lifecycle, item processor, discovery and the
 * transaction. Everything past the lifecycle needs the Property binding API;
 * discovery needs a provider executor and references, the transaction needs
 * references and replay keys.
 */
export const createGoogleImportRuntime = (
  deps: GoogleImportRuntimeDeps,
): GoogleImportRuntime => {
  const binding = deps.propertyBindingApi
  const lifecycle = binding
    ? createGoogleImportV2Lifecycle({
        store: deps.store,
        propertyBindingApi: binding,
        clock: deps.clock,
        newEventId: deps.newId,
        references: deps.references,
      })
    : null
  if (!binding) {
    return {
      lifecycle,
      processor: null,
      discovery: null,
      transaction: null,
      refreshBoundCategories: undefined,
      reauthorizeProviderCall: undefined,
    }
  }
  const executor = deps.providerExecutor
  const decideGoogleImport = async (request: DecisionRequest) => {
    await deps.refreshPolicyStoreRequired?.()
    return getExecutionPolicy().decide(request)
  }
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
  const refreshBoundCategories = executor
    ? createRefreshBoundGoogleCategories({
        findPropertyIds: deps.propertyApi.findIdsByGoogleConnection,
        binding,
        authorize: authorizeCommand,
        locations: createGoogleBusinessInformationAdapter({ executor, nowMs }),
        clock: deps.clock,
      })
    : undefined
  const reauthorizeProviderCall = createGoogleImportReauthorizer({
    resolveActor: deps.resolveActiveMember,
    authorize: authorizeCommand,
  })
  const processor = createGoogleImportV2Processor({
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
          ...(lifecycle ? { cancelImport: lifecycle.cancelRequest } : {}),
        })
      : null
  return {
    lifecycle,
    processor,
    discovery,
    transaction,
    refreshBoundCategories,
    reauthorizeProviderCall,
  }
}

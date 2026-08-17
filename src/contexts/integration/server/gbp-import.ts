// Integration context — GBP import server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { getContainer } from '#/composition'
import { googleConnectionId } from '#/shared/domain/ids'
import {
  listImportAccountsInputSchema,
  listImportCandidatesInputSchema,
  renewImportAuthorizationLeaseInputSchema,
} from '../application/dto/google-import-discovery.dto'
import {
  getPropertyImportStatusInputSchema,
  recoverPropertyImportInputSchema,
  retryPropertyImportItemInputSchema,
  startPropertyImportInputSchema,
} from '../application/dto/google-import-v2.dto'
import {
  GoogleImportDiscoveryError,
  type GoogleImportDiscoveryErrorCode,
} from '../application/google-import-discovery'
import {
  GoogleImportTransactionError,
  type GoogleImportTransactionErrorCode,
} from '../application/google-import-transaction'

function disableProviderContentCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}

function discoveryErrorStatus(code: GoogleImportDiscoveryErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 403
    case 'invalid_request':
      return 400
    case 'reference_invalid':
      return 410
    case 'provider_unavailable':
    case 'temporarily_unavailable':
      return 503
  }
}

function requireGoogleImportDiscovery() {
  const discovery = getContainer().useCases.googleImportDiscovery
  if (!discovery) {
    throw new GoogleImportDiscoveryError('temporarily_unavailable')
  }
  return discovery
}
function requireGoogleImportTransaction() {
  const transaction = getContainer().useCases.googleImportTransaction
  if (!transaction) {
    throw new GoogleImportTransactionError('temporarily_unavailable')
  }
  return transaction
}

function transactionErrorStatus(code: GoogleImportTransactionErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 403
    case 'invalid_reference':
      return 404
    case 'request_conflict':
      return 409
    case 'temporarily_unavailable':
      return 503
  }
}

function translateTransactionError(error: unknown): never {
  if (error instanceof GoogleImportTransactionError) {
    throwContextError(
      'GoogleImportTransactionError',
      error,
      transactionErrorStatus(error.code),
    )
  }
  throw catchUntagged(error)
}

function translateDiscoveryError(error: unknown): never {
  if (error instanceof GoogleImportDiscoveryError) {
    throwContextError(
      'GoogleImportDiscoveryError',
      error,
      discoveryErrorStatus(error.code),
    )
  }
  throw catchUntagged(error)
}

// ── bounded Google import discovery ────────────────────────────────

export const listImportAccounts = createServerFn({ method: 'POST' })
  .inputValidator(listImportAccountsInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableProviderContentCaching()
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'integration.manage',
          capability: 'property.import_gbp_v2',
        })
        try {
          return await requireGoogleImportDiscovery().listAccounts(
            {
              connectionId: googleConnectionId(data.connectionId),
              ...(data.cursorRef ? { cursorRef: data.cursorRef } : {}),
            },
            ctx,
          )
        } catch (error) {
          return translateDiscoveryError(error)
        }
      },
      'POST',
      'integration.listImportAccounts',
    ),
  )

export const listImportCandidates = createServerFn({ method: 'POST' })
  .inputValidator(listImportCandidatesInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableProviderContentCaching()
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'integration.manage',
          capability: 'property.import_gbp_v2',
        })
        try {
          const connectionId = googleConnectionId(data.connectionId)
          return data.accountRef
            ? await requireGoogleImportDiscovery().listCandidates(
                { connectionId, accountRef: data.accountRef },
                ctx,
              )
            : await requireGoogleImportDiscovery().listCandidates(
                { connectionId, cursorRef: data.cursorRef! },
                ctx,
              )
        } catch (error) {
          return translateDiscoveryError(error)
        }
      },
      'POST',
      'integration.listImportCandidates',
    ),
  )

export const renewImportAuthorizationLease = createServerFn({ method: 'POST' })
  .inputValidator(renewImportAuthorizationLeaseInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableProviderContentCaching()
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'integration.manage',
          capability: 'property.import_gbp_v2',
        })
        try {
          return await requireGoogleImportDiscovery().renewAuthorizationLease(
            {
              connectionId: googleConnectionId(data.connectionId),
              leaseRef: data.leaseRef,
            },
            ctx,
          )
        } catch (error) {
          return translateDiscoveryError(error)
        }
      },
      'POST',
      'integration.renewImportAuthorizationLease',
    ),
  )
// ── atomic v2 import intent ────────────────────────────────────────

export const startPropertyImportV2 = createServerFn({ method: 'POST' })
  .inputValidator(startPropertyImportInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableProviderContentCaching()
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'integration.manage',
          capability: 'property.import_gbp_v2',
        })
        try {
          const result = await requireGoogleImportTransaction().start(data, ctx)
          return { ...result, requestId: data.requestId }
        } catch (error) {
          return translateTransactionError(error)
        }
      },
      'POST',
      'integration.startPropertyImportV2',
    ),
  )

export const recoverPropertyImportV2 = createServerFn({ method: 'POST' })
  .inputValidator(recoverPropertyImportInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableProviderContentCaching()
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'integration.manage',
          capability: 'property.import_gbp_v2',
        })
        try {
          const result = await requireGoogleImportTransaction().recover(
            data.requestId,
            ctx,
          )
          return { ...result, requestId: data.requestId }
        } catch (error) {
          return translateTransactionError(error)
        }
      },
      'POST',
      'integration.recoverPropertyImportV2',
    ),
  )

export const retryPropertyImportItem = createServerFn({ method: 'POST' })
  .inputValidator(retryPropertyImportItemInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableProviderContentCaching()
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'integration.manage',
          capability: 'property.import_gbp_v2',
        })
        try {
          return await requireGoogleImportTransaction().retry(data, ctx)
        } catch (error) {
          return translateTransactionError(error)
        }
      },
      'POST',
      'integration.retryPropertyImportItem',
    ),
  )

export const getPropertyImportV2Status = createServerFn({ method: 'GET' })
  .inputValidator(getPropertyImportStatusInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableProviderContentCaching()
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'integration.manage',
          capability: 'property.import_gbp_v2',
        })
        try {
          return await requireGoogleImportTransaction().status(data.importJobId, ctx)
        } catch (error) {
          return translateTransactionError(error)
        }
      },
      'GET',
      'integration.getPropertyImportV2Status',
    ),
  )

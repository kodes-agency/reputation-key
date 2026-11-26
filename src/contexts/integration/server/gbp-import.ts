// Integration context — GBP import server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.

import { createServerFn } from '@tanstack/react-start'
import { commandHandler } from '#/shared/commands/command.server'
import type { CommandErrors } from '#/shared/commands/contracts'
import type { AuthContext } from '#/shared/domain/auth-context'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { getContainer } from '#/composition'
import { googleConnectionId } from '#/shared/domain/ids'
import {
  listImportAccountsInputSchema,
  listImportCandidatesInputSchema,
  renewImportAuthorizationLeaseInputSchema,
} from '../imports/google-import-discovery-input.contracts'
import {
  cancelPropertyImportInputSchema,
  getPropertyImportStatusInputSchema,
  recoverPropertyImportInputSchema,
  retryPropertyImportItemInputSchema,
  startPropertyImportInputSchema,
} from '../application/dto/google-import.dto'
import {
  GoogleImportDiscoveryError,
  type GoogleImportDiscoveryErrorCode,
} from '../imports/google-import-discovery.server'
import {
  GoogleImportTransactionError,
  type GoogleImportTransactionErrorCode,
} from '../imports/google-import-transaction.server'
import { disableProviderContentCaching } from './provider-content-caching'

function discoveryErrorStatus(code: GoogleImportDiscoveryErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 403
    case 'invalid_request':
      return 400
    case 'reference_invalid':
      return 410
    // Terminal provider denials. 409 keeps them off the retryable 503 branch:
    // the connection state, not the request, has to change first.
    case 'reauthentication_required':
    case 'provider_rejected':
      return 409
    case 'provider_unavailable':
    case 'temporarily_unavailable':
      return 503
  }
}

function requireGoogleImportDiscovery() {
  const discovery = getContainer().integrationPublicApi.imports.discover
  if (!discovery) {
    throw new GoogleImportDiscoveryError('temporarily_unavailable')
  }
  return discovery
}
function requireGoogleImportTransaction() {
  const transaction = getContainer().integrationPublicApi.imports.transact
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
    // The connection state has to change first, as for discovery.
    case 'reauthentication_required':
    case 'request_conflict':
      return 409
    // The request passed browser validation, but its durable fact violated a
    // server-owned contract. It cannot succeed unchanged and must not be sold
    // to the caller as a retryable availability failure.
    case 'contract_rejected':
      return 500
    case 'temporarily_unavailable':
      return 503
  }
}

const discoveryErrors: CommandErrors<GoogleImportDiscoveryError> = {
  name: 'GoogleImportDiscoveryError',
  is: (error): error is GoogleImportDiscoveryError =>
    error instanceof GoogleImportDiscoveryError,
  status: discoveryErrorStatus,
}

const transactionErrors: CommandErrors<GoogleImportTransactionError> = {
  name: 'GoogleImportTransactionError',
  is: (error): error is GoogleImportTransactionError =>
    error instanceof GoogleImportTransactionError,
  status: transactionErrorStatus,
}

async function runImportCommand<T>(
  headers: Headers,
  run: (ctx: AuthContext) => Promise<T>,
): Promise<T> {
  disableProviderContentCaching()
  const ctx = await resolveTenantContext(headers)
  await requireExecutionAllowed({
    actor: ctx,
    action: 'integration.manage',
    capability: 'property.import_gbp_v2',
  })
  return await run(ctx)
}

// ── bounded Google import discovery ────────────────────────────────

export const listImportAccounts = createServerFn({ method: 'POST' })
  .validator(listImportAccountsInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'integration.listImportAccounts', errors: discoveryErrors },
      async ({ data, headers }) =>
        runImportCommand(headers, (ctx) =>
          requireGoogleImportDiscovery().listAccounts(
            {
              connectionId: googleConnectionId(data.connectionId),
              ...(data.cursorRef ? { cursorRef: data.cursorRef } : {}),
            },
            ctx,
          ),
        ),
    ),
  )

export const listImportCandidates = createServerFn({ method: 'POST' })
  .validator(listImportCandidatesInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'integration.listImportCandidates',
        errors: discoveryErrors,
      },
      async ({ data, headers }) =>
        runImportCommand(headers, async (ctx) => {
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
        }),
    ),
  )

export const renewImportAuthorizationLease = createServerFn({ method: 'POST' })
  .validator(renewImportAuthorizationLeaseInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'integration.renewImportAuthorizationLease',
        errors: discoveryErrors,
      },
      async ({ data, headers }) =>
        runImportCommand(headers, (ctx) =>
          requireGoogleImportDiscovery().renewAuthorizationLease(
            {
              connectionId: googleConnectionId(data.connectionId),
              leaseRef: data.leaseRef,
            },
            ctx,
          ),
        ),
    ),
  )
// ── atomic v2 import intent ────────────────────────────────────────

export const startPropertyImportV2 = createServerFn({ method: 'POST' })
  .validator(startPropertyImportInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'integration.startPropertyImportV2',
        errors: transactionErrors,
      },
      async ({ data, headers }) =>
        runImportCommand(headers, async (ctx) => {
          const result = await requireGoogleImportTransaction().start(data, ctx)
          return { ...result, requestId: data.requestId }
        }),
    ),
  )

export const recoverPropertyImportV2 = createServerFn({ method: 'POST' })
  .validator(recoverPropertyImportInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'integration.recoverPropertyImportV2',
        errors: transactionErrors,
      },
      async ({ data, headers }) =>
        runImportCommand(headers, async (ctx) => {
          const result = await requireGoogleImportTransaction().recover(
            data.requestId,
            ctx,
          )
          return { ...result, requestId: data.requestId }
        }),
    ),
  )

export const retryPropertyImportItem = createServerFn({ method: 'POST' })
  .validator(retryPropertyImportItemInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'integration.retryPropertyImportItem',
        errors: transactionErrors,
      },
      async ({ data, headers }) =>
        runImportCommand(headers, (ctx) =>
          requireGoogleImportTransaction().retry(data, ctx),
        ),
    ),
  )

export const cancelPropertyImportV2 = createServerFn({ method: 'POST' })
  .validator(cancelPropertyImportInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'integration.cancelPropertyImportV2',
        errors: transactionErrors,
      },
      async ({ data, headers }) =>
        runImportCommand(headers, (ctx) =>
          requireGoogleImportTransaction().cancel(data.importJobId, ctx),
        ),
    ),
  )

export const getPropertyImportV2Status = createServerFn({ method: 'GET' })
  .validator(getPropertyImportStatusInputSchema)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'integration.getPropertyImportV2Status',
        errors: transactionErrors,
      },
      async ({ data, headers }) =>
        runImportCommand(headers, (ctx) =>
          requireGoogleImportTransaction().status(data.importJobId, ctx),
        ),
    ),
  )

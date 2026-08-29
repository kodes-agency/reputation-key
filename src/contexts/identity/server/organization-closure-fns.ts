// LIF-01-T17 — Closure Center server functions.
//
// WHY THESE DO NOT CALL `requireExecutionAllowed`
//
// Requesting a closure commits an Organization-wide suspension in the same
// transaction. Every ordinary Permission maps to a capability, and a suspended
// Organization denies every capability with `org_suspended`. Routing the
// closure commands through that gate would therefore make a closure
// UNCANCELLABLE and an export UNRETRIEVABLE the moment the fence engages —
// the tenant would be locked out of the only surface that can undo it.
//
// The Closure Center is exactly the carve-out: an authenticated, read-only
// status surface plus four closure-lifecycle commands. Its authority is not
// weaker for skipping the capability gate, it is stronger — every command
// re-checks "current AccountAdmin with an ACTIVE Organization binding" inside
// the command-store transaction, holding the membership and binding rows under
// `FOR UPDATE`, so a concurrent demotion, removal or binding release
// linearizes rather than racing a cached session.
//
// POSTURE (program bullet 8): no fresh-password check, no MFA, no step-up and
// no re-authentication challenge is introduced here. MFA is dark, and
// `BLOCKED_CAPABILITIES` is untouched by this feature — `-closure.test.tsx`
// and `organization-closure-fns.test.ts` both assert that mechanically. The
// only additional gate is a typed confirmation phrase, which proves INTENT,
// not identity.

import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { hasRole } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { identityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import {
  canCancelOrganizationClosure,
  ORGANIZATION_REACTIVATION_CHECKS,
  type OrganizationLifecycleStatus,
  type OrganizationReactivationCheck,
} from '../domain/organization-lifecycle'
import {
  cancelOrganizationClosureInputSchema,
  closureConfirmationPhrase,
  downloadOrganizationExportInputSchema,
  organizationExportRetrievalInputSchema,
  reactivateOrganizationInputSchema,
  requestOrganizationClosureInputSchema,
  type CancelOrganizationClosureDto,
  type ClosureCenterView,
  type DownloadOrganizationExportDto,
  type OrganizationExportRetrievalDto,
  type OrganizationExportView,
  type ReactivateOrganizationDto,
  type RequestOrganizationClosureDto,
} from '../application/dto/organization-closure.dto'
import type { OrganizationExportStatus } from '../application/ports/organization-export.port'

/**
 * Beta is exactly ONE logical US Data Cell, so the recovery deadline is
 * rendered in that cell's civil time rather than in a per-tenant zone that
 * does not exist yet. A wrong zone here would misstate a deadline by hours.
 */
const CELL_US_TIMEZONE = 'America/New_York'

/**
 * A Staff User is not an Organization manager. Staff User login is dark, but
 * the principal shape exists, so the closure path denies it explicitly rather
 * than relying on the dark capability to keep it away.
 */
function requireAccountAdminPrincipal(ctx: AuthContext): void {
  if (!hasRole(ctx.role, 'AccountAdmin')) {
    throw identityError(
      'forbidden',
      'Only a current AccountAdmin can use the Closure Center',
    )
  }
}

async function actor(): Promise<AuthContext> {
  const ctx = await resolveTenantContext(await headersFromContext())
  requireAccountAdminPrincipal(ctx)
  return ctx
}

function lifecycle() {
  return getContainer().identityLifecycleRuntime
}

/**
 * Container-injected, never ambient. Every closure command is replay-safe on
 * its operation id, so the generator that mints it is part of the runtime
 * contract rather than a process global.
 */
function newOperationId(): string {
  return getContainer().idGen()
}

/**
 * Never exposes `objectKey`, `retrievalTokenDigest`, `encryptionEvidenceRef`
 * or any support evidence reference: those are storage and operator control
 * plane, and a tenant surface that leaked them would hand out a second route
 * to the archive. Checksums and coverage ARE shown — they are how a tenant
 * verifies what they downloaded.
 */
function toExportView(
  status: OrganizationExportStatus | null,
): OrganizationExportView | null {
  if (!status) return null
  return {
    requestId: status.id,
    state: status.state,
    asOf: status.asOf.toISOString(),
    objectExpiresAt: status.objectExpiresAt.toISOString(),
    retrievalExpiresAt: status.retrievalExpiresAt?.toISOString() ?? null,
    archiveSha256: status.archiveSha256,
    coverageSha256: status.coverageSha256,
    lastErrorCode: status.lastErrorCode,
  }
}

function toClosureCenterView(
  input: Readonly<{
    organizationName: string
    status: OrganizationLifecycleStatus
    exportStatus: OrganizationExportStatus | null
    reactivationChecks: readonly OrganizationReactivationCheck[]
    now: Date
  }>,
): ClosureCenterView {
  return {
    organizationName: input.organizationName,
    timezone: CELL_US_TIMEZONE,
    state: input.status.state,
    revision: input.status.revision,
    closureRequestedAt: input.status.closureRequestedAt?.toISOString() ?? null,
    recoverableUntil: input.status.recoverableUntil?.toISOString() ?? null,
    irreversibleAt: input.status.irreversibleAt?.toISOString() ?? null,
    closedAt: input.status.closedAt?.toISOString() ?? null,
    reactivationRequired: input.status.reactivationRequired,
    // Server-computed: a client clock that runs slow must not be able to
    // present a cancel button for a window that has already closed.
    cancellable: canCancelOrganizationClosure({
      state: input.status.state,
      recoverableUntil: input.status.recoverableUntil,
      now: input.now,
    }),
    confirmationPhrase: closureConfirmationPhrase(input.organizationName),
    reactivationChecks: ORGANIZATION_REACTIVATION_CHECKS.map(
      (id) =>
        input.reactivationChecks.find((check) => check.id === id) ?? {
          id,
          satisfied: false,
          detailCode: 'not_evaluated',
        },
    ),
    export: toExportView(input.exportStatus),
  }
}

const handle = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (e) {
    if (isIdentityError(e)) throwIdentityError(e)
    throw catchUntagged(e)
  }
}

// ── Read: the Closure Center itself ─────────────────────────────────
//
// Each handler is extracted with `createServerOnlyFn` so the authorization
// and posture assertions can execute it directly, exactly as the beta
// feedback and Property lifecycle handlers do.

export const getClosureCenterHandler = createServerOnlyFn(
  async (): Promise<ClosureCenterView> =>
    handle(async () => {
      const ctx = await actor()
      const organizationId = ctx.organizationId as string
      const actorUserId = ctx.userId as string
      // Authorizes under lock; a demoted admin is refused here, not later.
      const status = await lifecycle().control.getStatus({
        organizationId,
        actorUserId,
      })
      const exportService = lifecycle().organizationExport.service
      const exportStatus = exportService
        ? await exportService.current({ organizationId, actorUserId })
        : null
      const organization = await getContainer().identityPort.getActiveOrg(
        await headersFromContext(),
      )
      return toClosureCenterView({
        organizationName: organization?.name ?? organizationId,
        status,
        exportStatus,
        // Only meaningful once the fence is up; an active Organization has
        // nothing to reactivate, so the checklist stays empty.
        reactivationChecks: [],
        // The injected container clock, never an ambient one: the recovery
        // deadline this view reports must move with the same clock the
        // command store enforces it against.
        now: getContainer().clock(),
      })
    }),
)

export const getClosureCenterFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(getClosureCenterHandler, 'GET', 'identity.getClosureCenter'),
)

// ── Commands ────────────────────────────────────────────────────────

export const requestOrganizationClosureHandler = createServerOnlyFn(
  async ({ data }: Readonly<{ data: RequestOrganizationClosureDto }>) =>
    handle(async () => {
      const ctx = await actor()
      const organizationId = ctx.organizationId as string
      const organization = await getContainer().identityPort.getActiveOrg(
        await headersFromContext(),
      )
      const expected = closureConfirmationPhrase(organization?.name ?? organizationId)
      if (data.typedConfirmation !== expected) {
        throw identityError(
          'validation_error',
          'Type the Organization name exactly to confirm closure',
        )
      }
      const status = await lifecycle().control.requestClosure({
        operationId: newOperationId(),
        organizationId,
        actorUserId: ctx.userId as string,
        reasonCode: data.reasonCode,
        supportEvidenceRef: data.supportEvidenceRef,
      })
      return { state: status.state, revision: status.revision }
    }),
)

export const requestOrganizationClosureFn = createServerFn({ method: 'POST' })
  .validator(requestOrganizationClosureInputSchema)
  .handler(
    tracedHandler(
      requestOrganizationClosureHandler,
      'POST',
      'identity.requestOrganizationClosure',
    ),
  )

export const cancelOrganizationClosureHandler = createServerOnlyFn(
  async ({ data }: Readonly<{ data: CancelOrganizationClosureDto }>) =>
    handle(async () => {
      const ctx = await actor()
      const status = await lifecycle().control.cancelClosure({
        operationId: newOperationId(),
        organizationId: ctx.organizationId as string,
        actorUserId: ctx.userId as string,
        reasonCode: data.reasonCode,
        supportEvidenceRef: data.supportEvidenceRef,
      })
      // Cancelling resumes NOTHING. `reactivationRequired` stays true and the
      // Organization suspension stays in place until explicit reactivation.
      return {
        state: status.state,
        revision: status.revision,
        reactivationRequired: status.reactivationRequired,
      }
    }),
)

export const cancelOrganizationClosureFn = createServerFn({ method: 'POST' })
  .validator(cancelOrganizationClosureInputSchema)
  .handler(
    tracedHandler(
      cancelOrganizationClosureHandler,
      'POST',
      'identity.cancelOrganizationClosure',
    ),
  )

export const reactivateOrganizationHandler = createServerOnlyFn(
  async ({ data }: Readonly<{ data: ReactivateOrganizationDto }>) =>
    handle(async () => {
      const ctx = await actor()
      const reactivation = lifecycle().control.reactivation
      if (!reactivation.reactivate) {
        throw identityError(
          'forbidden',
          'Organization reactivation is not available in this deployment',
        )
      }
      const result = await reactivation.reactivate({
        operationId: newOperationId(),
        organizationId: ctx.organizationId as string,
        actorUserId: ctx.userId as string,
        // The acting AccountAdmin authors every deliberate action they
        // confirm; a client cannot attribute one to somebody else.
        acknowledgements: data.acknowledgements.map((entry) => ({
          ...entry,
          actorUserId: ctx.userId as string,
        })),
      })
      return {
        state: result.status.state,
        revision: result.status.revision,
        reactivationRequired: result.status.reactivationRequired,
      }
    }),
)

export const reactivateOrganizationFn = createServerFn({ method: 'POST' })
  .validator(reactivateOrganizationInputSchema)
  .handler(
    tracedHandler(
      reactivateOrganizationHandler,
      'POST',
      'identity.reactivateOrganization',
    ),
  )

// ── Organization Export ─────────────────────────────────────────────

function requireExportService() {
  const service = lifecycle().organizationExport.service
  if (!service) {
    throw identityError(
      'forbidden',
      'Organization Export is not available in this deployment',
    )
  }
  return service
}

export const requestOrganizationExportHandler = createServerOnlyFn(
  async (): Promise<OrganizationExportView | null> =>
    handle(async () => {
      const ctx = await actor()
      const status = await requireExportService().request({
        requestId: newOperationId(),
        organizationId: ctx.organizationId as string,
        actorUserId: ctx.userId as string,
      })
      return toExportView(status)
    }),
)

export const requestOrganizationExportFn = createServerFn({ method: 'POST' }).handler(
  tracedHandler(
    requestOrganizationExportHandler,
    'POST',
    'identity.requestOrganizationExport',
  ),
)

/**
 * Issues the single-use, 24-hour retrieval link (program bullet 8).
 *
 * The token is returned exactly once and is never persisted in the clear —
 * only its digest is stored — so a second issuance for the same request is
 * refused by the repository rather than silently minting a second live link.
 */
export const issueOrganizationExportRetrievalHandler = createServerOnlyFn(
  async ({ data }: Readonly<{ data: OrganizationExportRetrievalDto }>) =>
    handle(async () => {
      const ctx = await actor()
      const issued = await requireExportService().issueRetrieval({
        requestId: data.requestId,
        operationId: newOperationId(),
        organizationId: ctx.organizationId as string,
        actorUserId: ctx.userId as string,
      })
      return { token: issued.token, expiresAt: issued.expiresAt.toISOString() }
    }),
)

export const issueOrganizationExportRetrievalFn = createServerFn({ method: 'POST' })
  .validator(organizationExportRetrievalInputSchema)
  .handler(
    tracedHandler(
      issueOrganizationExportRetrievalHandler,
      'POST',
      'identity.issueOrganizationExportRetrieval',
    ),
  )

/**
 * Consumes the retrieval token and returns the archive.
 *
 * Beta exports are bounded, so the archive is returned base64-encoded through
 * the same authenticated RPC channel rather than through a second, separately
 * authorized streaming route. That keeps exactly ONE authorization path to the
 * bytes; a streaming endpoint is the post-beta shape and needs its own review.
 */
export const downloadOrganizationExportHandler = createServerOnlyFn(
  async ({ data }: Readonly<{ data: DownloadOrganizationExportDto }>) =>
    handle(async () => {
      const ctx = await actor()
      const archive = await requireExportService().retrieve({
        requestId: data.requestId,
        token: data.token,
        organizationId: ctx.organizationId as string,
        actorUserId: ctx.userId as string,
      })
      return {
        filename: `organization-export-${data.requestId}.zip`,
        archiveBase64: Buffer.from(archive).toString('base64'),
      }
    }),
)

export const downloadOrganizationExportFn = createServerFn({ method: 'POST' })
  .validator(downloadOrganizationExportInputSchema)
  .handler(
    tracedHandler(
      downloadOrganizationExportHandler,
      'POST',
      'identity.downloadOrganizationExport',
    ),
  )

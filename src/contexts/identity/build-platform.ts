// Identity context — the platform operator console (ADR 0063).
//
// Its own composition seam, off `IdentityPublicApi`: no other context ever
// receives it, and only the console's server functions reach it, after
// requirePlatformOperator. Its store runs the ordinary invitation commands
// inside its own audited transactions, so identity/build.ts stays untouched.

import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { invitationId, organizationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InvitationEmailSender } from './application/ports/invitation-email.port'
import {
  listPlatformOrganizations,
  type ListPlatformOrganizations,
} from './application/use-cases/list-platform-organizations'
import {
  provisionOrganization,
  type ProvisionOrganization,
} from './application/use-cases/provision-organization'
import {
  inviteOrganizationAdmin,
  type InviteOrganizationAdmin,
} from './application/use-cases/invite-organization-admin'
import {
  resendOrganizationAdminInvitation,
  type ResendOrganizationAdminInvitation,
} from './application/use-cases/resend-organization-admin-invitation'
import {
  cancelOrganizationAdminInvitation,
  type CancelOrganizationAdminInvitation,
} from './application/use-cases/cancel-organization-admin-invitation'
import { createPlatformOrganizationStore } from './infrastructure/platform-organization-store'

export type PlatformConsoleDeps = Readonly<{
  db: Database
  clock: Clock
  idGen: () => string
  logger: LoggerPort
  sendEmail: InvitationEmailSender
  baseUrl: string
  invitationExpiresInMs: number
  /** Whether BETA_ALLOWLIST_ORGS covers the Organization (web's reading). */
  isControlledBetaEnabled: (organizationId: string) => boolean
}>

export type PlatformConsole = Readonly<{
  listOrganizations: ListPlatformOrganizations
  provisionOrganization: ProvisionOrganization
  inviteAdmin: InviteOrganizationAdmin
  resendInvitation: ResendOrganizationAdminInvitation
  cancelInvitation: CancelOrganizationAdminInvitation
}>

export function buildPlatformConsole(deps: PlatformConsoleDeps): PlatformConsole {
  const store = createPlatformOrganizationStore(deps.db, deps.idGen)
  const { clock, logger } = deps
  const email = {
    sendEmail: deps.sendEmail,
    baseUrl: deps.baseUrl,
    invitationExpiresInMs: deps.invitationExpiresInMs,
    logger,
  } as const

  return Object.freeze({
    listOrganizations: listPlatformOrganizations({
      store,
      isControlledBetaEnabled: deps.isControlledBetaEnabled,
      clock,
    }),
    provisionOrganization: provisionOrganization({
      ...email,
      store,
      clock,
      newOrganizationId: () => organizationId(deps.idGen()),
      newInvitationId: () => invitationId(deps.idGen()),
    }),
    inviteAdmin: inviteOrganizationAdmin({
      ...email,
      store,
      clock,
      idGen: () => invitationId(deps.idGen()),
    }),
    resendInvitation: resendOrganizationAdminInvitation({
      ...email,
      store,
      clock,
    }),
    cancelInvitation: cancelOrganizationAdminInvitation({
      store,
      clock,
      logger,
    }),
  })
}

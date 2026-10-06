// Platform operator console changes (ADR 0065): create an Organization, invite
// its first Account Admin, resend or cancel that invitation.
//
// Each function needs a sign-in from the last 30 minutes and draws on the
// operator's hourly budget before it reaches the console capability
// (platform-console-operator.server.ts).
//
// Apart from platform-console.ts, whose read the route's loader imports: a
// server function's client stub carries a 64-character id that gzip cannot
// shrink, so four stubs the loader never calls would ride every page's first
// paint for as long as they shared a module with the read.

import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  inviteOrganizationAdminInputSchema,
  organizationInvitationInputSchema,
  provisionOrganizationInputSchema,
  type InviteOrganizationAdminInput,
  type InviteOrganizationAdminResult,
  type OrganizationInvitationInput,
  type ProvisionOrganizationInput,
  type ProvisionOrganizationResult,
  type ResendOrganizationAdminInvitationResult,
} from '../application/dto/platform-console.dto'
import { asOperator } from './platform-console-operator.server'

type Request<T> = Readonly<{ data: T }>

export const provisionOrganizationHandler = createServerOnlyFn(
  ({ data }: Request<ProvisionOrganizationInput>): Promise<ProvisionOrganizationResult> =>
    asOperator(true, (operator) =>
      getContainer().identityPlatform.provisionOrganization(data, operator),
    ),
)

export const inviteOrganizationAdminHandler = createServerOnlyFn(
  ({
    data,
  }: Request<InviteOrganizationAdminInput>): Promise<InviteOrganizationAdminResult> =>
    asOperator(true, (operator) =>
      getContainer().identityPlatform.inviteAdmin(data, operator),
    ),
)

export const resendOrganizationAdminInvitationHandler = createServerOnlyFn(
  ({
    data,
  }: Request<OrganizationInvitationInput>): Promise<ResendOrganizationAdminInvitationResult> =>
    asOperator(true, (operator) =>
      getContainer().identityPlatform.resendInvitation(data, operator),
    ),
)

export const cancelOrganizationAdminInvitationHandler = createServerOnlyFn(
  ({ data }: Request<OrganizationInvitationInput>): Promise<void> =>
    asOperator(true, (operator) =>
      getContainer().identityPlatform.cancelInvitation(data, operator),
    ),
)

export const provisionOrganizationFn = createServerFn({ method: 'POST' })
  .validator(provisionOrganizationInputSchema)
  .handler(
    tracedHandler(
      provisionOrganizationHandler,
      'POST',
      'identity.platform.provisionOrganization',
    ),
  )

export const inviteOrganizationAdminFn = createServerFn({ method: 'POST' })
  .validator(inviteOrganizationAdminInputSchema)
  .handler(
    tracedHandler(
      inviteOrganizationAdminHandler,
      'POST',
      'identity.platform.inviteAdmin',
    ),
  )

export const resendOrganizationAdminInvitationFn = createServerFn({ method: 'POST' })
  .validator(organizationInvitationInputSchema)
  .handler(
    tracedHandler(
      resendOrganizationAdminInvitationHandler,
      'POST',
      'identity.platform.resendInvitation',
    ),
  )

export const cancelOrganizationAdminInvitationFn = createServerFn({ method: 'POST' })
  .validator(organizationInvitationInputSchema)
  .handler(
    tracedHandler(
      cancelOrganizationAdminInvitationHandler,
      'POST',
      'identity.platform.cancelInvitation',
    ),
  )

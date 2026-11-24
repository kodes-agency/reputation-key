// Integration context — entity constructors

import type { GoogleConnection } from './types'
import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'
import { ok, err } from '#/shared/domain'
import { integrationError } from './errors'

type BuildConnectionIdentity = Readonly<{
  kind: 'oidc'
  googleSubject: string
  email: string | null
}>

type BuildConnectionArgs = Readonly<{
  id: GoogleConnectionId
  organizationId: OrganizationId
  identity: BuildConnectionIdentity
  encryptedAccessToken: string
  encryptedRefreshToken: string
  tokenExpiresAt: Date
  scopes: ReadonlyArray<string>
  connectedBy: UserId
  now: Date
}>

export const buildGoogleConnection = (args: BuildConnectionArgs) => {
  if (args.identity.googleSubject.length === 0) {
    return err(integrationError('oauth_failed', 'Invalid Google identity'))
  }

  return ok<GoogleConnection>({
    id: args.id,
    organizationId: args.organizationId,
    googleSubject: args.identity.googleSubject,
    googleAccountEmail: args.identity.email,
    encryptedAccessToken: args.encryptedAccessToken,
    encryptedRefreshToken: args.encryptedRefreshToken,
    tokenExpiresAt: args.tokenExpiresAt,
    scopes: args.scopes,
    credentialAuthorizedBy: args.connectedBy,
    connectedBy: args.connectedBy,
    visibility: 'organization',
    status: 'active',
    credentialUseState: 'active',
    cleanupMaterialDeadlineAt: null,
    lifecycleVersion: 1,
    accessVersion: 1,
    credentialGeneration: 1,
    encryptionKeyId: 'v1',
    lastSuccessfulSyncAt: null,
    statusReason: null,
    statusChangedAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  })
}

// Integration context — entity constructors

import type { GoogleConnection } from './types'
import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'
import { ok, err } from '#/shared/domain'
import { integrationError } from './errors'
import { isValidVisibility } from './rules'
import type { GoogleCredentialHomeBinding } from '#/shared/domain/google-credential-home'
import { canReplaceGoogleCredentialHome } from '#/shared/domain/google-credential-home'

type BuildConnectionIdentity = Readonly<{
  kind: 'oidc'
  googleSubject: string
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
  visibility: 'private' | 'organization'
  credentialHome: GoogleCredentialHomeBinding
  now: Date
}>

export const buildGoogleConnection = (args: BuildConnectionArgs) => {
  if (args.identity.googleSubject.length === 0) {
    return err(integrationError('oauth_failed', 'Invalid Google identity'))
  }
  if (!isValidVisibility(args.visibility)) {
    return err(
      integrationError('invalid_visibility', `Invalid visibility: ${args.visibility}`),
    )
  }
  if (!canReplaceGoogleCredentialHome(null, args.credentialHome, 'new_grant')) {
    return err(integrationError('oauth_failed', 'Google credential home is unavailable'))
  }

  return ok<GoogleConnection>({
    id: args.id,
    organizationId: args.organizationId,
    googleSubject: args.identity.googleSubject,
    encryptedAccessToken: args.encryptedAccessToken,
    encryptedRefreshToken: args.encryptedRefreshToken,
    tokenExpiresAt: args.tokenExpiresAt,
    scopes: args.scopes,
    credentialAuthorizedBy: args.connectedBy,
    connectedBy: args.connectedBy,
    visibility: args.visibility,
    status: 'active',
    credentialUseState: 'active',
    cleanupMaterialDeadlineAt: null,
    lifecycleVersion: 1,
    accessVersion: 1,
    credentialGeneration: 1,
    credentialHomeCellId: args.credentialHome.homeCellId,
    credentialHomePolicyVersion: args.credentialHome.cataloguePolicyVersion,
    credentialHomeAuthorityGeneration: args.credentialHome.authorityGeneration,
    encryptionKeyId: 'v1',
    lastSuccessfulSyncAt: null,
    statusReason: null,
    statusChangedAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  })
}

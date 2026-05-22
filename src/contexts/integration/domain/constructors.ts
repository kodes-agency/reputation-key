// Integration context — entity constructors

import type { GoogleConnection, GbpImportJob } from './types'
import type {
  GoogleConnectionId,
  GbpImportJobId,
  OrganizationId,
  UserId,
} from '#/shared/domain/ids'
import { ok, err } from 'neverthrow'
import { integrationError } from './errors'
import { isValidVisibility, isValidEmail } from './rules'

type BuildConnectionArgs = Readonly<{
  id: GoogleConnectionId
  organizationId: OrganizationId
  googleAccountId: string
  googleEmail: string
  encryptedAccessToken: string
  encryptedRefreshToken: string
  tokenExpiresAt: Date
  scopes: ReadonlyArray<string>
  connectedBy: UserId
  visibility: 'private' | 'organization'
  now: Date
}>

export const buildGoogleConnection = (args: BuildConnectionArgs) => {
  if (!isValidEmail(args.googleEmail)) {
    return err(integrationError('oauth_failed', 'Invalid Google email'))
  }
  if (!isValidVisibility(args.visibility)) {
    return err(
      integrationError('invalid_visibility', `Invalid visibility: ${args.visibility}`),
    )
  }

  return ok<GoogleConnection>({
    id: args.id,
    organizationId: args.organizationId,
    googleAccountId: args.googleAccountId,
    googleEmail: args.googleEmail,
    encryptedAccessToken: args.encryptedAccessToken,
    encryptedRefreshToken: args.encryptedRefreshToken,
    tokenExpiresAt: args.tokenExpiresAt,
    scopes: args.scopes,
    connectedBy: args.connectedBy,
    visibility: args.visibility,
    status: 'active',
    createdAt: args.now,
    updatedAt: args.now,
  })
}

type BuildImportJobArgs = Readonly<{
  id: GbpImportJobId
  organizationId: OrganizationId
  initiatedBy: UserId
  totalCount: number
  now: Date
}>

export const buildGbpImportJob = (args: BuildImportJobArgs) =>
  ok<GbpImportJob>({
    id: args.id,
    organizationId: args.organizationId,
    initiatedBy: args.initiatedBy,
    status: 'queued',
    totalCount: args.totalCount,
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    createdAt: args.now,
    updatedAt: args.now,
  })

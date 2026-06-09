// Integration context — entity constructors

import type {
  GoogleConnection,
  GbpCacheEntry,
  GbpImportJob,
  GbpCacheDataType,
} from './types'
import type {
  GoogleConnectionId,
  GbpImportJobId,
  GbpCacheEntryId,
  OrganizationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import { ok, err } from '#/shared/domain'
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

type CreateGbpCacheEntryInput = Readonly<{
  id: GbpCacheEntryId
  organizationId: OrganizationId
  propertyId: PropertyId
  gbpPlaceId: string
  dataType: GbpCacheDataType
  payload: unknown
  googleAttribution: string | null
  fetchedAt: Date
  expiresAt: Date
  updatedAt: Date
}>

export const createGbpCacheEntry = (input: CreateGbpCacheEntryInput) => {
  // expiresAt > fetchedAt
  if (input.expiresAt <= input.fetchedAt) {
    return err(
      integrationError('invalid_cache_entry', 'expiresAt must be after fetchedAt'),
    )
  }

  // Required fields present
  if (!input.id) {
    return err(integrationError('invalid_cache_entry', 'id is required'))
  }
  if (!input.organizationId) {
    return err(integrationError('invalid_cache_entry', 'organizationId is required'))
  }
  if (!input.propertyId) {
    return err(integrationError('invalid_cache_entry', 'propertyId is required'))
  }
  if (!input.gbpPlaceId) {
    return err(integrationError('invalid_cache_entry', 'gbpPlaceId is required'))
  }

  return ok<GbpCacheEntry>({
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    gbpPlaceId: input.gbpPlaceId,
    dataType: input.dataType,
    payload: input.payload,
    googleAttribution: input.googleAttribution,
    fetchedAt: input.fetchedAt,
    expiresAt: input.expiresAt,
    updatedAt: input.updatedAt,
  })
}

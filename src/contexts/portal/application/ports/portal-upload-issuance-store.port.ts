import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type {
  PortalUploadIssuance,
  PortalUploadObservedMetadata,
} from '../../domain/upload-issuance'

export type PortalUploadScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  issuanceId: string
}>

export type StagePortalUploadResult =
  | Readonly<{ outcome: 'staged'; heroImageUrl: string | null }>
  | Readonly<{
      outcome: 'not_found' | 'not_issued' | 'expired' | 'metadata_mismatch'
    }>

export type PublishPortalUploadResult =
  | Readonly<{ outcome: 'published'; heroImageUrl: string }>
  | Readonly<{ outcome: 'stale' | 'already_finalized' | 'not_found' }>

export type PortalUploadIssuanceStore = Readonly<{
  create(issuance: PortalUploadIssuance): Promise<void>
  findScoped(scope: PortalUploadScope): Promise<PortalUploadIssuance | null>
  rejectIssued(
    scope: PortalUploadScope,
    reason: 'rejected' | 'expired',
    at: Date,
  ): Promise<boolean>
  stage(
    scope: PortalUploadScope,
    observed: PortalUploadObservedMetadata,
    at: Date,
  ): Promise<StagePortalUploadResult>
  findProcessable(scope: PortalUploadScope): Promise<PortalUploadIssuance | null>
  publishDerivative(
    scope: PortalUploadScope,
    derivative: Readonly<{
      heroKey: string
      thumbnailKey: string
      heroImageUrl: string
    }>,
    at: Date,
  ): Promise<PublishPortalUploadResult>
}>

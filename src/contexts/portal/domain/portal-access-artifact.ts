import { assert } from '#/shared/domain/assert'
import type {
  OrganizationId,
  PortalAccessArtifactId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'

export const PORTAL_ACCESS_ARTIFACT_CHANNELS = ['qr', 'nfc'] as const
export type PortalAccessArtifactChannel = (typeof PORTAL_ACCESS_ARTIFACT_CHANNELS)[number]

export type PortalAccessArtifact = Readonly<{
  id: PortalAccessArtifactId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalTokenId: string
  channel: PortalAccessArtifactChannel
  status: 'published'
  publishedAt: Date
  retiredAt: null
}>

export function publishPortalAccessArtifact(
  input: Readonly<{
    id: PortalAccessArtifactId
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    portalTokenId: string
    channel: PortalAccessArtifactChannel
    now: Date
  }>,
): PortalAccessArtifact {
  assert(input.id.trim().length > 0, 'Access Artifact id is required')
  assert(input.organizationId.trim().length > 0, 'Organization id is required')
  assert(input.propertyId.trim().length > 0, 'Property id is required')
  assert(input.portalId.trim().length > 0, 'Portal id is required')
  assert(input.portalTokenId.trim().length > 0, 'Portal address id is required')
  assert(
    (PORTAL_ACCESS_ARTIFACT_CHANNELS as readonly string[]).includes(input.channel),
    'Access Artifact channel must be qr or nfc',
  )
  assert(
    input.now instanceof Date && !Number.isNaN(input.now.getTime()),
    'now must be Date',
  )
  return {
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    portalTokenId: input.portalTokenId,
    channel: input.channel,
    status: 'published',
    publishedAt: input.now,
    retiredAt: null,
  }
}

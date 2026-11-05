import { Result } from '#/shared/domain'
import type { ScanEvent, ScanSource } from './types'
import type {
  ScanEventId,
  OrganizationId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { GuestError } from './errors'
import { validateSource } from './rules'

export type BuildScanEventInput = Readonly<{
  id: ScanEventId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  sessionId: string
  ipHash: string | null
  now: Date
}>

export const buildScanEvent = (
  input: BuildScanEventInput,
): Result<ScanEvent, GuestError> => {
  const sourceResult = validateSource(input.source)

  return sourceResult.map((_validSource): ScanEvent => ({
    id: input.id,
    organizationId: input.organizationId,
    portalId: input.portalId,
    propertyId: input.propertyId,
    source: input.source,
    sessionId: input.sessionId,
    ipHash: input.ipHash,
    createdAt: input.now,
  }))
}

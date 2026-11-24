import type { GuestObservationStore } from './guest-observation-store.port.server'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  ScanEventId,
  PortalAccessArtifactId,
  QualifiedScanId,
} from '#/shared/domain/ids'
import type { PortalPublicApi } from '#/contexts/portal/public-api'
import type { ScanEvent } from '../domain/types'
import { guestQualifiedScanRecorded, guestScanRecorded } from '../domain/events'
import { classifyQualifiedScanRequest } from '../domain/qualified-scan'
import type { ResolvePrimaryStaffAttribution } from '#/contexts/guest/responses/contracts'
import type { GuestObservationLossReporter } from './guest-observation-loss-monitor.port.server'

export type RecordScanDeps = Readonly<{
  observationStore: GuestObservationStore
  accessArtifacts: Pick<PortalPublicApi, 'isPrintCode' | 'resolvePublishedAccessArtifact'>
  idGen: () => ScanEventId
  qualifiedScanIdGen: () => QualifiedScanId
  clock: () => Date
  resolvePrimaryStaffAttribution: ResolvePrimaryStaffAttribution
  reportObservationLoss: GuestObservationLossReporter
}>

export type RecordScanInput = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  accessArtifactId: PortalAccessArtifactId | null
  publicationSnapshotId: string
  rawToken: string
  sessionId: string
  userAgent: string | null
  purpose: string | null
  secPurpose: string | null
}>

export type RecordScanOutcome =
  'qualified' | 'duplicate' | 'diagnostic' | 'retryable' | 'failed'

export const recordScan =
  (deps: RecordScanDeps) =>
  async (input: RecordScanInput): Promise<RecordScanOutcome> => {
    let observationLossReported = false
    const reportObservationLoss = async () => {
      if (observationLossReported) return
      observationLossReported = true
      // A broken monitor must never turn best-effort analytics into a public
      // journey failure. The production reporter already resolves degraded;
      // this second boundary protects injected/alternate implementations.
      try {
        await deps.reportObservationLoss('scan')
      } catch {
        // Intentionally suppressed at the fail-open public boundary.
      }
    }
    try {
      const occurredAt = deps.clock()
      // A print code is its own marker: the portal API says so from the address's
      // shape, and the lookup reads the channel from the code (ADR 0069).
      const markerImplied = deps.accessArtifacts.isPrintCode(input.rawToken)
      const decision = classifyQualifiedScanRequest({ ...input, markerImplied })
      let artifact: Awaited<
        ReturnType<PortalPublicApi['resolvePublishedAccessArtifact']>
      > = null
      let artifactVerificationUnavailable = false
      if (decision.eligible && (input.accessArtifactId || markerImplied)) {
        try {
          artifact = await deps.accessArtifacts.resolvePublishedAccessArtifact({
            accessArtifactId: input.accessArtifactId,
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            portalId: input.portalId,
            publicationSnapshotId: input.publicationSnapshotId,
            rawToken: input.rawToken,
            asOf: occurredAt,
          })
        } catch {
          artifactVerificationUnavailable = true
          await reportObservationLoss()
        }
      }
      let qualifiedOutcome: RecordScanOutcome | null = null
      if (artifact) {
        const staffAttribution = await deps.resolvePrimaryStaffAttribution({
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          portalId: input.portalId,
          observedAt: occurredAt,
        })
        const qualifiedScanId = deps.qualifiedScanIdGen()
        const fact = guestQualifiedScanRecorded({
          qualifiedScanId,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          portalId: input.portalId,
          portalGroupId: artifact.portalGroupId,
          accessArtifactId: artifact.accessArtifactId,
          occurredAt,
          staffAttribution,
        })
        const outcome = await deps.observationStore.commitQualifiedScan(
          {
            id: qualifiedScanId,
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            portalId: input.portalId,
            portalGroupId: artifact.portalGroupId,
            accessArtifactId: artifact.accessArtifactId,
            sourceEventId: fact.eventId,
            occurredAt,
            staffAttribution,
          },
          input.sessionId,
          fact,
        )
        qualifiedOutcome = outcome === 'applied' ? 'qualified' : 'duplicate'
      }

      try {
        const scanId = deps.idGen()
        const scan: ScanEvent = {
          id: scanId,
          organizationId: input.organizationId,
          portalId: input.portalId,
          propertyId: input.propertyId,
          source: artifact?.channel ?? 'direct',
          sessionId: input.sessionId,
          ipHash: null,
          createdAt: occurredAt,
        }
        await deps.observationStore.commitScan(
          scan,
          guestScanRecorded({
            scanId,
            organizationId: input.organizationId,
            portalId: input.portalId,
            propertyId: input.propertyId,
            scanSource: scan.source,
            occurredAt: scan.createdAt,
          }),
        )
      } catch {
        await reportObservationLoss()
        if (!qualifiedOutcome) return 'failed'
      }

      if (qualifiedOutcome) return qualifiedOutcome
      return artifactVerificationUnavailable ? 'retryable' : 'diagnostic'
    } catch {
      // Scan analytics is not the render critical path, but its loss is
      // durable and visible through the content-free monitor.
      await reportObservationLoss()
      return 'failed'
    }
  }

export type RecordScan = ReturnType<typeof recordScan>

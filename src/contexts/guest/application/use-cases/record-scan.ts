import type { GuestObservationStore } from '../ports/guest-observation-store.port'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  ScanEventId,
  PortalAccessArtifactId,
  QualifiedScanId,
} from '#/shared/domain/ids'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import { guestQualifiedScanRecorded, guestScanRecorded } from '../../domain/events'
import { buildScanEvent } from '../../domain/constructors'
import { classifyQualifiedScanRequest } from '../../domain/qualified-scan'
import type { PrimaryStaffAttributionResolver } from '../ports/primary-staff-attribution.port'
import type { GuestObservationLossReporter } from '../ports/guest-observation-loss-monitor.port'

export type RecordScanDeps = Readonly<{
  observationStore: GuestObservationStore
  accessArtifacts: Pick<PortalPublicApi, 'resolvePublishedAccessArtifact'>
  idGen: () => ScanEventId
  qualifiedScanIdGen: () => QualifiedScanId
  clock: () => Date
  resolvePrimaryStaffAttribution: PrimaryStaffAttributionResolver
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
      const decision = classifyQualifiedScanRequest(input)
      let artifact: Awaited<
        ReturnType<PortalPublicApi['resolvePublishedAccessArtifact']>
      > = null
      let artifactVerificationUnavailable = false
      if (decision.eligible && input.accessArtifactId) {
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
        const scanResult = buildScanEvent({
          id: scanId,
          organizationId: input.organizationId,
          portalId: input.portalId,
          propertyId: input.propertyId,
          source: artifact?.channel ?? 'direct',
          sessionId: input.sessionId,
          ipHash: null,
          now: occurredAt,
        })
        if (scanResult.isErr()) throw scanResult.error
        const scan = scanResult.value
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

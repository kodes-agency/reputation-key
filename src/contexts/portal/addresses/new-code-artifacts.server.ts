// Portal context — the two access artifacts of a code that is being made.
//
// A code has one QR marker and one NFC marker, published with it in the same
// command (ADR 0069 derives a print code from each). Issue and replace make them
// the same way, so there is one spelling: the artifacts, the facts that say they
// were published, and their ids, which the print codes are derived from.

import { portalAccessArtifactId } from '#/shared/domain/ids'
import { portalAccessArtifactPublished } from '../domain/events'
import {
  publishPortalAccessArtifact,
  type PortalAccessArtifactChannel,
} from '../domain/portal-access-artifact'
import type { Portal } from '../domain/types'

export function publishNewCodeArtifacts(
  input: Readonly<{
    portal: Pick<Portal, 'id' | 'organizationId' | 'propertyId'>
    portalTokenId: string
    idGen: () => string
    occurredAt: Date
    /** The Portal's new aggregate revision, which every fact of the command carries. */
    revision: Date
  }>,
) {
  const { portal, occurredAt } = input
  const publish = (channel: PortalAccessArtifactChannel) =>
    publishPortalAccessArtifact({
      id: portalAccessArtifactId(input.idGen()),
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      portalTokenId: input.portalTokenId,
      channel,
      now: occurredAt,
    })
  const qr = publish('qr')
  const nfc = publish('nfc')
  const eventFor = (artifact: typeof qr) =>
    portalAccessArtifactPublished({
      accessArtifactId: artifact.id,
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      channel: artifact.channel,
      sourceAggregateVersion: input.revision.toISOString(),
      occurredAt,
    })
  return {
    accessArtifacts: [qr, nfc] as const,
    accessArtifactEvents: [eventFor(qr), eventFor(nfc)] as const,
    artifactIds: { qr: qr.id, nfc: nfc.id },
  }
}

// Does the working copy still say what a published snapshot says?
//
// One comparison for the two callers that ask: the history use case (is there a
// pending change?) and the publish transaction (did the content move while the
// snapshot was being committed?). The working copy itself is read once, by
// infrastructure/portal-working-copy.reader.ts.
//
// Only a schema version 3 snapshot can match: it is the only shape publishing
// writes. A version 1 or 2 snapshot is the earlier design, so the working copy
// (which would publish version 3) has by definition moved past it.

import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  type PortalPublicationSnapshot,
} from '../domain/portal-publication-snapshot'
import {
  resolvePortalPublication,
  type ImmersivePublicationContent,
  type PortalPublicationSource,
} from '../domain/portal-publication-source'

type ComparableContent = Readonly<{
  organizationId: string
  propertyId: string
  privateFeedbackThreshold: number
  content: ImmersivePublicationContent
}>

/** What a v3 snapshot published, in the shape of a working copy's resolved content. */
export function publishedContent(
  snapshot: PortalPublicationSnapshot,
): ComparableContent | null {
  const configuration = snapshot.configuration
  if (configuration.schemaVersion !== IMMERSIVE_HUB_SCHEMA_VERSION) return null
  return {
    organizationId: snapshot.organizationId,
    propertyId: snapshot.propertyId,
    privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
    content: {
      portal: configuration.portal,
      guestLocale: configuration.guestLocale,
      languagePackVersion: configuration.languagePackVersion,
      localeSet: configuration.localeSet,
      languagePackVersions: configuration.languagePackVersions,
      localizedContent: configuration.localizedContent,
      linktree: configuration.linktree,
      links: configuration.links,
      brandProfile: configuration.brandProfile,
      timeZone: configuration.timeZone,
      ...(configuration.provenance ? { provenance: configuration.provenance } : {}),
    },
  }
}

/**
 * The working copy, resolved exactly as publishing would resolve it. Every
 * field of a v3 snapshot is in here, so no change a guest could see goes
 * unnoticed.
 */
export function comparableWorkingContent(
  workingCopy: PortalPublicationSource,
): ComparableContent {
  return {
    organizationId: workingCopy.organizationId,
    propertyId: workingCopy.propertyId,
    privateFeedbackThreshold: workingCopy.privateFeedbackThreshold,
    content: resolvePortalPublication(workingCopy).content,
  }
}

export function workingCopyMatchesSnapshot(
  workingCopy: PortalPublicationSource,
  snapshot: PortalPublicationSnapshot,
): boolean {
  const published = publishedContent(snapshot)
  return (
    published !== null &&
    canonicalizeRfc8785(comparableWorkingContent(workingCopy)) ===
      canonicalizeRfc8785(published)
  )
}

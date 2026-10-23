const AUTOMATED_AGENT_PATTERN =
  /bot|crawler|spider|slurp|headlesschrome|lighthouse|preview|facebookexternalhit|whatsapp|telegrambot|curl|wget|python-requests|node-fetch|axios|httpclient|go-http-client/iu
const SPECULATIVE_PURPOSE_PATTERN = /prefetch|prerender/iu

export type QualifiedScanExclusionReason =
  'access_artifact_missing' | 'prefetch' | 'automated_agent'

export type QualifiedScanRequestDecision =
  | Readonly<{ eligible: true }>
  | Readonly<{ eligible: false; reason: QualifiedScanExclusionReason }>

export function classifyQualifiedScanRequest(
  input: Readonly<{
    accessArtifactId: string | null
    /**
     * The address names its own artifact, so no marker is needed: it is a print
     * code (ADR 0069), whose channel the lookup reads from the code itself. A
     * website or "Public address" visit is not, and is still refused here.
     */
    markerImplied: boolean
    userAgent: string | null
    purpose: string | null
    secPurpose: string | null
  }>,
): QualifiedScanRequestDecision {
  if (!input.accessArtifactId && !input.markerImplied) {
    return { eligible: false, reason: 'access_artifact_missing' }
  }
  if (
    SPECULATIVE_PURPOSE_PATTERN.test(input.purpose ?? '') ||
    SPECULATIVE_PURPOSE_PATTERN.test(input.secPurpose ?? '')
  ) {
    return { eligible: false, reason: 'prefetch' }
  }
  if (!input.userAgent?.trim() || AUTOMATED_AGENT_PATTERN.test(input.userAgent)) {
    return { eligible: false, reason: 'automated_agent' }
  }
  return { eligible: true }
}

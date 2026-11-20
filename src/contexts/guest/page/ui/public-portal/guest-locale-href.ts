import type { GuestLocale } from '#/shared/domain/guest-locale'

/**
 * The address of a portal in another language. The public channel marker
 * (`accessArtifact`) travels with it, so switching language does not lose how
 * the guest arrived.
 */
export function guestLocaleHref(
  token: string,
  locale: GuestLocale,
  accessArtifactId: string | undefined,
): string {
  const artifactParam = accessArtifactId
    ? `&accessArtifact=${encodeURIComponent(accessArtifactId)}`
    : ''
  return `/p/${encodeURIComponent(token)}?locale=${locale}${artifactParam}`
}

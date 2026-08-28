import {
  GuestResponseForm,
  type GuestResponseAction,
  type GuestResponseFormProps,
} from './guest-response-form'
import {
  PortalSecondaryLinks,
  type PortalCategory,
  type PortalLinkItem,
} from './portal-secondary-links'
import type { PublicGoogleReviewDestination } from '#/contexts/portal/application/public-api'
import { getGuestPortalCopy } from './guest-language-pack'

export type { PortalCategory, PortalLinkItem } from './portal-secondary-links'

export type PublicPortalContentProps = Readonly<{
  /** Omitted only by authenticated manager previews. Public pages must supply it. */
  token?: string
  /** Public channel marker preserved when the guest switches language. */
  accessArtifactId?: string
  portal: {
    name: string
    description: string | null
    organizationName: string
    heroImageUrl: string | null
    theme: Record<string, string | number | boolean | null> | null
    logoUrl?: string | null
  }
  categories: ReadonlyArray<PortalCategory>
  links: ReadonlyArray<PortalLinkItem>
  reviewGateway?: Readonly<{
    privateFeedbackThreshold: number
    googleReview: Readonly<{ status: PublicGoogleReviewDestination['status'] }>
  }>
  localization?: Readonly<{
    selectedLocale: 'en' | 'bg'
    primaryLocale: 'en' | 'bg'
    availableLocales: readonly ('en' | 'bg')[]
    languagePackVersion?: 'guest-ui-en-v1' | 'guest-ui-bg-v1'
  }>
  selectSecondaryLink?: GuestResponseAction<
    { token: string; csrfNonce: string; linkId: string },
    { url: string }
  >
  responseForm?: Omit<
    GuestResponseFormProps,
    'token' | 'googleReview' | 'locale' | 'languagePackVersion'
  >
}>

/** Secondary text. See `--portal-text-muted` for why this is not `opacity-*`. */
const MUTED_STYLE = { color: 'var(--portal-text-muted)' }

export function PublicPortalContent({
  token,
  accessArtifactId,
  portal,
  categories,
  links,
  reviewGateway,
  localization,
  selectSecondaryLink,
  responseForm,
}: PublicPortalContentProps) {
  // The stored theme is an open JSON record, so each colour is narrowed rather
  // than asserted; the fallbacks match the domain default theme (#6366F1).
  const primaryColor =
    typeof portal.theme?.primaryColor === 'string' ? portal.theme.primaryColor : '#6366F1'
  const backgroundColor =
    typeof portal.theme?.backgroundColor === 'string'
      ? portal.theme.backgroundColor
      : '#ffffff'
  const textColor =
    typeof portal.theme?.textColor === 'string' ? portal.theme.textColor : '#111827'
  const selectedLocale = localization?.selectedLocale ?? 'en'
  const languagePackVersion =
    localization?.languagePackVersion ??
    (selectedLocale === 'bg' ? 'guest-ui-bg-v1' : 'guest-ui-en-v1')
  const copy = getGuestPortalCopy(selectedLocale, languagePackVersion)

  const themeStyle = {
    '--portal-primary': primaryColor,
    '--portal-bg': backgroundColor,
    '--portal-text': textColor,
    // Derived tints so surfaces and rules track the accent instead of the
    // hardcoded grays that used to make the Dark palette unreadable.
    '--portal-accent-soft': `color-mix(in srgb, ${primaryColor} 12%, transparent)`,
    '--portal-accent-border': `color-mix(in srgb, ${primaryColor} 40%, transparent)`,
    // Secondary text is mixed toward the portal's OWN background rather than
    // dimmed with `opacity-*`. Opacity composites against whatever happens to
    // be painted behind the element, so a preview rendered on a dark surface
    // produced dark-on-dark text (axe measured 1.08:1). Mixing on the
    // text→background axis yields an opaque colour whose contrast is a property
    // of the palette, not of the container.
    '--portal-text-muted': `color-mix(in srgb, ${textColor} 72%, ${backgroundColor})`,
  }

  const secondaryLinks =
    links.length > 0
      ? (activeCsrfNonce: string) => (
          <PortalSecondaryLinks
            token={token}
            csrfNonce={activeCsrfNonce}
            organizationName={portal.organizationName}
            categories={categories}
            links={links}
            selectSecondaryLink={selectSecondaryLink}
            locale={selectedLocale}
            languagePackVersion={languagePackVersion}
          />
        )
      : undefined

  const isPublicPortal = token !== undefined
  const publicGatewayReady =
    isPublicPortal && responseForm !== undefined && reviewGateway !== undefined

  return (
    <div
      className="min-h-screen"
      lang={selectedLocale}
      dir="ltr"
      style={{
        backgroundColor: 'var(--portal-bg, #ffffff)',
        color: 'var(--portal-text, #111827)',
        ...themeStyle,
      }}
    >
      <div className="mx-auto max-w-lg space-y-8 px-4 py-8">
        {token && localization && localization.availableLocales.length > 1 && (
          <nav
            aria-label={copy.languageNavigationLabel}
            className="flex justify-end gap-2 text-sm"
          >
            {localization.availableLocales.map((locale) => (
              <a
                key={locale}
                href={`/p/${encodeURIComponent(token)}?locale=${locale}${
                  accessArtifactId
                    ? `&accessArtifact=${encodeURIComponent(accessArtifactId)}`
                    : ''
                }`}
                hrefLang={locale}
                aria-current={locale === localization.selectedLocale ? 'page' : undefined}
                className="rounded-md border px-2 py-1"
              >
                {locale === 'bg' ? 'Български' : 'English'}
              </a>
            ))}
          </nav>
        )}
        {portal.logoUrl && (
          <img
            src={portal.logoUrl}
            alt={copy.portalLogoAlt(portal.organizationName)}
            className="mx-auto h-16 max-w-48 object-contain"
          />
        )}
        {portal.heroImageUrl && (
          <img
            src={portal.heroImageUrl}
            alt=""
            className="h-48 w-full rounded-lg object-cover"
          />
        )}

        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">{portal.name}</h1>
          <div
            className="mx-auto h-1 w-12 rounded-full"
            style={{ backgroundColor: 'var(--portal-primary)' }}
            aria-hidden
          />
          <p className="text-sm" style={MUTED_STYLE}>
            {portal.organizationName}
          </p>
        </div>

        {portal.description && (
          <p className="text-center" style={MUTED_STYLE}>
            {portal.description}
          </p>
        )}

        {publicGatewayReady ? (
          <GuestResponseForm
            token={token}
            googleReview={reviewGateway.googleReview}
            locale={selectedLocale}
            languagePackVersion={languagePackVersion}
            secondaryLinks={secondaryLinks}
            {...responseForm}
          />
        ) : isPublicPortal ? (
          <section role="status" className="rounded-lg border p-5 text-center">
            <h2 className="font-semibold">{copy.gatewayUnavailableTitle}</h2>
            <p className="mt-2 text-sm">{copy.gatewayUnavailableBody}</p>
          </section>
        ) : (
          <>
            <section className="rounded-lg border p-5 text-center">
              <h2 className="text-lg font-semibold">{copy.previewRatingTitle}</h2>
              <p className="mt-1 text-sm" style={MUTED_STYLE}>
                {copy.previewRatingBody}
              </p>
            </section>
            {secondaryLinks?.(responseForm?.csrfNonce ?? '')}
          </>
        )}
      </div>
    </div>
  )
}

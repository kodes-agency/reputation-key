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
import { PortalLanguageNav } from './portal-language-nav'
import { resolvePortalLocale, type PortalLocalization } from './portal-localization'
import { resolvePortalThemeStyle } from './portal-theme-style'

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
  localization?: PortalLocalization
  selectSecondaryLink?: GuestResponseAction<
    { token: string; csrfNonce: string; linkId: string },
    { url: string }
  >
  responseForm?: Omit<
    GuestResponseFormProps,
    'token' | 'googleReview' | 'locale' | 'languagePackVersion'
  >
}>

/**
 * Secondary text. See `resolvePortalThemeStyle` for why `--portal-text-muted`
 * is an opaque mixed colour rather than an `opacity-*` utility.
 */
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
  const { selectedLocale, languagePackVersion } = resolvePortalLocale(localization)
  const copy = getGuestPortalCopy(selectedLocale, languagePackVersion)
  const themeStyle = resolvePortalThemeStyle(portal.theme)

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
      {/* `main` is the landmark every word below belongs to. Without it a
          screen-reader user navigating by landmark finds nothing on the guest
          surface — axe reports it as landmark-one-main plus a region
          violation for the heading. */}
      <main className="mx-auto max-w-lg space-y-8 px-4 py-8">
        <PortalLanguageNav
          token={token}
          accessArtifactId={accessArtifactId}
          localization={localization}
          navigationLabel={copy.languageNavigationLabel}
        />
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
      </main>
    </div>
  )
}

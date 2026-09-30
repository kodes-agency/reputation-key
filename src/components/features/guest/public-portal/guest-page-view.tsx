import type { ReactNode } from 'react'
import { getGuestPortalCopy, type GuestPortalCopy } from './guest-language-pack'
import {
  previewFormViewProps,
  type GuestPagePreviewState,
} from './guest-page-preview-state'
import { PortalLanguageNav } from './portal-language-nav'
import { resolvePortalLocale, type PortalLocalization } from './portal-localization'
import { resolvePortalThemeStyle } from './portal-theme-style'
import { GuestGatewayUnavailable } from './guest-response-state-panels'
import {
  GuestResponseFormView,
  type GuestResponseFormViewProps,
} from './guest-response-form-view'

export type GuestPagePortal = Readonly<{
  name: string
  description: string | null
  organizationName: string
  heroImageUrl: string | null
  theme: Record<string, string | number | boolean | null> | null
  logoUrl?: string | null
}>

/** What the response area of the page shows. */
export type GuestPageBody =
  /** The public page: the response form, bound to its session by the container. */
  | Readonly<{ kind: 'live'; form: GuestResponseFormViewProps }>
  /** A controlled state rendered from static data. Mounts no server action. */
  | Readonly<{
      kind: 'preview'
      previewState: GuestPagePreviewState
      privateFeedbackThreshold?: number
      secondaryLinks?: ReactNode
    }>
  /** A public page whose review gateway did not resolve: fail closed. */
  | Readonly<{ kind: 'unavailable' }>
  /** The manager's sketch of the page: a static rating card, then the links. */
  | Readonly<{ kind: 'manager'; secondaryLinks?: ReactNode }>

export type GuestPageViewProps = Readonly<{
  /** Omitted only by authenticated manager previews. */
  token?: string
  /** Public channel marker preserved when the guest switches language. */
  accessArtifactId?: string
  portal: GuestPagePortal
  localization?: PortalLocalization
  /**
   * `page` fills the viewport (the public route). `container` fills whatever
   * frame it is placed in, so the view fits a phone frame in a preview.
   */
  height?: 'page' | 'container'
  body: GuestPageBody
}>

/**
 * Secondary text. See `resolvePortalThemeStyle` for why `--portal-text-muted`
 * is an opaque mixed colour rather than an `opacity-*` utility.
 */
const MUTED_STYLE = { color: 'var(--portal-text-muted)' }

const HEIGHT_CLASS = { page: 'min-h-screen', container: 'min-h-full' } as const

/**
 * The guest page as a pure view of its props. It never reads a session, calls a
 * server function or mounts an action: the container binds those and hands the
 * finished state in. That is what lets a manager preview, a story and the
 * anti-gating test render exactly the markup a guest gets.
 */
export function GuestPageView({
  token,
  accessArtifactId,
  portal,
  localization,
  height = 'container',
  body,
}: GuestPageViewProps) {
  const { selectedLocale, languagePackVersion } = resolvePortalLocale(localization)
  const copy = getGuestPortalCopy(selectedLocale, languagePackVersion)

  return (
    <div
      className={HEIGHT_CLASS[height]}
      lang={selectedLocale}
      dir="ltr"
      style={{
        backgroundColor: 'var(--portal-bg, #ffffff)',
        color: 'var(--portal-text, #111827)',
        ...resolvePortalThemeStyle(portal.theme),
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

        <GuestPageBodyView body={body} copy={copy} />
      </main>
      <footer className="mx-auto max-w-lg px-4 pb-8 text-center text-sm">
        <a href="/privacy" className="underline underline-offset-4" style={MUTED_STYLE}>
          {copy.privacyNotice}
        </a>
      </footer>
    </div>
  )
}

function GuestPageBodyView({
  body,
  copy,
}: Readonly<{ body: GuestPageBody; copy: GuestPortalCopy }>) {
  switch (body.kind) {
    case 'live':
      return <GuestResponseFormView {...body.form} />
    case 'preview':
      return (
        <GuestResponseFormView
          {...previewFormViewProps(body.previewState, {
            copy,
            privateFeedbackThreshold: body.privateFeedbackThreshold,
            secondaryLinks: body.secondaryLinks,
          })}
        />
      )
    case 'unavailable':
      return <GuestGatewayUnavailable copy={copy} />
    case 'manager':
      return (
        <>
          <section className="rounded-lg border p-5 text-center">
            <h2 className="text-lg font-semibold">{copy.previewRatingTitle}</h2>
            <p className="mt-1 text-sm" style={MUTED_STYLE}>
              {copy.previewRatingBody}
            </p>
          </section>
          {body.secondaryLinks}
        </>
      )
  }
}

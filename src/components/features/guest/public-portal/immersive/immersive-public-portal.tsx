import type { PublicImmersiveLoaderData } from '#/contexts/guest/application/dto/public-portal.dto'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PortalVisitRecorder } from '../../portal-visit-recording'
import { guestCopyText } from '../guest-copy-format'
import type { SelectSecondaryLinkAction } from '../guest-response-form-types'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { trackedLinkHref } from '../portal-link-href'
import { GuestHeader } from './guest-header'
import { GuestLanguageSwitcher } from './guest-language-switcher'
import { GuestTitleBlock } from './guest-title-block'
import type { GuestResponseActions } from './guest-response-actions'
import { ImmersiveFooter } from './immersive-footer'
import { immersiveFooterCopy } from './immersive-footer-copy'
import { ImmersiveLinktree } from './immersive-linktree'
import { bindLinkTapCounter } from './linktree-follow'
import { ImmersiveResponseView } from './immersive-response-view'
import { ImmersiveShell } from './immersive-shell'
import { useGuestClock } from './use-guest-clock'
import { useImmersiveGuestResponse } from './use-immersive-guest-response'

/** What the route hands a live Immersive Hub page: the loader's data, the pack and the bound actions. */
export type ImmersivePublicPortalProps = Readonly<{
  token: string
  /** The public channel marker, kept when the guest switches language. */
  accessArtifactId?: string
  /** The one v2 pack of the page's language. */
  pack: GuestPortalCopyV2
  immersive: PublicImmersiveLoaderData
  selectedLocale: GuestLocale
  /** Every language the portal offers, in its own order. */
  availableLocales: readonly GuestLocale[]
  googleReview: Readonly<{ status: 'available' | 'unavailable' }>
  /** The signed session's nonce and the guest's response so far. */
  csrfNonce: string
  initialResponse: GuestResponseView | null
  availability: 'available' | 'permission_denied' | 'error'
  /** The instant the server read the page: deadlines are written against it first, then it moves on with the time the page is open (`useGuestClock`). */
  servedAt: string
  actions: GuestResponseActions &
    Readonly<{
      selectSecondaryLink: SelectSecondaryLinkAction
    }>
  onPortalVisit: PortalVisitRecorder
}>

/** A tenant that cannot take a response, and a failed read, read the same to a guest. */
const AVAILABILITY = {
  available: 'available',
  permission_denied: 'unavailable',
  error: 'unavailable',
} as const

/**
 * The live guest page of a schema version 3 portal: the Immersive Hub bound to
 * its token. The header, title, response area, Linktree and footer are the
 * pure pieces slices 12 to 17 built; this wires them to the session, to the
 * server actions and to visit recording, and chooses nothing about how they look.
 *
 * Every tile navigates through the click route and counts a tap in the
 * background, independently of the response state.
 */
export function ImmersivePublicPortal(props: ImmersivePublicPortalProps) {
  const { token, pack, immersive, selectedLocale } = props
  const { brand, content } = immersive
  const session = useImmersiveGuestResponse({
    token,
    csrfNonce: props.csrfNonce,
    initialResponse: props.initialResponse,
    googleReviewAvailable: props.googleReview.status === 'available',
    availability: AVAILABILITY[props.availability],
    actions: props.actions,
  })
  const { csrfNonce, yourResponse, ...response } = session
  const now = useGuestClock(props.servedAt, session.response)

  return (
    <ImmersiveShell
      brand={brand}
      heroAlt={{
        value: content.heroAlt.value,
        lang: content.heroAlt.fallbackFrom ?? undefined,
      }}
      lang={selectedLocale}
      height="page"
    >
      <GuestHeader
        displayName={brand.displayName}
        wordmark={brand.wordmark}
        logo={brand.logo}
        logoAlt={guestCopyText(pack, 'logoAlt', { name: brand.displayName })}
      >
        <GuestLanguageSwitcher
          locales={props.availableLocales}
          selectedLocale={selectedLocale}
          token={token}
          accessArtifactId={props.accessArtifactId}
          copy={pack.copy}
        />
      </GuestHeader>
      <GuestTitleBlock
        title={{
          value: content.title.value,
          lang: content.title.fallbackFrom ?? undefined,
        }}
        displayName={brand.displayName}
      />
      <ImmersiveResponseView
        {...response}
        pack={pack}
        displayName={brand.displayName}
        yourResponse={{
          ...yourResponse,
          clock: { now, timeZone: immersive.timeZone },
        }}
      />
      <ImmersiveLinktree
        enabled={immersive.linktree.enabled}
        title={content.linktreeTitle}
        defaultTitle={pack.copy.linktreeDefaultTitle}
        links={immersive.links}
        hrefFor={(linkId) => trackedLinkHref(token, linkId)}
        countTap={bindLinkTapCounter({
          token,
          csrfNonce,
          selectSecondaryLink: props.actions.selectSecondaryLink,
        })}
      />
      <ImmersiveFooter
        copy={immersiveFooterCopy(pack, brand.displayName)}
        scopeKey={token}
        sessionKey={csrfNonce}
        onPortalVisit={props.onPortalVisit}
      />
    </ImmersiveShell>
  )
}

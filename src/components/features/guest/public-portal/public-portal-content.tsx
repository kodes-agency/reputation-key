import type { ReactNode } from 'react'
import type { GuestResponseAction, GuestResponseFormProps } from './guest-response-form'
import {
  PortalSecondaryLinks,
  type PortalCategory,
  type PortalLinkItem,
} from './portal-secondary-links'
import type { PublicGoogleReviewDestination } from '#/contexts/portal/application/public-api'
import {
  GuestPageView,
  type GuestPagePortal,
  type GuestPageViewProps,
} from './guest-page-view'
import type { GuestPagePreviewState } from './guest-page-preview-state'
import { resolvePortalLocale, type PortalLocalization } from './portal-localization'
import { useGuestResponseFormView } from './use-guest-response-form-view'

export type { PortalCategory, PortalLinkItem } from './portal-secondary-links'

export type PublicPortalContentProps = Readonly<{
  /** Omitted only by authenticated manager previews. Public pages must supply it. */
  token?: string
  /** Public channel marker preserved when the guest switches language. */
  accessArtifactId?: string
  portal: GuestPagePortal
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
  /**
   * Renders a controlled state from static data instead of the live form. No
   * server action is mounted, so previews and stories can show any state.
   */
  previewState?: GuestPagePreviewState
}>

type SecondaryLinksInput = Pick<
  PublicPortalContentProps,
  'token' | 'portal' | 'categories' | 'links' | 'selectSecondaryLink' | 'localization'
>

/** The "More from" links, bound to the session nonce the caller supplies. */
function secondaryLinksFor(
  {
    token,
    portal,
    categories,
    links,
    selectSecondaryLink,
    localization,
  }: SecondaryLinksInput,
  csrfNonce: string,
): ReactNode {
  if (links.length === 0) return undefined
  const { selectedLocale, languagePackVersion } = resolvePortalLocale(localization)
  return (
    <PortalSecondaryLinks
      token={token}
      csrfNonce={csrfNonce}
      organizationName={portal.organizationName}
      categories={categories}
      links={links}
      selectSecondaryLink={selectSecondaryLink}
      locale={selectedLocale}
      languagePackVersion={languagePackVersion}
    />
  )
}

/**
 * The guest page bound to its token: the container around `GuestPageView`.
 * Only a public page with a resolved review gateway mounts the response
 * actions. A preview state, a manager preview and a gateway that failed to
 * resolve render the pure view alone.
 */
export function PublicPortalContent(props: PublicPortalContentProps) {
  const { token, accessArtifactId, portal, localization, reviewGateway, responseForm } =
    props
  const isPublicPortal = token !== undefined
  const height = isPublicPortal ? 'page' : 'container'
  const view = { token, accessArtifactId, portal, localization, height } as const

  if (props.previewState) {
    return (
      <GuestPageView
        {...view}
        body={{
          kind: 'preview',
          previewState: props.previewState,
          privateFeedbackThreshold: reviewGateway?.privateFeedbackThreshold,
          secondaryLinks: secondaryLinksFor(props, responseForm?.csrfNonce ?? ''),
        }}
      />
    )
  }
  if (!isPublicPortal) {
    return (
      <GuestPageView
        {...view}
        body={{
          kind: 'manager',
          secondaryLinks: secondaryLinksFor(props, responseForm?.csrfNonce ?? ''),
        }}
      />
    )
  }
  if (responseForm === undefined || reviewGateway === undefined) {
    return <GuestPageView {...view} body={{ kind: 'unavailable' }} />
  }
  const { selectedLocale, languagePackVersion } = resolvePortalLocale(localization)
  return (
    <BoundGuestPage
      view={view}
      form={{
        token,
        googleReview: reviewGateway.googleReview,
        locale: selectedLocale,
        languagePackVersion,
        secondaryLinks: (csrfNonce) => secondaryLinksFor(props, csrfNonce),
        ...responseForm,
      }}
    />
  )
}

/** Owns the response session, so its hooks run only for a live public page. */
function BoundGuestPage({
  view,
  form,
}: Readonly<{
  view: Omit<GuestPageViewProps, 'body'>
  form: GuestResponseFormProps
}>) {
  const formView = useGuestResponseFormView(form)
  return <GuestPageView {...view} body={{ kind: 'live', form: formView }} />
}

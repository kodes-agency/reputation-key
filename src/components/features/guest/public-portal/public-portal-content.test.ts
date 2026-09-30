import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getGuestPortalCopy } from './guest-language-pack'
import {
  PublicPortalContent,
  type PublicPortalContentProps,
} from './public-portal-content'

const copy = getGuestPortalCopy('en', 'guest-ui-en-v1')
const NONCE = '00000000-0000-4000-8000-000000000040'

const refuse = () => vi.fn(async () => Promise.reject(new Error('action must not run')))
const responseForm = (): NonNullable<PublicPortalContentProps['responseForm']> => ({
  csrfNonce: NONCE,
  initialResponse: null,
  submitResponse: refuse(),
  correctResponse: refuse(),
  startNewResponse: refuse(),
  submitPrivateFeedback: refuse(),
  selectGoogleReview: refuse(),
  withdrawResponse: refuse(),
  withdrawPrivateFeedback: refuse(),
})

const base: PublicPortalContentProps = {
  portal: {
    name: 'The Harbor Hotel',
    description: null,
    organizationName: 'Harbor Hospitality',
    heroImageUrl: null,
    theme: null,
  },
  categories: [{ id: 'c1', title: 'Useful links' }],
  links: [
    { id: 'l1', label: 'Hotel website', url: 'https://example.com/', categoryId: 'c1' },
  ],
}
const gateway = {
  privateFeedbackThreshold: 3,
  googleReview: { status: 'available' as const },
}

const render = (props: Partial<PublicPortalContentProps>) =>
  renderToStaticMarkup(createElement(PublicPortalContent, { ...base, ...props }))

describe('PublicPortalContent', () => {
  it('renders a public page with a gateway as the live rating form', () => {
    const html = render({
      token: 'tok',
      reviewGateway: gateway,
      responseForm: responseForm(),
    })

    expect(html).toContain(copy.submitPrivateRating)
    expect(html).toContain('min-h-screen')
  })

  it('fails closed on a public page without a gateway', () => {
    const html = render({ token: 'tok' })

    expect(html).toContain(copy.gatewayUnavailableTitle)
    expect(html).not.toContain(copy.submitPrivateRating)
  })

  it('shows the manager sketch, sized to its frame, when there is no token', () => {
    const html = render({})

    expect(html).toContain(copy.previewRatingTitle)
    expect(html).toContain('min-h-full')
    expect(html).toContain(copy.moreLinksLabel)
  })

  it('renders a preview state with no token, nonce, click tracking or action', () => {
    const form = responseForm()
    const html = render({
      token: 'tok',
      accessArtifactId: 'artifact-1',
      reviewGateway: gateway,
      responseForm: form,
      selectSecondaryLink: refuse(),
      localization: {
        selectedLocale: 'en',
        primaryLocale: 'en',
        availableLocales: ['en', 'bg'],
        languagePackVersion: 'guest-ui-en-v1',
      },
      previewState: { kind: 'rated', rating: 2 },
    })

    expect(html).toContain(copy.continueToGoogle)
    expect(html).toContain(copy.privateFeedbackTitle)
    // The link goes straight to its destination: no tracked click, no recorded selection.
    expect(html).toContain('href="https://example.com/"')
    expect(html).not.toContain('/api/public/p/')
    // No language switch back to the real public page, and no session nonce.
    expect(html).not.toContain('/p/tok')
    expect(html).not.toContain('artifact-1')
    expect(html).not.toContain(NONCE)
    // A preview is sized to its frame, never to the viewport.
    expect(html).toContain('min-h-full')
    expect(html).not.toContain('min-h-screen')
  })

  it('uses the gateway threshold to decide a preview state note', () => {
    const html = render({
      reviewGateway: { ...gateway, privateFeedbackThreshold: 4 },
      previewState: { kind: 'rated', rating: 4 },
    })

    expect(html).toContain(copy.privateFeedbackTitle)
  })
})

// Cookie consent banner — a fixed bottom bar shown to guests who haven't yet
// consented to the duplicate-rating session cookie. The banner's visibility is
// derived from `localStorage` on mount (it renders `null` once consent is
// recorded), and the dismiss button persists consent + hides the bar.
//
// Stories share one browser page (and thus one localStorage), so each variant
// resets the consent key in `render` (runs at mount, before the banner's
// useEffect) — guaranteeing every variant starts from a known consent state
// regardless of the order stories execute in.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { CookieConsentBanner } from './cookie-consent-banner'

const CONSENT_KEY = 'guest-cookie-consent'

const meta: Meta<typeof CookieConsentBanner> = {
  title: 'Guest/CookieConsentBanner',
  component: CookieConsentBanner,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof CookieConsentBanner>

function renderWithoutConsent() {
  try {
    localStorage.removeItem(CONSENT_KEY)
  } catch {
    // ignore storage errors (sandbox / private mode)
  }
  return <CookieConsentBanner />
}

function renderWithConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, 'true')
  } catch {
    // ignore storage errors (sandbox / private mode)
  }
  return <CookieConsentBanner />
}

// No prior consent recorded — the banner mounts visible at the bottom of the
// viewport, explaining the session cookie.
export const Visible: Story = {
  render: () => renderWithoutConsent(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/we use a session cookie/i)).toBeInTheDocument()
  },
}

// Consent already recorded (e.g. a returning guest) — the banner's mount effect
// finds the stored flag and the component returns `null`, so nothing renders.
export const Dismissed: Story = {
  render: () => renderWithConsent(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText(/we use a session cookie/i)).toBeNull()
  },
}

// Dismissing persists consent to localStorage and unmounts the banner.
export const DismissWritesConsent: Story = {
  render: () => renderWithoutConsent(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Banner is present before dismissing.
    expect(canvas.getByText(/we use a session cookie/i)).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button'))

    // Consent is now persisted…
    expect(localStorage.getItem(CONSENT_KEY)).toBe('true')
    // …and the banner hides itself.
    await waitFor(() => {
      expect(canvas.queryByText(/we use a session cookie/i)).toBeNull()
    })
  },
}

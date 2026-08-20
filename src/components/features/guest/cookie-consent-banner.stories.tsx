// Guest analytics consent banner — a fixed bottom bar shown until the guest makes
// an explicit Accept/Reject choice. `portal.scan` requires
// `analyticsConsent: z.literal(true)`, so Accept is what drives the scan record:
// the banner reports consent to its parent at most once per browser session (guarded
// in `sessionStorage`, keyed by `scopeKey`) so refreshes cannot inflate the metric.
//
// Stories share one browser page (and thus one localStorage + sessionStorage), so
// each variant resets both keys in `render` (runs at mount, before the banner's
// useEffect) — guaranteeing every variant starts from a known state regardless of
// the order stories execute in.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { CookieConsentBanner } from './cookie-consent-banner'

const CONSENT_KEY = 'guest-analytics-consent'
const SCOPE_KEY = 'portal-public-token'
const SCAN_RECORDED_KEY = `guest-scan-recorded:${SCOPE_KEY}`

const meta: Meta<typeof CookieConsentBanner> = {
  title: 'Guest/CookieConsentBanner',
  component: CookieConsentBanner,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { scopeKey: SCOPE_KEY },
}
export default meta
type Story = StoryObj<typeof CookieConsentBanner>

function renderWithStoredDecision(
  decision: 'granted' | 'denied' | null,
  onAnalyticsConsent: () => void,
) {
  try {
    sessionStorage.removeItem(SCAN_RECORDED_KEY)
    if (decision === null) localStorage.removeItem(CONSENT_KEY)
    else localStorage.setItem(CONSENT_KEY, decision)
  } catch {
    // ignore storage errors (sandbox / private mode)
  }
  return (
    <CookieConsentBanner scopeKey={SCOPE_KEY} onAnalyticsConsent={onAnalyticsConsent} />
  )
}

// No decision recorded — the banner mounts visible, disclosing the hashed-IP
// processing, and offers Reject as prominently as Accept.
export const Undecided: Story = {
  args: { onAnalyticsConsent: fn() },
  render: (args) => renderWithStoredDecision(null, args.onAnalyticsConsent),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/hashed version of your IP address/i)).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(args.onAnalyticsConsent).not.toHaveBeenCalled()
  },
}

// Accepting persists the grant and reports consent once, so the parent can record
// the scan the server refuses without `analyticsConsent: true`.
export const AcceptRecordsScan: Story = {
  args: { onAnalyticsConsent: fn() },
  render: (args) => renderWithStoredDecision(null, args.onAnalyticsConsent),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept' }))

    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted')
    expect(args.onAnalyticsConsent).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: 'Accept' })).toBeNull()
    })
  },
}

// Rejecting persists the refusal, hides the banner and records nothing.
export const RejectRecordsNothing: Story = {
  args: { onAnalyticsConsent: fn() },
  render: (args) => renderWithStoredDecision(null, args.onAnalyticsConsent),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Reject' }))

    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied')
    expect(args.onAnalyticsConsent).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: 'Reject' })).toBeNull()
    })
  },
}

// A returning guest who already accepted: nothing renders, and consent is reported
// once for this browser session so the visit is still counted.
export const AlreadyGranted: Story = {
  args: { onAnalyticsConsent: fn() },
  render: (args) => renderWithStoredDecision('granted', args.onAnalyticsConsent),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Accept' })).toBeNull()
    await waitFor(() => {
      expect(args.onAnalyticsConsent).toHaveBeenCalledTimes(1)
    })
  },
}

// A returning guest who already rejected: the banner stays hidden and never nags.
export const AlreadyDenied: Story = {
  args: { onAnalyticsConsent: fn() },
  render: (args) => renderWithStoredDecision('denied', args.onAnalyticsConsent),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(args.onAnalyticsConsent).not.toHaveBeenCalled()
  },
}

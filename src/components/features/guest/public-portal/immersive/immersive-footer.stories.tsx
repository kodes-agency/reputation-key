// The footer of boards G01 (the visit notice inline) and G04 (acknowledged),
// on the real shell. Axe runs on every story. The play functions add what axe
// cannot see: that the notice is in the flow and not an overlay, that "Got it"
// hides it, and that the visit is counted whatever the guest does with it.
import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { portalVisitStorageKey } from '../../portal-visit-recording'
import { VISIT_NOTICE_ACKNOWLEDGED_KEY } from '../../visit-notice-acknowledgement'
import { bgV2 } from '../language-packs/bg-v2'
import { deV2 } from '../language-packs/de-v2'
import { enV2 } from '../language-packs/en-v2'
import { ImmersiveFooter, ImmersiveFooterView } from './immersive-footer'
import { immersiveFooterCopy } from './immersive-footer-copy'
import { ImmersiveShell } from './immersive-shell'

const NAME = 'Avela Resort'
/** The privacy link's name starts with its text; a screen reader hears that it opens a new tab after it. */
const PRIVACY_LINK = /^Privacy notice/u
const SCOPE_KEY = 'footer-story-portal'
const SESSION_KEY = 'footer-story-session'
const BRAND = { accentColour: '#EAD6A8', fieldColour: '#15110D', hero: null } as const

const PhoneFrame: Decorator = (Story) => (
  <div style={{ width: 390, height: 520, margin: '0 auto', overflowY: 'auto' }}>
    <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
    <Story />
  </div>
)

function resetStorage(acknowledged: boolean) {
  try {
    sessionStorage.removeItem(portalVisitStorageKey(SCOPE_KEY, SESSION_KEY))
    if (acknowledged) localStorage.setItem(VISIT_NOTICE_ACKNOWLEDGED_KEY, 'true')
    else localStorage.removeItem(VISIT_NOTICE_ACKNOWLEDGED_KEY)
  } catch {
    // Ignore storage errors in restricted Storybook sandboxes.
  }
}

const meta: Meta<typeof ImmersiveFooterView> = {
  title: 'Features/Guest/ImmersiveFooter',
  component: ImmersiveFooterView,
  decorators: [PhoneFrame],
  parameters: { layout: 'fullscreen' },
  args: { isNoticeVisible: true, onAcknowledge: fn() },
  render: (args) => (
    <ImmersiveShell brand={BRAND} heroAlt={{ value: '' }} lang="en">
      <ImmersiveFooterView {...args} />
    </ImmersiveShell>
  ),
}
export default meta

type Story = StoryObj<typeof ImmersiveFooterView>

/** Board G01: the one-line notice, the privacy link and "Got it", inline at the page's end. */
export const G01NoticeShowing: Story = {
  args: { copy: immersiveFooterCopy(enV2, NAME) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const notice = canvas.getByRole('region', { name: 'Visit counting' })
    expect(notice).toHaveTextContent('one essential cookie')
    expect(notice).toHaveTextContent('privacy-protected marker')
    // In the flow, not an overlay: nothing is fixed to the viewport.
    for (const element of canvasElement.querySelectorAll('footer, footer *')) {
      expect(getComputedStyle(element).position).not.toBe('fixed')
    }
    // The footer sits at the end of the page and the notice is inside it.
    const footer = canvasElement.querySelector('footer')
    expect(footer?.contains(notice)).toBe(true)
    const privacy = canvas.getByRole('link', { name: PRIVACY_LINK })
    expect(privacy).toHaveAttribute('href', '/privacy')
    // The notice opens in a tab of its own, so a guest keeps their place on the page.
    expect(privacy).toHaveAttribute('target', '_blank')
    expect(privacy).toHaveAttribute('rel', 'noopener')
    expect(privacy).toHaveAccessibleName('Privacy notice (opens in a new tab)')
    // Every target is at least 44 px tall.
    const targets = [privacy, canvas.getByRole('button', { name: 'Got it' })]
    for (const target of targets) {
      expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    expect(canvas.queryByText('Made with Reputation Key')).toBeNull()
  },
}

/** Board G04: "Privacy notice" on the left, "Made with Reputation Key" on the right. */
export const G04Acknowledged: Story = {
  args: { copy: immersiveFooterCopy(enV2, NAME), isNoticeVisible: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('region', { name: 'Visit counting' })).toBeNull()
    expect(canvas.queryByRole('button')).toBeNull()
    const link = canvas.getByRole('link', { name: PRIVACY_LINK })
    const made = canvas.getByText('Made with Reputation Key')
    expect(link.getBoundingClientRect().left).toBeLessThan(
      made.getBoundingClientRect().left,
    )
    expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  },
}

/** Bulgarian copy; the notice wraps inside the phone width without clipping. */
export const Bulgarian: Story = {
  args: { copy: immersiveFooterCopy(bgV2, NAME) },
  render: (args) => (
    <ImmersiveShell brand={BRAND} heroAlt={{ value: '' }} lang="bg">
      <ImmersiveFooterView {...args} />
    </ImmersiveShell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const notice = canvas.getByRole('region', { name: bgV2.copy.visitNoticeLabel })
    expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth)
  },
}

/**
 * A page that is not in English says that the privacy notice is, in its own
 * language, and still fits the narrowest phone: the label wraps under "Verstanden"
 * rather than running off the screen.
 */
export const GermanSaysTheNoticeIsInEnglish: Story = {
  args: { copy: immersiveFooterCopy(deV2, NAME) },
  decorators: [
    (Story) => (
      <div data-testid="narrow-phone" style={{ width: 320, margin: '0 auto' }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <ImmersiveShell brand={BRAND} heroAlt={{ value: '' }} lang="de">
      <ImmersiveFooterView {...args} />
    </ImmersiveShell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole('link', {
      name: /^Datenschutzhinweis \(auf Englisch\)/u,
    })
    expect(link).toHaveAccessibleName(
      'Datenschutzhinweis (auf Englisch) (öffnet in neuem Tab)',
    )
    expect(link).toHaveAttribute('target', '_blank')
    const notice = canvas.getByRole('region', { name: deV2.copy.visitNoticeLabel })
    expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth)
    const narrow = canvasElement.querySelector<HTMLElement>(
      '[data-testid="narrow-phone"]',
    )
    expect((narrow as HTMLElement).scrollWidth).toBeLessThanOrEqual(320)
    for (const target of [link, canvas.getByRole('button', { name: 'Verstanden' })]) {
      expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  },
}

const recordVisit = fn(async () => 'recorded' as const)

function liveFooter(acknowledged: boolean) {
  resetStorage(acknowledged)
  recordVisit.mockClear()
  return (
    <ImmersiveShell brand={BRAND} heroAlt={{ value: '' }} lang="en">
      <ImmersiveFooter
        copy={immersiveFooterCopy(enV2, NAME)}
        scopeKey={SCOPE_KEY}
        sessionKey={SESSION_KEY}
        onPortalVisit={recordVisit}
      />
    </ImmersiveShell>
  )
}

/** A first visit counts as soon as the page mounts, before the guest touches the notice. */
export const FirstVisitIsCountedBeforeAcknowledging: Story = {
  render: () => liveFooter(false),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(recordVisit).toHaveBeenCalledTimes(1))
    expect(canvas.getByRole('region', { name: 'Visit counting' })).toBeVisible()
  },
}

/** "Got it" hides the notice, remembers the choice, and counts nothing twice. */
export const AcknowledgeHidesTheNotice: Story = {
  render: () => liveFooter(false),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(recordVisit).toHaveBeenCalledTimes(1))
    await userEvent.click(canvas.getByRole('button', { name: 'Got it' }))
    expect(localStorage.getItem(VISIT_NOTICE_ACKNOWLEDGED_KEY)).toBe('true')
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Got it' })).toBeNull(),
    )
    expect(canvas.getByText('Made with Reputation Key')).toBeVisible()
    expect(recordVisit).toHaveBeenCalledTimes(1)
  },
}

/** A guest who acknowledged earlier sees no notice and is still counted. */
export const AcknowledgedGuestIsStillCounted: Story = {
  render: () => liveFooter(true),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('region', { name: 'Visit counting' })).toBeNull()
    await waitFor(() => expect(recordVisit).toHaveBeenCalledTimes(1))
  },
}

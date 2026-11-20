import type { ReactNode } from 'react'
import {
  usePortalVisitRecording,
  type PortalVisitRecorder,
} from '../../portal-visit-recording'
import { useVisitNoticeAcknowledgement } from '../../visit-notice-acknowledgement'
import type { ImmersiveFooterCopy } from './immersive-footer-copy'
import {
  IMMERSIVE_FOOTER_CSS,
  IMMERSIVE_FOOTER_STYLE_HREF,
} from './immersive-footer-styles'

const PRIVACY_HREF = '/privacy'

export type ImmersiveFooterViewProps = Readonly<{
  copy: ImmersiveFooterCopy
  /** Whether the visit notice is showing. It is inline in the footer, never an overlay. */
  isNoticeVisible: boolean
  onAcknowledge: () => void
}>

/**
 * The page footer as a pure view (boards G01 and G04). While the guest has not
 * acknowledged the notice, it holds the one-line notice, the privacy link and "Got
 * it". Afterwards it is one row: the privacy link and the attribution.
 */
export function ImmersiveFooterView({
  copy,
  isNoticeVisible,
  onAcknowledge,
}: ImmersiveFooterViewProps) {
  return (
    <FooterLayout
      copy={copy}
      isNoticeVisible={isNoticeVisible}
      privacyLink={
        <PrivacyLink
          href={PRIVACY_HREF}
          text={copy.privacyLink}
          opensNewTab={copy.privacyLinkOpensNewTab}
        />
      }
      acknowledge={
        <button type="button" className="ih-footer__ack" onClick={onAcknowledge}>
          <span className="ih-footer__ack-pill">{copy.acknowledge}</span>
        </button>
      }
    />
  )
}

/**
 * The footer as the admin's preview draws it: the same layout, but a picture. The
 * privacy link goes nowhere and "Got it" acknowledges nothing, so a manager
 * clicking through "Try as guest" neither leaves the editor nor sets the guest's
 * acknowledgement.
 */
export function InertImmersiveFooterView({
  copy,
  isNoticeVisible,
}: Omit<ImmersiveFooterViewProps, 'onAcknowledge'>) {
  return (
    <FooterLayout
      copy={copy}
      isNoticeVisible={isNoticeVisible}
      privacyLink={
        <PrivacyLink
          href={undefined}
          text={copy.privacyLink}
          opensNewTab={copy.privacyLinkOpensNewTab}
        />
      }
      acknowledge={
        <span className="ih-footer__ack ih-footer__ack--inert">
          <span className="ih-footer__ack-pill">{copy.acknowledge}</span>
        </span>
      }
    />
  )
}

/**
 * An anchor with no `href` is not a link: it keeps the look and is neither
 * focusable nor announced. A live link opens the notice in a tab of its own, so
 * a guest who is part-way through a rating or a note keeps their place, and says
 * so to a screen reader.
 */
function PrivacyLink({
  href,
  text,
  opensNewTab,
}: Readonly<{ href: string | undefined; text: string; opensNewTab: string }>) {
  const opensTab = href !== undefined
  return (
    <a
      href={href}
      target={opensTab ? '_blank' : undefined}
      rel={opensTab ? 'noopener' : undefined}
      className="ih-link-accent ih-footer__link"
    >
      {text}
      {opensTab && <span className="ih-sr-only"> {opensNewTab}</span>}
    </a>
  )
}

function FooterLayout({
  copy,
  isNoticeVisible,
  privacyLink,
  acknowledge,
}: Omit<ImmersiveFooterViewProps, 'onAcknowledge'> &
  Readonly<{ privacyLink: ReactNode; acknowledge: ReactNode }>) {
  return (
    <footer className="ih-footer">
      <style href={IMMERSIVE_FOOTER_STYLE_HREF} precedence="default">
        {IMMERSIVE_FOOTER_CSS}
      </style>
      {isNoticeVisible ? (
        <section aria-label={copy.noticeLabel} className="ih-footer__notice">
          <p className="ih-footer__text">{copy.visitNotice}</p>
          <div className="ih-footer__actions">
            {privacyLink}
            {acknowledge}
          </div>
        </section>
      ) : (
        <div className="ih-footer__row">
          {privacyLink}
          <p className="ih-footer__made">{copy.madeWith}</p>
        </div>
      )}
    </footer>
  )
}

export type ImmersiveFooterProps = Readonly<{
  copy: ImmersiveFooterCopy
  /** Stable Portal identity used to separate visits to different Portals. */
  scopeKey: string
  /** Signed-session identity used to separate successive guests in one browser tab. */
  sessionKey: string
  /** Invoked once per browser session to record the portal visit. */
  onPortalVisit: PortalVisitRecorder
}>

/**
 * The footer of a live Immersive Hub page: the view, bound to the guest's
 * acknowledgement and to visit recording. Recording does not depend on the
 * notice: the visit is counted on mount, whether the guest acknowledges the
 * notice, has already done so, or never sees it (ADR 0044).
 *
 * Known trade-off: the server cannot read the acknowledgement, so it renders
 * the one-row acknowledged footer and an unacknowledged guest sees it swap to
 * the taller notice after hydration. The footer is in flow at the end of the
 * page, so that is a layout shift below everything the guest is reading.
 * Slice 18's CLS observer measures it on a first visit
 * (docs/plan/portal-round-4-implementation.md, slice 17 carried forward).
 */
export function ImmersiveFooter({
  copy,
  scopeKey,
  sessionKey,
  onPortalVisit,
}: ImmersiveFooterProps) {
  const { isNoticeVisible, acknowledge } = useVisitNoticeAcknowledgement()
  usePortalVisitRecording({ scopeKey, sessionKey, onPortalVisit })
  return (
    <ImmersiveFooterView
      copy={copy}
      isNoticeVisible={isNoticeVisible}
      onAcknowledge={acknowledge}
    />
  )
}

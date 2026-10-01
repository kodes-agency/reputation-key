// The footer of the previewed page: the visit notice, the privacy link and the
// "made with" line, in the pack's words. The link goes nowhere in a preview.

import { guestCopyText } from '#/components/features/guest'
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import { previewStyles as styles } from './preview-page-styles'

export function PreviewFooter({
  copy,
  displayName,
}: Readonly<{ copy: GuestPortalCopyV2; displayName: string }>) {
  return (
    <footer style={styles.footer}>
      <p style={styles.notice}>
        {guestCopyText(copy, 'visitNotice', { name: displayName })}
      </p>
      <p style={styles.footerLine}>
        <span className="ih-link-accent" style={{ textDecoration: 'underline' }}>
          {copy.copy.privacyNoticeLink}
        </span>
        {' · '}
        {copy.copy.footerMadeWith}
      </p>
    </footer>
  )
}

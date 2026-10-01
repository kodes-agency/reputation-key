// The top of the previewed guest page: the wordmark or logo, the language chip,
// and the title block (the portal's title above the property's name).
//
// The chip is drawn but does not open the sheet: the pane's own language switch
// is the control, and a guest-page control that answered to nothing would only
// mislead a manager clicking through "Try as guest".

import { Globe } from 'lucide-react'
import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import { glassClassName, guestCopyText } from '#/components/features/guest'
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import type { PortalPreviewExperience } from '#/contexts/portal/application/public-api'
import { previewStyles as styles } from './preview-page-styles'

type Props = Readonly<{
  experience: PortalPreviewExperience
  copy: GuestPortalCopyV2
  locale: GuestLocale
  /** More than one language shows the chip; one shows none. */
  hasLanguageChip: boolean
}>

export function PreviewPageTop({ experience, copy, locale, hasLanguageChip }: Props) {
  const { brand, content } = experience
  const metadata = GUEST_LOCALE_METADATA[locale]
  return (
    <>
      <header style={styles.header}>
        {brand.logo ? (
          <img
            src={brand.logo.url}
            alt={guestCopyText(copy, 'logoAlt', { name: brand.displayName })}
            width={brand.logo.width}
            height={brand.logo.height}
            style={styles.logo}
          />
        ) : (
          <p className="ih-display" style={styles.wordmark}>
            {brand.wordmark ?? brand.displayName}
          </p>
        )}
        {hasLanguageChip ? (
          <span
            className={glassClassName('chip')}
            style={styles.chip}
            role="img"
            aria-label={`${copy.copy.languageChipLabel}: ${metadata.nativeName}`}
          >
            <Globe aria-hidden="true" size={14} />
            {metadata.chipLabel}
          </span>
        ) : null}
      </header>
      <div style={styles.titleBlock}>
        <h1 style={styles.kicker} lang={content.title.fallbackFrom ?? undefined}>
          {content.title.value}
        </h1>
        <p className="ih-display" style={styles.name}>
          {brand.displayName}
        </p>
      </div>
    </>
  )
}

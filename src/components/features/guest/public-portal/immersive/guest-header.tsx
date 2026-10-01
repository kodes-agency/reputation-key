import type { ReactNode } from 'react'

export type GuestHeaderProps = Readonly<{
  displayName: string
  /** The short name set in capitals; the display name stands in when there is none. */
  wordmark: string | null
  /** The property's logo, shown in place of the wordmark. */
  logo: Readonly<{ url: string; width: number; height: number }> | null
  /** The logo's description, already in the page's language. */
  logoAlt: string
  /** The language switcher, when the portal has more than one language. */
  children?: ReactNode
}>

/**
 * The top bar of the Immersive Hub (board G01): the property's wordmark or
 * logo on the left and, when the portal has several languages, the language
 * chip on the right. The brand mark is text or an image, never a heading: the
 * page's one `h1` is the title block's.
 */
export function GuestHeader({
  displayName,
  wordmark,
  logo,
  logoAlt,
  children,
}: GuestHeaderProps) {
  const mark = wordmark?.trim() || displayName
  return (
    <header className="ih-header">
      {logo ? (
        // The photo is the page's one eager, high-priority image. The logo is
        // above the fold too, but small: it loads at the browser's own priority.
        <img
          className="ih-logo"
          src={logo.url}
          alt={logoAlt}
          width={logo.width}
          height={logo.height}
          decoding="async"
        />
      ) : (
        <p className="ih-display ih-wordmark">{mark}</p>
      )}
      {children}
    </header>
  )
}

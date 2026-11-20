import type { CSSProperties, ReactNode } from 'react'

export type GuestHeaderProps = Readonly<{
  /**
   * The property's display name. The header no longer repeats it: the title block
   * beneath prints it large, so a property with no wordmark and no logo has no
   * mark here. Kept so callers need not change.
   */
  displayName?: string
  /** The short name set in capitals. With none (and no logo) the header shows no mark. */
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
 *
 * A mark that is not there is not made up. The display name stood in for a
 * missing wordmark, but the large name sits right beneath, so it was the same
 * words twice, small and cut off. Without a wordmark or a logo the header is the
 * chip alone.
 *
 * The wordmark is never cut off. How big it is drawn is the stylesheet's job
 * (`immersive-chrome-styles.ts`): it needs only the letters' count, which is
 * handed over as `--ih-wm-n`.
 */
export function GuestHeader({ wordmark, logo, logoAlt, children }: GuestHeaderProps) {
  const mark = wordmark?.trim() ?? ''
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
        mark !== '' && (
          <p
            className="ih-display ih-wordmark"
            style={{ '--ih-wm-n': [...mark].length } as CSSProperties}
          >
            {mark}
          </p>
        )
      )}
      {children}
    </header>
  )
}

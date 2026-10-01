import type { CSSProperties, ReactNode } from 'react'
import { GuestBackdrop } from './guest-backdrop'
import { GuestHero, type ImmersiveHeroAlt, type ImmersiveHeroMedia } from './guest-hero'
import { resolveImmersiveLook, type ImmersiveBrandColours } from './immersive-look'
import { IMMERSIVE_CSS, IMMERSIVE_STYLE_HREF } from './immersive-styles'

export type ImmersiveShellProps = Readonly<{
  /** The two brand colours and, when the property has one, its photo. */
  brand: ImmersiveBrandColours & Readonly<{ hero: ImmersiveHeroMedia | null }>
  /**
   * The photo's description; an empty value marks the photo decorative. `lang`
   * is set when the text is a fallback from another language than the page's.
   */
  heroAlt: ImmersiveHeroAlt
  /** The page's language: it selects hyphenation and the screen-reader voice. */
  lang: string
  /**
   * `page` fills the viewport (the public route): it is the page's `main`
   * landmark and it owns the document's colour scheme and body colour.
   * `container` fills whatever frame it is placed in, so a preview fits a
   * phone frame: it is a plain `div`, since the host page owns the landmark,
   * and it leaves the host document alone.
   */
  height?: 'page' | 'container'
  children?: ReactNode
}>

/**
 * The frame of the Immersive Hub (snapshot schema v3): the colour field, the
 * backdrop and hero behind it, and a centred column for the page's content. At
 * page height it is the page's `main` landmark. The header, title, rating card, Linktree and
 * footer are the children (slices 13 to 17).
 *
 * It owns the page's look: colours from `resolveImmersiveLook`, glass and
 * type from its stylesheet, and it answers the app's global link, theme and
 * line-breaking rules so none of them reaches the page (see the stylesheet).
 */
export function ImmersiveShell({
  brand,
  heroAlt,
  lang,
  height = 'container',
  children,
}: ImmersiveShellProps) {
  const look = resolveImmersiveLook(brand)
  const Frame = height === 'page' ? 'main' : 'div'
  return (
    <Frame
      className={`ih-root ih-root--${height}`}
      lang={lang}
      dir="ltr"
      data-ih-surface={brand.hero ? 'photo' : 'field'}
      style={look.style as CSSProperties}
    >
      <style href={IMMERSIVE_STYLE_HREF} precedence="default">
        {IMMERSIVE_CSS}
      </style>
      {/* The hero first: its eager, high-priority request is the one the preload
          scanner meets, and the blurred copy of the same URL follows it. Stacking
          is by z-index, not by order. */}
      <GuestHero hero={brand.hero} alt={heroAlt} />
      <GuestBackdrop hero={brand.hero} />
      <div className="ih-column">{children}</div>
    </Frame>
  )
}

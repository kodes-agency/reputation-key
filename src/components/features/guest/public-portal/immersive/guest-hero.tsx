import type { CSSProperties } from 'react'

/** A hero photo as the page receives it: a served URL, its real size and its focal point. */
export type ImmersiveHeroMedia = Readonly<{
  url: string
  width: number
  height: number
  /** 0 (left) to 1 (right) and 0 (top) to 1 (bottom): the part of the photo to keep when cropped. */
  focalX: number
  focalY: number
}>

/** The hero's description; `lang` is set when it is a fallback from another language than the page's. */
export type ImmersiveHeroAlt = Readonly<{ value: string; lang?: string }>

/** `object-position` for a focal point, clamped so a bad value cannot leave the photo. */
export function focalObjectPosition(focalX: number, focalY: number): string {
  const percent = (value: number) =>
    `${Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5)) * 100)}%`
  return `${percent(focalX)} ${percent(focalY)}`
}

/**
 * The top of the page: the property photo fading into the field, or, with no
 * photo, the arch motif of board G09. The photo is the page's largest contentful
 * paint, so it is the one image that loads eagerly and at high priority, and its
 * box is sized by CSS and declared by `width`/`height` so nothing moves when it
 * arrives.
 */
export function GuestHero({
  hero,
  alt,
}: Readonly<{ hero: ImmersiveHeroMedia | null; alt: ImmersiveHeroAlt }>) {
  if (!hero) return <GuestArch />
  const style = {
    '--ih-focal': focalObjectPosition(hero.focalX, hero.focalY),
  } as CSSProperties
  return (
    <div className="ih-hero" data-ih-hero="photo" style={style}>
      <img
        className="ih-hero__image"
        src={hero.url}
        alt={alt.value}
        lang={alt.value && alt.lang ? alt.lang : undefined}
        width={hero.width}
        height={hero.height}
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
      <div className="ih-hero__scrim ih-hero__scrim--top" aria-hidden="true" />
      <div className="ih-hero__scrim ih-hero__scrim--title" aria-hidden="true" />
    </div>
  )
}

/** Two concentric arch outlines, the colonnade of the no-photo page. Decorative. */
function GuestArch() {
  return (
    <svg
      className="ih-arch"
      data-ih-hero="arch"
      aria-hidden="true"
      focusable="false"
      width={390}
      height={250}
      viewBox="0 0 390 250"
      fill="none"
    >
      <path
        d="M85 250 V122 A110 110 0 0 1 305 122 V250"
        stroke="currentColor"
        strokeOpacity={0.26}
        strokeWidth={1}
      />
      <path
        d="M101 250 V126 A94 94 0 0 1 289 126 V250"
        stroke="currentColor"
        strokeOpacity={0.13}
        strokeWidth={1}
      />
    </svg>
  )
}

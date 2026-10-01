import { useId, type CSSProperties } from 'react'
import { focalObjectPosition, type ImmersiveHeroMedia } from './guest-hero'

/**
 * What the page is painted on. With a photo: a blurred, darkened copy of it
 * over the field, with two soft washes of colour. Without one: the field
 * itself, three washes of the accent's tones and a film of grain, so the colour
 * carries the page until a photo is uploaded. Decorative throughout.
 */
export function GuestBackdrop({ hero }: Readonly<{ hero: ImmersiveHeroMedia | null }>) {
  return hero ? <PhotoBackdrop hero={hero} /> : <FieldBackdrop />
}

function PhotoBackdrop({ hero }: Readonly<{ hero: ImmersiveHeroMedia }>) {
  const style = {
    '--ih-focal': focalObjectPosition(hero.focalX, hero.focalY),
  } as CSSProperties
  return (
    <div className="ih-backdrop" data-ih-backdrop="photo" aria-hidden="true">
      <img
        className="ih-backdrop__photo"
        style={style}
        src={hero.url}
        alt=""
        width={hero.width}
        height={hero.height}
        decoding="async"
        fetchPriority="low"
      />
      <div className="ih-backdrop__wash ih-backdrop__wash--photo" />
    </div>
  )
}

function FieldBackdrop() {
  // One filter per mounted backdrop: ids are document-wide.
  const filterId = useId()
  return (
    <div className="ih-backdrop" data-ih-backdrop="field" aria-hidden="true">
      <div className="ih-backdrop__wash ih-backdrop__wash--field" />
      <svg className="ih-backdrop__grain" focusable="false">
        <filter id={filterId}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency={0.85}
            numOctaves={2}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${filterId})`} />
      </svg>
    </div>
  )
}

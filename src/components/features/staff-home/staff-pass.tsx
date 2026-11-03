import type { ReactNode } from 'react'
import { focalObjectPosition } from '#/components/features/guest/public-portal/immersive/guest-hero'
import { usePreviewFinalLogo } from '#/components/features/portal/portal-share/use-print-final-pictures'
import { staffHeaderIsDark, staffLogoPlate } from './staff-look'
import type { StaffParticipation } from './types'

type Look = StaffParticipation['look']

/** A name past this length steps down a size, so it stays on two lines. */
const LONG_NAME = 28

function PassBrand({
  look,
  name,
  onDark,
}: Readonly<{ look: Look; name: string; onDark: boolean }>) {
  const logo = look.logo
  const read = usePreviewFinalLogo(logo?.url ?? null)
  if (!logo)
    return (
      <p className="staff-pass__name" data-long={name.length > LONG_NAME}>
        {name}
      </p>
    )
  const plate = staffLogoPlate({
    luminance: read.status === 'read' ? read.value.medianInkLuminance : null,
    onDark,
    accentColour: look.accentColour,
  })
  return (
    <img
      className="staff-pass__logo"
      src={logo.url}
      alt={name}
      width={logo.width}
      height={logo.height}
      data-plate={plate !== null}
      style={plate ? { backgroundColor: plate } : undefined}
    />
  )
}

/**
 * The one thing on the Code tab: a card like a boarding pass, in the paper, type
 * and scan band of the printed cards. Its header is the hotel's photo, or else its
 * colour; it names the hotel with its logo, or else its name.
 */
export function StaffPass({
  look,
  name,
  children,
  cue,
  lang,
}: Readonly<{
  look: Look
  name: string
  children: ReactNode
  cue?: string
  lang?: string
}>) {
  const hero = look.hero
  return (
    <article className="staff-pass" data-photo={hero !== null}>
      <header className="staff-pass__head">
        {hero ? (
          <img
            className="staff-pass__photo"
            src={hero.url}
            alt=""
            width={hero.width}
            height={hero.height}
            decoding="async"
            style={{ objectPosition: focalObjectPosition(hero.focalX, hero.focalY) }}
          />
        ) : null}
        <PassBrand look={look} name={name} onDark={staffHeaderIsDark(look)} />
      </header>
      {children}
      {cue ? (
        <p className="staff-pass__cue" lang={lang}>
          {cue}
        </p>
      ) : null}
    </article>
  )
}

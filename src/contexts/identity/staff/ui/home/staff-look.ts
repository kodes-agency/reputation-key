// The hotel's colours on the staff screens, worked out with the helpers its guest
// page and printed cards already use, so none of the three can drift. The pass
// wears the print's bar colours; a bar or a button on My results takes the accent
// the guest page can read on dark, or the print's darker ink on a light phone.
import type { CSSProperties } from 'react'
import {
  DEFAULT_IMMERSIVE_ACCENT,
  resolveImmersiveLook,
} from '#/components/features/guest/public-portal/immersive/immersive-look'
import { readableForegroundOn } from '#/shared/domain/portal-field-colour'
import {
  logoNeedsCreamPlate,
  logoNeedsPaperPlate,
  IMMERSIVE_LOGO_PLATE,
  paperLogoPlate,
  paperPrintKitPalette,
  PRINT_KIT_INK,
} from '#/shared/domain/portal-print-kit-palette'
import type { StaffParticipation } from './types'

type Look = StaffParticipation['look']

function staffGuestLook(look: Look | undefined) {
  return resolveImmersiveLook({
    accentColour: look?.accentColour || DEFAULT_IMMERSIVE_ACCENT,
    fieldColour: look?.fieldColour ?? '',
  })
}

/** The hotel's dark colour, which the Code tab sits on and the phone's own top bar takes. */
export function staffFieldColour(look: Look | undefined): string {
  return staffGuestLook(look).field
}

export function staffLookVariables(look: Look | undefined): CSSProperties {
  const accentColour = look?.accentColour || DEFAULT_IMMERSIVE_ACCENT
  const guest = staffGuestLook(look)
  const paper = paperPrintKitPalette(accentColour)
  return {
    '--staff-field': guest.field,
    '--staff-accent-dark': guest.accent,
    '--staff-on-accent-dark': guest.onAccent,
    '--staff-accent-light': paper.accentInk,
    '--staff-on-accent-light': readableForegroundOn(paper.accentInk),
    '--staff-band': paper.barFill,
    '--staff-on-band': paper.barText,
    '--staff-soft': paper.soft,
  } as CSSProperties
}

/** Whether the pass's header is dark: a photo's edge, or a band that takes white text. */
export function staffHeaderIsDark(look: NonNullable<Look>): boolean {
  if (look.hero) return true
  const accent = look.accentColour || DEFAULT_IMMERSIVE_ACCENT
  return paperPrintKitPalette(accent).barText !== PRINT_KIT_INK
}

/** The plate under a logo that would vanish on the pass's header; null needs none. */
export function staffLogoPlate(
  input: Readonly<{
    luminance: number | null
    /** On a photo's dark edge or a dark band. */
    onDark: boolean
    accentColour: string
  }>,
): string | null {
  if (input.onDark)
    return logoNeedsCreamPlate(input.luminance) ? IMMERSIVE_LOGO_PLATE : null
  return logoNeedsPaperPlate(input.luminance) ? paperLogoPlate(input.accentColour) : null
}

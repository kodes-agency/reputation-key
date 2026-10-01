// Portal context — save the Property look: the accent colour, the background
// and the wordmark guests see on every page of the Property. The public display
// name stays with Property settings, the images with the upload path, and the
// languages with `savePropertyDefaultGuestLocales`; this writes none of them.
//
// The write goes through the Brand Profile's own writer, so the profile's
// version fence, the `look_version` bump and the pending changes for the live
// Portals are the ones every look edit already gets.

import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  readLookContrast,
  type LookBackgroundMode,
} from '#/shared/domain/portal-look-readout'
import { parseHexColour } from '#/shared/domain/portal-field-colour'
import { portalError } from '../../domain/errors'
import { BACKGROUND_MODES, normaliseWordmark } from '../../domain/property-look'
import { assertPropertyAccess } from '../assert-property-access'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'

type Deps = Readonly<{
  experienceRepo: Pick<
    PortalExperienceRepository,
    'getPropertyExperience' | 'savePropertyProfile'
  >
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

export type SavePropertyLookInput = Readonly<{
  propertyId: string
  accentColour: string
  backgroundMode: LookBackgroundMode
  /** Read only when the background is manual. */
  backgroundColour?: string
  /** Left as it is when omitted; null (or only spaces) clears it. */
  wordmark?: string | null
}>

const INVALID_LOOK = 'invalid_theme'

/** The colours as the guest page would draw them, or the reason it could not. */
function checkedLook(input: SavePropertyLookInput, storedBackground: string) {
  if (!BACKGROUND_MODES.includes(input.backgroundMode)) {
    throw portalError(INVALID_LOOK, 'Choose an automatic or a manual background')
  }
  const isManual = input.backgroundMode === 'manual'
  if (parseHexColour(input.accentColour) === null) {
    throw portalError(INVALID_LOOK, 'Choose the accent as a six-digit colour')
  }
  if (isManual && parseHexColour(input.backgroundColour ?? '') === null) {
    throw portalError(INVALID_LOOK, 'Choose the background as a six-digit colour')
  }
  const readout = readLookContrast({
    accent: input.accentColour,
    backgroundMode: input.backgroundMode,
    backgroundColour: isManual ? (input.backgroundColour ?? '') : storedBackground,
  })
  if (readout === null) throw portalError(INVALID_LOOK, 'Choose valid colours')
  if (!readout.smallText.isReadable) {
    throw portalError(INVALID_LOOK, 'Page text cannot be read on this background')
  }
  if (!readout.accentOnField.isReadable) {
    throw portalError(INVALID_LOOK, 'This accent is hard to see on the page background')
  }
  return { accent: input.accentColour.toUpperCase(), isManual }
}

export const savePropertyLook =
  (deps: Deps) => async (input: SavePropertyLookInput, ctx: AuthContext) => {
    if (!canForContext(ctx, 'portal.admin')) {
      throw portalError(
        'forbidden',
        'Only an Account Admin can change Property-wide Portal branding',
      )
    }
    const pid = propertyId(input.propertyId)
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', pid)
    const { profile } = await deps.experienceRepo.getPropertyExperience(
      ctx.organizationId,
      pid,
    )
    if (!profile) {
      throw portalError(
        'brand_profile_missing',
        'Set the public display name before changing the look',
      )
    }
    const wordmark =
      input.wordmark === undefined ? undefined : normaliseWordmark(input.wordmark)
    const { accent, isManual } = checkedLook(input, profile.backgroundColor)
    return deps.experienceRepo.savePropertyProfile({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: pid,
      profile: {
        displayName: profile.displayName,
        // Images are server-owned: a look save keeps whatever the profile holds.
        logoUrl: profile.logoUrl,
        defaultHeroImageUrl: profile.defaultHeroImageUrl,
        primaryColor: accent,
        backgroundColor: isManual
          ? (input.backgroundColour ?? '').toUpperCase()
          : profile.backgroundColor,
        textColor: profile.textColor,
        backgroundMode: input.backgroundMode,
        ...(wordmark === undefined ? {} : { wordmark }),
      },
      updatedBy: ctx.userId,
      at: deps.clock(),
    })
  }

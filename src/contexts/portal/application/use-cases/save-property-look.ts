// Portal context — save the Property look: the accent colour, the background
// and the wordmark guests see on every page of the Property. The public display
// name stays with Property settings, the images with the upload path, and the
// languages with `savePropertyDefaultGuestLocales`; this writes none of them,
// and it does not count as a person confirming the display name.
//
// The write is the Brand Profile's look writer, which reads and writes inside
// the Property's publication lock, so the profile's `look_version` bump and the
// pending changes for the live Portals are the ones every look edit already
// gets, and nothing a name or image write does beside it is put back.
//
// What is refused: a colour that is not `#rrggbb`, and a manual background
// light text cannot be read on. An accent that is hard to see on its field is
// not: the guest page draws the text colour in its place (the page's readout
// says so), and the default palette every Property starts with is such an
// accent.

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
  experienceRepo: Pick<PortalExperienceRepository, 'savePropertyLook'>
  staffPublicApi: StaffPublicApi
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

/** The colours as the writer takes them, or the reason they cannot be saved. */
function checkedColours(input: SavePropertyLookInput) {
  if (!BACKGROUND_MODES.includes(input.backgroundMode)) {
    throw portalError(INVALID_LOOK, 'Choose an automatic or a manual background')
  }
  const isManual = input.backgroundMode === 'manual'
  if (parseHexColour(input.accentColour) === null) {
    throw portalError(INVALID_LOOK, 'Choose the accent as a six-digit colour')
  }
  const background = input.backgroundColour ?? ''
  if (isManual && parseHexColour(background) === null) {
    throw portalError(INVALID_LOOK, 'Choose the background as a six-digit colour')
  }
  const readout = readLookContrast({
    accent: input.accentColour,
    backgroundMode: input.backgroundMode,
    backgroundColour: background,
  })
  if (readout === null) throw portalError(INVALID_LOOK, 'Choose valid colours')
  if (!readout.smallText.isReadable) {
    throw portalError(INVALID_LOOK, 'Page text cannot be read on this background')
  }
  return {
    accent: input.accentColour.toUpperCase(),
    ...(isManual ? { background: background.toUpperCase() } : {}),
  }
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
    const wordmark =
      input.wordmark === undefined ? undefined : normaliseWordmark(input.wordmark)
    const { accent, background } = checkedColours(input)
    const saved = await deps.experienceRepo.savePropertyLook({
      organizationId: ctx.organizationId,
      propertyId: pid,
      look: {
        primaryColor: accent,
        backgroundMode: input.backgroundMode,
        ...(background === undefined ? {} : { backgroundColor: background }),
        ...(wordmark === undefined ? {} : { wordmark }),
      },
      actorUserId: ctx.userId,
      at: deps.clock(),
    })
    if (!saved) {
      throw portalError(
        'brand_profile_missing',
        'Set the public display name before changing the look',
      )
    }
    return saved
  }
